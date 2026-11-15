package wails

import "github.com/flokiorg/flnd/lnrpc"

// ChainInfo combines the current tip height from the block explorer with
// the node's own GetInfo response.
type ChainInfo struct {
	MempoolBlock int64
	NodeInfo     *lnrpc.GetInfoResponse
}

func (a *App) GetChainInfo(explorerHost string) (*ChainInfo, error) {
	height, err := GetBlocksTipHeight(explorerHost)
	if err != nil {
		return nil, err
	}
	info, err := a.nodeService.GetInfo()
	if err != nil {
		return nil, err
	}
	return &ChainInfo{
		MempoolBlock: height,
		NodeInfo:     info,
	}, nil
}

func (a *App) Unlock(password string) error {
	return a.nodeService.Unlock(password)
}

func (a *App) GetState() (*lnrpc.GetStateResponse, error) {
	return a.nodeService.GetState()
}

func (a *App) GetBalance() (*lnrpc.WalletBalanceResponse, error) {
	return a.nodeService.Balance()
}

func (a *App) GetRecoveryInfo() (*lnrpc.GetRecoveryInfoResponse, error) {
	return a.nodeService.GetRecoveryInfo()
}

func (a *App) ListUnspent(minConfs, maxConfs int32) ([]*lnrpc.Utxo, error) {
	return a.nodeService.ListUnspent(minConfs, maxConfs)
}

func (a *App) InitWallet(walletPassword, existMnemonic, aezeedPass, existHex string) error {
	return a.nodeService.InitWallet(walletPassword, existMnemonic, aezeedPass, existHex)
}

func (a *App) GenSeed(aezeedPass string) ([]string, error) {
	return a.nodeService.GenSeed(aezeedPass)
}
