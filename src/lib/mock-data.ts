import { Sensor, Reading, Dataset } from './types';

export const mockWalletAddress = '8vN3hK2mR9pL4jT6qW1xY5sC7bF3nM9vH2kP8wQ4tR6z';

export const mockSensors: Sensor[] = [
  {
    id: 'sensor-1',
    name: 'Lab Temperature Monitor',
    type: 'temperature',
    description: 'Primary temperature sensor in laboratory environment',
    location: 'São Paulo, Brazil',
    visibility: 'public',
    status: 'active',
    owner: mockWalletAddress,
    createdAt: new Date('2025-01-15'),
    lastReading: {
      id: 'reading-1',
      sensorId: 'sensor-1',
      timestamp: new Date(),
      variable: 'temperature',
      value: 22.5,
      unit: '°C',
      verified: true,
    }
  },
  {
    id: 'sensor-2',
    name: 'Greenhouse Humidity',
    type: 'humidity',
    description: 'Humidity monitoring for controlled agriculture',
    visibility: 'public',
    status: 'active',
    owner: mockWalletAddress,
    createdAt: new Date('2025-01-20'),
    lastReading: {
      id: 'reading-2',
      sensorId: 'sensor-2',
      timestamp: new Date(),
      variable: 'humidity',
      value: 65.3,
      unit: '%',
      verified: true,
    }
  },
  {
    id: 'sensor-3',
    name: 'Water Quality pH',
    type: 'ph',
    description: 'Continuous pH monitoring for water treatment',
    visibility: 'private',
    status: 'active',
    owner: mockWalletAddress,
    createdAt: new Date('2025-02-01'),
    lastReading: {
      id: 'reading-3',
      sensorId: 'sensor-3',
      timestamp: new Date(),
      variable: 'pH',
      value: 7.2,
      unit: 'pH',
      verified: true,
    }
  },
  {
    id: 'sensor-4',
    name: 'Atmospheric Pressure',
    type: 'pressure',
    description: 'Weather station barometric pressure',
    visibility: 'public',
    status: 'reconnecting',
    owner: mockWalletAddress,
    createdAt: new Date('2025-02-10'),
    lastReading: {
      id: 'reading-4',
      sensorId: 'sensor-4',
      timestamp: new Date(Date.now() - 300000),
      variable: 'pressure',
      value: 1013.25,
      unit: 'hPa',
      verified: true,
    }
  }
];

export const mockDatasets: Dataset[] = [
  {
    id: 'dataset-1',
    name: 'Temperature Dataset - Week 1',
    sensorId: 'sensor-1',
    startDate: new Date('2025-02-01'),
    endDate: new Date('2025-02-07'),
    readingsCount: 10080,
    status: 'anchored',
    merkleRoot: '0x4f3d8e2a1b5c9f7e6d4a8c2b1f5e9d7c3a6b8e4f2d9c7a5b3e1f8d6c4a2b9e7',
    transactionId: '5K8mN2pR9vL4jT6qW1xY3sC7bF9nM4vH2kP8wQ3tR6zX1yV5cB7fN9mK2pL4jT6q',
    createdAt: new Date('2025-02-08'),
  },
  {
    id: 'dataset-2',
    name: 'Humidity Dataset - January',
    sensorId: 'sensor-2',
    startDate: new Date('2025-01-20'),
    endDate: new Date('2025-01-31'),
    readingsCount: 15840,
    status: 'anchored',
    merkleRoot: '0x7a9c4f2e8b1d5c3f6e9a2d8c4b7f1e5d9c3a6b8e2f4d7c9a5b1e8f6d3c4a2b7',
    transactionId: '9R3pL6vN2mK8jT4qW7xY1sC5bF3nM9vH6kP2wQ8tR4zX7yV1cB5fN3mK9pL6jT2q',
    createdAt: new Date('2025-02-01'),
  },
  {
    id: 'dataset-3',
    name: 'pH Readings - Week 2',
    sensorId: 'sensor-3',
    startDate: new Date('2025-02-08'),
    endDate: new Date('2025-02-14'),
    readingsCount: 8640,
    status: 'anchoring',
    createdAt: new Date('2025-02-15'),
  },
  {
    id: 'dataset-4',
    name: 'Temperature Dataset - Week 2',
    sensorId: 'sensor-1',
    startDate: new Date('2025-02-08'),
    endDate: new Date('2025-02-14'),
    readingsCount: 10080,
    status: 'preparing',
    createdAt: new Date('2025-02-15'),
  }
];

// Simple hash function for demo purposes
function generateHash(data: string): string {
  let hash = 0;
  for (let i = 0; i < data.length; i++) {
    const char = data.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return Math.abs(hash).toString(16).padStart(16, '0');
}

// Generate historical readings for charts
export function generateHistoricalReadings(
  sensorId: string,
  type: string,
  count: number = 60
): Reading[] {
  const readings: Reading[] = [];
  const now = Date.now();
  const baseValue = type === 'temperature' ? 22 : type === 'humidity' ? 65 : type === 'ph' ? 7 : 1013;
  const variance = type === 'temperature' ? 3 : type === 'humidity' ? 10 : type === 'ph' ? 0.5 : 5;
  
  for (let i = count - 1; i >= 0; i--) {
    const timestamp = new Date(now - i * 2000); // 2 second intervals
    const value = baseValue + (Math.random() - 0.5) * variance;
    const roundedValue = Math.round(value * 100) / 100;
    const hashInput = `${sensorId}-${timestamp.toISOString()}-${roundedValue}-${type}`;
    
    readings.push({
      id: `reading-${sensorId}-${i}`,
      sensorId,
      timestamp,
      variable: type,
      value: roundedValue,
      unit: type === 'temperature' ? '°C' : type === 'humidity' ? '%' : type === 'ph' ? 'pH' : 'hPa',
      verified: true,
      hash: generateHash(hashInput),
    });
  }
  
  return readings;
}

// Simulate live reading generation
export function generateLiveReading(sensorId: string, type: string, lastValue?: number): Reading {
  const baseValue = lastValue || (type === 'temperature' ? 22 : type === 'humidity' ? 65 : type === 'ph' ? 7 : 1013);
  const variance = type === 'temperature' ? 0.3 : type === 'humidity' ? 2 : type === 'ph' ? 0.1 : 0.5;
  const newValue = baseValue + (Math.random() - 0.5) * variance;
  const roundedValue = Math.round(newValue * 100) / 100;
  const timestamp = new Date();
  const hashInput = `${sensorId}-${timestamp.toISOString()}-${roundedValue}-${type}`;
  
  return {
    id: `reading-${sensorId}-${Date.now()}`,
    sensorId,
    timestamp,
    variable: type,
    value: roundedValue,
    unit: type === 'temperature' ? '°C' : type === 'humidity' ? '%' : type === 'ph' ? 'pH' : 'hPa',
    verified: true,
    hash: generateHash(hashInput),
  };
}
