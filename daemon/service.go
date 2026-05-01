package daemon

import (
	"context"
	"log/slog"
	"strings"
	"sync"
	"time"

	"github.com/flokiorg/flnd"
	"github.com/flokiorg/flnd/lnrpc"
	"github.com/flokiorg/flnd/lnrpc/walletrpc"
	"github.com/flokiorg/flnd/signal"
	"github.com/flokiorg/go-flokicoin/chainutil"
	"github.com/flokiorg/go-flokicoin/chainutil/psbt"
	"github.com/flokiorg/lokinode/lokilog"
)

var log *slog.Logger = lokilog.For("daemon")

// Status represents the current lifecycle state of the FLND node.
type Status string

const (
	StatusInit        Status = "init"
	StatusNone        Status = "none"
	StatusStarting    Status = "starting"
	StatusLocked      Status = "locked"
	StatusUnlocked    Status = "unlocked"
	StatusSyncing     Status = "syncing"
	StatusReady       Status = "ready"
	StatusNoWallet    Status = "noWallet"
	StatusDown        Status = "down"
	StatusScanning    Status = "scanning"
	StatusBlock       Status = "block"
	StatusTransaction Status = "tx"
)

// Update carries a state transition and any associated metadata.
type Update struct {
	State                     Status
	Err                       error
	Transaction               *lnrpc.Transaction
	PortConflict              bool
	BlockHeight, SyncedHeight uint32
	BlockHash                 string
}

// OutputLock holds the locking details for a UTXO reserved during PSBT funding.
type OutputLock struct {
	ID       []byte
	Outpoint *lnrpc.OutPoint
}

// FundedPsbt wraps a funded PSBT packet together with its output locks.
type FundedPsbt struct {
	Packet *psbt.Packet
	Locks  []*OutputLock
}

// FetchTransactionsOptions controls the behaviour of FetchTransactionsWithOptions.
type FetchTransactionsOptions struct {
	ForceRescan bool
	IgnoreLimit bool
	OnProgress  func(count int)
}

// isPortConflict returns true when err looks like an "address already in use"
// failure from the OS network stack.
func isPortConflict(err error) bool {
	if err == nil {
		return false
	}
	msg := strings.ToLower(err.Error())
	return strings.Contains(msg, "address already in use") ||
		strings.Contains(msg, "bind: address") ||
		strings.Contains(msg, "only one usage of each socket")
}

// Service manages the full FLND daemon lifecycle — startup, client connection,
// health subscriptions, and auto-restart with exponential backoff.
type Service struct {
	subMu sync.Mutex
	subs  []chan *Update

	ctx    context.Context
	cancel context.CancelFunc

	flndConfig           *flnd.Config
	configMu             sync.Mutex
	maxTransactionsLimit uint32

	client    *Client
	daemon    *flndDaemon
	cmux      sync.Mutex
	wg        sync.WaitGroup
	running   bool
	lastEvent *Update
	stopOnce  sync.Once
}

// New creates a Service from a validated *flnd.Config and starts the FLND
// daemon in the background. The config is cloned internally so the caller may
// reuse it after this call.
func New(pctx context.Context, cfg *flnd.Config) *Service {
	ctx, cancel := context.WithCancel(pctx)
	s := &Service{
		lastEvent:  &Update{State: StatusInit},
		flndConfig: cfg,
		ctx:        ctx,
		cancel:     cancel,
	}
	go s.run()
	return s
}

