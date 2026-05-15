package daemon

import (
	"context"
	"crypto/x509"
	"errors"
	"fmt"
	"os"
	"sync"
	"time"

	"github.com/flokiorg/flnd"
	"github.com/flokiorg/flnd/signal"
	"google.golang.org/grpc"
	"google.golang.org/grpc/backoff"
	"google.golang.org/grpc/credentials"
	"google.golang.org/grpc/encoding/gzip"
)

var (
	ErrDaemonNotRunning = errors.New("daemon is not running")
)

const (
	maxGrpcRecvMsgSize = 50 * 1024 * 1024
	maxGrpcSendMsgSize = 20 * 1024 * 1024
)

type flndDaemon struct {
	config      *flnd.Config
	interceptor signal.Interceptor

	conn *grpc.ClientConn

	ctx      context.Context
	cancel   context.CancelFunc
	stopping bool // set by stop() before teardown; see isStopping().
	closed   bool
	mu       sync.Mutex
	wg       sync.WaitGroup
	client   *Client
}

// isStopping reports whether stop() has been invoked. Health-stream errors
// observed after this point are self-induced (we just closed the gRPC conn)
// and must not be forwarded as genuine StatusDown — otherwise consumers see
// a spurious "node down" blip during a deliberate Restart.
//
// Intentionally does NOT consult d.closed: a natural exit of flnd.Main sets
// d.closed via waitForShutdown without ever calling stop(), and in that case
// the trailing StatusDown event from the gRPC stream IS the genuine crash
// notification and must be forwarded so the run loop can capture the error.
func (d *flndDaemon) isStopping() bool {
	d.mu.Lock()
	defer d.mu.Unlock()
	return d.stopping
}

func newDaemon(pctx context.Context, config *flnd.Config, interceptor signal.Interceptor) (*flndDaemon, error) {
	ctx, cancel := context.WithCancel(pctx)

	if interceptor.ShutdownChannel() == nil {
		cancel()
		return nil, fmt.Errorf("signal interceptor is required")
	}

	return &flndDaemon{
		config:      config,
		ctx:         ctx,
		cancel:      cancel,
		interceptor: interceptor,
	}, nil
}

func (d *flndDaemon) start() (c *Client, err error) {
	impl := d.config.ImplementationConfig(d.interceptor)
	defer func() {
		if err != nil {
			log.Error().Err(err).Msg("daemon start aborted; calling d.stop()")
			d.stop()
			log.Info().Msg("d.stop() returned after start abort")
		}
	}()

	log.Info().Msg("daemon exec starting (waiting for flndStarted signal)")
	if err = d.exec(impl); err != nil {
		log.Error().Err(err).Msg("daemon exec failed")
		return
	}
	log.Info().Msg("daemon exec signalled ready; dialing gRPC")

	var creds credentials.TransportCredentials
	creds, err = tlsCreds(d.config.TLSCertPath)
	if err != nil {
		return nil, err
	}

	if len(d.config.RPCListeners) == 0 {
		return nil, fmt.Errorf("unable to open rpc connection, rpc listener is empty")
	}

	d.conn, err = grpc.NewClient(d.config.RPCListeners[0].String(),
		grpc.WithTransportCredentials(creds),
		grpc.WithDefaultCallOptions(
			grpc.MaxCallRecvMsgSize(maxGrpcRecvMsgSize),
			grpc.MaxCallSendMsgSize(maxGrpcSendMsgSize),
			grpc.UseCompressor(gzip.Name),
		), grpc.WithConnectParams(grpc.ConnectParams{
			MinConnectTimeout: 5 * time.Second,
			Backoff: backoff.Config{
				BaseDelay:  500 * time.Millisecond,
				Multiplier: 1.5,
				MaxDelay:   5 * time.Second,
			},
		}))
	if err != nil {
		return nil, err
	}

	d.client = NewClient(d.ctx, d.conn, d.config)
	c = d.client
	return
}

// execStartupTimeout bounds the wait for flnd.Main to signal readiness. On a
// lock+restart cycle flnd occasionally races its own shutdown (wallet DB lock,
// port rebind, TLS regen); without this cap the whole service loop wedges in
// d.start() and the UI is stuck on "starting" forever because s.client never
// gets registered, which in turn disables the GetState defensive fallback in
// the info endpoint.
const execStartupTimeout = 60 * time.Second

func (d *flndDaemon) exec(impl *flnd.ImplementationCfg) error {
	// Buffered so the exec goroutine never blocks on a stale send after the
	// select already returned on <-flndStarted or the timeout.
	errCh := make(chan error, 1)
	flndStarted := make(chan struct{})

	d.wg.Add(1)
	go func() {
		defer d.wg.Done()
		defer func() {
			if r := recover(); r != nil {
				err := fmt.Errorf("unable to run FLND daemon: %v", r)
				if d.client != nil {
					d.client.kill(err)
					return
				}
				select {
				case errCh <- err:
				default:
				}
			}
		}()
		if err := flnd.Main(d.config, flnd.ListenerCfg{}, impl, d.interceptor, flndStarted); err != nil {
			if d.client != nil {
				d.client.kill(err)
				return
			}
			select {
			case errCh <- err:
			default:
			}
		}
	}()

	select {
	case err := <-errCh:
		log.Error().Err(err).Msg("flnd.Main returned error before signalling ready")
		return err
	case <-flndStarted:
		log.Info().Msg("flndStarted signal received")
		return nil
	case <-d.ctx.Done():
		log.Warn().Err(d.ctx.Err()).Msg("exec aborted: daemon context cancelled before flndStarted")
		return d.ctx.Err()
	case <-time.After(execStartupTimeout):
		log.Error().Dur("timeout", execStartupTimeout).Msg("exec timeout: flnd.Main did not signal ready within timeout")
		return fmt.Errorf("flnd startup timeout after %s", execStartupTimeout)
	}
}

