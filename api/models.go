package api

// InfoResponse is returned by GET /api/info.
type InfoResponse struct {
	Version       string `json:"version"`
	LatestVersion string `json:"latestVersion"`
	Network       string `json:"network"`
	SyncedToChain        bool   `json:"syncedToChain"`
	BlockHeight          uint32 `json:"blockHeight"`
	MempoolHeight        int64  `json:"mempoolHeight"`
	BestHeaderTimestamp  int64  `json:"bestHeaderTimestamp"`
	NodePubkey    string `json:"nodePubkey"`
	NodeAlias     string `json:"nodeAlias"`
	NodeDir       string `json:"nodeDir"`
	RESTEndpoint  string `json:"restEndpoint"`
	MacaroonPath  string `json:"macaroonPath"`
	TLSCertPath   string `json:"tlsCertPath"`
	State           string `json:"state"`
	Error           string `json:"error,omitempty"`
	NodeRunning     bool   `json:"nodeRunning"`
	AnotherInstance bool   `json:"anotherInstance,omitempty"`
	PortConflict    bool   `json:"portConflict,omitempty"`

	// Network details
	PeerAddress   string `json:"peerAddress"`
	RpcAddress    string `json:"rpcAddress"`
	MacaroonHex   string `json:"macaroonHex"`
	TLSCertHex    string `json:"tlsCertHex"`

	// Configuration state (to detect dirty state)
	NodePublic    bool   `json:"nodePublic"`
	ExternalIP    string `json:"externalIP"`
	RestCors      string `json:"restCors"`
}

// BalanceResponse is returned by GET /api/balance.
type BalanceResponse struct {
	// Ready is true once the wallet has returned real balance figures.
	// While false, the numeric fields are placeholder zeros and the UI
	// should show a loading state instead of "0.00".
	Ready       bool  `json:"ready"`
	Confirmed   int64 `json:"confirmed"`
	Unconfirmed int64 `json:"unconfirmed"`
	Locked      int64 `json:"locked"`
	Total       int64 `json:"total"`
}

// TransactionItem represents a single on-chain transaction.
type TransactionItem struct {
	TxHash        string   `json:"txHash"`
	Amount        int64    `json:"amount"`
	Confirmations int32    `json:"confirmations"`
	BlockHeight   int32    `json:"blockHeight"`
	Timestamp     int64    `json:"timestamp"`
	Addresses     []string `json:"addresses"`
	Label         string   `json:"label"`
	Fee           int64    `json:"fee"`
}

// TransactionsResponse is returned by GET /api/transactions.
type TransactionsResponse struct {
	Total        int               `json:"total"`
	Transactions []TransactionItem `json:"transactions"`
}

// RecoveryResponse is returned by GET /api/wallet/recovery.
type RecoveryResponse struct {
	InProgress bool    `json:"inProgress"`
	Progress   float64 `json:"progress"`
}

// AddressResponse is returned by GET /api/wallet/address and POST /api/wallet/address/new.
type AddressResponse struct {
	Address string `json:"address"`
}

// FeesResponse is returned by GET /api/fees/recommended.
type FeesResponse struct {
	FastestFee  int64 `json:"fastestFee"`
	HalfHourFee int64 `json:"halfHourFee"`
	EconomyFee  int64 `json:"economyFee"`
}

// SendRequest is the body of POST /api/send.
type SendRequest struct {
	Address     string `json:"address"`
	Amount        int64  `json:"amount"`
	LokiPerVbyte int64  `json:"lokiPerVbyte"`
}

// SendResponse is returned by POST /api/send.
type SendResponse struct {
	TxID string `json:"txId"`
}

// EstimateFeeRequest is the body of POST /api/send/estimate-fee.
type EstimateFeeRequest struct {
	Address string `json:"address"`
	Amount  int64  `json:"amount"`
}

// EstimateFeeResponse is returned by POST /api/send/estimate-fee.
type EstimateFeeResponse struct {
	LokiPerVbyte int64 `json:"lokiPerVbyte"`
	TotalFee    int64 `json:"totalFee"`
}