func (s *Service) run() {
	s.wg.Add(1)
	defer s.wg.Done()

	retryDelay := time.Second
	const maxRetryDelay = 30 * time.Second

	for {
		select {
		case <-s.ctx.Done():
			log.Info("service context cancelled; stopping daemon")
			s.stopDaemon()
			return
		default:
			log.Info("service entering starting phase", "retry_delay", retryDelay)
			s.notifySubscribers(&Update{State: StatusStarting})

			// signal.Intercept() is a process-level singleton. There is a
			// tiny window between shutdownChannel closing (which unblocks
			// the previous waitForShutdown) and the handler goroutine
			// resetting the global "started" flag. Fast-retry on that
			// specific error instead of using the slow backoff path.
			var interceptor signal.Interceptor
			var interceptErr error
			for {
				interceptor, interceptErr = signal.Intercept()
				if interceptErr == nil {
					break
				}
				if !strings.Contains(interceptErr.Error(), "already started") {
					break
				}
				select {
				case <-s.ctx.Done():
					return
				case <-time.After(5 * time.Millisecond):
				}
			}
			if interceptErr != nil {
				log.Error("signal.Intercept failed", "err", interceptErr, "port_conflict", isPortConflict(interceptErr))
				s.notifySubscribers(&Update{State: StatusDown, Err: interceptErr, PortConflict: isPortConflict(interceptErr)})
				if !s.waitForRetry(retryDelay) {
					return
				}
				retryDelay = clampRetry(retryDelay*2, maxRetryDelay)
				continue
			}

			d, err := newDaemon(s.ctx, s.cloneConfig(), interceptor)
			if err != nil {
				log.Error("newDaemon failed", "err", err, "port_conflict", isPortConflict(err))
				s.notifySubscribers(&Update{State: StatusDown, Err: err, PortConflict: isPortConflict(err)})
				if !s.waitForRetry(retryDelay) {
					return
				}
				retryDelay = clampRetry(retryDelay*2, maxRetryDelay)
				continue
			}

			c, err := d.start()
			if err != nil {
				log.Error("daemon start failed", "err", err, "port_conflict", isPortConflict(err))
				s.notifySubscribers(&Update{State: StatusDown, Err: err, PortConflict: isPortConflict(err)})
				if !s.waitForRetry(retryDelay) {
					return
				}
				retryDelay = clampRetry(retryDelay*2, maxRetryDelay)
				continue
			}

			log.Info("daemon started; subscribing to health stream")
			retryDelay = time.Second
			s.running = true

			ctx, cancel := context.WithCancel(s.ctx)
			go func() {
				for {
					select {
					case <-ctx.Done():
						lokilog.Trace(log, "health relay exiting on ctx cancel")
						d.stop()
						return
					case health := <-c.Health():
						// Drop self-induced events: once we've called d.stop,
						// the gRPC stream will error and emit StatusDown. The
						// run loop publishes StatusStarting on the next
						// iteration, which is the correct transition — letting
						// the spurious StatusDown through would flash a fake
						// "node down" error across every consumer (e.g. the
						// UI during a Lock/Restart cycle).
						if d.isStopping() {
							lokilog.Trace(log, "suppressing health update (daemon stopping)", "state", string(health.State))
							continue
						}
						lokilog.Trace(log, "health update", "state", string(health.State), "port_conflict", health.PortConflict)
						s.notifySubscribers(health)
						if health.State == StatusDown {
							log.Warn("health reported down; stopping daemon", "err", health.Err)
							d.stop()
						}
					}
				}
			}()

			s.registerConnection(d, c)
			d.waitForShutdown()
			log.Info("daemon shutdown complete; run loop will restart")
			cancel()
			s.running = false
		}
	}
}

func (s *Service) waitForRetry(delay time.Duration) bool {
	timer := time.NewTimer(delay)
	defer timer.Stop()
	select {
	case <-s.ctx.Done():
		return false
	case <-timer.C:
		return true
	}
}

