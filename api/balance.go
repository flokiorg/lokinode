package api

import (
	"net/http"

	"github.com/labstack/echo/v4"
)

func handleBalance(app App) echo.HandlerFunc {
	return func(c echo.Context) error {
		svc := app.Service()
		if svc == nil {
			return svcErr(c)
		}

		bal, err := svc.Balance()
		if err != nil {
			// Wallet not yet ready (locked, syncing, etc.) — return zeros so the
			// frontend keeps polling without showing an error toast.
			return c.JSON(http.StatusOK, BalanceResponse{})
		}

		return c.JSON(http.StatusOK, BalanceResponse{
			Ready:       true,
			Confirmed:   bal.ConfirmedBalance,
			Unconfirmed: bal.UnconfirmedBalance,
			Locked:      bal.LockedBalance,
			Total:       bal.TotalBalance,
		})
	}
}
