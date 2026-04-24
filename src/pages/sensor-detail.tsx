import { useState, useEffect } from 'react';
import { Sensor, Reading, Dataset } from '../lib/types';
import { Card } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '../components/ui/dialog';
import { 
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '../components/ui/alert-dialog';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Switch } from '../components/ui/switch';
import { generateHistoricalReadings, generateLiveReading } from '../lib/mock-data';
import { 
  ArrowLeft, 
  Activity, 
  Pause, 
  Play, 
  CheckCircle2, 
  AlertCircle,
  Clock,
  Database,
  ExternalLink,
  Plus,
  Copy,
  Shield,
  Info,
  Trash2,
  Loader2,
  Settings,
  Eye,
  MapPin,
  Pencil,
  RefreshCw,
  Download
} from 'lucide-react';
import { SensorChart } from '../components/sensor-chart';
import { useAuth } from '../lib/auth-context';
import { readingAPI, datasetAPI, merkleAPI, sensorAPI } from '../lib/api';
import { supabase } from '../utils/supabase/client';
import { toast } from 'sonner@2.0.3';
import { verifyMerkleRoot, computeMerkleRoot } from '../lib/merkle';
import { formatDataSize } from '../lib/format';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { EditSensorDialog } from '../components/edit-sensor-dialog';

interface SensorDetailPageProps {
  sensor: Sensor;
  onBack: () => void;
  onViewAudit: (dataset: Dataset, sensor: Sensor) => void;
}