// waitForShutdown blocks until flnd.Main returns. Callable both passively
// (from the service run loop, to wait for a natural death) and after an
// explicit d.stop(). The 8-second grace period only applies *after* a
// shutdown has been requested (d.ctx cancelled) — without that guard the
// timeout would also fire during healthy operation, making the run loop
// believe the daemon died every 8 seconds.
func (d *flndDaemon) waitForShutdown() {
	done := make(chan struct{})
	go func() { d.wg.Wait(); close(done) }()

	wfsStarted := time.Now()
	log.Info().Msg("waitForShutdown: entering")
	// Phase 1: block indefinitely until the daemon exits on its own OR a
	// shutdown is requested.
	select {
	case <-done:
		log.Info().Dur("elapsed", time.Since(wfsStarted)).Msg("waitForShutdown: phase1 — exec goroutine exited naturally (no shutdown request)")
		// Daemon exited naturally (crash or self-termination without an explicit
		// d.stop call). The signal interceptor's mainInterruptHandler goroutine
		// may still be running — request shutdown so it exits and clears the
		// global `started` flag. Without this, the next acquireSignalInterceptor
		// call (e.g. on Retry) would spin forever on "already started".
		log.Info().Msg("waitForShutdown: phase1 — requesting interceptor shutdown")
		d.interceptor.RequestShutdown()
		select {
		case <-d.interceptor.ShutdownChannel():
			log.Info().Msg("waitForShutdown: phase1 — interceptor shutdown channel drained")
		case <-time.After(2 * time.Second):
			log.Warn().Msg("waitForShutdown: phase1 — interceptor shutdown channel did not drain within 2s")
		}
		d.mu.Lock()
		d.closed = true
		d.mu.Unlock()
		log.Info().Msg("waitForShutdown: phase1 — done")
		return
	case <-d.ctx.Done():
		log.Info().Dur("elapsed_before_ctx", time.Since(wfsStarted)).Msg("waitForShutdown: phase2 — shutdown requested; awaiting exec drain")
	}

	// Phase 2: shutdown requested — wait for flnd.Main to actually return.
	// Log a warning at 8 s so slow shutdowns are visible, but do NOT give up:
	// returning early while flnd.Main still holds its ports causes a port-conflict
	// on the very next RunNode call ("address already in use").
	select {
	case <-done:
		log.Info().Dur("elapsed", time.Since(wfsStarted)).Msg("waitForShutdown: phase2 — exec goroutine drained")
	case <-time.After(8 * time.Second):
		log.Warn().Msg("waitForShutdown: phase2 — exec goroutine did not drain within 8s; still waiting (port held!)")
		<-done
		log.Warn().Dur("elapsed", time.Since(wfsStarted)).Msg("waitForShutdown: phase2 — exec goroutine finally drained (slow shutdown)")
	}

	select {
	case <-d.interceptor.ShutdownChannel():
		log.Info().Msg("waitForShutdown: phase2 — interceptor shutdown channel drained")
	case <-time.After(2 * time.Second):
		log.Warn().Msg("waitForShutdown: phase2 — interceptor shutdown channel did not drain within 2s")
	}

	d.mu.Lock()
	d.closed = true
	d.mu.Unlock()
	log.Info().Dur("elapsed", time.Since(wfsStarted)).Msg("waitForShutdown: done")
}

func (d *flndDaemon) stop() {
	d.mu.Lock()
	defer d.mu.Unlock()
	if d.closed {
		log.Trace().Msg("daemon stop noop (already closed)")
		return
	}
	d.stopping = true
	log.Info().Msg("daemon stop: tearing down client + conn")

	if d.client != nil {
		d.client.close()
	}
	if d.conn != nil {
		d.conn.Close()
	}

	log.Info().Msg("daemon stop: cancelling context and requesting interceptor shutdown")
	d.cancel()
	d.interceptor.RequestShutdown()
	select {
	case <-d.interceptor.ShutdownChannel():
		log.Info().Msg("daemon stop: interceptor shutdown drained")
	case <-time.After(5 * time.Second):
		log.Warn().Msg("daemon stop: interceptor shutdown NOT drained within 5s — signal goroutine may be stuck")
	}
	log.Info().Msg("daemon stop: complete")
}

func tlsCreds(certPath string) (credentials.TransportCredentials, error) {
	pem, err := os.ReadFile(certPath)
	if err != nil {
		return nil, err
	}
	cp := x509.NewCertPool()
	if !cp.AppendCertsFromPEM(pem) {
		return nil, errors.New("failed to parse cert")
	}
	return credentials.NewClientTLSFromCert(cp, ""), nil
}
