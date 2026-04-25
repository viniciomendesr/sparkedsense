import { projectId, publicAnonKey } from "../utils/supabase/info";
import { Sensor, Reading, Dataset, MerkleProofData } from "./types";

const API_BASE = `https://${projectId}.supabase.co/functions/v1/server`;

// Helper function to get auth headers
export const getAuthHeaders = (accessToken?: string) => {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${accessToken || publicAnonKey}`,
    "Cache-Control": "no-cache, no-store",
  };
};

// Authentication APIs
export const authAPI = {
  signUp: async (email: string, password: string, name: string) => {
    const response = await fetch(`${API_BASE}/auth/signup`, {
      method: "POST",
      headers: getAuthHeaders(),
      body: JSON.stringify({ email, password, name }),
    });
    if (!response.ok) {
      const errorData = await response
        .json()
        .catch(() => ({ error: "Unknown error" }));
      throw new Error(errorData.error || "Sign up failed");
    }
    return response.json();
  },

  signIn: async (email: string, password: string) => {
    const response = await fetch(`${API_BASE}/auth/signin`, {
      method: "POST",
      headers: getAuthHeaders(),
      body: JSON.stringify({ email, password }),
    });
    if (!response.ok) {
      const errorData = await response
        .json()
        .catch(() => ({ error: "Unknown error" }));
      throw new Error(errorData.error || "Sign in failed");
    }
    return response.json();
  },

  signOut: async (accessToken: string) => {
    const response = await fetch(`${API_BASE}/auth/signout`, {
      method: "POST",
      headers: getAuthHeaders(accessToken),
    });
    if (!response.ok) {
      const errorData = await response
        .json()
        .catch(() => ({ error: "Unknown error" }));
      throw new Error(errorData.error || "Sign out failed");
    }
    return response.json();
  },

  getSession: async () => {
    const response = await fetch(`${API_BASE}/auth/session`, {
      method: "GET",
      headers: getAuthHeaders(),
    });
    if (!response.ok) {
      return null;
    }
    return response.json();
  },
};

// Sensor APIs
export const sensorAPI = {
  generateClaimToken: async (accessToken: string) => {
    const response = await fetch(`${API_BASE}/sensors/generate-claim-token`, {
      method: "POST",
      headers: getAuthHeaders(accessToken),
    });
    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to generate claim token: ${error}`);
    }
    const data = await response.json();
    return data.claimToken as string;
  },

  // ADR-012: Step 1 of /server/register-device for unsigned_dev sensors.
  // Creates/updates the device row with mac_address + public_key. No challenge
  // verification — the returned `challenge` is discarded because unsigned_dev
  // never proceeds to Step 2.
  registerDeviceStep1: async (macAddress: string, publicKey: string) => {
    const response = await fetch(`${API_BASE}/register-device`, {
      method: "POST",
      headers: getAuthHeaders(),
      body: JSON.stringify({ macAddress, publicKey }),
    });
    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to register device (Step 1): ${error}`);
    }
    return response.json();
  },

  retrieveClaimToken: async (
    walletPublicKey: string,
    macAddress: string,
    devicePublicKey: string,
    accessToken: string
  ) => {
    const response = await fetch(`${API_BASE}/sensors/retrieve-claim-token`, {
      method: "POST",
      headers: getAuthHeaders(accessToken),
      body: JSON.stringify({
        wallet_public_key: walletPublicKey,
        mac_address: macAddress,
        device_public_key: devicePublicKey,
      }),
    });
    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to retrieve claim token: ${error}`);
    }
    const data = await response.json();
    return data.claim_token as string;
  },

  list: async (accessToken: string) => {
    const response = await fetch(`${API_BASE}/sensors`, {
      method: "GET",
      headers: getAuthHeaders(accessToken),
    });
    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to fetch sensors: ${error}`);
    }
    const data = await response.json();
    return data.sensors as Sensor[];
  },

  get: async (id: string, accessToken: string) => {
    const response = await fetch(`${API_BASE}/sensors/${id}`, {
      method: "GET",
      headers: getAuthHeaders(accessToken),
    });
    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to fetch sensor: ${error}`);
    }
    const data = await response.json();
    return data.sensor as Sensor;
  },

  create: async (sensor: Partial<Sensor>, accessToken: string) => {
    const response = await fetch(`${API_BASE}/sensors`, {
      method: "POST",
      headers: getAuthHeaders(accessToken),
      body: JSON.stringify(sensor),
    });
    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to create sensor: ${error}`);
    }
    const data = await response.json();
    return data.sensor as Sensor;
  },

  // ADR-014/ADR-016: rotate the device public key bound to a sensor. Used when
  // the firmware acquires real signing capability and needs the platform to
  // recognize its new pubkey while preserving the existing NFT identity.
  rotatePubkey: async (
    id: string,
    args: { newPublicKey: string; newMacAddress?: string },
    accessToken: string,
  ) => {
    const response = await fetch(`${API_BASE}/sensors/${id}/rotate-pubkey`, {
      method: "POST",
      headers: getAuthHeaders(accessToken),
      body: JSON.stringify(args),
    });
    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to rotate pubkey: ${error}`);
    }
    const data = await response.json();
    return data.sensor as Sensor;
  },

  // ADR-014: deferred mint. Promotes a sensor in `unverified` mode to `real`,
  // attaching nft_address + claim_token. Server wallet pays on devnet.
  mint: async (id: string, accessToken: string) => {
    const response = await fetch(`${API_BASE}/sensors/${id}/mint`, {
      method: "POST",
      headers: getAuthHeaders(accessToken),
    });
    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to mint sensor: ${error}`);
    }
    const data = await response.json();
    return data.sensor as Sensor;
  },

  update: async (id: string, updates: Partial<Sensor>, accessToken: string) => {
    const response = await fetch(`${API_BASE}/sensors/${id}`, {
      method: "PUT",
      headers: getAuthHeaders(accessToken),
      body: JSON.stringify(updates),
    });
    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to update sensor: ${error}`);
    }
    const data = await response.json();
    return data.sensor as Sensor;
  },

  delete: async (id: string, accessToken: string) => {
    const response = await fetch(`${API_BASE}/sensors/${id}`, {
      method: "DELETE",
      headers: getAuthHeaders(accessToken),
    });
    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to delete sensor: ${error}`);
    }
    return response.json();
  },

  refreshLocation: async (id: string, accessToken: string) => {
    const response = await fetch(`${API_BASE}/sensors/${id}/refresh-location`, {
      method: "POST",
      headers: getAuthHeaders(accessToken),
    });
    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to refresh location: ${error}`);
    }
    const data = await response.json();
    return data.sensor as Sensor;
  },
};

