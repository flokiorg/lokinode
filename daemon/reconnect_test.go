package daemon

// These tests target the exact mechanism described in the "host loses
// internet" bug report: when the sync-stall watchdog (pollSyncStatus, see
// client.go) decides the chain has been stuck too long, it emits
// Update{State: StatusDown} with a *nil* Err (client.go, "nil Err ->
// auto-restart, not crash/retry path"). runHealthRelay forwards that to
// Service.run(), whose crashErr==nil branch loops straight back into
// runOnce() with NO call to waitForRetry() — i.e. no user gate at all.
//
// A genuine crash (flnd.Main returning a real error) produces the same
// StatusDown state but with a non-nil Err, which DOES block on
// waitForRetry() until the user clicks Retry.
//
// These tests exercise the real, unmodified runHealthRelay and waitForRetry
// implementations — no mocking of the logic under test — to confirm this
// split actually exists in the code as read, before any fix is attempted.

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/flokiorg/flnd/signal"
)

// mustIntercept acquires the process-wide signal interceptor for a test,
// retrying past the brief "already started" window the same way
// Service.acquireSignalInterceptor does in production (service.go). This is
// necessary because flndDaemon.stop() calls interceptor.RequestShutdown(),
// which needs a live mainInterruptHandler goroutine behind it (see
// signal.Intercept); a zero-value Interceptor would hang forever.
func mustIntercept(t *testing.T) signal.Interceptor {
	t.Helper()
	deadline := time.Now().Add(2 * time.Second)
	for {
		ic, err := signal.Intercept()
		if err == nil {
			return ic
		}
		if !strings.Contains(err.Error(), "already started") || time.Now().After(deadline) {
			t.Fatalf("signal.Intercept: %v", err)
		}
		time.Sleep(5 * time.Millisecond)
	}
}

// newTestDaemon builds a minimal *flndDaemon that can be torn down via
// stop()/isStopping() without ever starting a real flnd process.
func newTestDaemon(t *testing.T) *flndDaemon {
	t.Helper()
	ic := mustIntercept(t)
	ctx, cancel := context.WithCancel(context.Background())
	d := &flndDaemon{
		ctx:         ctx,
		cancel:      cancel,
		interceptor: ic,
	}
	t.Cleanup(func() {
		// Idempotent: if the test already called stop(), this is a no-op.
		d.stop()
	})
	return d
}

// TestRunHealthRelay_SelfTriggeredStall_ReportsNoCrash reproduces what
// pollSyncStatus emits when it gives up on a stalled sync
// (client.go: `c.submitHealth(Update{State: StatusDown})  // nil Err ->
// auto-restart, not crash/retry path`). It proves runHealthRelay still tears
// the daemon down (d.stop() is called) but reports a nil crashErr for it,
// which is the exact signal Service.run() uses to skip the user-facing
// retry gate.
func TestRunHealthRelay_SelfTriggeredStall_ReportsNoCrash(t *testing.T) {
	s := &Service{}
	d := newTestDaemon(t)
	c := &Client{health: make(chan *Update, 4)}

	c.health <- &Update{State: StatusDown} // Err == nil: self-triggered stall

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()

	done := make(chan error, 1)
	go func() { done <- s.runHealthRelay(ctx, d, c) }()

	// Give the relay time to process the event before we look at side effects.
	select {
	case err := <-done:
		t.Fatalf("runHealthRelay returned early (err=%v); it should keep running until ctx is cancelled or the health channel closes", err)
	case <-time.After(100 * time.Millisecond):
	}

	if !d.isStopping() {
		t.Fatal("a StatusDown update must cause runHealthRelay to call d.stop(), but the daemon was never marked stopping")
	}

	cancel()
	if err := <-done; err != nil {
		t.Fatalf("crashErr = %v, want nil: a nil-Err StatusDown (self-triggered stall) must not be reported as a crash", err)
	}
}

// TestRunHealthRelay_RealCrash_PreservesError is the control case: a
// StatusDown update WITH an error (what a genuine flnd.Main failure produces
// via d.client.kill(err), client.go) must have its error preserved so
// Service.run() routes it through waitForRetry() instead of auto-looping.
func TestRunHealthRelay_RealCrash_PreservesError(t *testing.T) {
	s := &Service{}
	d := newTestDaemon(t)
	c := &Client{health: make(chan *Update, 4)}

	wantErr := errors.New("flnd.Main: simulated crash")
	c.health <- &Update{State: StatusDown, Err: wantErr}

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()

	done := make(chan error, 1)
	go func() { done <- s.runHealthRelay(ctx, d, c) }()

	time.Sleep(100 * time.Millisecond)
	if !d.isStopping() {
		t.Fatal("a StatusDown update must cause runHealthRelay to call d.stop()")
	}

	cancel()
	err := <-done
	if !errors.Is(err, wantErr) {
		t.Fatalf("crashErr = %v, want %v: a real crash's error must survive so run() gates the restart behind waitForRetry()", err, wantErr)
	}
}

// TestService_WaitForRetry_BlocksUntilSignalled confirms waitForRetry is a
// genuine blocking gate: given the crashErr!=nil branch in Service.run()
// reaches it, nothing proceeds until either RestartWithConfig signals
// retryNow (the user clicking Retry) or the service is shut down.
//
// Combined with the two tests above, this closes the loop on the bug
// report's core claim: run()'s `if crashErr == nil { continue }` (service.go)
// means a self-triggered stall restart NEVER reaches this gate — only a real
// crash does. The self-triggered path restarts (and therefore relocks the
// wallet, since flnd always boots LOCKED) without any user action at all.
func TestService_WaitForRetry_BlocksUntilSignalled(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	s := &Service{ctx: ctx, cancel: cancel, retryNow: make(chan struct{}, 1)}

	done := make(chan bool, 1)
	go func() { done <- s.waitForRetry() }()

	select {
	case ok := <-done:
		t.Fatalf("waitForRetry returned (%v) before being signalled or cancelled — it is not actually gating anything", ok)
	case <-time.After(100 * time.Millisecond):
	}

	s.retryNow <- struct{}{}
	select {
	case ok := <-done:
		if !ok {
			t.Fatal("waitForRetry should return true when retryNow fires")
		}
	case <-time.After(2 * time.Second):
		t.Fatal("waitForRetry did not unblock after retryNow was signalled")
	}
}
