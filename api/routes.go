package api

import "github.com/labstack/echo/v4"

func registerRoutes(g *echo.Group, app App) {
	// Node lifecycle
	g.GET("/info", handleInfo(app))
	g.GET("/node/default-dir", handleDefaultNodeDir(app))
	g.GET("/node/check-dir", handleCheckDir(app))
	g.GET("/node/dir-empty", handleDirEmpty(app))
	g.POST("/node/start", handleNodeStart(app))
	g.POST("/node/stop", handleNodeStop(app))
	g.POST("/node/restart", handleNodeRestart(app))
	g.POST("/node/verify-config", handleVerifyConfig(app))
	g.GET("/node/config", handleGetNodeConfig(app))
	g.GET("/node/last", handleGetLastNode(app))
	g.GET("/node/list", handleListNodeConfigs(app))
	g.POST("/node/config", handleSaveNodeConfig(app))

	// Wallet
	g.GET("/balance", handleBalance(app))
	g.POST("/wallet/lock", handleLock(app))
	g.POST("/wallet/unlock", handleUnlock(app))
	g.POST("/wallet/init", handleInitWallet(app))
	g.POST("/wallet/seed", handleGenSeed(app))
	g.GET("/wallet/recovery", handleRecovery(app))
	g.GET("/wallet/address", handleGetAddress(app))
	g.POST("/wallet/address/new", handleNewAddress(app))
	g.PATCH("/wallet/password", handleChangePassword(app))

	// Transactions
	g.GET("/transactions", handleTransactions(app))

	// Send
	g.POST("/send", handleSend(app))
	g.POST("/send/estimate-fee", handleEstimateFee(app))
	g.POST("/send/fund-psbt", handleFundPsbt(app))
	g.POST("/send/finalize-psbt", handleFinalizePsbt(app))
	g.POST("/send/publish", handlePublishTx(app))

	// Fees
	g.GET("/fees/recommended", handleRecommendedFees(app))

	// Node credentials (macaroon + TLS hex for external wallet clients)
	g.GET("/node/credentials", handleCredentials(app))

	// Logs
	g.GET("/logs", handleLogs(app))
	g.GET("/logs/stream", handleLogsStream(app))
}
