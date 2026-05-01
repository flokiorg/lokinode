package daemon

import (
	"bytes"
	"context"
	"encoding/hex"
	"errors"
	"fmt"
	"math"
	"net"
	"os"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/flokiorg/flnd"
	"github.com/flokiorg/flnd/aezeed"
	"github.com/flokiorg/flnd/lnrpc"
	"github.com/flokiorg/flnd/lnrpc/chainrpc"
	"github.com/flokiorg/flnd/lnrpc/walletrpc"
	"github.com/flokiorg/flnd/rpcperms"
	"github.com/flokiorg/flnd/walletunlocker"
	"github.com/flokiorg/go-flokicoin/chainutil"
	"github.com/flokiorg/go-flokicoin/chainutil/psbt"
	"google.golang.org/grpc"
	"google.golang.org/grpc/metadata"
	"google.golang.org/grpc/status"
)

var (
	ErrWalletNotFound       = errors.New("wallet not found")
	ErrWalletAlreadyExists  = errors.New("wallet already exists")
	ErrWalletMustBeLocked   = errors.New("wallet must be locked (stop the node first)")
	ErrWalletMustBeUnlocked = errors.New("wallet must be unlocked")

	defaultRPCPort  = 10005
	defaultPeerPort = 5521
)

const (
	defaultRPCTimeout       = 5 * time.Second
	transactionFetchTimeout = 30 * time.Second
	transactionPageSize     = 200
	transactionsCacheTTL    = 5 * time.Minute
	recentHeaderThreshold   = 5 * time.Minute
	defaultRecoveryWindow   = 2500

	localhostIP           = "127.0.0.1"
	publicDNSCheckAddress = "8.8.8.8:80"
)

type txCache struct {
	Txs         []*lnrpc.Transaction
	LastIndex   uint64
	NextOffset  uint32
	LastUpdated time.Time
	Dirty       bool
}

// Client wraps all FLND gRPC sub-clients and manages the macaroon credential.
type Client struct {
	unlockerClient lnrpc.WalletUnlockerClient
	lnClient       lnrpc.LightningClient
	walletKit      walletrpc.WalletKitClient
	stateClient    lnrpc.StateClient
	ntfClient      chainrpc.ChainNotifierClient

	health      chan *Update
	config      *flnd.Config
	ctx         context.Context
	adminMacHex string
	tlsCertHex  string

	subTxsOnce sync.Once
	cache      *txCache
	txFetchLimit uint32

	syncPollingActive bool
	syncPollingStop   chan struct{}
	syncPollingDone   chan struct{}
	isSynced          bool
	syncedHeight      uint32
	mu                sync.Mutex

	closing bool
}

// NewClient creates a Client from an open gRPC connection and starts the
// background state subscription goroutine.
func NewClient(ctx context.Context, conn *grpc.ClientConn, config *flnd.Config) *Client {
	c := &Client{
		unlockerClient: lnrpc.NewWalletUnlockerClient(conn),
		lnClient:       lnrpc.NewLightningClient(conn),
		walletKit:      walletrpc.NewWalletKitClient(conn),
		stateClient:    lnrpc.NewStateClient(conn),
		ntfClient:      chainrpc.NewChainNotifierClient(conn),
		health:         make(chan *Update, 16),
		ctx:            ctx,
		config:         config,
		cache: &txCache{
			Txs:         make([]*lnrpc.Transaction, 0),
			LastUpdated: time.Time{},
			Dirty:       true,
		},
	}
	go c.subscribeState()
	return c
}

// Health returns the channel on which state updates are delivered.
func (c *Client) Health() <-chan *Update {
	return c.health
}

// --- state subscriptions ---

func (c *Client) subscribeState() {
	// hasAdvancedState tracks whether we have seen a real wallet state beyond
	// WAITING_TO_START.  On stream reconnect FLND replays WAITING_TO_START before
	// the current state; without this guard that causes a spurious StatusStarting
	// flash in the UI even though the wallet was (e.g.) locked the whole time.
	hasAdvancedState := false

	// connectAttempts counts consecutive SubscribeState failures before the
	// first real state is received.  After 60 attempts (~30 s) we surface
	// StatusDown so the UI shows an error rather than spinning forever on
	// "Starting".  The counter resets each time a real state is received.
	connectAttempts := 0
	const maxConnectAttempts = 60

	for {
		stream, err := c.stateClient.SubscribeState(c.ctx, &lnrpc.SubscribeStateRequest{})
		if err != nil {
			if c.isClosing() {
				c.submitHealth(Update{State: StatusDown})
				return
			}
			// Once we have ever reached a real state the node is running —
			// keep retrying silently (App Nap reconnect).  Before that,
			// cap the attempts so a permanent gRPC failure doesn't leave
			// the UI stuck on "Starting" forever.
			if !hasAdvancedState {
				connectAttempts++
				if connectAttempts >= maxConnectAttempts {
					c.submitHealth(Update{State: StatusDown, Err: err})
					return
				}
			}
			select {
			case <-c.ctx.Done():
				c.submitHealth(Update{State: StatusDown})
				return
			case <-time.After(500 * time.Millisecond):
				continue
			}
		}
		connectAttempts = 0 // stream opened successfully

		for {
			r, err := stream.Recv()
			if err != nil {
				break
			}

			switch r.State {
			case lnrpc.WalletState_NON_EXISTING:
				hasAdvancedState = true
				c.submitHealth(Update{State: StatusNoWallet})

			case lnrpc.WalletState_LOCKED:
				hasAdvancedState = true
				c.submitHealth(Update{State: StatusLocked})

			case lnrpc.WalletState_UNLOCKED:
				hasAdvancedState = true
				c.refreshMacaroon()
				c.submitHealth(Update{State: StatusUnlocked})

			case lnrpc.WalletState_WAITING_TO_START:
				if !hasAdvancedState {
					c.submitHealth(Update{State: StatusStarting})
				}

			case lnrpc.WalletState_RPC_ACTIVE:
				c.refreshMacaroon()
				synced, recentHeader, blockHeight, err := c.IsSynced()
				if err != nil {
					// If we get a signature mismatch, try refreshing one more time
					if strings.Contains(err.Error(), "signature mismatch") {
						c.refreshMacaroon()
					}
					continue
				} else if synced || recentHeader {
					c.stopSyncPolling()
					c.submitHealth(Update{State: StatusReady, BlockHeight: blockHeight})
				} else {
					c.submitHealth(Update{State: StatusSyncing, BlockHeight: blockHeight})
					go c.pollSyncStatus()
				}

			case lnrpc.WalletState_SERVER_ACTIVE:
				c.refreshMacaroon()
				_, _, blockHeight, _ := c.IsSynced()
				c.stopSyncPolling()
				c.submitHealth(Update{State: StatusReady, BlockHeight: blockHeight})
				c.subTxsOnce.Do(func() {
					go c.subscribeTransactions()
					go c.subscribeBlocks()
				})
			}
		}

		// Stream broke. If the daemon is shutting down, emit StatusDown and exit.
		// Otherwise reconnect — the FLND process is still running, only the
		// gRPC transport dropped (e.g. server-side keepalive timeout while the
		// app was backgrounded by macOS App Nap).
		if c.isClosing() {
			c.submitHealth(Update{State: StatusDown})
			return
		}
		select {
		case <-c.ctx.Done():
			c.submitHealth(Update{State: StatusDown})
			return
		case <-time.After(500 * time.Millisecond):
		}
	}
}

