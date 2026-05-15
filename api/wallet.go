package api

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"time"

	"github.com/flokiorg/flnd/lnrpc"
	"github.com/labstack/echo/v4"
	"github.com/flokiorg/lokinode/daemon"
	"github.com/flokiorg/lokinode/db"
	"github.com/flokiorg/lokinode/lokilog"
	"github.com/rs/zerolog"
	"gorm.io/gorm"
)

var log zerolog.Logger = lokilog.For("api")

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
			log.Warn().Msg("lock rate-limited")
			return apiErr(c, http.StatusTooManyRequests, errTooManyAttempts)
		}
		log.Info().Msg("wallet lock requested")
		if err := app.RestartNode(); err != nil {
			log.Error().Err(err).Msg("wallet lock failed")
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
			log.Warn().Err(err).Msg("unlock failed")
			// M1: return a generic message — don't echo the gRPC error.
			return apiErr(c, http.StatusUnauthorized, errInvalidPassword)
		}
		log.Info().Msg("wallet unlocked")
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
		restore := req.Mnemonic != "" || req.Hex != ""
		log.Info().Bool("restore", restore).Msg("wallet init requested")
		if err := svc.InitWallet(req.Password, req.Mnemonic, req.AezeedPass, req.Hex); err != nil {
			log.Error().Err(sanitizeGRPC(err)).Msg("wallet init failed")
			return apiErr(c, http.StatusInternalServerError, sanitizeGRPC(err))
		}
		log.Info().Bool("restore", restore).Msg("wallet initialized")
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
		log.Info().Msg("seed generation requested")
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

// storedAddrTypeKey reads the raw preference value from DB ("segwit" or "taproot").
// Defaults to "segwit" when not set.
func storedAddrTypeKey(database *gorm.DB) string {
	var cfg db.AppConfig
	if err := database.First(&cfg, "key = ?", db.ConfigKeyPreferredAddressType).Error; err != nil {
		return "segwit"
	}
	if cfg.Value == "taproot" {
		return "taproot"
	}
	return "segwit"
}

// unusedAddrType maps a preference key to the FLND UNUSED_* type so that
// GET /wallet/address always returns the last unused address without consuming
// a fresh derivation index.
func unusedAddrType(key string) lnrpc.AddressType {
	if key == "taproot" {
		return lnrpc.AddressType_UNUSED_TAPROOT_PUBKEY
	}
	return lnrpc.AddressType_UNUSED_WITNESS_PUBKEY_HASH
}

// newAddrType maps a preference key to the plain FLND type used when the user
// explicitly requests a brand-new address.
func newAddrType(key string) lnrpc.AddressType {
	if key == "taproot" {
		return lnrpc.AddressType_TAPROOT_PUBKEY
	}
	return lnrpc.AddressType_WITNESS_PUBKEY_HASH
}

func handleGetAddressPreference(app App) echo.HandlerFunc {
	return func(c echo.Context) error {
		addrType := storedAddrTypeKey(app.GetDB())
		return c.JSON(http.StatusOK, AddressPreferenceResponse{AddressType: addrType})
	}
}

// handleSetAddressPreference saves the preference and returns the last unused
// address for the new type in a single round-trip so the frontend never has to
// fire a second request after switching types.
func handleSetAddressPreference(app App) echo.HandlerFunc {
	return func(c echo.Context) error {
		svc := app.Service()
		if svc == nil {
			return svcErr(c)
		}
		var req AddressPreferenceRequest
		if err := c.Bind(&req); err != nil {
			return apiErr(c, http.StatusBadRequest, err)
		}
		if req.AddressType != "segwit" && req.AddressType != "taproot" {
			return apiErr(c, http.StatusBadRequest, errors.New("addressType must be 'segwit' or 'taproot'"))
		}
		cfg := db.AppConfig{Key: db.ConfigKeyPreferredAddressType, Value: req.AddressType}
		if err := app.GetDB().Save(&cfg).Error; err != nil {
			return apiErr(c, http.StatusInternalServerError, err)
		}
		log.Info().Str("address_type", req.AddressType).Msg("address type preference updated")
		addr, err := svc.NewAddress(unusedAddrType(req.AddressType))
		if err != nil {
			return apiErr(c, http.StatusInternalServerError, err)
		}
		return c.JSON(http.StatusOK, AddressPreferenceResponse{
			AddressType: req.AddressType,
			Address:     addr,
		})
	}
}

// handleGetAddress returns the last unused address for the preferred type.
// FLND's LastUnusedAddress advances automatically once an address is funded,
// so this is always the right address to show — no DB tracking required.
func handleGetAddress(app App) echo.HandlerFunc {
	return func(c echo.Context) error {
		svc := app.Service()
		if svc == nil {
			return svcErr(c)
		}
		key := storedAddrTypeKey(app.GetDB())
		addr, err := svc.NewAddress(unusedAddrType(key))
		if err != nil {
			return apiErr(c, http.StatusInternalServerError, err)
		}
		return c.JSON(http.StatusOK, AddressResponse{Address: addr})
	}
}

// handleNewAddress explicitly advances the derivation index and returns a
// fresh address of the preferred type (explicit user "rotate" action).
func handleNewAddress(app App) echo.HandlerFunc {
	return func(c echo.Context) error {
		svc := app.Service()
		if svc == nil {
			return svcErr(c)
		}
		key := storedAddrTypeKey(app.GetDB())
		addr, err := svc.NewAddress(newAddrType(key))
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
			log.Info().Msg("password change requested on active node; initiating automated stop-update-unlock flow")

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
			log.Warn().Err(err).Msg("change password failed")
			return apiErr(c, http.StatusInternalServerError, sanitizeGRPC(err))
		}

		// 4. Auto-unlock with the new password to return to the previous state.
		if err := svc.Unlock(req.NewPassword); err != nil {
			log.Error().Err(err).Msg("auto-unlock after password change failed")
			// Don't return error here, the password IS changed, node just
			// needs manual unlock or investigation.
		}

		log.Info().Msg("wallet password changed")
		return c.NoContent(http.StatusNoContent)
	}
}
