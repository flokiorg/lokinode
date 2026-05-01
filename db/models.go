package db

import (
	"time"
)

// Node stores all Lokinode-managed settings for a Flokicoin node.
//
// Two independent keys identify a node record:
//   - Dir (primary key): the data directory path — always known at first contact.
//   - PubKey: the node's cryptographic identity — known after the first start.
//
// The PubKey carries a partial unique index (non-empty values only), so multiple
// newly-created nodes that have not yet started can coexist with an empty PubKey
// without violating uniqueness. Once a PubKey is set it must be globally unique.
//
// handleSaveNodeConfig detects when the same PubKey appears under a new Dir
// (node was moved to a different folder) and migrates the record automatically,
// preserving all user settings across directory changes.
type Node struct {
	Dir        string    `gorm:"primaryKey;not null"     json:"dir"`
	PubKey     string    `gorm:"column:pub_key"          json:"pubKey"` // partial unique index: see db.go
	Alias      string    `json:"alias"`
	NodePublic bool      `json:"nodePublic"`
	ExternalIP string    `json:"externalIP"`
	RestCors   string    `json:"restCors"`
	RpcListen  string    `json:"rpcListen"`
	RestListen string    `json:"restListen"`
	LastOpened time.Time `json:"lastOpened"`
	CreatedAt  time.Time `json:"createdAt"`
	UpdatedAt  time.Time `json:"updatedAt"`
}

// AppConfig stores global application settings as key-value pairs.
type AppConfig struct {
	Key   string `gorm:"primaryKey" json:"key"`
	Value string `json:"value"`
}

const (
	ConfigKeyLastNodePubKey = "last_node_pubkey"
	ConfigKeyLastNodeDir    = "last_node_dir"
)
