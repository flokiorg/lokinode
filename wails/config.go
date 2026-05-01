package wails

import "errors"

func (a *App) GetNodeDir() (string, error) {
	if a.flndCfg == nil {
		return "", errNoProfile
	}
	return a.flndCfg.LndDir, nil
}

func (a *App) GetRESTEndpoint() (string, error) {
	if a.flndCfg == nil {
		return "", errNoProfile
	}
	if len(a.flndCfg.RESTListeners) == 0 {
		return "", errors.New("unknown REST address")
	}
	prefix := "http://"
	if !a.flndCfg.DisableRestTLS {
		prefix = "https://"
	}
	return prefix + a.flndCfg.RESTListeners[0].String(), nil
}

func (a *App) GetAdminMacaroonPath() (string, error) {
	if a.flndCfg == nil {
		return "", errNoProfile
	}
	if a.flndCfg.NoMacaroons {
		return "", errors.New("macaroon disabled")
	}
	return a.flndCfg.AdminMacPath, nil
}
