package api

import (
	"bytes"
	"encoding/hex"
	"errors"
	"net/http"

	"github.com/flokiorg/go-flokicoin/chainutil"
	"github.com/flokiorg/go-flokicoin/chainutil/psbt"
	"github.com/labstack/echo/v4"
	lokiwails "github.com/flokiorg/lokinode/wails"
)

func handleSend(app App) echo.HandlerFunc {
	return func(c echo.Context) error {
		svc := app.Service()
		if svc == nil {
			return svcErr(c)
		}
		var req SendRequest
		if err := c.Bind(&req); err != nil {
			return apiErr(c, http.StatusBadRequest, err)
		}
		if req.Address == "" || req.Amount <= 0 {
			return apiErr(c, http.StatusBadRequest, errors.New("address and positive amount are required"))
		}
		txid, err := svc.SendCoins(req.Address, req.Amount, req.SatPerVbyte)
		if err != nil {
			// Return the gRPC error message — it is meaningful to the user
			// (e.g. "insufficient funds", "invalid address") but strip any
			// internal path or stack info via the gRPC status message only.
			return apiErr(c, http.StatusBadRequest, sanitizeGRPC(err))
		}
		return c.JSON(http.StatusOK, SendResponse{TxID: txid})
	}
}

func handleEstimateFee(app App) echo.HandlerFunc {
	return func(c echo.Context) error {
		svc := app.Service()
		if svc == nil {
			return svcErr(c)
		}
		var req EstimateFeeRequest
		if err := c.Bind(&req); err != nil {
			return apiErr(c, http.StatusBadRequest, err)
		}
		satPerVbyte, totalFee, err := svc.EstimateFee(req.Address, req.Amount)
		if err != nil {
			return apiErr(c, http.StatusInternalServerError, err)
		}
		return c.JSON(http.StatusOK, EstimateFeeResponse{
			SatPerVbyte: satPerVbyte,
			TotalFee:    totalFee,
		})
	}
}

func handleRecommendedFees(app App) echo.HandlerFunc {
	return func(c echo.Context) error {
		fastest, halfHour, economy, err := lokiwails.GetRecommendedFees(app.ExplorerHost())
		if err != nil {
			return apiErr(c, http.StatusInternalServerError, err)
		}
		return c.JSON(http.StatusOK, FeesResponse{
			FastestFee:  fastest,
			HalfHourFee: halfHour,
			EconomyFee:  economy,
		})
	}
}

func handleFundPsbt(app App) echo.HandlerFunc {
	return func(c echo.Context) error {
		svc := app.Service()
		if svc == nil {
			return svcErr(c)
		}
		var req FundPsbtRequest
		if err := c.Bind(&req); err != nil {
			return apiErr(c, http.StatusBadRequest, err)
		}
		if req.Address == "" || req.Amount <= 0 {
			return apiErr(c, http.StatusBadRequest, errors.New("address and positive amount are required"))
		}

		addrToAmount := map[string]int64{req.Address: req.Amount}
		// Use 10-minute lock expiration for the review phase
		funded, err := svc.FundPsbt(addrToAmount, req.SatPerVbyte, 600)
		if err != nil {
			return apiErr(c, http.StatusBadRequest, sanitizeGRPC(err))
		}

		var buf bytes.Buffer
		if funded.Packet != nil {
			_ = funded.Packet.Serialize(&buf)
		}

		fee, _ := funded.Packet.GetTxFee()
		return c.JSON(http.StatusOK, FundPsbtResponse{
			Psbt:     hex.EncodeToString(buf.Bytes()),
			TotalFee: int64(fee),
		})
	}
}

func handleFinalizePsbt(app App) echo.HandlerFunc {
	return func(c echo.Context) error {
		svc := app.Service()
		if svc == nil {
			return svcErr(c)
		}
		var req FinalizePsbtRequest
		if err := c.Bind(&req); err != nil {
			return apiErr(c, http.StatusBadRequest, err)
		}
		psbtBytes, err := hex.DecodeString(req.Psbt)
		if err != nil {
			return apiErr(c, http.StatusBadRequest, err)
		}
		packet, err := psbt.NewFromRawBytes(bytes.NewReader(psbtBytes), false)
		if err != nil {
			return apiErr(c, http.StatusBadRequest, err)
		}
		tx, err := svc.FinalizePsbt(packet)
		if err != nil {
			return apiErr(c, http.StatusBadRequest, sanitizeGRPC(err))
		}
		txBytes, _ := tx.MsgTx().Bytes()
		return c.JSON(http.StatusOK, FinalizePsbtResponse{TxHex: hex.EncodeToString(txBytes)})
	}
}

func handlePublishTx(app App) echo.HandlerFunc {
	return func(c echo.Context) error {
		svc := app.Service()
		if svc == nil {
			return svcErr(c)
		}
		var req PublishTxRequest
		if err := c.Bind(&req); err != nil {
			return apiErr(c, http.StatusBadRequest, err)
		}
		txBytes, err := hex.DecodeString(req.TxHex)
		if err != nil {
			return apiErr(c, http.StatusBadRequest, err)
		}
		tx, err := chainutil.NewTxFromBytes(txBytes)
		if err != nil {
			return apiErr(c, http.StatusBadRequest, err)
		}
		if err := svc.PublishTransaction(tx); err != nil {
			return apiErr(c, http.StatusBadRequest, sanitizeGRPC(err))
		}
		return c.JSON(http.StatusOK, SendResponse{TxID: tx.MsgTx().TxHash().String()})
	}
}