export function SensorDetailPage({ 
  sensor, 
  onBack, 
  onViewAudit
}: SensorDetailPageProps) {
  const { accessToken, user } = useAuth();
  const [isStreaming, setIsStreaming] = useState(true);
  const [readings, setReadings] = useState<Reading[]>([]);
  const [historicalReadings, setHistoricalReadings] = useState<Reading[]>([]);
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [createDatasetOpen, setCreateDatasetOpen] = useState(false);
  const [datasetName, setDatasetName] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [isPublicDataset, setIsPublicDataset] = useState(false);
  const [loading, setLoading] = useState(true);
  const [verifyHashInput, setVerifyHashInput] = useState('');
  const [verifyMerkleInput, setVerifyMerkleInput] = useState('');
  const [hourlyMerkleRoot, setHourlyMerkleRoot] = useState('');
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [datasetToDelete, setDatasetToDelete] = useState<Dataset | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteSensorDialogOpen, setDeleteSensorDialogOpen] = useState(false);
  const [isDeletingSensor, setIsDeletingSensor] = useState(false);
  const [sensorVisibility, setSensorVisibility] = useState(sensor.visibility);
  const [editSensorDialogOpen, setEditSensorDialogOpen] = useState(false);
  const [sensorName, setSensorName] = useState(sensor.name);
  const [sensorDescription, setSensorDescription] = useState(sensor.description);
  const [sensorLocation, setSensorLocation] = useState(sensor.location);
  const [isRefreshingLocation, setIsRefreshingLocation] = useState(false);

  const handleRefreshLocation = async () => {
    if (!accessToken || isRefreshingLocation) return;
    try {
      setIsRefreshingLocation(true);
      const updated = await sensorAPI.refreshLocation(sensor.id, accessToken);
      setSensorLocation(updated.location);
      toast.success('Location refreshed');
    } catch (error: any) {
      console.error('Failed to refresh location:', error);
      toast.error(error.message || 'Failed to refresh location');
    } finally {
      setIsRefreshingLocation(false);
    }
  };

  // Load initial data in two waves:
  //  Wave 1 (blocks TTI): last 100 readings + datasets + merkle root.
  //  Wave 2 (deferred via requestIdleCallback): 25k slim historical readings.
  // Each fetch is independent — one failing must not wipe the others.
  useEffect(() => {
    if (!accessToken) return;

    let cancelled = false;

    const parseReadings = (rows: Reading[]) =>
      rows.map((r) => ({ ...r, timestamp: new Date(r.timestamp) }));
    const parseDatasets = (rows: Dataset[]) =>
      rows.map((d) => ({
        ...d,
        startDate: new Date(d.startDate),
        endDate: new Date(d.endDate),
        createdAt: new Date(d.createdAt),
      }));
    const fallback = sensor.mode === 'mock'
      ? generateHistoricalReadings(sensor.id, sensor.type, 60)
      : [];

    const loadCritical = async () => {
      setLoading(true);
      const [readingsRes, datasetsRes, merkleRes] = await Promise.allSettled([
        readingAPI.list(sensor.id, accessToken, 100),
        datasetAPI.list(sensor.id, accessToken),
        merkleAPI.getHourlyRoot(sensor.id, accessToken),
      ]);
      if (cancelled) return;

      if (readingsRes.status === 'fulfilled') {
        const parsed = parseReadings(readingsRes.value);
        setReadings(parsed.length > 0 ? parsed : (sensor.mode === 'real' ? [] : fallback));
      } else {
        console.error('Failed to load readings:', readingsRes.reason);
        setReadings(sensor.mode === 'real' ? [] : fallback);
      }

      if (datasetsRes.status === 'fulfilled') {
        setDatasets(parseDatasets(datasetsRes.value));
      } else {
        console.error('Failed to load datasets:', datasetsRes.reason);
      }

      if (merkleRes.status === 'fulfilled') {
        setHourlyMerkleRoot(merkleRes.value.merkleRoot || '');
      }

      setLoading(false);
    };

    const loadHistorical = async () => {
      try {
        // Slim payload — only timestamp/value/unit, no hash/signature. LTTB in
        // the chart downsamples further for rendering; we still fetch all rows
        // so Min/Max/Avg stats reflect the true dataset.
        const rows = await readingAPI.list(sensor.id, accessToken, 25000, { slim: true });
        if (cancelled) return;
        // Skip Date parsing on this path — SensorChart handles string timestamps.
        setHistoricalReadings(rows.length > 0 ? rows : (sensor.mode === 'real' ? [] : fallback));
      } catch (err) {
        console.error('Failed to load historical readings:', err);
      }
    };

    loadCritical();

    // Defer the heavy 25k fetch until the browser is idle, with a 1500ms
    // fallback so the chart doesn't stay empty on always-busy main threads.
    const idle = (window as any).requestIdleCallback as
      | ((cb: () => void, opts?: { timeout?: number }) => number)
      | undefined;
    let idleId: number | undefined;
    let fallbackId: number | undefined;
    if (idle) {
      idleId = idle(() => loadHistorical(), { timeout: 1500 });
    } else {
      fallbackId = window.setTimeout(() => loadHistorical(), 200);
    }

    return () => {
      cancelled = true;
      if (idleId && (window as any).cancelIdleCallback) (window as any).cancelIdleCallback(idleId);
      if (fallbackId) clearTimeout(fallbackId);
    };
  }, [sensor.id, sensor.type, sensor.mode, accessToken]);

  // Simulate live streaming for MOCK sensors only.
  // ADR-012: `unsigned_dev` publishes real events from physical firmware and
  // must never be fed synthetic readings — use the polling branch below instead.
  useEffect(() => {
    if (!isStreaming || sensor.status !== 'active' || sensor.mode !== 'mock') return;

    const interval = setInterval(() => {
      setReadings(prev => {
        const lastReading = prev[prev.length - 1];
        const newReading = generateLiveReading(sensor.id, sensor.type, lastReading?.value);
        return [...prev.slice(-59), newReading];
      });
    }, 2000);

    return () => clearInterval(interval);
  }, [isStreaming, sensor.id, sensor.type, sensor.status, sensor.mode]);

  // Poll real sensor data from API every 15 seconds.
  // ADR-012: `unsigned_dev` sensors publish real events (with the signature
  // bypass marker) and must be polled just like `real` — both read from the
  // canonical `readings` table server-side.
  useEffect(() => {
    if (!isStreaming || sensor.mode === 'mock' || !accessToken) return;

    const pollReadings = async () => {
      try {
        const readingsData = await readingAPI.list(sensor.id, accessToken, 100);
        const parsedReadings = readingsData.map(r => ({
          ...r,
          timestamp: new Date(r.timestamp),
        }));
        if (parsedReadings.length > 0) {
          setReadings(parsedReadings);
        }
        // Also refresh merkle root
        const merkleData = await merkleAPI.getHourlyRoot(sensor.id, accessToken).catch(() => ({ merkleRoot: '', leaves: [] }));
        if (merkleData.merkleRoot) {
          setHourlyMerkleRoot(merkleData.merkleRoot);
  
        }
      } catch (error) {
        console.error('Failed to poll readings:', error);
      }
    };

    // Poll immediately, then every 15 seconds
    pollReadings();
    const interval = setInterval(pollReadings, 15000);
    return () => clearInterval(interval);
  }, [isStreaming, sensor.id, sensor.mode, accessToken]);

  // Real-time subscription for dataset updates
  useEffect(() => {
    if (!user) return;

    const channel = supabase
      .channel('dataset-changes')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'kv_store_4a89e1c9',
          filter: `key=like.dataset:${sensor.id}:%`,
        },
        () => {
          // Reload datasets when changes detected
          if (accessToken) {
            datasetAPI.list(sensor.id, accessToken).then(datasetsData => {
              const parsedDatasets = datasetsData.map(d => ({
                ...d,
                startDate: new Date(d.startDate),
                endDate: new Date(d.endDate),
                createdAt: new Date(d.createdAt),
              }));
              setDatasets(parsedDatasets);
            });
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user, sensor.id, accessToken]);

  const handleCreateDataset = async () => {
    if (!accessToken || !datasetName || !startDate || !endDate) return;

    try {
      const dataset = await datasetAPI.create({
        name: datasetName,
        sensorId: sensor.id,
        startDate: new Date(startDate),
        endDate: new Date(endDate),
        isPublic: isPublicDataset,
      }, accessToken);

      const parsedDataset = {
        ...dataset,
        startDate: new Date(dataset.startDate),
        endDate: new Date(dataset.endDate),
        createdAt: new Date(dataset.createdAt),
      };

      setDatasets(prev => [...prev, parsedDataset]);
      setCreateDatasetOpen(false);
      setDatasetName('');
      setStartDate('');
      setEndDate('');
      setIsPublicDataset(false);

      toast.success('Dataset created', {
        description: 'Click "Anchor to Solana" on the dataset card to publish the Merkle root onchain.',
      });
    } catch (error: any) {
      console.error('Failed to create dataset:', error);
      toast.error('Failed to create dataset');
    }
  };

  // Compute the Merkle root in the browser by pulling the dataset's export
  // and recomputing canonical per-reading hashes from raw values. This offloads
  // tens of thousands of SHA-256 ops away from the edge function, which hits
  // WORKER_RESOURCE_LIMIT on the free tier past ~5k readings.
  const computeAnchorInputs = async (datasetId: string) => {
    const payload = await datasetAPI.export(datasetId, accessToken!);
    const readings = payload.readings ?? [];
    const sorted = [...readings].sort((a: any, b: any) => {
      const dt = new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime();
      if (dt !== 0) return dt;
      return (a.id || '').localeCompare(b.id || '');
    });
    const sensorId = payload.dataset?.sensorId ?? sensor.id;
    const hashes = await Promise.all(sorted.map(async (r: any) => {
      const canonical = JSON.stringify({
        sensorId,
        timestamp: r.timestamp,
        value: r.value,
        unit: r.unit,
      });
      const buf = await globalThis.crypto.subtle.digest(
        'SHA-256',
        new TextEncoder().encode(canonical),
      );
      return Array.from(new Uint8Array(buf))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
    }));
    const merkleRoot = await computeMerkleRoot(hashes);
    return { merkleRoot, readingsCount: sorted.length };
  };

  const handleAnchorDataset = async (dataset: Dataset, isReanchor = false) => {
    if (!accessToken) return;
    const verb = isReanchor ? 'Re-anchoring' : 'Anchoring';
    setDatasets(prev => prev.map(d => d.id === dataset.id ? { ...d, status: 'anchoring' } : d));
    toast.info(`${verb} on Solana...`, { description: 'Computing root locally + signing tx, ~5–20 seconds.' });
    try {
      const { merkleRoot, readingsCount } = await computeAnchorInputs(dataset.id);
      const updated = await datasetAPI.anchor(dataset.id, accessToken, { merkleRoot, readingsCount });
      const parsed: Dataset = {
        ...updated,
        startDate: new Date(updated.startDate),
        endDate: new Date(updated.endDate),
        createdAt: new Date(updated.createdAt),
      };
      setDatasets(prev => prev.map(d => d.id === dataset.id ? parsed : d));
      if (parsed.anchorExplorerUrl) {
        toast.success(isReanchor ? 'Re-anchored on Solana' : 'Anchored on Solana', {
          description: 'Click "View onchain anchor" to verify.',
        });
      } else {
        toast.warning('Dataset marked anchored (fallback)', {
          description: 'Solana tx unavailable — simulated anchor used. Retry to get a real onchain signature.',
        });
      }
    } catch (error: any) {
      console.error('Anchor failed:', error);
      setDatasets(prev => prev.map(d => d.id === dataset.id ? { ...d, status: 'failed' } : d));
      toast.error(`${verb.replace('ing', '').toLowerCase()} failed`, {
        description: error.message || 'You can retry from the dataset card.',
      });
    }
  };

  const handleDownloadDataset = async (dataset: Dataset) => {
    if (!accessToken) return;
    try {
      const payload = await datasetAPI.export(dataset.id, accessToken);
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${dataset.name.replace(/[^\w\-]+/g, '_')}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast.success(`Exported ${payload.readings?.length ?? 0} readings`);
    } catch (err: any) {
      console.error('Download failed:', err);
      toast.error(err.message || 'Download failed');
    }
  };

  const handleDeleteDataset = async () => {
    if (!accessToken || !datasetToDelete) return;

    try {
      setIsDeleting(true);
      await datasetAPI.delete(datasetToDelete.id, accessToken);
      
      // Remove from local state
      setDatasets(prev => prev.filter(d => d.id !== datasetToDelete.id));
      
      toast.success('Dataset successfully deleted');
      setDeleteDialogOpen(false);
      setDatasetToDelete(null);
    } catch (error: any) {
      console.error('Failed to delete dataset:', error);
      toast.error(error.message || 'Failed to delete dataset');
    } finally {
      setIsDeleting(false);
    }
  };

  const openDeleteDialog = (dataset: Dataset) => {
    setDatasetToDelete(dataset);
    setDeleteDialogOpen(true);
  };

  const handleDeleteSensor = async () => {
    if (!accessToken) return;

    try {
      setIsDeletingSensor(true);
      await sensorAPI.delete(sensor.id, accessToken);
      
      toast.success('Sensor successfully deleted');
      setDeleteSensorDialogOpen(false);
      
      // Redirect back to dashboard
      setTimeout(() => {
        onBack();
      }, 500);
    } catch (error: any) {
      console.error('Failed to delete sensor:', error);
      toast.error(error.message || 'Failed to delete sensor');
    } finally {
      setIsDeletingSensor(false);
    }
  };

  const handleVisibilityChange = async (newVisibility: string) => {
    if (!accessToken) return;

    try {
      await sensorAPI.update(sensor.id, { visibility: newVisibility as 'public' | 'private' | 'partial' }, accessToken);
      setSensorVisibility(newVisibility as 'public' | 'private' | 'partial');
      toast.success('Sensor visibility updated successfully');
    } catch (error: any) {
      console.error('Failed to update sensor visibility:', error);
      toast.error(error.message || 'Failed to update visibility');
    }
  };

  // Filter readings to last hour
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
  const lastHourReadings = readings.filter(r => r.timestamp >= oneHourAgo);

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
    // Simulate verification
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
    inactive: 'bg-[var(--text-disabled)]',
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
          Back to Dashboard
        </Button>

        <div className="flex items-start justify-between">
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-2">
              <h1 style={{ fontSize: '1.75rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                {sensorName}
              </h1>
              <Button
                variant="ghost"
                size="sm"
                className="h-8 w-8 p-0 text-muted-foreground hover:text-foreground"
                onClick={() => setEditSensorDialogOpen(true)}
                aria-label="Edit sensor"
                title="Edit sensor"
              >
                <Pencil className="w-4 h-4" />
              </Button>
            </div>
            <p className="mb-3" style={{ color: 'var(--text-secondary)' }}>
              {sensorDescription}
            </p>
            {sensorLocation && (
              <div className="flex items-center gap-1.5 mb-3">
                <MapPin className="w-4 h-4 text-muted-foreground shrink-0" />
                <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                  {sensorLocation}
                  {sensor.latitude != null && sensor.longitude != null && (
                    <span className="text-xs ml-2" style={{ color: 'var(--text-muted)' }}>
                      ({sensor.latitude.toFixed(4)}, {sensor.longitude.toFixed(4)}
                      {sensor.locationAccuracy != null && ` ±${Math.round(sensor.locationAccuracy)}m`})
                    </span>
                  )}
                </span>
                {sensor.latitude != null && sensor.longitude != null && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 w-6 p-0 text-muted-foreground hover:text-foreground"
                    onClick={handleRefreshLocation}
                    disabled={isRefreshingLocation}
                    aria-label="Refresh location"
                    title="Refresh location"
                  >
                    <RefreshCw className={`w-3 h-3 ${isRefreshingLocation ? 'animate-spin' : ''}`} />
                  </Button>
                )}
              </div>
            )}
            {(sensor.totalReadingsCount ?? 0) > 0 && (
              <div className="flex items-center gap-4 mb-3 text-sm" style={{ color: 'var(--text-secondary)' }}>
                <div className="flex items-center gap-1.5">
                  <Database className="w-4 h-4 text-muted-foreground shrink-0" />
                  <span>{(sensor.totalReadingsCount ?? 0).toLocaleString()} readings processed</span>
                </div>
                {(sensor.totalDataBytes ?? 0) > 0 && (
                  <div className="flex items-center gap-1.5">
                    <Database className="w-4 h-4 text-muted-foreground shrink-0" />
                    <span>{formatDataSize(sensor.totalDataBytes ?? 0)} stored</span>
                  </div>
                )}
              </div>
            )}
            <div className="flex items-center gap-2 mb-3">
              <Badge variant="outline" className="border-border">
                <div className="flex items-center gap-1.5">
                  <div className={`w-2 h-2 rounded-full ${statusColors[sensor.status]}`}></div>
                  {sensor.status.charAt(0).toUpperCase() + sensor.status.slice(1)}
                </div>
              </Badge>
              <Badge variant="outline" className="bg-chart-1/20 text-chart-1 border-chart-1/30">
                {sensor.type.charAt(0).toUpperCase() + sensor.type.slice(1)}
              </Badge>
            </div>
            {/* Device identity NFT minting is deferred (see ADR-007 partial in
                Phase 15 — only dataset anchoring is onchain today). The per-
                dataset "View onchain anchor" button in the Datasets tab links
                to the actual Solana transaction. */}
          </div>
          
          {sensor.lastReading && (
            <Card className="p-4 bg-card border-border min-w-[200px]">
              <p className="text-sm mb-1" style={{ color: 'var(--text-muted)' }}>
                Latest Reading
              </p>
              <p className="text-2xl mb-1" style={{ fontWeight: 600, color: 'var(--text-primary)' }}>
                {sensor.lastReading.value} {sensor.lastReading.unit}
              </p>
              <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                {new Date(sensor.lastReading.timestamp).toLocaleString()}
              </p>
            </Card>
          )}
        </div>
      </div>

      {/* Sensor Settings */}
      <Card className="p-4 bg-card border-border mb-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-6">
            <div className="flex items-center gap-3">
              <Settings className="w-4 h-4 text-muted-foreground" />
              <span style={{ fontWeight: 500, color: 'var(--text-primary)' }}>
                Sensor Settings
              </span>
            </div>
            
            <div className="flex items-center gap-2">
              <Eye className="w-4 h-4 text-muted-foreground" />
              <Label htmlFor="visibility" className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                Visibility:
              </Label>
              <Select value={sensorVisibility} onValueChange={handleVisibilityChange}>
                <SelectTrigger className="w-[140px] h-8">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="public">Public</SelectItem>
                  <SelectItem value="private">Private</SelectItem>
                  <SelectItem value="partial">Partial</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <Button
            variant="outline"
            size="sm"
            onClick={() => setDeleteSensorDialogOpen(true)}
            className="border-destructive/50 text-destructive hover:bg-destructive/10"
          >
            <Trash2 className="w-4 h-4 mr-2" />
            Delete Sensor
          </Button>
        </div>
      </Card>

      {/* Tabs */}
      <Tabs defaultValue="live" className="space-y-6">
        <TabsList className="bg-muted/50 border border-border">
          <TabsTrigger value="live" className="data-[state=active]:bg-card">
            <Activity className="w-4 h-4 mr-2" />
            Live Stream
          </TabsTrigger>
          <TabsTrigger value="datasets" className="data-[state=active]:bg-card">
            <Database className="w-4 h-4 mr-2" />
            Datasets ({datasets.length})
          </TabsTrigger>
        </TabsList>

        {/* Live Stream Tab */}
        <TabsContent value="live" className="space-y-6">
          {/* Stream Controls */}
          <Card className="p-4 bg-card border-border">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className={`w-3 h-3 rounded-full ${isStreaming ? 'bg-success animate-pulse' : 'bg-[var(--text-disabled)]'}`}></div>
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
                {isStreaming ? (
                  <>
                    <Pause className="w-4 h-4 mr-2" />
                    Pause Stream
                  </>
                ) : (
                  <>
                    <Play className="w-4 h-4 mr-2" />
                    Resume Stream
                  </>
                )}
              </Button>
            </div>
          </Card>

          {/* Live Data */}
          <SensorChart
            readings={readings}
            mode="live"
            title="Live Data"
            unit={readings[0]?.unit || sensor.lastReading?.unit || ''}
          />

          {/* Historical Data Feed */}
          <div className="flex items-center gap-3 pt-2">
            <Clock className="w-5 h-5 text-primary" />
            <h2 style={{ fontSize: '1.25rem', fontWeight: 600, color: 'var(--text-primary)' }}>
              Historical Data Feed
            </h2>
          </div>
          <SensorChart
            readings={historicalReadings}
            mode="historical"
            title="Historical Data"
            unit={historicalReadings[0]?.unit || sensor.lastReading?.unit || ''}
          />

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
            <p className="text-sm mb-2" style={{ color: 'var(--text-muted)' }}>
              Showing readings from the last 1 hour (default system range)
            </p>
            {hourlyMerkleRoot && (
              <div className="flex items-start gap-2 mb-4 p-3 bg-muted/50 rounded-lg border border-border">
                <Shield className="w-4 h-4 text-primary flex-shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0">
                  <p className="text-xs mb-1" style={{ color: 'var(--text-muted)' }}>
                    Hourly Merkle Root
                    <span className="ml-1.5" style={{ color: 'var(--text-muted)' }}>
                      — computed now; anchor a dataset to commit this range onchain
                    </span>
                  </p>
                  <code className="text-xs font-mono block truncate" style={{ color: 'var(--text-secondary)' }}>
                    {hourlyMerkleRoot}
                  </code>
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-8 px-2 flex-shrink-0"
                  onClick={() => copyToClipboard(hourlyMerkleRoot)}
                  title="Copy root"
                >
                  <Copy className="w-3 h-3" />
                </Button>
              </div>
            )}
            {lastHourReadings.length === 0 && sensor.mode === 'real' ? (
              <div className="py-12 text-center">
                <Clock className="w-12 h-12 text-muted-foreground mx-auto mb-4 opacity-50" />
                <h4 className="mb-2" style={{ fontWeight: 600, color: 'var(--text-primary)' }}>
                  No readings yet
                </h4>
                <p style={{ color: 'var(--text-secondary)' }}>
                  Waiting for live data from your connected device.
                </p>
                <p className="text-sm mt-2" style={{ color: 'var(--text-muted)' }}>
                  Make sure your physical sensor is powered on and connected to WiFi.
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

            {/* Data integrity is now proven via the Solana anchor on each
                dataset (Datasets tab — each anchored dataset links to the
                transaction on Solana Explorer). Paste-your-own-hash panel
                removed — see ADR-007 UX rework. */}
          </Card>
        </TabsContent>

        {/* Datasets Tab */}
        <TabsContent value="datasets" className="space-y-6">
          {/* Info Banner */}
          <Card className="p-4 bg-primary/5 border-primary/20">
            <div className="flex items-start gap-3">
              <Info className="w-5 h-5 text-primary flex-shrink-0 mt-0.5" />
              <div>
                <p style={{ fontSize: '0.875rem', color: 'var(--text-primary)', marginBottom: '4px' }}>
                  <strong>Dataset Creation Rules</strong>
                </p>
                <p style={{ fontSize: '0.875rem', color: 'var(--text-secondary)' }}>
                  Only data generated within Sparked Sense can be grouped into datasets. External datasets are not yet supported.
                </p>
              </div>
            </div>
          </Card>

          <div className="flex items-center justify-between">
            <p style={{ color: 'var(--text-secondary)' }}>
              Group readings into datasets and anchor them on Solana for permanent verification
            </p>
            <Button
              onClick={() => setCreateDatasetOpen(true)}
              className="bg-primary text-primary-foreground"
            >
              <Plus className="w-4 h-4 mr-2" />
              Create Dataset
            </Button>
          </div>

          {datasets.length === 0 ? (
            <Card className="p-12 bg-card border-border border-dashed text-center">
              <div className="max-w-md mx-auto">
                <Database className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
                <h3 className="mb-2" style={{ fontWeight: 600, color: 'var(--text-primary)' }}>
                  No datasets yet
                </h3>
                <p className="mb-6" style={{ color: 'var(--text-secondary)' }}>
                  Create a dataset to group readings and anchor them on the blockchain
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
                        {dataset.isPublic && (
                          <Badge variant="outline" className="bg-primary/10 text-primary border-primary/30">
                            Public
                          </Badge>
                        )}
                      </div>
                      
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
                        <div>
                          <p className="text-xs mb-1" style={{ color: 'var(--text-muted)' }}>
                            Period
                          </p>
                          <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                            {dataset.startDate.toLocaleDateString()} - {dataset.endDate.toLocaleDateString()}
                          </p>
                        </div>
                        <div>
                          <p className="text-xs mb-1" style={{ color: 'var(--text-muted)' }}>
                            Total Accesses
                          </p>
                          <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                            {dataset.accessCount?.toLocaleString() || 0}
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

                      <div className="flex items-center gap-2 flex-wrap">
                        {(dataset.status === 'preparing' || dataset.status === 'failed') && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleAnchorDataset(dataset)}
                            className="border-primary/50 text-primary hover:bg-primary/10"
                          >
                            <Shield className="w-3 h-3 mr-2" />
                            {dataset.status === 'failed' ? 'Retry anchor' : 'Anchor to Solana'}
                          </Button>
                        )}

                        {dataset.status === 'anchoring' && (
                          <Button variant="outline" size="sm" disabled className="border-border">
                            <Loader2 className="w-3 h-3 mr-2 animate-spin" />
                            Anchoring...
                          </Button>
                        )}

                        {dataset.status === 'anchored' && (
                          <>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => onViewAudit(dataset, sensor)}
                              className="border-border hover:bg-muted"
                            >
                              {dataset.isPublic ? 'View Public Audit' : 'View Audit'}
                              <ExternalLink className="w-3 h-3 ml-2" />
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => handleDownloadDataset(dataset)}
                              className="border-border hover:bg-muted"
                            >
                              <Download className="w-3 h-3 mr-2" />
                              Download
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => handleAnchorDataset(dataset, true)}
                              className="border-secondary/50 text-secondary hover:bg-secondary/10"
                              title="Submit a new Solana memo tx with the current Merkle root"
                            >
                              <RefreshCw className="w-3 h-3 mr-2" />
                              Re-anchor
                            </Button>
                          </>
                        )}

                        {dataset.anchorExplorerUrl && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => window.open(dataset.anchorExplorerUrl, '_blank')}
                            className="border-secondary/50 hover:bg-secondary/10"
                            title={`Anchored on Solana ${dataset.anchorCluster ?? 'devnet'}`}
                          >
                            <Shield className="w-3 h-3 mr-2" />
                            View onchain anchor
                            <ExternalLink className="w-3 h-3 ml-2" />
                          </Button>
                        )}

                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => openDeleteDialog(dataset)}
                          className="border-destructive/50 text-destructive hover:bg-destructive/10"
                        >
                          <Trash2 className="w-3 h-3 mr-2" />
                          Delete
                        </Button>
                        
                        <div className="flex items-center gap-2 ml-auto">
                          <span className="text-sm" style={{ color: 'var(--text-muted)' }}>
                            {dataset.isPublic ? 'Public' : 'Private'}
                          </span>
                          <Switch
                            checked={dataset.isPublic}
                            onCheckedChange={async (checked) => {
                              if (!accessToken) return;
                              try {
                                await datasetAPI.update(dataset.id, { isPublic: checked }, accessToken);
                                setDatasets(prev => prev.map(d => 
                                  d.id === dataset.id ? { ...d, isPublic: checked } : d
                                ));
                                toast.success(checked ? 'Dataset is now public' : 'Dataset is now private');
                              } catch (error) {
                                console.error('Failed to update dataset visibility:', error);
                                toast.error('Failed to update dataset visibility');
                              }
                            }}
                          />
                        </div>
                      </div>
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>

      {/* Create Dataset Dialog */}
      <Dialog open={createDatasetOpen} onOpenChange={setCreateDatasetOpen}>
        <DialogContent className="bg-card border-border">
          <DialogHeader>
            <DialogTitle style={{ color: 'var(--text-primary)' }}>Create Dataset</DialogTitle>
            <DialogDescription style={{ color: 'var(--text-secondary)' }}>
              Group readings from a specific time period into a dataset for blockchain anchoring
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 mt-4">
            <div className="space-y-2">
              <Label htmlFor="dataset-name">Dataset Name</Label>
              <Input
                id="dataset-name"
                value={datasetName}
                onChange={(e) => setDatasetName(e.target.value)}
                placeholder="Temperature Dataset - Week 3"
                className="bg-input border-border"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="start-date">Start Date</Label>
                <Input
                  id="start-date"
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className="bg-input border-border"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="end-date">End Date</Label>
                <Input
                  id="end-date"
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  className="bg-input border-border"
                />
              </div>
            </div>

            <div className="flex items-center justify-between p-4 rounded-lg bg-muted/30 border border-border">
              <div className="flex-1">
                <Label htmlFor="public-dataset" className="cursor-pointer">
                  Make Dataset Public
                </Label>
                <p style={{ fontSize: '0.875rem', color: 'var(--text-muted)', marginTop: '4px' }}>
                  Public datasets appear in the public sensors collection and can be audited by anyone. You can change this setting later.
                </p>
              </div>
              <Switch
                id="public-dataset"
                checked={isPublicDataset}
                onCheckedChange={setIsPublicDataset}
              />
            </div>

            <div className="flex gap-3 pt-4">
              <Button
                variant="outline"
                onClick={() => setCreateDatasetOpen(false)}
                className="flex-1 border-border"
              >
                Cancel
              </Button>
              <Button
                onClick={handleCreateDataset}
                disabled={!datasetName || !startDate || !endDate}
                className="flex-1 bg-primary text-primary-foreground"
              >
                Create Dataset
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Delete Dataset Confirmation Dialog */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent className="bg-card border-border">
          <AlertDialogHeader>
            <AlertDialogTitle style={{ color: 'var(--text-primary)' }}>
              Delete Dataset
            </AlertDialogTitle>
            <AlertDialogDescription style={{ color: 'var(--text-secondary)' }}>
              Are you sure you want to delete this dataset? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {datasetToDelete && (
            <div className="mt-2 p-3 bg-muted/50 rounded-lg border border-border">
              <p className="text-sm" style={{ color: 'var(--text-primary)', fontWeight: 500 }}>
                {datasetToDelete.name}
              </p>
              <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
                {datasetToDelete.readingsCount.toLocaleString()} readings • {datasetToDelete.startDate.toLocaleDateString()} - {datasetToDelete.endDate.toLocaleDateString()}
              </p>
            </div>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel 
              disabled={isDeleting}
              className="border-border"
            >
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteDataset}
              disabled={isDeleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isDeleting ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Deleting...
                </>
              ) : (
                <>
                  <Trash2 className="w-4 h-4 mr-2" />
                  Delete Dataset
                </>
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete Sensor Confirmation Dialog */}
      <AlertDialog open={deleteSensorDialogOpen} onOpenChange={setDeleteSensorDialogOpen}>
        <AlertDialogContent className="bg-card border-border">
          <AlertDialogHeader>
            <AlertDialogTitle style={{ color: 'var(--text-primary)' }}>
              Delete Sensor
            </AlertDialogTitle>
            <AlertDialogDescription style={{ color: 'var(--text-secondary)' }}>
              Are you sure you want to delete this sensor? All associated datasets and readings will also be removed. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="mt-2 p-3 bg-destructive/10 rounded-lg border border-destructive/30">
            <p className="text-sm" style={{ color: 'var(--text-primary)', fontWeight: 500 }}>
              {sensor.name}
            </p>
            <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
              {datasets.length} dataset(s) • {readings.length} reading(s)
            </p>
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel 
              disabled={isDeletingSensor}
              className="border-border"
            >
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteSensor}
              disabled={isDeletingSensor}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isDeletingSensor ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Deleting...
                </>
              ) : (
                <>
                  <Trash2 className="w-4 h-4 mr-2" />
                  Delete Sensor
                </>
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Edit Sensor Dialog */}
      <EditSensorDialog
        open={editSensorDialogOpen}
        onOpenChange={setEditSensorDialogOpen}
        sensor={{ ...sensor, name: sensorName, description: sensorDescription }}
        onSaved={(updated) => {
          setSensorName(updated.name);
          setSensorDescription(updated.description);
        }}
      />
    </div>
  );
}