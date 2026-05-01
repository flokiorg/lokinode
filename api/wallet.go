package api

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"time"

	"github.com/flokiorg/flnd/lnrpc"
	"github.com/labstack/echo/v4"
	"github.com/flokiorg/lokinode/daemon"
	"github.com/flokiorg/lokinode/lokilog"
)

var log *slog.Logger = lokilog.For("api")

// Sentinel errors returned to callers — generic enough not to leak internals.
var (
	errInvalidPassword = errors.New("invalid password")
	errTooManyAttempts = errors.New("too many attempts, please wait")
)

// handleLock bounces the daemon in-place so the wallet returns to the locked
// state without tearing down the service. Mirrors twallet's Wallet.Restart()
// pattern — single atomic operation, keeps subscribers connected, avoids the
// signal.Intercept recreation race that makes the stop+start dance unreliable.
func handleLock(app App) echo.HandlerFunc {
	return func(c echo.Context) error {
		if !lifecycleLimiter.Allow() {
			log.Warn("lock rate-limited")
			return apiErr(c, http.StatusTooManyRequests, errTooManyAttempts)
		}
		log.Info("wallet lock requested")
		if err := app.RestartNode(); err != nil {
			log.Error("wallet lock failed", "err", err)
			return apiErr(c, http.StatusServiceUnavailable, err)
		}
		return c.NoContent(http.StatusNoContent)
	}
}

func handleUnlock(app App) echo.HandlerFunc {
	return func(c echo.Context) error {
		// M3: rate-limit unlock to prevent brute-force.
		if !unlockLimiter.Allow() {
			return apiErr(c, http.StatusTooManyRequests, errTooManyAttempts)
		}
		svc := app.Service()
		if svc == nil {
			return svcErr(c)
		}
		var req UnlockRequest
		if err := c.Bind(&req); err != nil {
			return apiErr(c, http.StatusBadRequest, err)
		}
		if req.Password == "" {
			return apiErr(c, http.StatusBadRequest, errors.New("password is required"))
		}
		if err := svc.Unlock(req.Password); err != nil {
			log.Warn("unlock failed", "err", err)
			// M1: return a generic message — don't echo the gRPC error.
			return apiErr(c, http.StatusUnauthorized, errInvalidPassword)
		}
		log.Info("wallet unlocked")
		return c.NoContent(http.StatusNoContent)
	}
}

func handleInitWallet(app App) echo.HandlerFunc {
	return func(c echo.Context) error {
		svc := app.Service()
		if svc == nil {
			return svcErr(c)
		}
		var req InitWalletRequest
		if err := c.Bind(&req); err != nil {
			return apiErr(c, http.StatusBadRequest, err)
		}
		if req.Password == "" {
			return apiErr(c, http.StatusBadRequest, errors.New("password is required"))
		}
		if err := svc.InitWallet(req.Password, req.Mnemonic, req.AezeedPass, req.Hex); err != nil {
			return apiErr(c, http.StatusInternalServerError, sanitizeGRPC(err))
		}
		return c.NoContent(http.StatusNoContent)
	}
}

func handleGenSeed(app App) echo.HandlerFunc {
	return func(c echo.Context) error {
		var req SeedRequest
		if err := c.Bind(&req); err != nil {
			return apiErr(c, http.StatusBadRequest, err)
		}

		// Use standalone generation whenever possible. This allows the onboarding
		// wizard to show the seed phrase BEFORE the flnd process is even started,
		// satisfying the requirement that users must confirm saving their seed
		// before the node "powers on".
		words, err := daemon.GenerateStandaloneSeed([]byte(req.AezeedPass))
		if err == nil {
			return c.JSON(http.StatusOK, MnemonicResponse{Mnemonic: words})
		}

		// Fallback to daemon-based generation if standalone fails (e.g. entropy
		// error) and the service happens to be running.
		svc := app.Service()
		if svc != nil {
			words, err = svc.GenSeed(req.AezeedPass)
			if err == nil {
				return c.JSON(http.StatusOK, MnemonicResponse{Mnemonic: words})
			}
			return apiErr(c, http.StatusInternalServerError, err)
		}

		return apiErr(c, http.StatusServiceUnavailable, errors.New("node not running"))
	}
}

