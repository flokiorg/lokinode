package db

import (
	"os"
	"path/filepath"

	"github.com/adrg/xdg"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

// Init opens (or creates) the Lokinode SQLite database and runs all pending
// schema migrations. The database is stored in the OS-standard data directory.
func Init() (*gorm.DB, error) {
	workDir := filepath.Join(xdg.DataHome, "lokinode")
	if err := os.MkdirAll(workDir, 0700); err != nil {
		return nil, err
	}

	dsn := filepath.Join(workDir, "lokinode.db") +
		"?_busy_timeout=5000&_journal_mode=WAL&_synchronous=NORMAL"

	db, err := gorm.Open(sqlite.Open(dsn), &gorm.Config{
		Logger: logger.Default.LogMode(logger.Silent),
	})
	if err != nil {
		return nil, err
	}

	if err := migrateSchema(db); err != nil {
		return nil, err
	}

	return db, nil
}

// migrateSchema applies all schema migrations in order.
// Each migration is idempotent — safe to run on every startup.
func migrateSchema(db *gorm.DB) error {
	// ── Migration 1: change primary key from pub_key to dir ──────────────────
	// Earlier versions used pub_key as the PK. We need dir as PK so that a
	// node can be stored before its first start (when pubkey is unknown).
	if db.Migrator().HasTable(&Node{}) {
		var dirIsPK int64
		db.Raw("SELECT count(*) FROM pragma_table_info('nodes') WHERE name = 'dir' AND pk = 1").
			Scan(&dirIsPK)
		if dirIsPK == 0 {
			if err := db.Transaction(func(tx *gorm.DB) error {
				tx.Exec("DROP INDEX IF EXISTS idx_nodes_pub_key")
				if err := tx.Exec("ALTER TABLE nodes RENAME TO nodes_old").Error; err != nil {
					return err
				}
				if err := tx.AutoMigrate(&Node{}); err != nil {
					return err
				}
				// Copy data; deduplicate by dir (keep the most recently opened row).
				return tx.Exec(`
					INSERT INTO nodes
						(dir, pub_key, alias, node_public, external_ip,
						 rest_cors, rpc_listen, rest_listen, last_opened, created_at, updated_at)
					SELECT
						dir, pub_key, alias, node_public, external_ip,
						rest_cors, rpc_listen, rest_listen, MAX(last_opened), created_at, updated_at
					FROM nodes_old
					GROUP BY dir
				`).Error
			}); err != nil {
				return err
			}
			// Drop the now-unused backup table outside the transaction.
			db.Exec("DROP TABLE IF EXISTS nodes_old")
		}
	}

	// ── AutoMigrate: add new columns, create indexes declared in tags ─────────
	if err := db.AutoMigrate(&Node{}, &AppConfig{}); err != nil {
		return err
	}

	// ── Migration 2: partial unique index on pub_key (non-empty values only) ──
	// GORM tags cannot express a partial index, so we create it manually.
	// Multiple nodes may have an empty pub_key (not started yet) without
	// conflicting; once a pub_key is set it must be globally unique.
	db.Exec(`
		CREATE UNIQUE INDEX IF NOT EXISTS idx_nodes_pub_key
		ON nodes(pub_key)
		WHERE pub_key != ''
	`)

	return nil
}