func (c *Client) subscribeBlocks() {
	for {
		stream, err := c.ntfClient.RegisterBlockEpochNtfn(c.withMacaroon(), &chainrpc.BlockEpoch{})
		if err != nil {
			if c.isClosing() {
				return
			}
			if strings.Contains(err.Error(), "signature mismatch") {
				c.refreshMacaroon()
			}
			select {
			case <-c.ctx.Done():
				return
			case <-time.After(2 * time.Second):
				continue
			}
		}

		for {
			r, err := stream.Recv()
			if err != nil {
				break
			}

			c.invalidateTxCache()

			state := StatusBlock
			var syncedHeight uint32

			c.mu.Lock()
			if !c.isSynced {
				state = StatusScanning
				syncedHeight = c.syncedHeight
			}
			c.mu.Unlock()

			c.submitHealth(Update{
				State:        state,
				SyncedHeight: syncedHeight,
				BlockHeight:  r.Height,
				BlockHash:    hex.EncodeToString(r.Hash),
			})
		}

		if c.isClosing() {
			return
		}
		select {
		case <-c.ctx.Done():
			return
		case <-time.After(2 * time.Second):
		}
	}
}

func (c *Client) subscribeTransactions() {
	for {
		stream, err := c.lnClient.SubscribeTransactions(c.withMacaroon(), &lnrpc.GetTransactionsRequest{})
		if err != nil {
			if c.isClosing() {
				return
			}
			if strings.Contains(err.Error(), "signature mismatch") {
				c.refreshMacaroon()
			}
			select {
			case <-c.ctx.Done():
				return
			case <-time.After(2 * time.Second):
				continue
			}
		}

		for {
			r, err := stream.Recv()
			if err != nil {
				break
			}
			c.invalidateTxCache()
			c.submitHealth(Update{State: StatusTransaction, Transaction: r})
		}

		if c.isClosing() {
			return
		}
		select {
		case <-c.ctx.Done():
			return
		case <-time.After(2 * time.Second):
		}
	}
}

func (c *Client) invalidateTxCache() {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.cache != nil {
		c.cache.Dirty = true
	}
}

func (c *Client) SetMaxTransactionsLimit(limit uint32) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.txFetchLimit = limit
	if c.cache != nil {
		c.cache.Dirty = true
	}
}

// FetchTransactions returns all on-chain transactions using the cache.
func (c *Client) FetchTransactions() ([]*lnrpc.Transaction, error) {
	return c.FetchTransactionsWithOptions(FetchTransactionsOptions{})
}