// Reading APIs
export const readingAPI = {
  list: async (sensorId: string, accessToken: string, limit = 100, opts?: { slim?: boolean }) => {
    const params = new URLSearchParams({ limit: String(limit) });
    if (opts?.slim) params.set('slim', '1');
    const response = await fetch(
      `${API_BASE}/readings/${sensorId}?${params.toString()}`,
      {
        method: "GET",
        headers: getAuthHeaders(accessToken),
      }
    );
    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to fetch readings: ${error}`);
    }
    const data = await response.json();
    return data.readings as Reading[];
  },

  create: async (reading: Partial<Reading>, accessToken: string) => {
    const response = await fetch(`${API_BASE}/readings`, {
      method: "POST",
      headers: getAuthHeaders(accessToken),
      body: JSON.stringify(reading),
    });
    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to create reading: ${error}`);
    }
    const data = await response.json();
    return data.reading as Reading;
  },

  getHistorical: async (
    sensorId: string,
    startDate: Date,
    endDate: Date,
    accessToken: string
  ) => {
    const response = await fetch(
      `${API_BASE}/readings/${sensorId}/historical?start=${startDate.toISOString()}&end=${endDate.toISOString()}`,
      {
        method: "GET",
        headers: getAuthHeaders(accessToken),
      }
    );
    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to fetch historical readings: ${error}`);
    }
    const data = await response.json();
    return data.readings as Reading[];
  },
};

// Dataset APIs
export const datasetAPI = {
  list: async (sensorId: string, accessToken: string) => {
    const response = await fetch(`${API_BASE}/datasets/${sensorId}`, {
      method: "GET",
      headers: getAuthHeaders(accessToken),
    });
    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to fetch datasets: ${error}`);
    }
    const data = await response.json();
    return data.datasets as Dataset[];
  },

  get: async (id: string, accessToken: string) => {
    const response = await fetch(`${API_BASE}/datasets/detail/${id}`, {
      method: "GET",
      headers: getAuthHeaders(accessToken),
    });
    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to fetch dataset: ${error}`);
    }
    const data = await response.json();
    return data.dataset as Dataset;
  },

  create: async (dataset: Partial<Dataset>, accessToken: string) => {
    const response = await fetch(`${API_BASE}/datasets`, {
      method: "POST",
      headers: getAuthHeaders(accessToken),
      body: JSON.stringify(dataset),
    });
    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to create dataset: ${error}`);
    }
    const data = await response.json();
    return data.dataset as Dataset;
  },

  update: async (
    id: string,
    updates: Partial<Dataset>,
    accessToken: string
  ) => {
    const response = await fetch(`${API_BASE}/datasets/${id}`, {
      method: "PUT",
      headers: getAuthHeaders(accessToken),
      body: JSON.stringify(updates),
    });
    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to update dataset: ${error}`);
    }
    const data = await response.json();
    return data.dataset as Dataset;
  },

  anchor: async (
    id: string,
    accessToken: string,
    precomputed?: { merkleRoot: string; readingsCount: number },
  ) => {
    const response = await fetch(`${API_BASE}/datasets/${id}/anchor`, {
      method: "POST",
      headers: getAuthHeaders(accessToken),
      body: precomputed ? JSON.stringify(precomputed) : undefined,
    });
    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to anchor dataset: ${error}`);
    }
    const data = await response.json();
    return data.dataset as Dataset;
  },

  incrementAccess: async (id: string, accessToken: string) => {
    const response = await fetch(`${API_BASE}/datasets/${id}/access`, {
      method: "POST",
      headers: getAuthHeaders(accessToken),
    });
    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to increment access count: ${error}`);
    }
    return response.json();
  },

  verifyHash: async (sensorId: string, hash: string, accessToken: string) => {
    const response = await fetch(`${API_BASE}/verify/hash`, {
      method: "POST",
      headers: getAuthHeaders(accessToken),
      body: JSON.stringify({ sensorId, hash }),
    });
    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to verify hash: ${error}`);
    }
    return response.json();
  },

  verifyMerkleRoot: async (
    sensorId: string,
    merkleRoot: string,
    accessToken: string
  ) => {
    const response = await fetch(`${API_BASE}/verify/merkle`, {
      method: "POST",
      headers: getAuthHeaders(accessToken),
      body: JSON.stringify({ sensorId, merkleRoot }),
    });
    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to verify Merkle root: ${error}`);
    }
    return response.json();
  },

  delete: async (id: string, accessToken: string) => {
    const response = await fetch(`${API_BASE}/datasets/${id}`, {
      method: "DELETE",
      headers: getAuthHeaders(accessToken),
    });
    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to delete dataset: ${error}`);
    }
    return response.json();
  },

  export: async (id: string, accessToken: string) => {
    const response = await fetch(`${API_BASE}/datasets/${id}/export`, {
      method: "GET",
      headers: getAuthHeaders(accessToken),
    });
    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to export dataset: ${error}`);
    }
    return response.json();
  },
};

// Stats API
export const statsAPI = {
  get: async (accessToken: string) => {
    const response = await fetch(`${API_BASE}/stats`, {
      method: "GET",
      headers: getAuthHeaders(accessToken),
    });
    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to fetch stats: ${error}`);
    }
    return response.json();
  },
};

