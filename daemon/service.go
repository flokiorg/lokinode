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
	lastEvent *Update
	stopOnce  sync.Once
	// retryNow signals waitForRetry to unblock. Capacity 1 + non-blocking sends
	// ensure RestartWithConfig is never blocked. registerConnection drains stale
	// signals — see comment there for the invariant this preserves.
	retryNow chan struct{}
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
		retryNow:   make(chan struct{}, 1),
	}
	go s.run()
	return s
}

// run drives the daemon lifecycle: start → run → on crash, hold StatusDown
// until a user-initiated Retry. Each iteration is a single attempt; the loop
// exits when s.ctx is cancelled.
func (s *Service) run() {
	s.wg.Add(1)
	defer s.wg.Done()

	for {
		select {
		case <-s.ctx.Done():
			log.Info("service context cancelled; stopping daemon")
			s.stopDaemon()
			return
		default:
		}

		crashErr := s.runOnce()
		if crashErr == nil {
			// Clean shutdown (user-triggered Restart or Stop). Loop straight back
			// to the top so the ctx.Done check decides whether to start a fresh
			// daemon or exit.
			continue
		}

		// Crashed or failed to start: hold StatusDown and wait for explicit
		// user action (Retry button) — no auto-retry.
		if !s.waitForRetry() {
			return
		}
	}
}

// runOnce performs one full daemon lifecycle. Returns nil on a clean shutdown
// (no auto-retry needed) or the captured crash error otherwise.
func (s *Service) runOnce() error {
	log.Info("service entering starting phase")
	s.notifySubscribers(&Update{State: StatusStarting})

	interceptor, err := s.acquireSignalInterceptor()
	if err != nil {
		return s.failStartup("signal.Intercept", err)
	}

	d, err := newDaemon(s.ctx, s.cloneConfig(), interceptor)
	if err != nil {
		// Interceptor was acquired but daemon was never created. Release it so
		// the next acquireSignalInterceptor call can succeed.
		interceptor.RequestShutdown()
		select {
		case <-interceptor.ShutdownChannel():
		case <-time.After(2 * time.Second):
			log.Warn("signal interceptor did not drain after newDaemon failure")
		}
		return s.failStartup("newDaemon", err)
	}

	log.Info("daemon start: calling d.start()")
	c, err := d.start()
	if err != nil {
		// d.start()'s defer already called d.stop() which triggered RequestShutdown
		// and drained the interceptor. Wait briefly for the flnd.Main goroutine to
		// release OS resources (ports, wallet DB) so the next Retry starts clean.
		// The wait is bounded: if flnd.Main is unresponsive we must still publish
		// StatusDown so the UI exits the "Starting" screen and shows the error.
		log.Info("daemon start failed; waiting up to 10s for goroutine cleanup", "err", err)
		cleanupDone := make(chan struct{})
		go func() { d.wg.Wait(); close(cleanupDone) }()
		select {
		case <-cleanupDone:
			log.Info("daemon goroutine exited cleanly after start failure")
		case <-time.After(10 * time.Second):
			log.Warn("daemon goroutine still running 10s after start failure; proceeding to error state (Retry may see port conflict)")
		}
		return s.failStartup("daemon start", err)
	}

	log.Info("daemon started; subscribing to health stream")
	return s.superviseDaemon(d, c)
}

// superviseDaemon runs the health relay for d/c, blocks until the daemon
// exits, and returns the crash error captured by the relay (or nil if the
// shutdown was clean). The connection pointers are cleared before returning.
func (s *Service) superviseDaemon(d *flndDaemon, c *Client) error {
	relayCtx, relayCancel := context.WithCancel(s.ctx)
	defer relayCancel()

	// Buffered so the relay never blocks on its final send, even if this
	// function exits via panic before the receive.
	relayDone := make(chan error, 1)
	go func() {
		relayDone <- s.runHealthRelay(relayCtx, d, c)
	}()

	s.registerConnection(d, c)
	d.waitForShutdown()
	log.Info("daemon shutdown complete; run loop will restart")

	// Cancel the relay and wait for it to drain. The channel receive
	// establishes happens-before with every write the relay made — including
	// the captured crashErr — so this read is race-free.
	relayCancel()
	crashErr := <-relayDone

	s.cmux.Lock()
	s.daemon = nil
	s.client = nil
	s.cmux.Unlock()

	return crashErr
}