func (s *Service) cloneConfig() *flnd.Config {
	s.configMu.Lock()
	defer s.configMu.Unlock()
	cfg := *s.flndConfig
	cfg.TLSExtraDomains = append([]string(nil), s.flndConfig.TLSExtraDomains...)
	cfg.TLSExtraIPs = append([]string(nil), s.flndConfig.TLSExtraIPs...)
	cfg.RawRPCListeners = append([]string(nil), s.flndConfig.RawRPCListeners...)
	cfg.RawRESTListeners = append([]string(nil), s.flndConfig.RawRESTListeners...)
	cfg.RawListeners = append([]string(nil), s.flndConfig.RawListeners...)
	cfg.RestCORS = append([]string(nil), s.flndConfig.RestCORS...)
	cfg.NeutrinoMode.ConnectPeers = append([]string(nil), s.flndConfig.NeutrinoMode.ConnectPeers...)
	return &cfg
}

// Stop shuts down the service and the underlying daemon cleanly.
func (s *Service) Stop() {
	s.stopOnce.Do(func() {
		log.Info("service stop requested")
		s.stopDaemon()
		s.cancel()
		s.unsubscribeAll()
		s.wg.Wait()
		s.running = false
		log.Info("service stopped")
	})
}

func (s *Service) stopDaemon() {
	s.cmux.Lock()
	defer s.cmux.Unlock()
	if s.daemon != nil {
		s.daemon.stop()
		s.daemon.waitForShutdown()
		s.daemon = nil
		s.client = nil
	}
}

// Restart bounces the current daemon so the service's run() loop brings up a
// fresh one (locked wallet, fresh gRPC conn). Returns ErrDaemonNotRunning if
// the daemon hasn't been registered yet — callers must not treat the silent
// no-op as success, otherwise the UI waits for a state change that never
// comes. If the daemon is mid-startup the caller should wait, not Restart.
//
// Publishes StatusStarting to subscribers *before* stopping the daemon, and
// clears the cached client/daemon pointers so readers (e.g. info handler's
// GetState fallback) see the transition immediately. Without this push, the
// run() loop only emits StatusStarting after waitForShutdown returns (up to
// ~10s), during which info polls continue reporting the stale prior state.
func (s *Service) Restart() error {
	return s.RestartWithConfig(nil)
}

func (s *Service) RestartWithConfig(cfg *flnd.Config) error {
	s.cmux.Lock()
	d := s.daemon
	s.cmux.Unlock()
	if d == nil {
		lokilog.Trace(log, "restart requested but daemon not running")
		return ErrDaemonNotRunning
	}
	log.Info("restart requested")

	if cfg != nil {
		s.configMu.Lock()
		s.flndConfig = cfg
		s.configMu.Unlock()
	}

	s.notifySubscribers(&Update{State: StatusStarting})
	s.cmux.Lock()
	oldDaemon := s.daemon
	s.client = nil
	s.daemon = nil
	s.cmux.Unlock()

	if oldDaemon != nil {
		oldDaemon.stop()
	}

	log.Debug("restart: old daemon stopped and joined")
	return nil
}

func (s *Service) registerConnection(d *flndDaemon, c *Client) {
	s.cmux.Lock()
	defer s.cmux.Unlock()
	s.client = c
	s.daemon = d
	c.SetMaxTransactionsLimit(s.maxTransactionsLimit)
	s.configMu.Lock()
	s.flndConfig.ResetWalletTransactions = false
	s.configMu.Unlock()
}

// Subscribe returns a channel that receives all future state updates.
// The current state is sent immediately on the returned channel.
func (s *Service) Subscribe() <-chan *Update {
	ch := make(chan *Update, 5)
	s.subMu.Lock()
	s.subs = append(s.subs, ch)
	ch <- s.lastEvent
	s.subMu.Unlock()
	return ch
}

// Unsubscribe removes a subscription channel.
func (s *Service) Unsubscribe(ch <-chan *Update) {
	s.subMu.Lock()
	defer s.subMu.Unlock()
	for i := range s.subs {
		if s.subs[i] == ch {
			s.subs = append(s.subs[:i], s.subs[i+1:]...)
			return
		}
	}
}

func (s *Service) notifySubscribers(u *Update) {
	s.subMu.Lock()
	defer s.subMu.Unlock()
	s.lastEvent = u
	for _, ch := range s.subs {
		select {
		case ch <- u:
		default:
		}
	}
}