// FetchTransactionsWithOptions returns transactions using cache-first pagination,
// deduplication, and newest-first sort — mirroring the twallet/flnd design.
func (c *Client) FetchTransactionsWithOptions(opts FetchTransactionsOptions) ([]*lnrpc.Transaction, error) {
	if c.isClosing() {
		return nil, ErrDaemonNotRunning
	}

	c.mu.Lock()
	limit := int(c.txFetchLimit)
	if opts.IgnoreLimit {
		limit = 0
	}
	cache := c.cache
	if cache != nil && !cache.Dirty && !opts.ForceRescan && time.Since(cache.LastUpdated) <= transactionsCacheTTL {
		lastIndex := cache.LastIndex
		c.mu.Unlock()

		ctx, cancel := c.rpcContext(5 * time.Second)
		probe, err := c.lnClient.GetTransactions(ctx, &lnrpc.GetTransactionsRequest{
			StartHeight:     0,
			EndHeight:       -1,
			MaxTransactions: 1,
			IndexOffset:     uint32(lastIndex + 1),
		})
		cancel()

		if err == nil && len(probe.Transactions) == 0 {
			c.mu.Lock()
			if c.cache != nil {
				c.cache.LastUpdated = time.Now()
				cached := append([]*lnrpc.Transaction(nil), c.cache.Txs...)
				if limit > 0 && len(cached) > limit {
					cached = cached[:limit]
				}
				c.mu.Unlock()
				return cached, nil
			}
			c.mu.Unlock()
		}
	} else {
		c.mu.Unlock()
	}

	var cursor uint64
	var existing []*lnrpc.Transaction
	c.mu.Lock()
	if c.cache != nil && !opts.ForceRescan {
		cursor = c.cache.LastIndex
		if len(c.cache.Txs) > 0 {
			existing = append(existing, c.cache.Txs...)
		}
	}
	c.mu.Unlock()

	collected := make([]*lnrpc.Transaction, 0, 256)
	lastIndex := uint64(0)

	for {
		ctx, cancel := c.rpcContext(transactionFetchTimeout)
		resp, err := c.lnClient.GetTransactions(ctx, &lnrpc.GetTransactionsRequest{
			StartHeight:     0,
			EndHeight:       -1,
			MaxTransactions: transactionPageSize,
			IndexOffset:     uint32(cursor),
		})
		cancel()
		if err != nil {
			if matchRPCErrorMessage(err, context.DeadlineExceeded) {
				return nil, fmt.Errorf("rpc connection timeout")
			}
			return nil, err
		}

		lastIndex = resp.LastIndex
		if len(resp.Transactions) == 0 {
			break
		}

		collected = append(collected, resp.Transactions...)
		if opts.OnProgress != nil {
			opts.OnProgress(len(existing) + len(collected))
		}

		cursor = uint64(resp.LastIndex) + 1
		if cursor > uint64(^uint32(0)) {
			cursor = uint64(^uint32(0))
			break
		}
		if uint32(len(resp.Transactions)) < transactionPageSize {
			break
		}
	}

	currentTotal := len(existing) + len(collected)
	if opts.OnProgress != nil {
		opts.OnProgress(currentTotal)
	}

	allTxs := make([]*lnrpc.Transaction, 0, currentTotal)
	allTxs = append(allTxs, existing...)
	allTxs = append(allTxs, collected...)

	sort.SliceStable(allTxs, func(i, j int) bool {
		if allTxs[i].TimeStamp != allTxs[j].TimeStamp {
			return allTxs[i].TimeStamp > allTxs[j].TimeStamp
		}
		return allTxs[i].BlockHeight > allTxs[j].BlockHeight
	})

	if len(allTxs) > 1 {
		seen := make(map[string]struct{}, len(allTxs))
		dedup := allTxs[:0]
		for _, tx := range allTxs {
			if _, ok := seen[tx.TxHash]; ok {
				continue
			}
			seen[tx.TxHash] = struct{}{}
			dedup = append(dedup, tx)
		}
		allTxs = dedup
	}

	c.mu.Lock()
	if c.cache != nil {
		snapshot := append([]*lnrpc.Transaction(nil), allTxs...)
		c.cache.Txs = snapshot
		c.cache.LastIndex = lastIndex
		next := lastIndex + 1
		if next > uint64(^uint32(0)) {
			c.cache.NextOffset = ^uint32(0)
		} else {
			c.cache.NextOffset = uint32(next)
		}
		c.cache.LastUpdated = time.Now()
		c.cache.Dirty = false
		result := snapshot
		c.mu.Unlock()
		if limit > 0 && len(result) > limit {
			result = result[:limit]
		}
		return append([]*lnrpc.Transaction(nil), result...), nil
	}
	c.mu.Unlock()

	result := append([]*lnrpc.Transaction(nil), allTxs...)
	if limit > 0 && len(result) > limit {
		result = result[:limit]
	}
	return result, nil
}

// FundPsbt funds a PSBT template and returns the funded packet with output locks.
func (c *Client) FundPsbt(addrToAmount map[string]int64, lokiPerVbyte uint64, lockExpirationSeconds uint64) (*FundedPsbt, error) {
	if c.isClosing() {
		return nil, ErrDaemonNotRunning
	}
	outputs := make(map[string]uint64, len(addrToAmount))
	for a, v := range addrToAmount {
		outputs[a] = uint64(v)
	}
	resp, err := c.walletKit.FundPsbt(c.withMacaroon(), &walletrpc.FundPsbtRequest{
		Template: &walletrpc.FundPsbtRequest_Raw{
			Raw: &walletrpc.TxTemplate{Outputs: outputs},
		},
		Fees: &walletrpc.FundPsbtRequest_SatPerVbyte{
			SatPerVbyte: lokiPerVbyte,
		},
		LockExpirationSeconds: lockExpirationSeconds,
	})
	if err != nil {
		return nil, err
	}
	packet, err := psbt.NewFromRawBytes(bytes.NewReader(resp.FundedPsbt), false)
	if err != nil {
		return nil, err
	}
	locks := make([]*OutputLock, 0, len(resp.LockedUtxos))
	for _, utxo := range resp.LockedUtxos {
		if utxo == nil || utxo.Outpoint == nil {
			continue
		}
		locks = append(locks, &OutputLock{ID: utxo.Id, Outpoint: utxo.Outpoint})
	}
	return &FundedPsbt{Packet: packet, Locks: locks}, nil
}

// FinalizePsbt signs and finalises a funded PSBT, returning the ready-to-broadcast tx.
func (c *Client) FinalizePsbt(packet *psbt.Packet) (*chainutil.Tx, error) {
	if c.isClosing() {
		return nil, ErrDaemonNotRunning
	}
	var buf bytes.Buffer
	if err := packet.Serialize(&buf); err != nil {
		return nil, err
	}
	resp, err := c.walletKit.FinalizePsbt(c.withMacaroon(), &walletrpc.FinalizePsbtRequest{
		FundedPsbt: buf.Bytes(),
	})
	if err != nil {
		return nil, err
	}
	return chainutil.NewTxFromBytes(resp.RawFinalTx)
}