// runHealthRelay forwards health updates to subscribers and returns the first
// crash error observed before the daemon was stopped. Exits when ctx is
// cancelled.
func (s *Service) runHealthRelay(ctx context.Context, d *flndDaemon, c *Client) error {
	var crashErr error
	for {
		select {
		case <-ctx.Done():
			lokilog.Trace(log, "health relay exiting on ctx cancel")
			// Idempotent: if d.stop was already called, this is a no-op.
			d.stop()
			return crashErr
		case health, ok := <-c.Health():
			if !ok {
				return crashErr
			}
			// Drop self-induced events: once d.stop has been called the gRPC
			// stream will error and emit StatusDown. Forwarding that would
			// flash a fake "node down" across the UI during Lock/Restart.
			if d.isStopping() {
				lokilog.Trace(log, "suppressing health update (daemon stopping)", "state", string(health.State))
				continue
			}
			lokilog.Trace(log, "health update", "state", string(health.State), "port_conflict", health.PortConflict)
			s.notifySubscribers(health)
			if health.State == StatusDown {
				log.Warn("health reported down; stopping daemon", "err", health.Err)
				if crashErr == nil {
					crashErr = health.Err
				}
				// Mark stopping so any further events from the dying stream
				// are suppressed. Idempotent against later cancellations.
				d.stop()
			}
		}
	}
}

// acquireSignalInterceptor obtains the process-level signal interceptor,
// retrying past the brief "already started" window that follows the previous
// daemon's shutdown.
func (s *Service) acquireSignalInterceptor() (signal.Interceptor, error) {
	attempts := 0
	for {
		interceptor, err := signal.Intercept()
		if err == nil {
			if attempts > 0 {
				log.Info("signal interceptor acquired after retry", "attempts", attempts)
			}
			return interceptor, nil
		}
		if !strings.Contains(err.Error(), "already started") {
			log.Error("signal interceptor failed with unexpected error", "err", err)
			return interceptor, err
		}
		attempts++
		if attempts == 1 {
			log.Info("signal interceptor busy (previous daemon still cleaning up); retrying", "err", err)
		} else if attempts%200 == 0 {
			log.Warn("signal interceptor still busy after retries", "attempts", attempts, "waited_ms", attempts*5)
		}
		select {
		case <-s.ctx.Done():
			log.Warn("service ctx cancelled while waiting for signal interceptor", "attempts", attempts)
			return interceptor, s.ctx.Err()
		case <-time.After(5 * time.Millisecond):
		}
	}
}

// failStartup publishes a StatusDown event for a startup-phase error and
// returns the error so runOnce can hand it to the retry-gate.
func (s *Service) failStartup(stage string, err error) error {
	log.Error("daemon startup failed", "stage", stage, "err", err, "port_conflict", isPortConflict(err))
	s.notifySubscribers(&Update{State: StatusDown, Err: err, PortConflict: isPortConflict(err)})
	return err
}