func (s *Service) unsubscribeAll() {
	s.subMu.Lock()
	defer s.subMu.Unlock()
	if len(s.subs) == 0 {
		return
	}
	final := &Update{State: StatusDown}
	for _, ch := range s.subs {
		select {
		case ch <- final:
		case <-time.After(5 * time.Second):
		}
		close(ch)
	}
	s.subs = s.subs[:0]
}

// GetLastEvent returns the most recent status update.
func (s *Service) GetLastEvent() *Update {
	return s.lastEvent
}

// --- delegated wallet/node operations ---

// Unlock unlocks the wallet with the given passphrase.
func (s *Service) Unlock(passphrase string) error {
	s.cmux.Lock()
	defer s.cmux.Unlock()
	if s.client == nil {
		return ErrDaemonNotRunning
	}
	return s.client.Unlock(passphrase)
}

// GetInfo returns the current node info.
func (s *Service) GetInfo() (*lnrpc.GetInfoResponse, error) {
	s.cmux.Lock()
	defer s.cmux.Unlock()
	if s.client == nil {
		return nil, ErrDaemonNotRunning
	}
	return s.client.GetInfo()
}

// GetState returns the current wallet state.
func (s *Service) GetState() (*lnrpc.GetStateResponse, error) {
	s.cmux.Lock()
	defer s.cmux.Unlock()
	if s.client == nil {
		return nil, ErrDaemonNotRunning
	}
	return s.client.GetState()
}

// GenSeed generates a new aezeed mnemonic, optionally protected by aezeedPass.
func (s *Service) GenSeed(aezeedPass string) ([]string, error) {
	s.cmux.Lock()
	defer s.cmux.Unlock()
	if s.client == nil {
		return nil, ErrDaemonNotRunning
	}
	return s.client.GenSeed(aezeedPass)
}

// InitWallet creates or restores the wallet. Pass existMnemonic or existHex
// to restore, or leave both empty to initialise a fresh wallet.
func (s *Service) InitWallet(walletPassword, existMnemonic, aezeedPass, existHex string) error {
	s.cmux.Lock()
	defer s.cmux.Unlock()
	if s.client == nil {
		return ErrDaemonNotRunning
	}
	return s.client.InitWallet(walletPassword, existMnemonic, aezeedPass, existHex)
}

// WalletExists returns true if a wallet has been created.
func (s *Service) WalletExists() (bool, error) {
	s.cmux.Lock()
	defer s.cmux.Unlock()
	if s.client == nil {
		return false, ErrDaemonNotRunning
	}
	return s.client.WalletExists()
}

// IsLocked returns true if the wallet exists but is locked.
func (s *Service) IsLocked() (bool, error) {
	s.cmux.Lock()
	defer s.cmux.Unlock()
	if s.client == nil {
		return false, ErrDaemonNotRunning
	}
	return s.client.IsLocked()
}

// Balance returns the wallet balance.
func (s *Service) Balance() (*lnrpc.WalletBalanceResponse, error) {
	s.cmux.Lock()
	defer s.cmux.Unlock()
	if s.client == nil {
		return nil, ErrDaemonNotRunning
	}
	return s.client.Balance()
}

// ChangePassphrase changes the wallet passphrase. Wallet must be locked.
func (s *Service) ChangePassphrase(oldPass, newPass string) error {
	s.cmux.Lock()
	defer s.cmux.Unlock()
	if s.client == nil {
		return ErrDaemonNotRunning
	}
	return s.client.ChangePassphrase(oldPass, newPass)
}

// GetRecoveryInfo returns wallet recovery progress.
func (s *Service) GetRecoveryInfo() (*lnrpc.GetRecoveryInfoResponse, error) {
	s.cmux.Lock()
	defer s.cmux.Unlock()
	if s.client == nil {
		return nil, ErrDaemonNotRunning
	}
	return s.client.GetRecoveryInfo()
}