// PublishTransaction broadcasts a finalised transaction.
func (c *Client) PublishTransaction(tx *chainutil.Tx) error {
	if c.isClosing() {
		return ErrDaemonNotRunning
	}
	b, err := tx.MsgTx().Bytes()
	if err != nil {
		return err
	}
	resp, err := c.walletKit.PublishTransaction(c.withMacaroon(), &walletrpc.Transaction{TxHex: b})
	if err != nil {
		return err
	}
	if resp.PublishError != "" {
		return fmt.Errorf("%s", resp.PublishError)
	}
	return nil
}

// ReleaseOutputs releases UTXO locks previously acquired by FundPsbt.
func (c *Client) ReleaseOutputs(locks []*OutputLock) error {
	if len(locks) == 0 {
		return nil
	}
	if c.isClosing() {
		return ErrDaemonNotRunning
	}
	for _, lock := range locks {
		if lock == nil || len(lock.ID) == 0 || lock.Outpoint == nil {
			continue
		}
		if _, err := c.walletKit.ReleaseOutput(c.withMacaroon(), &walletrpc.ReleaseOutputRequest{
			Id:       lock.ID,
			Outpoint: lock.Outpoint,
		}); err != nil {
			return err
		}
	}
	return nil
}

// SimpleManyTransfer sends coins to multiple outputs in a single transaction.
func (c *Client) SimpleManyTransfer(addrToAmount map[string]int64, lokiPerVbyte uint64) (string, error) {
	if c.isClosing() {
		return "", ErrDaemonNotRunning
	}
	resp, err := c.lnClient.SendMany(c.withMacaroon(), &lnrpc.SendManyRequest{
		AddrToAmount: addrToAmount,
		SatPerVbyte:  lokiPerVbyte,
	})
	if err != nil {
		return "", err
	}
	return resp.Txid, nil
}

// SimpleManyTransferFee estimates the fee for a multi-output transaction.
func (c *Client) SimpleManyTransferFee(addrToAmount map[string]int64) (*lnrpc.EstimateFeeResponse, error) {
	if c.isClosing() {
		return nil, ErrDaemonNotRunning
	}
	return c.lnClient.EstimateFee(c.withMacaroon(), &lnrpc.EstimateFeeRequest{
		AddrToAmount:          addrToAmount,
		TargetConf:            1,
		CoinSelectionStrategy: lnrpc.CoinSelectionStrategy_STRATEGY_RANDOM,
		SpendUnconfirmed:      true,
	})
}

// SignMessageWithAddress signs a message using the key behind the given address.
func (c *Client) SignMessageWithAddress(address, message string) (string, error) {
	if c.isClosing() {
		return "", ErrDaemonNotRunning
	}
	ctx, cancel := c.rpcContext(0)
	defer cancel()
	resp, err := c.walletKit.SignMessageWithAddr(ctx, &walletrpc.SignMessageWithAddrRequest{
		Addr: address,
		Msg:  []byte(message),
	})
	if err != nil {
		return "", err
	}
	return resp.GetSignature(), nil
}

// VerifyMessageWithAddress verifies a signed message against an address.
func (c *Client) VerifyMessageWithAddress(address, message, signature string) (*walletrpc.VerifyMessageWithAddrResponse, error) {
	if c.isClosing() {
		return nil, ErrDaemonNotRunning
	}
	ctx, cancel := c.rpcContext(0)
	defer cancel()
	return c.walletKit.VerifyMessageWithAddr(ctx, &walletrpc.VerifyMessageWithAddrRequest{
		Addr:      address,
		Msg:       []byte(message),
		Signature: signature,
	})
}

// ListUnspentWithMaxConfs handles the math.MaxInt32 default like twallet.
func (c *Client) ListUnspentFull(minConfs, maxConfs int32) ([]*lnrpc.Utxo, error) {
	if c.isClosing() {
		return nil, ErrDaemonNotRunning
	}
	if maxConfs == 0 {
		maxConfs = math.MaxInt32
	}
	ctx, cancel := c.rpcContext(0)
	defer cancel()
	resp, err := c.walletKit.ListUnspent(ctx, &walletrpc.ListUnspentRequest{MinConfs: minConfs, MaxConfs: maxConfs})
	if err != nil {
		return nil, err
	}
	return resp.GetUtxos(), nil
}

func (c *Client) stopSyncPolling() {
	var done chan struct{}

	c.mu.Lock()
	if c.syncPollingActive && c.syncPollingStop != nil {
		close(c.syncPollingStop)
		c.syncPollingStop = nil
		done = c.syncPollingDone
	}
	c.mu.Unlock()

	if done != nil {
		<-done
	}
}

func (c *Client) pollSyncStatus() {
	c.mu.Lock()
	if c.syncPollingActive {
		c.mu.Unlock()
		return
	}
	stopCh := make(chan struct{})
	doneCh := make(chan struct{})
	c.syncPollingActive = true
	c.syncPollingStop = stopCh
	c.syncPollingDone = doneCh
	c.mu.Unlock()

	ticker := time.NewTicker(5 * time.Second)
	defer ticker.Stop()
	defer func() {
		c.mu.Lock()
		c.syncPollingActive = false
		c.syncPollingStop = nil
		c.syncPollingDone = nil
		c.mu.Unlock()
		close(doneCh)
	}()

	for {
		select {
		case <-c.ctx.Done():
			return
		case <-stopCh:
			return
		case <-ticker.C:
			synced, recentHeader, blockHeight, err := c.IsSynced()
			if err != nil {
				continue
			}
			if synced || recentHeader {
				c.submitHealth(Update{State: StatusReady, BlockHeight: blockHeight})
				return
			}
			c.submitHealth(Update{State: StatusSyncing, BlockHeight: blockHeight})
		}
	}
}

