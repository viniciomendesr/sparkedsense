export interface Sensor {
  id: string;
  name: string;
  type: 'temperature' | 'humidity' | 'ph' | 'pressure' | 'light' | 'co2' | 'acoustic';
  description: string;
  visibility: 'public' | 'private' | 'partial';
  status: 'active' | 'inactive' | 'reconnecting';
  mode: 'mock' | 'real' | 'unverified';
  owner: string;
  claimToken?: string;
  walletPublicKey?: string;
  devicePublicKey?: string;
  // ADR-014/ADR-016: timestamp of the most recent device-key rotation. Audit
  // consumers should treat events before this as a separate trust epoch.
  pubkeyRotatedAt?: string;
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
  // Global monotonic sequence number within this sensor's full history.
  // 1 = oldest reading ever recorded; incrementing by 1 for each subsequent
  // row. Computed server-side (see getSensorReadings in the edge function).
  sequence?: number;
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
  // ADR-014: attestation provenance.
  // mintStatus = source sensor mode at creation time. Datasets from `unverified`
  // sensors are still anchorable but auditors should know the composition.
  mintStatus?: 'real' | 'unverified' | 'mock';
  // Breakdown of how many events in the dataset were signature-verified vs
  // arrived with the unsigned_dev wire marker (only emitted for unverified sources).
  signatureComposition?: {
    verified: number;
    unsigned: number;
  };
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