// MaxSendableRequest is the body of POST /api/send/max-sendable.
type MaxSendableRequest struct {
	Address     string `json:"address"`
	LokiPerVbyte int64  `json:"lokiPerVbyte"`
}

// MaxSendableResponse is returned by POST /api/send/max-sendable.
type MaxSendableResponse struct {
	Amount   int64 `json:"amount"`
	TotalFee int64 `json:"totalFee"`
}

// PSBT models
type FundPsbtRequest struct {
	Address     string `json:"address"`
	Amount      int64  `json:"amount"`
	LokiPerVbyte uint64 `json:"lokiPerVbyte"`
}

type FundPsbtResponse struct {
	Psbt     string       `json:"psbt"`
	TotalFee int64        `json:"totalFee"`
	Locks    []OutputLock `json:"locks"`
}

type OutputLock struct {
	ID          string `json:"id"`
	TxidBytes   string `json:"txidBytes"`
	OutputIndex uint32 `json:"outputIndex"`
}

type ReleasePsbtRequest struct {
	Locks []OutputLock `json:"locks"`
}

type FinalizePsbtRequest struct {
	Psbt string `json:"psbt"`
}

type FinalizePsbtResponse struct {
	TxHex string `json:"txHex"`
}

type PublishTxRequest struct {
	TxHex string `json:"txHex"`
}

// MnemonicResponse is returned by POST /api/wallet/seed.
type MnemonicResponse struct {
	Mnemonic []string `json:"mnemonic"`
}

// UnlockRequest is the body of POST /api/wallet/unlock.
type UnlockRequest struct {
	Password string `json:"password"`
}

// InitWalletRequest is the body of POST /api/wallet/init.
type InitWalletRequest struct {
	Password   string `json:"password"`
	Mnemonic   string `json:"mnemonic"`
	AezeedPass string `json:"aezeedPass"`
	Hex        string `json:"hex"`
}

// SeedRequest is the body of POST /api/wallet/seed.
type SeedRequest struct {
	AezeedPass string `json:"aezeedPass"`
}

// ChangePasswordRequest is the body of PATCH /api/wallet/password.
type ChangePasswordRequest struct {
	CurrentPassword string `json:"currentPassword"`
	NewPassword     string `json:"newPassword"`
}

// VerifyConfigRequest is the body of POST /api/node/verify-config.
type VerifyConfigRequest struct {
	PubKey     string `json:"pubKey"`
	Dir        string `json:"dir"`
	Alias      string `json:"alias"`
	RestCors   string `json:"restCors"`
	RPCListen  string `json:"rpcListen"`
	RESTListen string `json:"restListen"`
	NodePublic bool   `json:"nodePublic"`
	NodeIP     string `json:"nodeIP"`
}

// CredentialsResponse is returned by GET /api/node/credentials.
type CredentialsResponse struct {
	MacaroonHex  string `json:"macaroonHex"`
	MacaroonPath string `json:"macaroonPath"`
	TLSCertHex   string `json:"tlsCertHex"`
	TLSCertPath  string `json:"tlsCertPath"`
	GRPCEndpoint string `json:"grpcEndpoint"`
}

// LightningConfigResponse is returned by GET /api/info for network details.
type LightningConfigResponse struct {
	RESTEndpoint string `json:"restEndpoint"`
	MacaroonPath string `json:"macaroonPath"`
	TLSCertPath  string `json:"tlsCertPath"`
}

// CheckDirResponse is returned by GET /api/node/check-dir.
type CheckDirResponse struct {
	// Exists is true when the directory contains an existing flnd node
	// (tls.cert or wallet database found).
	Exists bool `json:"exists"`
}

// DirEmptyResponse is returned by GET /api/node/dir-empty.
type DirEmptyResponse struct {
	// Empty is true when the directory does not exist yet or contains no files.
	// The frontend blocks non-empty folder selection during node creation.
	Empty bool `json:"empty"`
}

// ErrorResponse wraps API errors.
type ErrorResponse struct {
	Message string `json:"message"`
}
