package api

import (
	"bufio"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/labstack/echo/v4"
)

func handleLogs(app App) echo.HandlerFunc {
	return func(c echo.Context) error {
		logDir := app.GetLogDir()
		logPath, err := findLogFile(logDir)
		if err != nil {
			return c.JSON(http.StatusOK, map[string][]string{"lines": {}})
		}

		linesStr := c.QueryParam("lines")
		maxLines := 200
		if linesStr != "" {
			if v, err := strconv.Atoi(linesStr); err == nil && v > 0 && v <= 2000 {
				maxLines = v
			}
		}

		f, err := os.Open(logPath)
		if err != nil {
			return c.JSON(http.StatusOK, map[string][]string{"lines": {}})
		}
		defer f.Close()

		lines := readBackfill(f, maxLines)
		return c.JSON(http.StatusOK, map[string][]string{"lines": lines})
	}
}

// handleLogsStream streams log lines as Server-Sent Events.
// It sends the last 100 existing lines immediately as backfill, then tails
// the file at 200 ms intervals. A heartbeat comment is emitted every 15 s
// to keep the connection alive through any intermediate proxies.
func handleLogsStream(app App) echo.HandlerFunc {
	return func(c echo.Context) error {
		h := c.Response().Header()
		h.Set("Content-Type", "text/event-stream; charset=utf-8")
		// SSE requires Cache-Control: no-cache (not no-store).
		// The global securityHeaders middleware sets no-store; override it here.
		h.Set("Cache-Control", "no-cache")
		h.Set("Connection", "keep-alive")
		// Prevent proxy / WebView buffering that would delay events.
		h.Set("X-Accel-Buffering", "no")
		// Some WebView2 / WKWebView builds buffer chunked responses;
		// identity encoding keeps frames visible as soon as they are flushed.
		h.Set("Transfer-Encoding", "identity")
		// Allow the Wails WebView (origin: wails://wails) to connect directly
		// to the loopback HTTP server without CORS rejection.  This is safe
		// because the server is bound to 127.0.0.1 and requires a token.
		h.Set("Access-Control-Allow-Origin", "*")
		c.Response().WriteHeader(http.StatusOK)

		ctx := c.Request().Context()
		w := c.Response()
		logDir := app.GetLogDir()

		emit := func(line string) bool {
			safe := strings.NewReplacer("\n", " ", "\r", " ").Replace(line)
			if _, werr := fmt.Fprintf(w, "data: %s\n\n", safe); werr != nil {
				return false
			}
			w.Flush()
			return true
		}

		var (
			f       *os.File
			tailBuf *bufio.Reader
			partial string
		)

		defer func() {
			if f != nil {
				f.Close()
			}
		}()

		pollTick := time.NewTicker(250 * time.Millisecond)
		heartTick := time.NewTicker(15 * time.Second)
		defer pollTick.Stop()
		defer heartTick.Stop()

		for {
			select {
			case <-ctx.Done():
				return nil

			case <-heartTick.C:
				if _, werr := fmt.Fprintf(w, ": heartbeat\n\n"); werr != nil {
					return nil
				}
				w.Flush()

			case <-pollTick.C:
				if f == nil {
						logPath, err := findLogFile(logDir)
					if err != nil {
						continue
					}
					f, err = os.Open(logPath)
					if err != nil {
						continue
					}

					if _, werr := fmt.Fprintf(w, "event: filename\ndata: %s\n\n", filepath.Base(logPath)); werr == nil {
						w.Flush()
					}

					lines := readBackfill(f, 100)
					for _, line := range lines {
						if !emit(line) {
							return nil
						}
					}

					if _, err := f.Seek(0, io.SeekEnd); err != nil {
						f.Close()
						f = nil
						continue
					}
					tailBuf = bufio.NewReaderSize(f, 64*1024)
				}

				for {
					chunk, readErr := tailBuf.ReadString('\n')
					partial += chunk
					if readErr != nil {
						break
					}
					line := strings.TrimRight(partial, "\r\n")
					partial = ""
					if line != "" && !emit(line) {
						return nil
					}
				}
			}
		}
	}
}

func findLogFile(logDir string) (string, error) {
	candidates := []string{"flnd.log", "flokicoin.log"}
	for _, name := range candidates {
		path := filepath.Join(logDir, name)
		if info, err := os.Stat(path); err == nil && !info.IsDir() {
			return path, nil
		}
	}
	return "", os.ErrNotExist
}

func readBackfill(f *os.File, maxLines int) []string {
	const searchSize = 64 * 1024
	stat, err := f.Stat()
	if err != nil || stat.Size() == 0 {
		return nil
	}

	start := stat.Size() - searchSize
	if start < 0 {
		start = 0
	}

	if _, err := f.Seek(start, io.SeekStart); err != nil {
		return nil
	}

	data, err := io.ReadAll(f)
	if err != nil {
		return nil
	}

	lines := strings.Split(string(data), "\n")
	if len(lines) > 0 && lines[len(lines)-1] == "" {
		lines = lines[:len(lines)-1]
	}

	if len(lines) > maxLines {
		return lines[len(lines)-maxLines:]
	}
	return lines
}
