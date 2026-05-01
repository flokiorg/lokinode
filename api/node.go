package api

import (
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"time"

	"github.com/labstack/echo/v4"
	"github.com/flokiorg/lokinode/daemon"
	"github.com/flokiorg/lokinode/db"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

func handleNodeStart(app App) echo.HandlerFunc {
	return func(c echo.Context) error {
		if !lifecycleLimiter.Allow() {
			log.Warn("node start rate-limited")
			return apiErr(c, http.StatusTooManyRequests, errTooManyAttempts)
		}
		log.Info("node start requested")
		if err := app.RunNode(); err != nil {
			log.Error("node start failed", "err", err)
			return apiErr(c, http.StatusInternalServerError, err)
		}
		return c.NoContent(http.StatusNoContent)
	}
}

func handleNodeStop(app App) echo.HandlerFunc {
	return func(c echo.Context) error {
		if !lifecycleLimiter.Allow() {
			log.Warn("node stop rate-limited")
			return apiErr(c, http.StatusTooManyRequests, errTooManyAttempts)
		}
		log.Info("node stop requested")
		app.StopNode()
		return c.NoContent(http.StatusNoContent)
	}
}

func handleNodeRestart(app App) echo.HandlerFunc {
	return func(c echo.Context) error {
		if !lifecycleLimiter.Allow() {
			log.Warn("node restart rate-limited")
			return apiErr(c, http.StatusTooManyRequests, errTooManyAttempts)
		}
		log.Info("node restart requested")
		if err := app.RestartNode(); err != nil {
			return apiErr(c, http.StatusInternalServerError, err)
		}
		return c.NoContent(http.StatusNoContent)
	}
}

func handleDefaultNodeDir(app App) echo.HandlerFunc {
	return func(c echo.Context) error {
		return c.JSON(http.StatusOK, map[string]string{"dir": app.GetDefaultNodeDir()})
	}
}

func handleCheckDir(app App) echo.HandlerFunc {
	return func(c echo.Context) error {
		dir := filepath.Clean(c.QueryParam("dir"))
		return c.JSON(http.StatusOK, CheckDirResponse{Exists: app.CheckNodeDir(dir)})
	}
}

func handleDirEmpty(app App) echo.HandlerFunc {
	return func(c echo.Context) error {
		dir := c.QueryParam("dir")
		if dir == "" {
			return apiErr(c, http.StatusBadRequest, fmt.Errorf("dir query param required"))
		}
		empty, err := app.IsDirEmpty(dir)
		if err != nil {
			return apiErr(c, http.StatusInternalServerError, err)
		}
		return c.JSON(http.StatusOK, DirEmptyResponse{Empty: empty})
	}
}

func handleVerifyConfig(app App) echo.HandlerFunc {
	return func(c echo.Context) error {
		var req VerifyConfigRequest
		if err := c.Bind(&req); err != nil {
			return apiErr(c, http.StatusBadRequest, err)
		}
		if err := app.VerifyConfig(daemon.UserNodeConfig{
			Dir:        req.Dir,
			Alias:      req.Alias,
			RestCors:   req.RestCors,
			RPCListen:  req.RPCListen,
			RESTListen: req.RESTListen,
			NodePublic: req.NodePublic,
			ExternalIP: req.NodeIP,
		}); err != nil {
			return apiErr(c, http.StatusBadRequest, err)
		}
		return c.NoContent(http.StatusNoContent)
	}
}

func handleGetNodeConfig(app App) echo.HandlerFunc {
	return func(c echo.Context) error {
		dir := filepath.Clean(c.QueryParam("dir"))
		if dir == "" {
			return apiErr(c, http.StatusBadRequest, fmt.Errorf("dir query param required"))
		}
		cfg, err := app.GetNodeConfig(dir)
		if err != nil {
			return apiErr(c, http.StatusInternalServerError, err)
		}
		return c.JSON(http.StatusOK, VerifyConfigRequest{
			PubKey:     cfg.PubKey,
			Dir:        cfg.Dir,
			Alias:      cfg.Alias,
			RestCors:   cfg.RestCors,
			RPCListen:  cfg.RPCListen,
			RESTListen: cfg.RESTListen,
			NodePublic: cfg.NodePublic,
			NodeIP:     cfg.ExternalIP,
		})
	}
}

func handleGetLastNode(app App) echo.HandlerFunc {
	return func(c echo.Context) error {
		gormDB := app.GetDB()
		if gormDB == nil {
			return c.JSON(http.StatusOK, nil)
		}

		// Tier 1: lookup by the most recently used pubkey (most specific).
		var pubKeyCfg db.AppConfig
		if err := gormDB.First(&pubKeyCfg, "key = ?", db.ConfigKeyLastNodePubKey).Error; err == nil && pubKeyCfg.Value != "" {
			var node db.Node
			if err := gormDB.First(&node, "pub_key = ?", pubKeyCfg.Value).Error; err == nil {
				return c.JSON(http.StatusOK, node)
			}
		}

		// Tier 2: lookup by the most recently used directory (covers nodes
		// that have never been started, where pubkey is still unknown).
		var dirCfg db.AppConfig
		if err := gormDB.First(&dirCfg, "key = ?", db.ConfigKeyLastNodeDir).Error; err == nil && dirCfg.Value != "" {
			var node db.Node
			if err := gormDB.First(&node, "dir = ?", dirCfg.Value).Error; err == nil {
				return c.JSON(http.StatusOK, node)
			}
		}

		// Tier 3: fallback to the most recently opened row (e.g. after a DB reset).
		var node db.Node
		if err := gormDB.Order("last_opened desc").First(&node).Error; err != nil {
			return c.JSON(http.StatusOK, nil)
		}
		return c.JSON(http.StatusOK, node)
	}
}

func handleListNodeConfigs(app App) echo.HandlerFunc {
	return func(c echo.Context) error {
		gormDB := app.GetDB()
		if gormDB == nil {
			return c.JSON(http.StatusOK, []db.Node{})
		}

		var nodes []db.Node
		if err := gormDB.Order("last_opened desc").Find(&nodes).Error; err != nil {
			return apiErr(c, http.StatusInternalServerError, err)
		}

		// Sanity check: filter only existing directories and deduplicate by Dir
		// (e.g. if the user reset the node in the same folder, we only want the latest PubKey)
		var existing []db.Node
		seenDirs := make(map[string]bool)
		for _, n := range nodes {
			if seenDirs[n.Dir] {
				continue
			}
			if _, err := os.Stat(n.Dir); err == nil {
				existing = append(existing, n)
				seenDirs[n.Dir] = true
			}
		}

		return c.JSON(http.StatusOK, existing)
	}
}

func handleSaveNodeConfig(app App) echo.HandlerFunc {
	return func(c echo.Context) error {
		var req struct {
			PubKey     string `json:"pubKey"`
			Dir        string `json:"dir"`
			Alias      string `json:"alias"`
			NodePublic bool   `json:"nodePublic"`
			ExternalIP string `json:"externalIP"`
			RestCors   string `json:"restCors"`
			RpcListen  string `json:"rpcListen"`
			RestListen string `json:"restListen"`
		}
		if err := c.Bind(&req); err != nil {
			return apiErr(c, http.StatusBadRequest, err)
		}
		if req.Dir == "" {
			return apiErr(c, http.StatusBadRequest, fmt.Errorf("dir is required"))
		}
		req.Dir = filepath.Clean(req.Dir)

		gormDB := app.GetDB()
		if gormDB == nil {
			return apiErr(c, http.StatusInternalServerError, fmt.Errorf("database not initialized"))
		}

		err := gormDB.Transaction(func(tx *gorm.DB) error {
			// ── Dir-change recovery ───────────────────────────────────────────
			// If this pubkey already exists under a different directory the node
			// was moved. Inherit its stored settings for any field the current
			// request left empty, then delete the stale record so the unique
			// index constraint is not violated by the upcoming Save.
			if req.PubKey != "" {
				var stale db.Node
				if err := tx.Where("pub_key = ? AND dir != ?", req.PubKey, req.Dir).
					First(&stale).Error; err == nil {

					log.Info("node directory change detected — migrating settings",
						"pubkey", req.PubKey[:min(8, len(req.PubKey))],
						"old", stale.Dir, "new", req.Dir)

					if req.Alias == "" {
						req.Alias = stale.Alias
					}
					if !req.NodePublic {
						req.NodePublic = stale.NodePublic
					}
					if req.ExternalIP == "" {
						req.ExternalIP = stale.ExternalIP
					}
					if req.RestCors == "" {
						req.RestCors = stale.RestCors
					}
					if req.RpcListen == "" {
						req.RpcListen = stale.RpcListen
					}
					if req.RestListen == "" {
						req.RestListen = stale.RestListen
					}
					if err := tx.Delete(&stale).Error; err != nil {
						return err
					}
				}
			}

			// ── Upsert by dir (primary key) ───────────────────────────────────
			node := db.Node{
				PubKey:     req.PubKey,
				Dir:        req.Dir,
				Alias:      req.Alias,
				NodePublic: req.NodePublic,
				ExternalIP: req.ExternalIP,
				RestCors:   req.RestCors,
				RpcListen:  req.RpcListen,
				RestListen: req.RestListen,
				LastOpened: time.Now(),
			}
			if err := tx.Save(&node).Error; err != nil {
				return err
			}

			// Always track the most recently active directory (primary key, always known).
			if err := tx.Clauses(clause.OnConflict{UpdateAll: true}).
				Create(&db.AppConfig{
					Key:   db.ConfigKeyLastNodeDir,
					Value: req.Dir,
				}).Error; err != nil {
				return err
			}

			// Only persist the pubkey when it's actually known — writing ""
			// would corrupt the lookup in handleGetLastNode.
			if req.PubKey == "" {
				return nil
			}
			return tx.Clauses(clause.OnConflict{UpdateAll: true}).
				Create(&db.AppConfig{
					Key:   db.ConfigKeyLastNodePubKey,
					Value: req.PubKey,
				}).Error
		})
		if err != nil {
			return apiErr(c, http.StatusInternalServerError, err)
		}

		return c.NoContent(http.StatusNoContent)
	}
}
