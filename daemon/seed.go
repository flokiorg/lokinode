package daemon

import (
	"crypto/rand"
	"fmt"
	"time"

	"github.com/flokiorg/flnd/aezeed"
)

// GenerateStandaloneSeed generates a new 24-word aezeed mnemonic without
// requiring a running FLND daemon. This is used during onboarding to allow
// users to save their seed BEFORE the node is started.
func GenerateStandaloneSeed(aezeedPass []byte) ([]string, error) {
	var entropy [aezeed.EntropySize]byte
	if _, err := rand.Read(entropy[:]); err != nil {
		return nil, fmt.Errorf("unable to generate entropy: %w", err)
	}

	// aezeed version 0 is the current standard for LND/FLND.
	seed, err := aezeed.New(0, &entropy, time.Now())
	if err != nil {
		return nil, fmt.Errorf("unable to create aezeed seed: %w", err)
	}

	mnemonic, err := seed.ToMnemonic(aezeedPass)
	if err != nil {
		return nil, fmt.Errorf("unable to generate mnemonic: %w", err)
	}

	return mnemonic[:], nil
}
