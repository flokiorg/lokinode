export interface InfoResponse {
  version: string;
  latestVersion: string;
  network: string;
  syncedToChain: boolean;
  blockHeight: number;
  mempoolHeight: number;
  bestHeaderTimestamp: number;
  nodePubkey: string;
  nodeAlias: string;
  nodeDir: string;
  restEndpoint: string;
  macaroonPath: string;
  tlsCertPath: string;
  state: string;
  error?: string;
  nodeRunning: boolean;
  anotherInstance?: boolean;
  portConflict?: boolean;
  peerAddress: string;
  rpcAddress: string;
  macaroonHex: string;
  tlsCertHex: string;
  nodePublic: boolean;
  externalIP: string;
  restCors: string;
}

export interface BalanceResponse {
  ready: boolean;
  confirmed: number;
  unconfirmed: number;
  locked: number;
  total: number;
}

export interface TransactionItem {
  txHash: string;
  amount: number;
  confirmations: number;
  blockHeight: number;
  timestamp: number;
  addresses: string[];
  label: string;
  fee: number;
}

export interface TransactionsResponse {
  total: number;
  transactions: TransactionItem[];
}

export interface FeesResponse {
  fastestFee: number;
  halfHourFee: number;
  economyFee: number;
}

export interface AddressResponse {
  address: string;
}

export interface MnemonicResponse {
  mnemonic: string[];
}

export interface SendResponse {
  txId: string;
}

export interface EstimateFeeResponse {
  satPerVbyte: number;
  totalFee: number;
}

export interface FundPsbtResponse {
  psbt: string;
  totalFee: number;
}

export interface FinalizePsbtResponse {
  txHex: string;
}

export interface CredentialsResponse {
  macaroonHex: string;
  macaroonPath: string;
  tlsCertHex: string;
  tlsCertPath: string;
  grpcEndpoint: string;
}