// waitForRetry blocks until the user signals retry via RestartWithConfig or
// the service is shut down. Returns true to continue, false to exit the loop.
func (s *Service) waitForRetry() bool {
	select {
	case <-s.ctx.Done():
		return false
	case <-s.retryNow:
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

// Stop shuts down the service and the underlying daemon cleanly. Idempotent.
func (s *Service) Stop() {
	s.stopOnce.Do(func() {
		log.Info("service stop requested")
		s.stopDaemon()
		s.cancel()
		s.unsubscribeAll()
		s.wg.Wait()
		log.Info("service stopped")
	})
}

// stopDaemon stops the daemon if one is running. cmux is held only long enough
// to claim ownership of the *flndDaemon — the actual blocking shutdown happens
// outside the lock so concurrent readers of s.client are not stalled.
func (s *Service) stopDaemon() {
	s.cmux.Lock()
	d := s.daemon
	s.daemon = nil
	s.client = nil
	s.cmux.Unlock()
	if d == nil {
		return
	}
	d.stop()
	d.waitForShutdown()
}

// Restart bounces the current daemon so the service's run() loop brings up a
// fresh one (locked wallet, fresh gRPC conn). Safe to call at any lifecycle
// stage: if the daemon is running it is stopped and the run() loop restarts
// it; if it is in a retry-delay (crashed/never started) the delay is
// interrupted and a new attempt starts immediately.
//
// Publishes StatusStarting to subscribers before stopping the daemon, and
// clears the cached client/daemon pointers so readers (e.g. info handler's
// GetState fallback) see the transition immediately.
func (s *Service) Restart() error {
	return s.RestartWithConfig(nil)
}

func (s *Service) RestartWithConfig(cfg *flnd.Config) error {
	if cfg != nil {
		s.configMu.Lock()
		s.flndConfig = cfg
		s.configMu.Unlock()
	}

	s.notifySubscribers(&Update{State: StatusStarting})

	s.cmux.Lock()
	d := s.daemon
	s.client = nil
	s.daemon = nil
	s.cmux.Unlock()

	if d != nil {
		// Daemon is running — stop it; the run() loop's waitForShutdown will
		// unblock and restart automatically.
		log.Info("restart requested; stopping daemon")
		d.stop()
	} else {
		// Daemon is not running: either it crashed before gRPC came up, or it
		// crashed after and the run loop is sleeping in waitForRetry. Signal the
		// channel to wake it up immediately so the next attempt starts without
		// waiting for the full backoff delay.
		log.Info("restart requested; daemon not running, interrupting retry delay")
		select {
		case s.retryNow <- struct{}{}:
		default:
		}
	}

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
	// Drain any retry signal that was deposited during startup. retryNow is
	// only meaningful while waitForRetry is blocked; a signal sent between
	// iterations (e.g. RestartWithConfig firing while we were inside
	// newDaemon/d.start with s.daemon still nil) would otherwise sit in the
	// buffer and short-circuit the next genuine waitForRetry — silently
	// auto-retrying on the next crash and breaking the "down until user
	// clicks Retry" invariant.
	select {
	case <-s.retryNow:
	default:
	}
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

// GetLastEvent returns the most recent status update. The pointer is read
// under subMu to pair with the write in notifySubscribers; the returned
// *Update itself is treated as immutable by all writers, so callers may
// safely read its fields without holding the mutex.
func (s *Service) GetLastEvent() *Update {
	s.subMu.Lock()
	defer s.subMu.Unlock()
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
func (s *Service) SendCoins(address string, amountLoki int64, lokiPerVbyte int64) (string, error) {
	s.cmux.Lock()
	defer s.cmux.Unlock()
	if s.client == nil {
		return "", ErrDaemonNotRunning
	}
	return s.client.SendCoins(address, amountLoki, lokiPerVbyte)
}

// EstimateFee returns the estimated fee rate and total fee for a send.
func (s *Service) EstimateFee(address string, amountLoki int64) (lokiPerVbyte int64, totalFee int64, err error) {
	s.cmux.Lock()
	defer s.cmux.Unlock()
	if s.client == nil {
		return 0, 0, ErrDaemonNotRunning
	}
	return s.client.EstimateFee(address, amountLoki)
}

// MaxSendable returns the maximum sendable amount and its fee for a given address and fee rate.
func (s *Service) MaxSendable(address string, lokiPerVbyte int64) (amount int64, fee int64, err error) {
	s.cmux.Lock()
	defer s.cmux.Unlock()
	if s.client == nil {
		return 0, 0, ErrDaemonNotRunning
	}
	return s.client.MaxSendable(address, lokiPerVbyte)
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
