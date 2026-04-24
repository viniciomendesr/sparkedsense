export interface Sensor {
  id: string;
  name: string;
  type: 'temperature' | 'humidity' | 'ph' | 'pressure' | 'light' | 'co2' | 'acoustic';
  description: string;
  visibility: 'public' | 'private' | 'partial';
  status: 'active' | 'inactive' | 'reconnecting';
  mode: 'mock' | 'real';
  owner: string;
  claimToken?: string;
  walletPublicKey?: string;
  thumbnailUrl?: string;
  location?: string;
  latitude?: number;
  longitude?: number;
  locationAccuracy?: number;
  createdAt: Date;
  updatedAt?: Date;
  lastReading?: Reading;
}

export interface Reading {
  id: string;
  sensorId: string;
  timestamp: Date;
  variable: string;
  value: number;
  unit: string;
  verified: boolean;
  signature?: string;
  hash?: string;
}

export interface Dataset {
  id: string;
  name: string;
  sensorId: string;
  startDate: Date;
  endDate: Date;
  readingsCount: number;
  status: 'preparing' | 'anchoring' | 'anchored' | 'failed';
  merkleRoot?: string;
  transactionId?: string;
  isPublic: boolean;
  createdAt: Date;
  accessCount?: number;
  previewReadings?: Reading[];
  // ADR-007: real Solana anchor metadata (present when anchoring succeeded onchain).
  anchorTxSignature?: string;
  anchorExplorerUrl?: string;
  anchorCluster?: 'devnet' | 'mainnet-beta' | 'testnet';
  anchorMemo?: string;
  anchoredAt?: string;
}

export interface MerkleProofStep {
  hash: string;
  position: "left" | "right";
}

export interface MerkleProofData {
  leafHash: string;
  leafIndex: number;
  proof: MerkleProofStep[];
  root: string;
}

export interface HourlyMerkleData {
  sensorId: string;
  merkleRoot: string;
  leafCount: number;
  leaves: string[];
  timestamp: Date;
  readingsCount: number;
}

export interface SensorMetrics {
  id: string;
  name: string;
  type: string;
  status: string;
  lastReading?: Reading;
  publicDatasetsCount: number;
  totalReadingsCount: number;
  verifiedDatasetsCount: number;
  totalVerified: number;
  lastActivity?: Date;
  hourlyMerkleRoot?: string;
}

export interface LiveData {
  sensorId: string;
  values: { timestamp: Date; value: number }[];
  isConnected: boolean;
}