// ListUnspent returns UTXOs with confirmation counts in [minConfs, maxConfs].
func (s *Service) ListUnspent(minConfs, maxConfs int32) ([]*lnrpc.Utxo, error) {
	s.cmux.Lock()
	defer s.cmux.Unlock()
	if s.client == nil {
		return nil, ErrDaemonNotRunning
	}
	return s.client.ListUnspent(minConfs, maxConfs)
}

// GetLightningConfig returns connection details for this node.
func (s *Service) GetLightningConfig() (*LightningConfig, error) {
	s.cmux.Lock()
	defer s.cmux.Unlock()
	if s.client == nil {
		return nil, ErrDaemonNotRunning
	}
	return s.client.GetLightningConfig()
}

// GetConnectionInfo returns connection details without invoking GetInfo.
// Use on the info-polling hot path when PubKey/Alias are fetched separately.
func (s *Service) GetConnectionInfo() (*ConnectionInfo, error) {
	s.cmux.Lock()
	defer s.cmux.Unlock()
	if s.client == nil {
		return nil, ErrDaemonNotRunning
	}
	return s.client.GetConnectionInfo()
}

// SendCoins broadcasts an on-chain transaction and returns the txid.
func (s *Service) SendCoins(address string, amountLoki int64, satPerVbyte int64) (string, error) {
	s.cmux.Lock()
	defer s.cmux.Unlock()
	if s.client == nil {
		return "", ErrDaemonNotRunning
	}
	return s.client.SendCoins(address, amountLoki, satPerVbyte)
}

// EstimateFee returns the estimated fee rate and total fee for a send.
func (s *Service) EstimateFee(address string, amountLoki int64) (satPerVbyte int64, totalFee int64, err error) {
	s.cmux.Lock()
	defer s.cmux.Unlock()
	if s.client == nil {
		return 0, 0, ErrDaemonNotRunning
	}
	return s.client.EstimateFee(address, amountLoki)
}

// NewAddress generates a new on-chain address of the given type.
func (s *Service) NewAddress(addrType lnrpc.AddressType) (string, error) {
	s.cmux.Lock()
	defer s.cmux.Unlock()
	if s.client == nil {
		return "", ErrDaemonNotRunning
	}
	return s.client.NewAddress(addrType)
}

// GetTransactions returns on-chain transactions in the given height range.
// Pass 0, -1 to get all transactions.
func (s *Service) GetTransactions(startHeight, endHeight int32) ([]*lnrpc.Transaction, error) {
	s.cmux.Lock()
	defer s.cmux.Unlock()
	if s.client == nil {
		return nil, ErrDaemonNotRunning
	}
	return s.client.GetTransactions(startHeight, endHeight)
}

// FetchTransactions returns all on-chain transactions using the cache.
func (s *Service) FetchTransactions() ([]*lnrpc.Transaction, error) {
	return s.FetchTransactionsWithOptions(FetchTransactionsOptions{})
}

// FetchTransactionsWithOptions returns cached, paginated, deduplicated transactions.
func (s *Service) FetchTransactionsWithOptions(opts FetchTransactionsOptions) ([]*lnrpc.Transaction, error) {
	s.cmux.Lock()
	defer s.cmux.Unlock()
	if s.client == nil {
		return nil, ErrDaemonNotRunning
	}
	return s.client.FetchTransactionsWithOptions(opts)
}

// TriggerRescan forces a wallet rescan on the next daemon start.
func (s *Service) TriggerRescan() error {
	s.configMu.Lock()
	s.flndConfig.ResetWalletTransactions = true
	s.configMu.Unlock()
	return s.Restart()
}

// FundPsbt funds a PSBT template and returns the packet with output locks.
func (s *Service) FundPsbt(addrToAmount map[string]int64, lokiPerVbyte uint64, lockExpirationSeconds uint64) (*FundedPsbt, error) {
	s.cmux.Lock()
	defer s.cmux.Unlock()
	if s.client == nil {
		return nil, ErrDaemonNotRunning
	}
	return s.client.FundPsbt(addrToAmount, lokiPerVbyte, lockExpirationSeconds)
}

