package api

import (
	"net/http"
	"sort"
	"strconv"

	"github.com/labstack/echo/v4"
)

func handleTransactions(app App) echo.HandlerFunc {
	return func(c echo.Context) error {
		svc := app.Service()
		if svc == nil {
			return svcErr(c)
		}

		limitStr := c.QueryParam("limit")
		offsetStr := c.QueryParam("offset")

		const maxLimit = 500
		limit := 50
		offset := 0
		if limitStr != "" {
			if v, err := strconv.Atoi(limitStr); err == nil && v > 0 {
				if v > maxLimit {
					v = maxLimit
				}
				limit = v
			}
		}
		if offsetStr != "" {
			if v, err := strconv.Atoi(offsetStr); err == nil && v >= 0 {
				offset = v
			}
		}

		txs, err := svc.GetTransactions(0, -1)
		if err != nil {
			// Wallet not yet ready — return empty list so the UI keeps polling
			// without triggering an error toast.
			return c.JSON(http.StatusOK, TransactionsResponse{Total: 0, Transactions: []TransactionItem{}})
		}

		// Sort: unconfirmed first, then by timestamp descending
		sort.Slice(txs, func(i, j int) bool {
			if txs[i].NumConfirmations == 0 && txs[j].NumConfirmations > 0 {
				return true
			}
			if txs[j].NumConfirmations == 0 && txs[i].NumConfirmations > 0 {
				return false
			}
			return txs[i].TimeStamp > txs[j].TimeStamp
		})

		total := len(txs)
		if offset >= total {
			return c.JSON(http.StatusOK, TransactionsResponse{
				Total:        total,
				Transactions: []TransactionItem{},
			})
		}
		end := offset + limit
		if end > total {
			end = total
		}
		page := txs[offset:end]

		items := make([]TransactionItem, 0, len(page))
		for _, tx := range page {
			addrs := make([]string, 0, len(tx.DestAddresses))
			addrs = append(addrs, tx.DestAddresses...)
			items = append(items, TransactionItem{
				TxHash:        tx.TxHash,
				Amount:        tx.Amount,
				Confirmations: tx.NumConfirmations,
				BlockHeight:   tx.BlockHeight,
				Timestamp:     tx.TimeStamp,
				Addresses:     addrs,
				Label:         tx.Label,
				Fee:           tx.TotalFees,
			})
		}

		return c.JSON(http.StatusOK, TransactionsResponse{
			Total:        total,
			Transactions: items,
		})
	}
}
