package daemon

import (
	"testing"
	"time"
)

func TestSyncProgressTracker_FirstTickAnchors(t *testing.T) {
	tracker := newSyncProgressTracker(syncStuckTimeout)

	// First call with bestTs=0: should anchor lastAt, not report stuck yet.
	stuck := tracker.record(0)
	if stuck {
		t.Fatal("should not be stuck on first tick")
	}
	if tracker.lastAt.IsZero() {
		t.Fatal("lastAt should be anchored on first tick")
	}
}

func TestSyncProgressTracker_ProgressResetsTimer(t *testing.T) {
	tracker := newSyncProgressTracker(10 * time.Millisecond)

	tracker.record(100)
	time.Sleep(5 * time.Millisecond)

	// Advance bestTs — timer should reset, not stuck yet.
	stuck := tracker.record(200)
	if stuck {
		t.Fatal("progress was observed; should not be stuck")
	}

	// Wait for the original timeout to expire without further progress.
	time.Sleep(5 * time.Millisecond)
	stuck = tracker.record(200)
	if stuck {
		t.Fatal("timer was reset on progress; should not be stuck yet")
	}

	// Now wait past the timeout from the last progress.
	time.Sleep(15 * time.Millisecond)
	stuck = tracker.record(200)
	if !stuck {
		t.Fatal("no progress past timeout; should be stuck")
	}
}

func TestSyncProgressTracker_SameTimestampTriggersStuck(t *testing.T) {
	tracker := newSyncProgressTracker(10 * time.Millisecond)

	tracker.record(42) // anchor
	time.Sleep(20 * time.Millisecond)

	stuck := tracker.record(42) // same ts, past timeout
	if !stuck {
		t.Fatal("bestTs unchanged past timeout; should be stuck")
	}
}

func TestSyncProgressTracker_ZeroTimestampStuck(t *testing.T) {
	tracker := newSyncProgressTracker(10 * time.Millisecond)

	tracker.record(0) // anchor with zero ts
	time.Sleep(20 * time.Millisecond)

	stuck := tracker.record(0)
	if !stuck {
		t.Fatal("zero bestTs unchanged past timeout; should be stuck")
	}
}

func TestSyncProgressTracker_StuckForReturnsElapsed(t *testing.T) {
	tracker := newSyncProgressTracker(syncStuckTimeout)

	if d := tracker.stuckFor(); d != 0 {
		t.Fatalf("stuckFor before any record should be 0, got %v", d)
	}

	tracker.record(0)
	time.Sleep(5 * time.Millisecond)

	d := tracker.stuckFor()
	if d < 5*time.Millisecond {
		t.Fatalf("stuckFor should be at least 5ms, got %v", d)
	}
}

func TestSyncProgressTracker_NotStuckBeforeTimeout(t *testing.T) {
	tracker := newSyncProgressTracker(syncStuckTimeout) // 3 minutes

	// Simulate many ticks with the same bestTs but nowhere near the timeout.
	for i := 0; i < 100; i++ {
		stuck := tracker.record(999)
		if stuck {
			t.Fatalf("stuck reported after only %d ticks, well before timeout", i+1)
		}
	}
}

func TestSyncProgressTracker_ResetAfterProgress(t *testing.T) {
	tracker := newSyncProgressTracker(10 * time.Millisecond)

	tracker.record(1)
	time.Sleep(20 * time.Millisecond)

	// Would be stuck here, but advance bestTs — timer resets.
	stuck := tracker.record(2)
	if stuck {
		t.Fatal("progress at timeout boundary should reset timer, not report stuck")
	}

	// Should not be stuck immediately after progress.
	stuck = tracker.record(2)
	if stuck {
		t.Fatal("should not be stuck right after progress")
	}
}