// FinalizePsbt signs and finalises a funded PSBT.
func (s *Service) FinalizePsbt(packet *psbt.Packet) (*chainutil.Tx, error) {
	s.cmux.Lock()
	defer s.cmux.Unlock()
	if s.client == nil {
		return nil, ErrDaemonNotRunning
	}
	return s.client.FinalizePsbt(packet)
}

// PublishTransaction broadcasts a finalised transaction.
func (s *Service) PublishTransaction(tx *chainutil.Tx) error {
	s.cmux.Lock()
	defer s.cmux.Unlock()
	if s.client == nil {
		return ErrDaemonNotRunning
	}
	return s.client.PublishTransaction(tx)
}

// ReleaseOutputs releases UTXO locks acquired during PSBT funding.
func (s *Service) ReleaseOutputs(locks []*OutputLock) error {
	if len(locks) == 0 {
		return nil
	}
	s.cmux.Lock()
	defer s.cmux.Unlock()
	if s.client == nil {
		return ErrDaemonNotRunning
	}
	return s.client.ReleaseOutputs(locks)
}

// SimpleManyTransfer sends to multiple outputs in one transaction.
func (s *Service) SimpleManyTransfer(addrToAmount map[string]int64, lokiPerVbyte uint64) (string, error) {
	s.cmux.Lock()
	defer s.cmux.Unlock()
	if s.client == nil {
		return "", ErrDaemonNotRunning
	}
	return s.client.SimpleManyTransfer(addrToAmount, lokiPerVbyte)
}

// SimpleManyTransferFee estimates the fee for a multi-output transaction.
func (s *Service) SimpleManyTransferFee(addrToAmount map[string]int64) (*lnrpc.EstimateFeeResponse, error) {
	s.cmux.Lock()
	defer s.cmux.Unlock()
	if s.client == nil {
		return nil, ErrDaemonNotRunning
	}
	return s.client.SimpleManyTransferFee(addrToAmount)
}

// SignMessage signs a message with the key behind the given address.
func (s *Service) SignMessage(address, message string) (string, error) {
	s.cmux.Lock()
	defer s.cmux.Unlock()
	if s.client == nil {
		return "", ErrDaemonNotRunning
	}
	return s.client.SignMessageWithAddress(address, message)
}

// VerifyMessage verifies a signed message against an address.
func (s *Service) VerifyMessage(address, message, signature string) (*walletrpc.VerifyMessageWithAddrResponse, error) {
	s.cmux.Lock()
	defer s.cmux.Unlock()
	if s.client == nil {
		return nil, ErrDaemonNotRunning
	}
	return s.client.VerifyMessageWithAddress(address, message, signature)
}

// ListAddresses returns all addresses in the wallet.
func (s *Service) ListAddresses() (*walletrpc.ListAddressesResponse, error) {
	s.cmux.Lock()
	defer s.cmux.Unlock()
	if s.client == nil {
		return nil, ErrDaemonNotRunning
	}
	return s.client.ListAddresses()
}

// --- helpers ---

// WaitForStatus blocks until the service reaches the target state or the
// context is cancelled.
func (s *Service) WaitForStatus(ctx context.Context, target Status) error {
	s.subMu.Lock()
	if s.lastEvent != nil && s.lastEvent.State == target {
		s.subMu.Unlock()
		return nil
	}
	ch := make(chan *Update, 5)
	s.subs = append(s.subs, ch)
	s.subMu.Unlock()

	defer s.Unsubscribe(ch)

	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case update := <-ch:
			if update != nil && update.State == target {
				return nil
			}
		}
	}
}

func clampRetry(d, max time.Duration) time.Duration {
	if d > max {
		return max
	}
	return d
}
