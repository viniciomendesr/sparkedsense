import { useState, useEffect } from 'react';
import { Sensor, Reading, Dataset } from '../lib/types';
import { Card } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';
import { 
  ArrowLeft, 
  Activity, 
  CheckCircle2, 
  AlertCircle,
  Database,
  ExternalLink,
  Shield,
  TrendingUp,
  Calendar,
  Clock,
  Copy,
  Info,
  MapPin
} from 'lucide-react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { publicAPI } from '../lib/api';
import { verifyMerkleRoot } from '../lib/merkle';
import { generateHistoricalReadings, generateLiveReading } from '../lib/mock-data';
import { ImageWithFallback } from '../components/figma/ImageWithFallback';
import { Label } from '../components/ui/label';
import { Input } from '../components/ui/input';
import { toast } from 'sonner@2.0.3';

interface PublicSensorDetailPageProps {
  sensor: Sensor;
  onBack: () => void;
  onViewAudit: (dataset: Dataset, sensor: Sensor) => void;
}

export function PublicSensorDetailPage({ 
  sensor, 
  onBack, 
  onViewAudit
}: PublicSensorDetailPageProps) {
  const [isStreaming, setIsStreaming] = useState(true);
  const [readings, setReadings] = useState<Reading[]>([]);
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [loading, setLoading] = useState(true);
  const [verifyHashInput, setVerifyHashInput] = useState('');
  const [verifyMerkleInput, setVerifyMerkleInput] = useState('');

  // Load initial data
  useEffect(() => {
    const loadData = async () => {
      try {
        setLoading(true);
        const [readingsData, datasetsData] = await Promise.all([
          publicAPI.getPublicReadings(sensor.id, 100),
          publicAPI.getPublicDatasets(sensor.id),
        ]);

        const parsedReadings = readingsData.map(r => ({
          ...r,
          timestamp: new Date(r.timestamp),
        }));

        const parsedDatasets = datasetsData.map(d => ({
          ...d,
          startDate: new Date(d.startDate),
          endDate: new Date(d.endDate),
          createdAt: new Date(d.createdAt),
        }));

        // For real sensors, only show readings if they exist from API
        // For mock sensors, fall back to generated data if no API data
        if (sensor.mode === 'real') {
          setReadings(parsedReadings);
        } else {
          setReadings(parsedReadings.length > 0 ? parsedReadings : generateHistoricalReadings(sensor.id, sensor.type, 60));
        }
        setDatasets(parsedDatasets);
      } catch (error: any) {
        console.error('Failed to load sensor data:', error);
        // For real sensors, keep readings empty on error
        // For mock sensors, fall back to mock data
        if (sensor.mode === 'mock') {
          const historical = generateHistoricalReadings(sensor.id, sensor.type, 60);
          setReadings(historical);
        } else {
          setReadings([]);
        }
      } finally {
        setLoading(false);
      }
    };

    loadData();
  }, [sensor.id, sensor.type, sensor.mode]);

  // Simulate live streaming for public view
  useEffect(() => {
    // Only generate mock live data for mock sensors
    if (!isStreaming || sensor.status !== 'active' || sensor.mode === 'real') return;

    const interval = setInterval(() => {
      setReadings(prev => {
        const lastReading = prev[prev.length - 1];
        const newReading = generateLiveReading(sensor.id, sensor.type, lastReading?.value);
        return [...prev.slice(-59), newReading];
      });
    }, 3000);

    return () => clearInterval(interval);
  }, [isStreaming, sensor.id, sensor.type, sensor.status, sensor.mode]);

  // Filter readings to last hour
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
  const lastHourReadings = readings.filter(r => r.timestamp >= oneHourAgo);

  const chartData = readings.map(r => ({
    time: r.timestamp.toLocaleTimeString(),
    value: r.value,
  }));

  const copyToClipboard = async (text: string) => {
    try {
      // Try modern clipboard API first
      await navigator.clipboard.writeText(text);
      toast.success('Hash copied to clipboard');
    } catch (err) {
      // Fallback for environments where Clipboard API is blocked
      try {
        const textarea = document.createElement('textarea');
        textarea.value = text;
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
        toast.success('Hash copied to clipboard');
      } catch (fallbackErr) {
        console.error('Failed to copy text:', fallbackErr);
        toast.error('Failed to copy to clipboard');
      }
    }
  };

  const handleVerifyHash = () => {
    if (!verifyHashInput.trim()) {
      toast.error('Please enter a hash to verify');
      return;
    }
    const found = lastHourReadings.find(r => r.hash === verifyHashInput);
    if (found) {
      toast.success('Hash verified! Reading is authentic.');
    } else {
      toast.error('Hash not found in recent readings');
    }
  };

  const handleVerifyMerkle = async () => {
    if (!verifyMerkleInput.trim()) {
      toast.error('Please enter a Merkle root to verify');
      return;
    }
    toast.info('Verifying Merkle root client-side...');
    try {
      const hashes = lastHourReadings
        .sort((a, b) => {
          const dt = new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime();
          if (dt !== 0) return dt;
          return (a.id || '').localeCompare(b.id || '');
        })
        .map(r => r.hash || '');
      const ok = await verifyMerkleRoot(hashes, verifyMerkleInput);
      if (ok) {
        toast.success(`Merkle root verified for ${lastHourReadings.length} readings (client-side)`);
      } else {
        toast.error('Merkle root does not match the current readings');
      }
    } catch (err) {
      console.error('Merkle verification failed:', err);
      toast.error('Verification failed');
    }
  };

  const statusColors = {
    active: 'bg-success',
    inactive: 'bg-[#4A4F59]',
    reconnecting: 'bg-warning',
  };

  const datasetStatusColors = {
    preparing: 'bg-secondary/20 text-secondary border-secondary/30',
    anchoring: 'bg-warning/20 text-warning border-warning/30',
    anchored: 'bg-success/20 text-success border-success/30',
    failed: 'bg-destructive/20 text-destructive border-destructive/30',
  };

  const datasetStatusLabels = {
    preparing: 'Preparing',
    anchoring: 'Anchoring',
    anchored: 'Anchored',
    failed: 'Failed',
  };

  const formatDate = (date: Date | string | undefined) => {
    if (!date) return 'N/A';
    const dateObj = typeof date === 'string' ? new Date(date) : date;
    return dateObj.toLocaleDateString();
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      {/* Header */}
      <div className="mb-6">
        <Button
          variant="ghost"
          onClick={onBack}
          className="mb-4 -ml-2 hover:bg-muted"
        >
          <ArrowLeft className="w-4 h-4 mr-2" />
          Back
        </Button>

        {/* Sensor Hero Section */}
        <Card className="overflow-hidden bg-card border-border mb-6">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Thumbnail */}
            {sensor.thumbnailUrl && (
              <div className="lg:col-span-1">
                <div className="relative w-full h-64 lg:h-full bg-muted/50">
                  <ImageWithFallback
                    src={sensor.thumbnailUrl}
                    alt={sensor.name}
                    className="w-full h-full object-cover"
                  />
                  <div className="absolute top-3 right-3">
                    <div className={`px-3 py-1.5 rounded-full ${statusColors[sensor.status]} backdrop-blur-sm`}>
                      <span className="text-sm text-white">{sensor.status}</span>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Info */}
            <div className={`p-6 ${sensor.thumbnailUrl ? 'lg:col-span-2' : 'lg:col-span-3'}`}>
              <div className="flex items-start justify-between mb-4">
                <div className="flex-1">
                  <h1 className="mb-2" style={{ fontSize: '1.75rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                    {sensor.name}
                  </h1>
                  <p className="mb-4" style={{ color: 'var(--text-secondary)' }}>
                    {sensor.description}
                  </p>
                  {sensor.location && (
                    <div className="flex items-center gap-1.5 mb-4">
                      <MapPin className="w-4 h-4 text-muted-foreground shrink-0" />
                      <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                        {sensor.location}
                        {sensor.latitude != null && sensor.longitude != null && (
                          <span className="text-xs ml-2" style={{ color: 'var(--text-muted)' }}>
                            ({sensor.latitude.toFixed(4)}, {sensor.longitude.toFixed(4)}
                            {sensor.locationAccuracy != null && ` ±${Math.round(sensor.locationAccuracy)}m`})
                          </span>
                        )}
                      </span>
                    </div>
                  )}
                  <div className="flex items-center gap-2 flex-wrap">
                    {!sensor.thumbnailUrl && (
                      <Badge variant="outline" className="border-border">
                        <div className="flex items-center gap-1.5">
                          <div className={`w-2 h-2 rounded-full ${statusColors[sensor.status]}`}></div>
                          {sensor.status.charAt(0).toUpperCase() + sensor.status.slice(1)}
                        </div>
                      </Badge>
                    )}
                    <Badge variant="outline" className="bg-chart-1/20 text-chart-1 border-chart-1/30">
                      {sensor.type.charAt(0).toUpperCase() + sensor.type.slice(1)}
                    </Badge>
                    <Badge variant="outline" className="bg-primary/10 text-primary border-primary/30">
                      Public
                    </Badge>
                    {sensor.mode === 'real' ? (
                      <Badge variant="outline" className="bg-accent/20 text-accent border-accent/30">
                        Real Data
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="bg-secondary/20 text-secondary border-secondary/30">
                        Mock Data
                      </Badge>
                    )}
                  </div>
                </div>
              </div>

              {/* Metadata Grid */}
              <div className="grid grid-cols-2 md:grid-cols-3 gap-4 p-4 rounded-lg bg-muted/30 border border-border">
                <div>
                  <div className="flex items-center gap-1.5 mb-1">
                    <Calendar className="w-3 h-3 text-muted-foreground" />
                    <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                      Created
                    </span>
                  </div>
                  <p className="text-sm" style={{ fontWeight: 500, color: 'var(--text-primary)' }}>
                    {formatDate(sensor.createdAt)}
                  </p>
                </div>
                <div>
                  <div className="flex items-center gap-1.5 mb-1">
                    <Clock className="w-3 h-3 text-muted-foreground" />
                    <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                      Last Updated
                    </span>
                  </div>
                  <p className="text-sm" style={{ fontWeight: 500, color: 'var(--text-primary)' }}>
                    {formatDate(sensor.updatedAt || sensor.createdAt)}
                  </p>
                </div>
                {sensor.lastReading && (
                  <div>
                    <div className="flex items-center gap-1.5 mb-1">
                      <Activity className="w-3 h-3 text-muted-foreground" />
                      <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                        Latest Reading
                      </span>
                    </div>
                    <p className="text-sm" style={{ fontWeight: 500, color: 'var(--text-primary)' }}>
                      {sensor.lastReading.value} {sensor.lastReading.unit}
                    </p>
                  </div>
                )}
              </div>
            </div>
          </div>
        </Card>

        {/* Real-Time Data Section */}
        <div className="mb-6">
          <div className="flex items-center gap-3 mb-4">
            <TrendingUp className="w-5 h-5 text-primary" />
            <h2 style={{ fontSize: '1.25rem', fontWeight: 600, color: 'var(--text-primary)' }}>
              Real-Time Data Feed
            </h2>
          </div>

          {/* Stream Status */}
          <Card className="p-4 bg-card border-border mb-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className={`w-3 h-3 rounded-full ${isStreaming ? 'bg-success animate-pulse' : 'bg-[#4A4F59]'}`}></div>
                <span style={{ fontWeight: 500, color: 'var(--text-primary)' }}>
                  {isStreaming ? 'Streaming Live Data' : 'Stream Paused'}
                </span>
              </div>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setIsStreaming(!isStreaming)}
                className="border-border"
                disabled={sensor.status !== 'active'}
              >
                {isStreaming ? 'Pause Stream' : 'Resume Stream'}
              </Button>
            </div>
          </Card>

          {/* Chart */}
          <Card className="p-6 bg-card border-border mb-4">
            <h3 className="mb-4" style={{ fontWeight: 600, color: 'var(--text-primary)' }}>
              Live Chart
            </h3>
            <div className="h-80">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                  <XAxis 
                    dataKey="time" 
                    stroke="var(--text-muted)"
                    tick={{ fill: 'var(--text-muted)', fontSize: 12 }}
                  />
                  <YAxis 
                    stroke="var(--text-muted)"
                    tick={{ fill: 'var(--text-muted)', fontSize: 12 }}
                  />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: 'var(--card)',
                      border: '1px solid var(--border)',
                      borderRadius: '8px',
                      color: 'var(--text-primary)',
                    }}
                  />
                  <Line 
                    type="monotone" 
                    dataKey="value" 
                    stroke="var(--chart-1)" 
                    strokeWidth={2}
                    dot={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </Card>

          {/* Recent Readings Table */}
          <Card className="p-6 bg-card border-border">
            <div className="flex items-center justify-between mb-2">
              <h3 style={{ fontWeight: 600, color: 'var(--text-primary)' }}>
                Recent Readings
              </h3>
              <Badge variant="outline" className="bg-primary/10 text-primary border-primary/30">
                <Info className="w-3 h-3 mr-1" />
                Last 1 Hour
              </Badge>
            </div>
            <p className="text-sm mb-4" style={{ color: 'var(--text-muted)' }}>
              Showing readings from the last 1 hour (default system range)
            </p>
            {lastHourReadings.length === 0 && sensor.mode === 'real' ? (
              <div className="py-12 text-center">
                <Clock className="w-12 h-12 text-muted-foreground mx-auto mb-4 opacity-50" />
                <h4 className="mb-2" style={{ fontWeight: 600, color: 'var(--text-primary)' }}>
                  No live data available
                </h4>
                <p style={{ color: 'var(--text-secondary)' }}>
                  Waiting for the device to send readings.
                </p>
                <p className="text-sm mt-2" style={{ color: 'var(--text-muted)' }}>
                  Make sure the physical sensor is powered on and connected.
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-border">
                      <th className="text-left py-3 px-4 text-sm" style={{ fontWeight: 500, color: 'var(--text-secondary)' }}>
                        Timestamp
                      </th>
                      <th className="text-left py-3 px-4 text-sm" style={{ fontWeight: 500, color: 'var(--text-secondary)' }}>
                        Variable
                      </th>
                      <th className="text-left py-3 px-4 text-sm" style={{ fontWeight: 500, color: 'var(--text-secondary)' }}>
                        Value
                      </th>
                      <th className="text-left py-3 px-4 text-sm" style={{ fontWeight: 500, color: 'var(--text-secondary)' }}>
                        Hash
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {lastHourReadings.slice(-10).reverse().map((reading) => (
                      <tr key={reading.id} className="border-b border-border/50">
                        <td className="py-3 px-4 text-sm" style={{ color: 'var(--text-primary)' }}>
                          {reading.timestamp.toLocaleString()}
                        </td>
                        <td className="py-3 px-4 text-sm" style={{ color: 'var(--text-secondary)' }}>
                          {reading.variable}
                        </td>
                        <td className="py-3 px-4 text-sm font-mono" style={{ color: 'var(--text-primary)' }}>
                          {reading.value} {reading.unit}
                        </td>
                        <td className="py-3 px-4">
                          <div className="flex items-center gap-2">
                            <code className="text-xs font-mono px-2 py-1 bg-muted rounded" style={{ color: 'var(--text-secondary)' }}>
                              {reading.hash ? reading.hash.slice(0, 12) + '...' : 'N/A'}
                            </code>
                            {reading.hash && (
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-7 w-7 p-0"
                                onClick={() => copyToClipboard(reading.hash!)}
                              >
                                <Copy className="w-3 h-3" />
                              </Button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* Hash Verification Section */}
            <div className="mt-6 pt-6 border-t border-border space-y-4">
              <h4 style={{ fontWeight: 600, color: 'var(--text-primary)' }}>
                Verify Data Integrity
              </h4>
              
              {/* Single Hash Verification */}
              <div className="space-y-2">
                <Label htmlFor="verify-hash">Single Hash Verification</Label>
                <div className="flex gap-2">
                  <Input
                    id="verify-hash"
                    value={verifyHashInput}
                    onChange={(e) => setVerifyHashInput(e.target.value)}
                    placeholder="Paste reading hash to verify..."
                    className="flex-1 bg-input border-border font-mono text-sm"
                  />
                  <Button
                    onClick={handleVerifyHash}
                    variant="outline"
                    className="border-primary/50 hover:bg-primary/10"
                  >
                    <Shield className="w-4 h-4 mr-2" />
                    Verify Hash
                  </Button>
                </div>
              </div>

              {/* Hourly Data Verification */}
              <div className="space-y-2">
                <Label htmlFor="verify-merkle">Hourly Data Verification</Label>
                <div className="flex gap-2">
                  <Input
                    id="verify-merkle"
                    value={verifyMerkleInput}
                    onChange={(e) => setVerifyMerkleInput(e.target.value)}
                    placeholder="Paste Merkle root to verify last hour..."
                    className="flex-1 bg-input border-border font-mono text-sm"
                  />
                  <Button
                    onClick={handleVerifyMerkle}
                    variant="outline"
                    className="border-primary/50 hover:bg-primary/10"
                  >
                    <Shield className="w-4 h-4 mr-2" />
                    Verify Root
                  </Button>
                </div>
                <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                  Verifies the Merkle root for all {lastHourReadings.length} readings from the last hour
                </p>
              </div>
            </div>
          </Card>
        </div>

        {/* Datasets Section */}
        <div>
          <div className="flex items-center gap-3 mb-4">
            <Database className="w-5 h-5 text-primary" />
            <h2 style={{ fontSize: '1.25rem', fontWeight: 600, color: 'var(--text-primary)' }}>
              Public Datasets ({datasets.length})
            </h2>
          </div>

          {datasets.length === 0 ? (
            <Card className="p-12 bg-card border-border border-dashed text-center">
              <div className="max-w-md mx-auto">
                <Database className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
                <h3 className="mb-2" style={{ fontWeight: 600, color: 'var(--text-primary)' }}>
                  No public datasets yet
                </h3>
                <p style={{ color: 'var(--text-secondary)' }}>
                  This sensor doesn't have any public datasets available for audit yet.
                </p>
              </div>
            </Card>
          ) : (
            <div className="space-y-4">
              {datasets.map((dataset) => (
                <Card key={dataset.id} className="p-6 bg-card border-border hover:border-primary/50 transition-all duration-200">
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-3 mb-2 flex-wrap">
                        <h3 style={{ fontWeight: 600, color: 'var(--text-primary)' }}>
                          {dataset.name}
                        </h3>
                        <Badge variant="outline" className={`${datasetStatusColors[dataset.status]} border`}>
                          {datasetStatusLabels[dataset.status]}
                        </Badge>
                        <Badge variant="outline" className="bg-primary/10 text-primary border-primary/30">
                          Public
                        </Badge>
                      </div>
                      
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
                        <div>
                          <p className="text-xs mb-1" style={{ color: 'var(--text-muted)' }}>
                            Period
                          </p>
                          <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                            {formatDate(dataset.startDate)} - {formatDate(dataset.endDate)}
                          </p>
                        </div>
                        <div>
                          <p className="text-xs mb-1" style={{ color: 'var(--text-muted)' }}>
                            Readings
                          </p>
                          <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                            {dataset.readingsCount.toLocaleString()}
                          </p>
                        </div>
                        {dataset.merkleRoot && (
                          <div className="col-span-2">
                            <p className="text-xs mb-1" style={{ color: 'var(--text-muted)' }}>
                              Merkle Root
                            </p>
                            <code className="text-xs font-mono" style={{ color: 'var(--text-secondary)' }}>
                              {dataset.merkleRoot.slice(0, 16)}...
                            </code>
                          </div>
                        )}
                      </div>

                      {dataset.status === 'anchored' && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => onViewAudit(dataset, sensor)}
                          className="border-border hover:bg-muted"
                        >
                          <Shield className="w-3 h-3 mr-2" />
                          View Public Audit
                          <ExternalLink className="w-3 h-3 ml-2" />
                        </Button>
                      )}
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}