// Merkle Root API
export const merkleAPI = {
  getHourlyRoot: async (sensorId: string, accessToken: string) => {
    const response = await fetch(
      `${API_BASE}/sensors/${sensorId}/hourly-merkle`,
      {
        method: "GET",
        headers: getAuthHeaders(accessToken),
      }
    );
    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to fetch hourly Merkle root: ${error}`);
    }
    return response.json();
  },

  getProof: async (sensorId: string, leafIndex: number, accessToken: string): Promise<{ proof: MerkleProofData; merkleRoot: string; leafCount: number }> => {
    const response = await fetch(
      `${API_BASE}/sensors/${sensorId}/merkle-proof/${leafIndex}`,
      {
        method: "GET",
        headers: getAuthHeaders(accessToken),
      }
    );
    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to fetch Merkle proof: ${error}`);
    }
    return response.json();
  },
};

// Public API (no authentication required)
export const publicAPI = {
  listPublicSensors: async () => {
    const response = await fetch(`${API_BASE}/public/sensors`, {
      method: "GET",
      headers: getAuthHeaders(),
    });
    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to fetch public sensors: ${error}`);
    }
    const data = await response.json();
    return data.sensors as Sensor[];
  },

  getFeaturedSensors: async () => {
    const response = await fetch(`${API_BASE}/public/sensors/featured`, {
      method: "GET",
      headers: getAuthHeaders(),
    });
    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to fetch featured sensors: ${error}`);
    }
    return response.json();
  },

  getPublicSensor: async (id: string) => {
    const response = await fetch(`${API_BASE}/public/sensors/${id}`, {
      method: "GET",
      headers: getAuthHeaders(),
    });
    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to fetch public sensor: ${error}`);
    }
    const data = await response.json();
    return data.sensor as Sensor;
  },

  getPublicDatasets: async (sensorId: string) => {
    const response = await fetch(`${API_BASE}/public/datasets/${sensorId}`, {
      method: "GET",
      headers: getAuthHeaders(),
    });
    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to fetch public datasets: ${error}`);
    }
    const data = await response.json();
    return data.datasets as Dataset[];
  },

  exportPublicDataset: async (id: string) => {
    const response = await fetch(`${API_BASE}/public/datasets/${id}/export`, {
      method: "GET",
      headers: getAuthHeaders(),
    });
    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to export public dataset: ${error}`);
    }
    return response.json();
  },

  getPublicReadings: async (sensorId: string, limit = 100, opts?: { slim?: boolean }) => {
    const params = new URLSearchParams({ limit: String(limit) });
    if (opts?.slim) params.set('slim', '1');
    const response = await fetch(
      `${API_BASE}/public/readings/${sensorId}?${params.toString()}`,
      {
        method: "GET",
        headers: getAuthHeaders(),
      }
    );
    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to fetch public readings: ${error}`);
    }
    const data = await response.json();
    return data.readings as Reading[];
  },

  /**
   * ADR-010: fetch the latest CloudEvents envelopes for a public sensor.
   * Optional `eventType` filters to a single event_type (e.g. 'io.sparkedsense.inference.classification').
   */
  getEnvelopes: async (sensorId: string, opts?: { limit?: number; eventType?: string }) => {
    const params = new URLSearchParams();
    params.set('limit', String(opts?.limit ?? 100));
    if (opts?.eventType) params.set('type', opts.eventType);
    const response = await fetch(
      `${API_BASE}/public/readings-v2/${sensorId}?${params.toString()}`,
      { method: 'GET', headers: getAuthHeaders() },
    );
    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to fetch envelopes: ${error}`);
    }
    const data = await response.json();
    return data.readings as Array<{
      id: string;
      spec_version: string;
      event_type: string;
      source: string;
      time: string;
      datacontenttype: string;
      data: unknown;
      device_id: string;
      signature: string;
      created_at: string;
    }>;
  },

  getPublicHourlyMerkle: async (sensorId: string) => {
    const response = await fetch(
      `${API_BASE}/public/sensors/${sensorId}/hourly-merkle`,
      {
        method: "GET",
        headers: getAuthHeaders(),
      }
    );
    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to fetch public hourly Merkle root: ${error}`);
    }
    return response.json();
  },

  getPublicMerkleProof: async (sensorId: string, leafIndex: number): Promise<{ proof: MerkleProofData; merkleRoot: string; leafCount: number }> => {
    const response = await fetch(
      `${API_BASE}/public/sensors/${sensorId}/merkle-proof/${leafIndex}`,
      {
        method: "GET",
        headers: getAuthHeaders(),
      }
    );
    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to fetch public Merkle proof: ${error}`);
    }
    return response.json();
  },

  verifyPublicMerkle: async (sensorId: string, merkleRoot: string) => {
    const currentData = await publicAPI.getPublicHourlyMerkle(sensorId);
    return {
      verified: currentData.merkleRoot === merkleRoot,
      expected: currentData.merkleRoot,
      received: merkleRoot,
      readingsCount: currentData.readingsCount,
    };
  },
};
