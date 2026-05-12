package api

import (
	"encoding/json"
	"fmt"
	"net/http"
	"time"

	"github.com/flokiorg/lokinode/daemon"
	"github.com/labstack/echo/v4"
)

func handleEvents(app App) echo.HandlerFunc {
	return func(c echo.Context) error {
		h := c.Response().Header()
		h.Set("Access-Control-Allow-Origin", "*")
		h.Set("Content-Type", "text/event-stream; charset=utf-8")
		h.Set("Cache-Control", "no-cache")
		h.Set("Connection", "keep-alive")
		h.Set("X-Accel-Buffering", "no")
		h.Set("Transfer-Encoding", "identity")
		c.Response().WriteHeader(http.StatusOK)

		ctx := c.Request().Context()
		heartbeat := time.NewTicker(15 * time.Second)
		defer heartbeat.Stop()

		emit := func(ev *daemon.Update) bool {
			se := stateEventFromUpdate(ev)
			if ev.State == daemon.StatusDown {
				se.AnotherInstance = app.IsAnotherInstanceRunning()
			}
			data, err := json.Marshal(se)
			if err != nil {
				log.Error("failed to marshal state event", "err", err)
				return false
			}
			_, werr := fmt.Fprintf(c.Response(), "data: %s\n\n", data)
			c.Response().Flush()
			return werr == nil
		}

		for {
			// Wait for a live service. Send heartbeats so the connection stays
			// open while the daemon is stopped between a Stop and a Start.
			svc := app.Service()
			for svc == nil {
				select {
				case <-ctx.Done():
					return nil
				case <-heartbeat.C:
					if _, err := fmt.Fprintf(c.Response(), ": heartbeat\n\n"); err != nil {
						return nil
					}
					c.Response().Flush()
				case <-time.After(300 * time.Millisecond):
					svc = app.Service()
				}
			}

			// Subscribe and stream until this service stops.
			sub := svc.Subscribe()
		streaming:
			for {
				select {
				case <-ctx.Done():
					svc.Unsubscribe(sub)
					return nil
				case <-heartbeat.C:
					if _, err := fmt.Fprintf(c.Response(), ": heartbeat\n\n"); err != nil {
						svc.Unsubscribe(sub)
						return nil
					}
					c.Response().Flush()
				case ev, ok := <-sub:
					if !ok {
						// unsubscribeAll closed the channel — service stopped.
						// Loop back to wait for the next service.
						break streaming
					}
					if !emit(ev) {
						svc.Unsubscribe(sub)
						return nil
					}
				}
			}
		}
	}
}

func stateEventFromUpdate(u *daemon.Update) StateEvent {
	se := StateEvent{
		State:        string(u.State),
		NodeRunning:  true,
		PortConflict: u.PortConflict,
		BlockHeight:  u.BlockHeight,
		BlockHash:    u.BlockHash,
		SyncedHeight: u.SyncedHeight,
	}
	if u.Err != nil {
		se.Error = u.Err.Error()
	}
	if u.Transaction != nil {
		item := txToItem(u.Transaction)
		se.Transaction = &item
	}
	return se
}
