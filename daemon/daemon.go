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
	"github.com/flokiorg/lokinode/lokilog"
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
func (d *flndDaemon) isStopping() bool {
	d.mu.Lock()
	defer d.mu.Unlock()
	return d.stopping || d.closed
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
			log.Error("daemon start aborted", "err", err)
			d.stop()
		}
	}()

	log.Debug("daemon exec starting")
	if err = d.exec(impl); err != nil {
		return
	}
	log.Debug("daemon exec signalled ready; dialing gRPC")

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
		return err
	case <-flndStarted:
		return nil
	case <-d.ctx.Done():
		return d.ctx.Err()
	case <-time.After(execStartupTimeout):
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

	started := time.Now()
	// Phase 1: block indefinitely until the daemon exits on its own OR a
	// shutdown is requested.
	select {
	case <-done:
		lokilog.Trace(log, "daemon exec drained without shutdown request", "elapsed", time.Since(started))
		d.mu.Lock()
		d.closed = true
		d.mu.Unlock()
		return
	case <-d.ctx.Done():
		log.Debug("shutdown requested; awaiting exec drain")
	}

	// Phase 2: shutdown requested — bounded grace for flnd.Main to return.
	select {
	case <-done:
		log.Debug("daemon exec drained after shutdown", "elapsed", time.Since(started))
	case <-time.After(8 * time.Second):
		log.Warn("daemon exec goroutine did not drain within 8s after shutdown")
	}

	select {
	case <-d.interceptor.ShutdownChannel():
	case <-time.After(2 * time.Second):
		log.Warn("daemon shutdown channel did not drain within 2s")
	}

	d.mu.Lock()
	d.closed = true
	d.mu.Unlock()
}

func (d *flndDaemon) stop() {
	d.mu.Lock()
	defer d.mu.Unlock()
	if d.closed {
		lokilog.Trace(log, "daemon stop noop (already closed)")
		return
	}
	d.stopping = true
	log.Debug("daemon stop: tearing down client + conn")

	if d.client != nil {
		d.client.close()
	}
	if d.conn != nil {
		d.conn.Close()
	}

	d.cancel()
	d.interceptor.RequestShutdown()
	select {
	case <-d.interceptor.ShutdownChannel():
		lokilog.Trace(log, "daemon stop: interceptor shutdown drained")
	case <-time.After(5 * time.Second):
		log.Warn("daemon stop: interceptor shutdown not drained within 5s")
	}
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