// --- lifecycle helpers ---

func (c *Client) close() {
	c.mu.Lock()
	c.closing = true
	c.mu.Unlock()
}

func (c *Client) isClosing() bool {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.closing
}

func (c *Client) kill(err error) {
	c.mu.Lock()
	closing := c.closing
	c.mu.Unlock()
	if matchRPCErrorMessage(err, context.Canceled) || closing {
		c.submitHealth(Update{State: StatusDown})
	} else {
		c.submitHealth(Update{State: StatusDown, Err: err})
	}
}

func (c *Client) submitHealth(change Update) {
	select {
	case c.health <- &change:
	default:
	}
}

// --- wallet operations ---

// WalletExists returns true if a wallet has been created.
func (c *Client) WalletExists() (bool, error) {
	if c.isClosing() {
		return false, ErrDaemonNotRunning
	}
	ctx, cancel := c.rpcContext(0)
	defer cancel()
	_, err := c.lnClient.GetInfo(ctx, &lnrpc.GetInfoRequest{})
	if err == nil {
		return true, nil
	}
	if matchRPCErrorMessage(err, rpcperms.ErrNoWallet) {
		return false, nil
	}
	return true, nil
}

// IsLocked returns true if the wallet exists but is locked.
func (c *Client) IsLocked() (bool, error) {
	if c.isClosing() {
		return false, ErrDaemonNotRunning
	}
	_, err := c.lnClient.GetInfo(c.withMacaroon(), &lnrpc.GetInfoRequest{})
	if err == nil {
		return false, nil
	}
	_, err = c.unlockerClient.GenSeed(c.ctx, &lnrpc.GenSeedRequest{})
	if err == nil {
		return true, nil
	}
	if matchRPCErrorMessage(err, rpcperms.ErrWalletUnlocked, fmt.Errorf("wallet already exists")) {
		return true, nil
	}
	return false, err
}

// IsSynced returns whether the chain is synced, whether the header is recent,
// the current block height, and any error.
func (c *Client) IsSynced() (bool, bool, uint32, error) {
	if c.isClosing() {
		return false, false, 0, ErrDaemonNotRunning
	}
	ctx, cancel := c.rpcContext(0)
	defer cancel()
	resp, err := c.lnClient.GetInfo(ctx, &lnrpc.GetInfoRequest{})
	if err != nil && matchRPCErrorMessage(err, rpcperms.ErrRPCStarting) {
		err = nil
		resp = nil
	}
	var blockHeight uint32
	var synced bool
	var recentHeader bool
	if resp != nil {
		blockHeight = resp.BlockHeight
		synced = err == nil && resp.SyncedToChain
		if !synced && err == nil {
			blockTime := time.Unix(resp.BestHeaderTimestamp, 0)
			recentHeader = time.Since(blockTime) <= recentHeaderThreshold
		} else {
			recentHeader = synced
		}
	}
	c.mu.Lock()
	c.isSynced = synced
	c.syncedHeight = blockHeight
	c.mu.Unlock()
	return synced, recentHeader, blockHeight, err
}

// GetInfo returns the node info response from FLND.
func (c *Client) GetInfo() (*lnrpc.GetInfoResponse, error) {
	if c.isClosing() {
		return nil, ErrDaemonNotRunning
	}
	ctx, cancel := c.rpcContext(0)
	defer cancel()
	return c.lnClient.GetInfo(ctx, &lnrpc.GetInfoRequest{})
}

// GetState returns the current wallet state.
func (c *Client) GetState() (*lnrpc.GetStateResponse, error) {
	if c.isClosing() {
		return nil, ErrDaemonNotRunning
	}
	ctx, cancel := c.rpcContext(0)
	defer cancel()
	return c.stateClient.GetState(ctx, &lnrpc.GetStateRequest{})
}

// Unlock unlocks the wallet with the given passphrase.
func (c *Client) Unlock(passphrase string) error {
	if c.isClosing() {
		return ErrDaemonNotRunning
	}
	_, err := c.unlockerClient.UnlockWallet(c.ctx, &lnrpc.UnlockWalletRequest{
		WalletPassword: []byte(passphrase),
		RecoveryWindow: 255,
	})
	if err != nil && matchRPCErrorMessage(err, rpcperms.ErrWalletUnlocked) {
		return nil
	}
	return err
}

// GenSeed generates a new cipher seed mnemonic, optionally protected by aezeedPass.
func (c *Client) GenSeed(aezeedPass string) ([]string, error) {
	if c.isClosing() {
		return nil, ErrDaemonNotRunning
	}
	resp, err := c.unlockerClient.GenSeed(c.ctx, &lnrpc.GenSeedRequest{
		AezeedPassphrase: []byte(aezeedPass),
	})
	if err != nil {
		return nil, fmt.Errorf("unable to generate seed: %w", err)
	}
	return resp.CipherSeedMnemonic, nil
}

