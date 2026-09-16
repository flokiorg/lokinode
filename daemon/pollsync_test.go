package daemon

// Verifies the second hypothesis from the "host loses internet" bug report:
// pollSyncStatus's stuck-progress tracker only advances when IsSynced/GetInfo
// calls SUCCEED but report no progress (client.go: `if err != nil { ...;
// continue }` skips tracker.record entirely). If GetInfo starts erroring or
// timing out — which is what a wedged/unresponsive backend would look like
// from the client's side — the auto-restart safety net never fires, and the
// daemon can sit reporting "syncing" forever with no self-recovery.
//
// syncStuckTimeout and syncPollInterval are the package-level test seam
// added alongside this file (client.go) specifically so this can run in
// milliseconds instead of the real 3-minute/5-second production values.

import (
	"context"
	"errors"
	"sync/atomic"
	"testing"
	"time"

	"github.com/flokiorg/flnd"
	"github.com/flokiorg/flnd/lnrpc"
	"google.golang.org/grpc"
)

// fakeLightningClient embeds the (nil) interface so it satisfies
// lnrpc.LightningClient, and overrides only GetInfo — the one method
// IsSynced/pollSyncStatus actually calls. Any other method would panic if
// invoked, which is intentional: these tests only exercise the sync-polling
// path.
type fakeLightningClient struct {
	lnrpc.LightningClient
	getInfo func(ctx context.Context) (*lnrpc.GetInfoResponse, error)
}

func (f *fakeLightningClient) GetInfo(ctx context.Context, _ *lnrpc.GetInfoRequest, _ ...grpc.CallOption) (*lnrpc.GetInfoResponse, error) {
	return f.getInfo(ctx)
}

// withShortSyncTimers overrides the package-level poll/stuck timers for the
// duration of a test and restores them afterwards.
func withShortSyncTimers(t *testing.T, stuck, interval time.Duration) {
	t.Helper()
	origStuck, origInterval := syncStuckTimeout, syncPollInterval
	syncStuckTimeout, syncPollInterval = stuck, interval
	t.Cleanup(func() {
		syncStuckTimeout, syncPollInterval = origStuck, origInterval
	})
}

func newPollTestClient(getInfo func(ctx context.Context) (*lnrpc.GetInfoResponse, error)) *Client {
	return &Client{
		lnClient: &fakeLightningClient{getInfo: getInfo},
		health:   make(chan *Update, 16),
		ctx:      context.Background(),
		config:   &flnd.Config{},
	}
}

// TestPollSyncStatus_StuckButSuccessful_TriggersRestart is the designed
// path: GetInfo keeps succeeding but reports an unchanged, stale header.
// After syncStuckTimeout of no progress, pollSyncStatus must self-terminate
// by publishing StatusDown (client.go: "nil Err -> auto-restart, not
// crash/retry path").
func TestPollSyncStatus_StuckButSuccessful_TriggersRestart(t *testing.T) {
	withShortSyncTimers(t, 60*time.Millisecond, 5*time.Millisecond)

	var calls int32
	c := newPollTestClient(func(ctx context.Context) (*lnrpc.GetInfoResponse, error) {
		atomic.AddInt32(&calls, 1)
		return &lnrpc.GetInfoResponse{
			SyncedToChain:       false,
			BestHeaderTimestamp: 1700000000, // fixed, far-past timestamp: never "recent", never advances
			BlockHeight:         100,
		}, nil
	})

	done := make(chan struct{})
	go func() { c.pollSyncStatus(); close(done) }()

	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatal("pollSyncStatus did not return; the stuck-timeout safety net never fired")
	}

	if atomic.LoadInt32(&calls) == 0 {
		t.Fatal("GetInfo was never called")
	}

	// pollSyncStatus publishes a StatusSyncing update on every tick leading
	// up to the stuck detection, then one final StatusDown right before it
	// returns (client.go). done closing happens-after that last send, so
	// draining the buffered channel here is race-free; we only care about
	// the last (terminal) update.
	var last *Update
	drained := 0
	for {
		select {
		case ev := <-c.health:
			last = ev
			drained++
		default:
			goto checked
		}
	}
checked:
	if last == nil {
		t.Fatal("pollSyncStatus returned but never published any health update")
	}
	if last.State != StatusDown {
		t.Fatalf("last published state = %v (of %d updates), want StatusDown as the terminal update", last.State, drained)
	}
	if last.Err != nil {
		t.Fatalf("got Err %v, want nil (self-triggered stall, not a crash)", last.Err)
	}
}

// TestPollSyncStatus_PersistentErrors_NeverTriggersRestart is the blind
// spot: GetInfo fails on every call (context deadline exceeded, connection
// refused, etc. — whatever an unresponsive backend produces). Because
// pollSyncStatus's `if err != nil { continue }` skips tracker.record
// entirely, the stuck-timer never advances and the safety net never fires,
// no matter how long the failures persist.
func TestPollSyncStatus_PersistentErrors_NeverTriggersRestart(t *testing.T) {
	withShortSyncTimers(t, 60*time.Millisecond, 5*time.Millisecond)

	var calls int32
	c := newPollTestClient(func(ctx context.Context) (*lnrpc.GetInfoResponse, error) {
		atomic.AddInt32(&calls, 1)
		return nil, errors.New("context deadline exceeded")
	})

	done := make(chan struct{})
	go func() { c.pollSyncStatus(); close(done) }()

	// Run for well past 10x the stuck-timeout used above. If the watchdog
	// worked the same way it does for the "successful but stale" case, it
	// would have fired many times over by now.
	select {
	case <-done:
		t.Fatal("pollSyncStatus returned on its own despite GetInfo only ever erroring — the stuck-timer must not have been what caused this; investigate")
	case <-time.After(600 * time.Millisecond):
	}

	if calls := atomic.LoadInt32(&calls); calls < 5 {
		t.Fatalf("expected many GetInfo attempts by now, got %d — test timers may be too slow", calls)
	}

	select {
	case ev := <-c.health:
		t.Fatalf("pollSyncStatus published %+v despite GetInfo never once succeeding; expected no health updates at all", ev)
	default:
		// Expected: persistent GetInfo errors never reach tracker.record, so
		// no StatusDown (or any other update) is ever published. The daemon
		// is left silently polling forever with no visible recovery attempt.
	}

	c.stopSyncPolling()
	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatal("pollSyncStatus did not exit after stopSyncPolling")
	}
}
