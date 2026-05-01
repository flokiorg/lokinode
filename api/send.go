package api

import (
	"bytes"
	"encoding/hex"
	"errors"
	"net/http"

	"github.com/flokiorg/flnd/lnrpc"
	"github.com/flokiorg/go-flokicoin/chainutil"
	"github.com/flokiorg/go-flokicoin/chainutil/psbt"
	"github.com/flokiorg/lokinode/daemon"
	lokiwails "github.com/flokiorg/lokinode/wails"
	"github.com/labstack/echo/v4"
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
		txid, err := svc.SendCoins(req.Address, req.Amount, req.LokiPerVbyte)
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
		lokiPerVbyte, totalFee, err := svc.EstimateFee(req.Address, req.Amount)
		if err != nil {
			return apiErr(c, http.StatusInternalServerError, err)
		}
		return c.JSON(http.StatusOK, EstimateFeeResponse{
			LokiPerVbyte: lokiPerVbyte,
			TotalFee:    totalFee,
		})
	}
}

func handleMaxSendable(app App) echo.HandlerFunc {
	return func(c echo.Context) error {
		svc := app.Service()
		if svc == nil {
			return svcErr(c)
		}
		var req MaxSendableRequest
		if err := c.Bind(&req); err != nil {
			return apiErr(c, http.StatusBadRequest, err)
		}
		amount, fee, err := svc.MaxSendable(req.Address, req.LokiPerVbyte)
		if err != nil {
			return apiErr(c, http.StatusInternalServerError, err)
		}
		return c.JSON(http.StatusOK, MaxSendableResponse{
			Amount:   amount,
			TotalFee: fee,
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
		funded, err := svc.FundPsbt(addrToAmount, req.LokiPerVbyte, 600)
		if err != nil {
			return apiErr(c, http.StatusBadRequest, sanitizeGRPC(err))
		}

		var buf bytes.Buffer
		if funded.Packet != nil {
			_ = funded.Packet.Serialize(&buf)
		}

		fee, _ := funded.Packet.GetTxFee()
		var locks []OutputLock
		for _, l := range funded.Locks {
			locks = append(locks, OutputLock{
				ID:          hex.EncodeToString(l.ID),
				TxidBytes:   hex.EncodeToString(l.Outpoint.TxidBytes),
				OutputIndex: l.Outpoint.OutputIndex,
			})
		}

		return c.JSON(http.StatusOK, FundPsbtResponse{
			Psbt:     hex.EncodeToString(buf.Bytes()),
			TotalFee: int64(fee),
			Locks:    locks,
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

func handleReleasePsbt(app App) echo.HandlerFunc {
	return func(c echo.Context) error {
		svc := app.Service()
		if svc == nil {
			return svcErr(c)
		}
		var req ReleasePsbtRequest
		if err := c.Bind(&req); err != nil {
			return apiErr(c, http.StatusBadRequest, err)
		}

		var locks []*daemon.OutputLock
		for _, l := range req.Locks {
			idBytes, _ := hex.DecodeString(l.ID)
			txidBytes, _ := hex.DecodeString(l.TxidBytes)
			locks = append(locks, &daemon.OutputLock{
				ID: idBytes,
				Outpoint: &lnrpc.OutPoint{
					TxidBytes:   txidBytes,
					OutputIndex: l.OutputIndex,
				},
			})
		}

		if err := svc.ReleaseOutputs(locks); err != nil {
			return apiErr(c, http.StatusInternalServerError, err)
		}
		return c.JSON(http.StatusOK, map[string]bool{"success": true})
	}
}