// InitWallet initialises the wallet. Pass existMnemonic or existHex for restore,
// or leave both empty to use a freshly generated seed.
func (c *Client) InitWallet(walletPassword, existMnemonic, aezeedPass, existHex string) error {
	if c.isClosing() {
		return ErrDaemonNotRunning
	}
	if err := walletunlocker.ValidatePassword([]byte(walletPassword)); err != nil {
		return err
	}

	var (
		cipherSeedMnemonic []string
		recoveryWindow     int32
	)

	switch {
	case existMnemonic != "":
		existMnemonic = strings.TrimSpace(strings.ToLower(existMnemonic))
		cipherSeedMnemonic = strings.Split(existMnemonic, " ")
		if len(cipherSeedMnemonic) != 24 {
			return fmt.Errorf("wrong cipher seed mnemonic length: got %v words, expecting 24",
				len(cipherSeedMnemonic))
		}
		recoveryWindow = defaultRecoveryWindow
	case existHex != "":
		encipheredSeed, err := hex.DecodeString(strings.TrimSpace(existHex))
		if err != nil {
			return fmt.Errorf("invalid hex seed: %w", err)
		}
		if len(encipheredSeed) != aezeed.EncipheredCipherSeedSize {
			return fmt.Errorf("invalid seed length: got %d bytes, expecting %d",
				len(encipheredSeed), aezeed.EncipheredCipherSeedSize)
		}
		mnemonic, err := aezeed.CipherTextToMnemonic([aezeed.EncipheredCipherSeedSize]byte(encipheredSeed))
		if err != nil {
			return fmt.Errorf("failed to decode hex seed: %w", err)
		}
		cipherSeedMnemonic = mnemonic[:]
		recoveryWindow = defaultRecoveryWindow
	}

	_, err := c.unlockerClient.InitWallet(c.ctx, &lnrpc.InitWalletRequest{
		WalletPassword:                     []byte(walletPassword),
		CipherSeedMnemonic:                 cipherSeedMnemonic,
		AezeedPassphrase:                   []byte(aezeedPass),
		ExtendedMasterKey:                  "",
		ExtendedMasterKeyBirthdayTimestamp: 0,
		RecoveryWindow:                     recoveryWindow,
		StatelessInit:                      false,
	})
	return err
}

// RestoreByEncipheredSeed restores a wallet from a hex-encoded enciphered seed.
// Returns the mnemonic words.
func (c *Client) RestoreByEncipheredSeed(strEncipheredSeed, passphrase string) ([]string, error) {
	if c.isClosing() {
		return nil, ErrDaemonNotRunning
	}

	encipheredSeed, err := hex.DecodeString(strings.TrimSpace(strEncipheredSeed))
	if err != nil {
		return nil, err
	}

	if len(encipheredSeed) != aezeed.EncipheredCipherSeedSize {
		return nil, fmt.Errorf("invalid seed length: got %d bytes, expecting %d",
			len(encipheredSeed), aezeed.EncipheredCipherSeedSize)
	}

	mnemonic, err := aezeed.CipherTextToMnemonic([aezeed.EncipheredCipherSeedSize]byte(encipheredSeed))
	if err != nil {
		return nil, err
	}

	_, err = c.unlockerClient.InitWallet(c.ctx, &lnrpc.InitWalletRequest{
		WalletPassword:     []byte(passphrase),
		CipherSeedMnemonic: mnemonic[:],
		RecoveryWindow:     defaultRecoveryWindow,
	})
	if err != nil {
		return nil, err
	}

	return mnemonic[:], nil
}

// Create generates a new seed and immediately initialises the wallet.
// Returns the hex-encoded enciphered seed and the mnemonic words.
func (c *Client) Create(passphrase string) (string, []string, error) {
	if c.isClosing() {
		return "", nil, ErrDaemonNotRunning
	}
	seedResp, err := c.unlockerClient.GenSeed(c.ctx, &lnrpc.GenSeedRequest{})
	if err != nil {
		return "", nil, err
	}
	_, err = c.unlockerClient.InitWallet(c.ctx, &lnrpc.InitWalletRequest{
		WalletPassword:     []byte(passphrase),
		CipherSeedMnemonic: seedResp.CipherSeedMnemonic,
		RecoveryWindow:     0,
	})
	if err != nil {
		return "", nil, err
	}
	return hex.EncodeToString(seedResp.EncipheredSeed), seedResp.CipherSeedMnemonic, nil
}

// ChangePassphrase changes the wallet passphrase. The wallet must be locked.
func (c *Client) ChangePassphrase(oldPass, newPass string) error {
	if c.isClosing() {
		return ErrDaemonNotRunning
	}
	locked, err := c.IsLocked()
	if err != nil {
		return err
	}
	if !locked {
		return ErrWalletMustBeLocked
	}
	_, err = c.unlockerClient.ChangePassword(c.withMacaroon(), &lnrpc.ChangePasswordRequest{
		CurrentPassword: []byte(oldPass),
		NewPassword:     []byte(newPass),
	})
	return err
}

// RestoreByMnemonic restores a wallet from a 24-word mnemonic.
// Returns the hex-encoded enciphered seed.
func (c *Client) RestoreByMnemonic(mnemonic []string, passphrase string) (string, error) {
	if c.isClosing() {
		return "", ErrDaemonNotRunning
	}
	var seedMnemonic aezeed.Mnemonic
	copy(seedMnemonic[:], mnemonic)
	cipherSeed, err := seedMnemonic.ToCipherSeed([]byte{})
	if err != nil {
		return "", err
	}
	encipheredSeed, err := cipherSeed.Encipher([]byte{})
	if err != nil {
		return "", err
	}
	_, err = c.unlockerClient.InitWallet(c.ctx, &lnrpc.InitWalletRequest{
		WalletPassword:     []byte(passphrase),
		CipherSeedMnemonic: mnemonic,
		RecoveryWindow:     255,
	})
	if err != nil {
		return "", err
	}
	return hex.EncodeToString(encipheredSeed[:]), nil
}

