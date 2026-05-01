package daemon

import (
	"strings"

	"github.com/flokiorg/flnd"
	"github.com/flokiorg/flnd/lncfg"
	"github.com/flokiorg/flnd/signal"
	"github.com/jessevdk/go-flags"
)

const feeURL = "https://lokichain.info/api/v1/fees/recommended"

// UserNodeConfig holds the user-supplied fields from the onboarding UI.
// All other config values are set programmatically from flnd defaults.
type UserNodeConfig struct {
	PubKey     string
	Dir        string
	Alias      string
	RestCors   string
	RPCListen  string
	RESTListen string
	NodePublic bool
	ExternalIP string
}

// BuildAndValidate constructs a complete flnd.Config from flnd.DefaultConfig(),
// applies canonical desktop defaults (neutrino, no console log, protocol
// options, mainnet peers), merges in the user-supplied overrides, then calls
// flnd.ValidateConfig. No INI string manipulation is performed.
func BuildAndValidate(interceptor signal.Interceptor, ucfg UserNodeConfig) (*flnd.Config, error) {
	cfg := flnd.DefaultConfig()

	// ── canonical desktop defaults ────────────────────────────────────────
	cfg.Flokicoin.MainNet = true
	cfg.Flokicoin.Node = "neutrino"
	cfg.LogConfig.Console.Disable = true
	cfg.DisableRestTLS = true
	cfg.NoMacaroons = false
	cfg.ProtocolOptions = &lncfg.ProtocolOptions{
		OptionScidAlias: true,
		OptionZeroConf:  true,
	}
	cfg.Pprof = &lncfg.Pprof{}

	// ── neutrino peers ────────────────────────────────────────────────────
	// ── fee estimator (required for neutrino mainnet) ─────────────────────
	cfg.Fee.URL = feeURL

	// ── listen address ────────────────────────────────────────────────────
	// Public nodes accept incoming P2P connections; private nodes connect out only.
	// Note: P2P and External IP settings are applied in the post-validation
	// block below to ensure they take precedence over flnd.conf.
	cfg.LndDir = ucfg.Dir

	if ucfg.RPCListen != "" {
		cfg.RawRPCListeners = []string{ucfg.RPCListen}
	}
	if ucfg.RESTListen != "" {
		cfg.RawRESTListeners = []string{ucfg.RESTListen}
	}

	// ── validate ──────────────────────────────────────────────────────────
	fileParser := flags.NewParser(&cfg, flags.Default)
	flagParser := flags.NewParser(&cfg, flags.Default)
	finalCfg, err := flnd.ValidateConfig(cfg, interceptor, fileParser, flagParser)
	if err != nil {
		return nil, err
	}

	// ── Post-validation overrides ─────────────────────────────────────────
	// ValidateConfig parses the flnd.conf file which might overwrite our
	// programmatic settings. Since we treat the Lokinode DB as the source of
	// truth for user-managed settings (Alias, IP, CORS, etc), we re-apply
	// them here to ensure they stick even if a conflicting flnd.conf exists.
	if ucfg.Alias != "" {
		finalCfg.Alias = ucfg.Alias
	}
	if ucfg.RestCors != "" {
		finalCfg.RestCORS = strings.Split(ucfg.RestCors, ",")
	}
	if ucfg.NodePublic {
		finalCfg.DisableListen = false
		if ucfg.ExternalIP != "" {
			finalCfg.RawExternalIPs = []string{ucfg.ExternalIP}
		}
	} else {
		finalCfg.DisableListen = true
	}

	return finalCfg, nil
}
