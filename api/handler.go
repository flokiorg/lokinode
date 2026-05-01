package api

import (
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/flokiorg/flnd"
	"github.com/labstack/echo/v4"
	"github.com/labstack/echo/v4/middleware"
	"github.com/flokiorg/lokinode/daemon"
	"gorm.io/gorm"
)

// App is the interface that the api handlers require from the Wails app.
// *wails.App satisfies this interface.
type App interface {
	Service() *daemon.Service
	Config() *flnd.Config
	GetVersion() string
	ExplorerHost() string
	RunNode() error
	StopNode()
	RestartNode() error
	VerifyConfig(ucfg daemon.UserNodeConfig) error
	GetNodeConfig(dir string) (daemon.UserNodeConfig, error)
	GetDefaultNodeDir() string
	GetLogDir() string
	GetAPIToken() string
	GetDB() *gorm.DB
	IsAnotherInstanceRunning() bool
	CheckNodeDir(dir string) bool
	IsDirEmpty(dir string) (bool, error)
}

// maxRequestBodyBytes caps incoming request bodies at 64 KB.
// No legitimate API call in this app requires more.
const maxRequestBodyBytes = 64 * 1024

// NewHandler returns an http.Handler that serves all /api/* routes.
// Non-matching paths return 404, which tells Wails to fall through to the
// embedded static assets.
func NewHandler(app App) http.Handler {
	e := echo.New()
	e.HideBanner = true
	e.HidePort = true

	// M2: custom recover that never leaks Go stack traces to the client.
	e.Use(middleware.RecoverWithConfig(middleware.RecoverConfig{
		DisablePrintStack: true,
		LogErrorFunc: func(c echo.Context, err error, stack []byte) error {
			// Log to stderr without sending the stack to the client.
			c.Logger().Errorf("panic recovered: %v", err)
			return nil
		},
	}))

	// L1: security headers on every response.
	e.Use(securityHeaders())
	e.Use(referrerPolicy())

	// L2: token authentication.
	e.Use(tokenAuth(app))

	// H1: reject request bodies larger than 64 KB.
	e.Use(middleware.BodyLimit("64K"))

	api := e.Group("/api")
	registerRoutes(api, app)

	// All other paths → 404 so Wails serves static assets.
	e.Any("/*", func(c echo.Context) error {
		return echo.ErrNotFound
	})

	return e
}

// securityHeaders adds conservative security-related response headers.
func securityHeaders() echo.MiddlewareFunc {
	return func(next echo.HandlerFunc) echo.HandlerFunc {
		return func(c echo.Context) error {
			h := c.Response().Header()
			h.Set("X-Content-Type-Options", "nosniff")
			h.Set("X-Frame-Options", "DENY")
			h.Set("Cache-Control", "no-store")
			h.Set("Content-Security-Policy", "default-src 'none'")
			return next(c)
		}
	}
}

// referrerPolicy suppresses the Referer header on outbound requests so the
// ?token= query param never leaks to external origins.
func referrerPolicy() echo.MiddlewareFunc {
	return func(next echo.HandlerFunc) echo.HandlerFunc {
		return func(c echo.Context) error {
			c.Response().Header().Set("Referrer-Policy", "no-referrer")
			return next(c)
		}
	}
}

// tokenAuth ensures the request has the correct X-API-Token.
func tokenAuth(app App) echo.MiddlewareFunc {
	return func(next echo.HandlerFunc) echo.HandlerFunc {
		return func(c echo.Context) error {
			// In Wails, the frontend is trusted to have the token.
			// Any external process without the token will be blocked.
			validToken := app.GetAPIToken()
			token := c.Request().Header.Get("X-API-Token")
			if token == "" {
				// Fallback to standard Authorization header
				auth := c.Request().Header.Get("Authorization")
				if strings.HasPrefix(auth, "Bearer ") {
					token = strings.TrimPrefix(auth, "Bearer ")
				}
			}

			if token == "" {
				token = c.QueryParam("token")
			}

			if token != validToken {
				c.Logger().Warn("unauthorized request rejected")
				return echo.NewHTTPError(http.StatusUnauthorized, "unauthorized")
			}
			return next(c)
		}
	}
}

// unlockLimiter implements a simple token-bucket rate limiter for the
// unlock endpoint: max 5 attempts per 30-second window per app instance.
// Since this runs as a desktop app with a single WebView, one global bucket
// is sufficient.
var unlockLimiter = &tokenBucket{
	capacity: 5,
	tokens:   5,
	refillAt: time.Now().Add(30 * time.Second),
	refillBy: 30 * time.Second,
}

// lifecycleLimiter caps lock/start/stop requests at 5 per 10s. Each of these
// triggers an flnd boot/shutdown that can contend for the wallet DB file
// lock, the signal.Intercept singleton, and RPC/REST ports. Spamming them
// thrashes flnd and can wedge the service; rate-limiting them is a
// correctness measure, not just abuse prevention.
var lifecycleLimiter = &tokenBucket{
	capacity: 5,
	tokens:   5,
	refillAt: time.Now().Add(10 * time.Second),
	refillBy: 10 * time.Second,
}

type tokenBucket struct {
	mu       sync.Mutex
	capacity int
	tokens   int
	refillAt time.Time
	refillBy time.Duration
}

func (tb *tokenBucket) Allow() bool {
	tb.mu.Lock()
	defer tb.mu.Unlock()
	if time.Now().After(tb.refillAt) {
		tb.tokens = tb.capacity
		tb.refillAt = time.Now().Add(tb.refillBy)
	}
	if tb.tokens <= 0 {
		return false
	}
	tb.tokens--
	return true
}