// Balance returns the current wallet balance.
func (c *Client) Balance() (*lnrpc.WalletBalanceResponse, error) {
	if c.isClosing() {
		return nil, ErrDaemonNotRunning
	}
	ctx, cancel := c.rpcContext(0)
	defer cancel()
	return c.lnClient.WalletBalance(ctx, &lnrpc.WalletBalanceRequest{MinConfs: 0})
}

// GetRecoveryInfo returns wallet recovery progress.
func (c *Client) GetRecoveryInfo() (*lnrpc.GetRecoveryInfoResponse, error) {
	if c.isClosing() {
		return nil, ErrDaemonNotRunning
	}
	ctx, cancel := c.rpcContext(0)
	defer cancel()
	return c.lnClient.GetRecoveryInfo(ctx, &lnrpc.GetRecoveryInfoRequest{})
}

// ListUnspent returns unspent outputs.
func (c *Client) ListUnspent(minConfs, maxConfs int32) ([]*lnrpc.Utxo, error) {
	if c.isClosing() {
		return nil, ErrDaemonNotRunning
	}
	ctx, cancel := c.rpcContext(0)
	defer cancel()
	resp, err := c.walletKit.ListUnspent(ctx, &walletrpc.ListUnspentRequest{MinConfs: minConfs, MaxConfs: maxConfs})
	if err != nil {
		return nil, err
	}
	return resp.GetUtxos(), nil
}

// ListAddresses returns all wallet addresses.
func (c *Client) ListAddresses() (*walletrpc.ListAddressesResponse, error) {
	if c.isClosing() {
		return nil, ErrDaemonNotRunning
	}
	ctx, cancel := c.rpcContext(0)
	defer cancel()
	return c.walletKit.ListAddresses(ctx, &walletrpc.ListAddressesRequest{})
}

// LightningConfig contains the node's connection info for third-party tools.
type LightningConfig struct {
	RpcAddress  string
	PeerAddress string
	PubKey      string
	Alias       string
	MacaroonHex string
	TLSCertHex  string
}

// ConnectionInfo is the subset of LightningConfig that does not require a
// GetInfo call — safe for the 2s info poll to call every tick. PubKey/Alias
// come from the caller's own GetInfo (which the info endpoint already does).
type ConnectionInfo struct {
	RpcAddress  string
	PeerAddress string
	MacaroonHex string
	TLSCertHex  string
}

// cachedTLSCertHex returns the hex-encoded TLS cert, reading it from disk
// only once. flnd writes the cert at startup and never rewrites it during
// the process lifetime, so caching is safe.
func (c *Client) cachedTLSCertHex() (string, error) {
	c.mu.Lock()
	cached := c.tlsCertHex
	c.mu.Unlock()
	if cached != "" {
		return cached, nil
	}
	data, err := os.ReadFile(c.config.TLSCertPath)
	if err != nil {
		return "", err
	}
	encoded := hex.EncodeToString(data)
	c.mu.Lock()
	c.tlsCertHex = encoded
	c.mu.Unlock()
	return encoded, nil
}

// resolveAddresses computes the local RPC + public peer addresses. The UDP
// dial is local-only (no packet sent) and typically resolves in microseconds.
func (c *Client) resolveAddresses() (rpc, peer string) {
	conn, err := net.Dial("udp", publicDNSCheckAddress)
	if err != nil {
		return "", ""
	}
	localAddr := conn.LocalAddr().(*net.UDPAddr)
	conn.Close()
	ip := localAddr.IP.String()

	rpcPort := strconv.Itoa(defaultRPCPort)
	if len(c.config.RPCListeners) > 0 {
		if _, p, err := net.SplitHostPort(c.config.RPCListeners[0].String()); err == nil {
			rpcPort = p
		}
	}
	rpc = net.JoinHostPort(localhostIP, rpcPort)

	peerPort := strconv.Itoa(defaultPeerPort)
	if len(c.config.Listeners) > 0 {
		if _, p, err := net.SplitHostPort(c.config.Listeners[0].String()); err == nil {
			peerPort = p
		}
	}
	peer = net.JoinHostPort(ip, peerPort)
	return
}

// GetConnectionInfo returns the fast-path connection details (no GetInfo RPC).
// Use this on the hot polling path; call GetLightningConfig only when you also
// need PubKey/Alias.
func (c *Client) GetConnectionInfo() (*ConnectionInfo, error) {
	if c.isClosing() {
		return nil, ErrDaemonNotRunning
	}
	if c.lnClient == nil {
		return nil, ErrDaemonNotRunning
	}
	tlsHex, err := c.cachedTLSCertHex()
	if err != nil {
		return nil, err
	}
	rpc, peer := c.resolveAddresses()
	return &ConnectionInfo{
		RpcAddress:  rpc,
		PeerAddress: peer,
		MacaroonHex: c.adminMacHex,
		TLSCertHex:  tlsHex,
	}, nil
}

// GetLightningConfig returns connection details plus PubKey/Alias via GetInfo.
func (c *Client) GetLightningConfig() (*LightningConfig, error) {
	if c.isClosing() {
		return nil, ErrDaemonNotRunning
	}
	if c.lnClient == nil {
		return nil, ErrDaemonNotRunning
	}

	ctx, cancel := context.WithTimeout(c.ctx, defaultRPCTimeout)
	defer cancel()
	ctx = metadata.NewOutgoingContext(ctx, metadata.Pairs("macaroon", c.adminMacHex))

	info, err := c.lnClient.GetInfo(ctx, &lnrpc.GetInfoRequest{})
	if err != nil {
		return nil, err
	}
	tlsHex, err := c.cachedTLSCertHex()
	if err != nil {
		return nil, err
	}
	rpc, peer := c.resolveAddresses()
	return &LightningConfig{
		RpcAddress:  rpc,
		PeerAddress: peer,
		PubKey:      info.IdentityPubkey,
		Alias:       info.Alias,
		MacaroonHex: c.adminMacHex,
		TLSCertHex:  tlsHex,
	}, nil
}

