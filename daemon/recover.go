package daemon

import (
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
)

// isEOFError returns true when err is or wraps an EOF / unexpected-EOF error,
// or contains the string "EOF" — the signature of a corrupted neutrino header.
func isEOFError(err error) bool {
	if err == nil {
		return false
	}
	if errors.Is(err, io.EOF) || errors.Is(err, io.ErrUnexpectedEOF) {
		return true
	}
	return strings.Contains(err.Error(), "EOF")
}

// PurgeNeutrinoCache removes the four neutrino header and database files from
// nodeDir/data/chain/flokicoin/main/. Files that are already absent are
// silently skipped; any other removal error is returned immediately.
// These files are re-created from the network on the next daemon startup.
func PurgeNeutrinoCache(nodeDir string) error {
	base := filepath.Join(nodeDir, "data", "chain", "flokicoin", "main")
	targets := []string{
		filepath.Join(base, "block_headers.bin"),
		filepath.Join(base, "reg_filter_headers.bin"),
		filepath.Join(base, "neutrino.db"),
		filepath.Join(base, "neutrino.sqlite"),
	}

	removed := false
	for _, path := range targets {
		err := os.Remove(path)
		switch {
		case err == nil:
			removed = true
			log.Info().Str("path", path).Msg("neutrino cache file removed")
		case errors.Is(err, os.ErrNotExist):
			continue
		default:
			return fmt.Errorf("failed to remove %s: %w", path, err)
		}
	}

	if removed {
		log.Info().Msg("neutrino cache cleared")
	} else {
		log.Info().Msg("no neutrino cache files found to clear")
	}
	return nil
}
