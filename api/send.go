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
		log.Info().Int64("amount_loki", req.Amount).Int64("fee_rate", req.LokiPerVbyte).Msg("send requested")
		txid, err := svc.SendCoins(req.Address, req.Amount, req.LokiPerVbyte)
		if err != nil {
			log.Error().Err(sanitizeGRPC(err)).Msg("send failed")
			// Return the gRPC error message — it is meaningful to the user
			// (e.g. "insufficient funds", "invalid address") but strip any
			// internal path or stack info via the gRPC status message only.
			return apiErr(c, http.StatusBadRequest, sanitizeGRPC(err))
		}
		log.Info().Str("txid", txid).Msg("send succeeded")
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
		log.Trace().Int64("amount_loki", req.Amount).Msg("fee estimate requested")
		lokiPerVbyte, totalFee, err := svc.EstimateFee(req.Address, req.Amount)
		if err != nil {
			log.Error().Err(err).Msg("fee estimate failed")
			return apiErr(c, http.StatusInternalServerError, err)
		}
		log.Trace().Int64("loki_per_vbyte", lokiPerVbyte).Int64("total_fee", totalFee).Msg("fee estimate result")
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

		log.Info().Int64("amount_loki", req.Amount).Uint64("fee_rate", req.LokiPerVbyte).Msg("fund PSBT requested")
		addrToAmount := map[string]int64{req.Address: req.Amount}
		// Use 90-second lock expiration for the review phase.
		funded, err := svc.FundPsbt(addrToAmount, req.LokiPerVbyte, 90)
		if err != nil {
			log.Error().Err(sanitizeGRPC(err)).Msg("fund PSBT failed")
			return apiErr(c, http.StatusBadRequest, sanitizeGRPC(err))
		}

		var buf bytes.Buffer
		if funded.Packet != nil {
			_ = funded.Packet.Serialize(&buf)
		}

		fee, _ := funded.Packet.GetTxFee()
		log.Info().Int64("total_fee", int64(fee)).Int("locks", len(funded.Locks)).Msg("PSBT funded")
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
		log.Trace().Msg("finalize PSBT requested")
		tx, err := svc.FinalizePsbt(packet)
		if err != nil {
			log.Error().Err(sanitizeGRPC(err)).Msg("finalize PSBT failed")
			return apiErr(c, http.StatusBadRequest, sanitizeGRPC(err))
		}
		log.Trace().Msg("PSBT finalized")
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
		txid := tx.MsgTx().TxHash().String()
		log.Info().Str("txid", txid).Msg("publish tx requested")
		if err := svc.PublishTransaction(tx); err != nil {
			log.Error().Err(sanitizeGRPC(err)).Str("txid", txid).Msg("publish tx failed")
			return apiErr(c, http.StatusBadRequest, sanitizeGRPC(err))
		}
		log.Info().Str("txid", txid).Msg("tx published")
		return c.JSON(http.StatusOK, SendResponse{TxID: txid})
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