// SendCoins broadcasts an on-chain transaction and returns the txid.
func (c *Client) SendCoins(address string, amountLoki int64, lokiPerVbyte int64) (string, error) {
	if c.isClosing() {
		return "", ErrDaemonNotRunning
	}
	ctx, cancel := c.rpcContext(0)
	defer cancel()
	resp, err := c.lnClient.SendCoins(ctx, &lnrpc.SendCoinsRequest{
		Addr:        address,
		Amount:      amountLoki,
		SatPerVbyte: uint64(lokiPerVbyte),
	})
	if err != nil {
		return "", err
	}
	return resp.Txid, nil
}

// EstimateFee estimates the fee for a potential send. Returns (lokiPerVbyte, totalFeeLoki, err).
func (c *Client) EstimateFee(address string, amountLoki int64) (lokiPerVbyte int64, totalFee int64, err error) {
	if c.isClosing() {
		return 0, 0, ErrDaemonNotRunning
	}
	ctx, cancel := c.rpcContext(0)
	defer cancel()
	resp, err := c.lnClient.EstimateFee(ctx, &lnrpc.EstimateFeeRequest{
		AddrToAmount: map[string]int64{address: amountLoki},
		TargetConf:   6,
	})
	if err != nil {
		return 0, 0, err
	}
	return int64(resp.SatPerVbyte), resp.FeeSat, nil
}

// MaxSendable calculates the maximum amount that can be sent to an address
// given a fee rate, by summing all UTXOs and subtracting the estimated fee.
func (c *Client) MaxSendable(address string, lokiPerVbyte int64) (amount int64, fee int64, err error) {
	if c.isClosing() {
		return 0, 0, ErrDaemonNotRunning
	}
	// 1. List all unspent UTXOs
	utxos, err := c.ListUnspent(0, math.MaxInt32)
	if err != nil {
		return 0, 0, err
	}
	if len(utxos) == 0 {
		return 0, 0, nil
	}

	var total int64
	for _, u := range utxos {
		total += u.AmountSat
	}

	// 2. Estimate transaction size.
	// We assume a standard P2WPKH (Segwit) transaction for estimation.
	// Overhead: 10.5 vB
	// Input (P2WPKH): 68 vB each
	// Output (P2WPKH): 31 vB each
	// Sweep tx has exactly 1 output and len(utxos) inputs.
	size := 11 + (len(utxos) * 68) + 31
	fee = int64(size) * lokiPerVbyte

	amount = total - fee
	if amount < 0 {
		return 0, total, nil
	}

	return amount, fee, nil
}

// NewAddress generates a new receiving address of the given type.
func (c *Client) NewAddress(addrType lnrpc.AddressType) (string, error) {
	if c.isClosing() {
		return "", ErrDaemonNotRunning
	}
	ctx, cancel := c.rpcContext(0)
	defer cancel()
	resp, err := c.lnClient.NewAddress(ctx, &lnrpc.NewAddressRequest{Type: addrType})
	if err != nil {
		return "", err
	}
	return resp.Address, nil
}

// GetTransactions returns on-chain transactions in [startHeight, endHeight].
// Pass endHeight = -1 to include unconfirmed mempool transactions.
func (c *Client) GetTransactions(startHeight, endHeight int32) ([]*lnrpc.Transaction, error) {
	if c.isClosing() {
		return nil, ErrDaemonNotRunning
	}
	ctx, cancel := c.rpcContext(30 * time.Second)
	defer cancel()
	resp, err := c.lnClient.GetTransactions(ctx, &lnrpc.GetTransactionsRequest{
		StartHeight: startHeight,
		EndHeight:   endHeight,
	})
	if err != nil {
		return nil, err
	}
	return resp.Transactions, nil
}

// --- context helpers ---

func (c *Client) withMacaroon() context.Context {
	c.mu.Lock()
	hex := c.adminMacHex
	c.mu.Unlock()
	md := metadata.Pairs("macaroon", hex)
	return metadata.NewOutgoingContext(c.ctx, md)
}

func (c *Client) rpcContext(timeout time.Duration) (context.Context, context.CancelFunc) {
	if timeout <= 0 {
		timeout = defaultRPCTimeout
	}
	if c.config.ConnectionTimeout > 0 && timeout > c.config.ConnectionTimeout {
		timeout = c.config.ConnectionTimeout
	}
	ctx, cancel := context.WithTimeout(c.ctx, timeout)

	c.mu.Lock()
	hex := c.adminMacHex
	c.mu.Unlock()
	md := metadata.Pairs("macaroon", hex)
	return metadata.NewOutgoingContext(ctx, md), cancel
}

func (c *Client) refreshMacaroon() {
	if macHex, err := readMacaroon(c.config.AdminMacPath); err == nil {
		c.mu.Lock()
		c.adminMacHex = macHex
		c.mu.Unlock()
		log.Debug("refreshed admin macaroon from disk")
	}
}

// --- internal helpers ---

func readMacaroon(path string) (string, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return "", err
	}
	return hex.EncodeToString(data), nil
}

func matchRPCErrorMessage(err error, targets ...error) bool {
	st, ok := status.FromError(err)
	if !ok {
		return false
	}
	for _, t := range targets {
		if st.Message() == t.Error() {
			return true
		}
	}
	return false
}