func handleRecovery(app App) echo.HandlerFunc {
	return func(c echo.Context) error {
		svc := app.Service()
		if svc == nil {
			return svcErr(c)
		}
		info, err := svc.GetRecoveryInfo()
		if err != nil {
			return apiErr(c, http.StatusInternalServerError, err)
		}
		return c.JSON(http.StatusOK, RecoveryResponse{
			InProgress: info.RecoveryMode,
			Progress:   info.Progress,
		})
	}
}

func handleGetAddress(app App) echo.HandlerFunc {
	return func(c echo.Context) error {
		svc := app.Service()
		if svc == nil {
			return svcErr(c)
		}

		// Try to find the last generated address first to avoid rotation on every GET.
		// This follows the standard behavior where a receiving address is "sticky"
		// until used or explicitly rotated.
		resp, err := svc.ListAddresses()
		if err == nil && resp != nil {
			var lastAddr string
			for _, acc := range resp.AccountWithAddresses {
				for _, addr := range acc.Addresses {
					// We only care about external (receiving) addresses
					if !addr.IsInternal {
						lastAddr = addr.Address
					}
				}
			}
			if lastAddr != "" {
				return c.JSON(http.StatusOK, AddressResponse{Address: lastAddr})
			}
		}

		// Fallback: generate a new one if none exist
		addr, err := svc.NewAddress(lnrpc.AddressType_WITNESS_PUBKEY_HASH)
		if err != nil {
			return apiErr(c, http.StatusInternalServerError, err)
		}
		return c.JSON(http.StatusOK, AddressResponse{Address: addr})
	}
}

func handleNewAddress(app App) echo.HandlerFunc {
	return func(c echo.Context) error {
		svc := app.Service()
		if svc == nil {
			return svcErr(c)
		}
		addr, err := svc.NewAddress(lnrpc.AddressType_WITNESS_PUBKEY_HASH)
		if err != nil {
			return apiErr(c, http.StatusInternalServerError, err)
		}
		return c.JSON(http.StatusOK, AddressResponse{Address: addr})
	}
}

func handleChangePassword(app App) echo.HandlerFunc {
	return func(c echo.Context) error {
		svc := app.Service()
		if svc == nil {
			return svcErr(c)
		}
		var req ChangePasswordRequest
		if err := c.Bind(&req); err != nil {
			return apiErr(c, http.StatusBadRequest, err)
		}

		// Pro UX: if the wallet is currently unlocked (Ready/Syncing), we
		// handle the full stop-restart-update-unlock dance internally.
		lastState := svc.GetLastEvent()
		if lastState != nil && (lastState.State == daemon.StatusReady || lastState.State == daemon.StatusSyncing) {
			log.Info("password change requested on active node; initiating automated stop-update-unlock flow")

			// 1. Force a restart to bring the node to StatusLocked.
			if err := svc.Restart(); err != nil {
				return apiErr(c, http.StatusInternalServerError, err)
			}

			// 2. Wait for it to be locked (timeout 20s).
			ctx, cancel := context.WithTimeout(c.Request().Context(), 20*time.Second)
			defer cancel()
			if err := svc.WaitForStatus(ctx, daemon.StatusLocked); err != nil {
				return apiErr(c, http.StatusInternalServerError, fmt.Errorf("timeout waiting for node to lock: %v", err))
			}
		}

		// 3. Apply the password change (requires StatusLocked).
		if err := svc.ChangePassphrase(req.CurrentPassword, req.NewPassword); err != nil {
			log.Warn("change password failed", "err", err)
			return apiErr(c, http.StatusInternalServerError, sanitizeGRPC(err))
		}

		// 4. Auto-unlock with the new password to return to the previous state.
		if err := svc.Unlock(req.NewPassword); err != nil {
			log.Error("auto-unlock after password change failed", "err", err)
			// Don't return error here, the password IS changed, node just
			// needs manual unlock or investigation.
		}

		log.Info("wallet password changed")
		return c.NoContent(http.StatusNoContent)
	}
}
