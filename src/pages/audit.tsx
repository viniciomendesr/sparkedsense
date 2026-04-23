import { useState, useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Dataset, Sensor } from '../lib/types';
import { Card } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '../components/ui/dialog';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Copy, Check, CheckCircle2, ExternalLink, Shield, ArrowLeft, Mail, Info, Download, Upload, XCircle, Loader2, ChevronLeft, ChevronRight, Search } from 'lucide-react';
import { publicAPI, datasetAPI } from '../lib/api';
import { useAuth } from '../lib/auth-context';
import { toast } from 'sonner@2.0.3';
import {
  computeMerkleRoot,
  buildMerkleTreeFull,
  generateInclusionProof,
  traceInclusionProof,
  MerkleTreeFull,
} from '../lib/merkle';

type FileVerifyResult =
  | { status: 'ok'; readingsCount: number; computedRoot: string; anchorMatches: boolean }
  | { status: 'mismatch'; readingsCount: number; computedRoot: string; expectedRoot: string }
  | { status: 'error'; message: string };

type SortedReading = {
  id: string;
  timestamp: string;
  value: number;
  unit: string;
  variable: string;
  // Canonical hash derived locally from the raw values — never trust a hash
  // field from the file.
  computedHash: string;
};

type ProofTrace = {
  readingIndex: number;
  reading: SortedReading;
  canonicalString: string;
  leafHash: string;
  steps: Array<{
    step: number;
    left: string;
    right: string;
    result: string;
    siblingFromSide: 'left' | 'right';
  }>;
  finalRoot: string;
  matchesOnchain: boolean;
};

interface AuditPageProps {
  dataset?: Dataset;
  sensor?: Sensor;
  onBack: () => void;
}

export function AuditPage({ dataset: propDataset, sensor: propSensor, onBack }: AuditPageProps) {
  const [searchParams] = useSearchParams();
  const [dataset, setDataset] = useState<Dataset | null>(propDataset || null);
  const [sensor, setSensor] = useState<Sensor | null>(propSensor || null);
  const [loading, setLoading] = useState(false);
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [accessRequestOpen, setAccessRequestOpen] = useState(false);
  const [requestName, setRequestName] = useState('');
  const [requestEmail, setRequestEmail] = useState('');
  const [requestPrice, setRequestPrice] = useState('');
  const [downloading, setDownloading] = useState(false);
  const [verifyingFile, setVerifyingFile] = useState(false);
  const [verifyResult, setVerifyResult] = useState<FileVerifyResult | null>(null);
  const [verifyFileName, setVerifyFileName] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { accessToken } = useAuth();

  // Persisted after a successful file verification — lets the user prove
  // individual readings client-side (no further server calls).
  const [verifiedReadings, setVerifiedReadings] = useState<SortedReading[] | null>(null);
  const [verifiedTree, setVerifiedTree] = useState<MerkleTreeFull | null>(null);
  const [proofPage, setProofPage] = useState(1);
  const [proofSearch, setProofSearch] = useState('');
  const [activeProof, setActiveProof] = useState<ProofTrace | null>(null);
  const [computingProof, setComputingProof] = useState<number | null>(null);
  const PROOF_PAGE_SIZE = 20;

  // Check if we're viewing a public sensor
  const publicSensorId = searchParams.get('sensor');

  useEffect(() => {
    if (publicSensorId && !sensor) {
      loadPublicSensor(publicSensorId);
    }
  }, [publicSensorId]);

  const loadPublicSensor = async (sensorId: string) => {
    try {
      setLoading(true);
      const sensorData = await publicAPI.getPublicSensor(sensorId);
      const datasets = await publicAPI.getPublicDatasets(sensorId);
      
      setSensor(sensorData);
      if (datasets.length > 0) {
        // Show the first anchored dataset or the first dataset
        const anchoredDataset = datasets.find(d => d.status === 'anchored');
        setDataset(anchoredDataset || datasets[0]);
      }
    } catch (error) {
      console.error('Failed to load public sensor:', error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="animate-pulse" style={{ color: 'var(--text-primary)' }}>
          Loading sensor data...
        </div>
      </div>
    );
  }

  if (!dataset || !sensor) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Card className="p-8 text-center">
          <p style={{ color: 'var(--text-primary)' }}>No dataset available for audit</p>
          <Button onClick={onBack} className="mt-4" variant="outline">
            Go Back
          </Button>
        </Card>
      </div>
    );
  }

  const handleCopy = async (text: string, field: string) => {
    try {
      // Try modern clipboard API first
      await navigator.clipboard.writeText(text);
      setCopiedField(field);
      setTimeout(() => setCopiedField(null), 2000);
    } catch (err) {
      // Fallback for environments where Clipboard API is blocked
      try {
        const textArea = document.createElement('textarea');
        textArea.value = text;
        textArea.style.position = 'fixed';
        textArea.style.left = '-999999px';
        textArea.style.top = '-999999px';
        document.body.appendChild(textArea);
        textArea.focus();
        textArea.select();
        const successful = document.execCommand('copy');
        document.body.removeChild(textArea);
        if (successful) {
          setCopiedField(field);
          setTimeout(() => setCopiedField(null), 2000);
        }
      } catch (fallbackErr) {
        console.error('Failed to copy:', fallbackErr);
      }
    }
  };

  const handleDownload = async () => {
    if (!dataset) return;
    setDownloading(true);
    try {
      // Authenticated owner uses the private export; anonymous visitor falls
      // back to the public export (only works when dataset.isPublic === true).
      const payload = accessToken
        ? await datasetAPI.export(dataset.id, accessToken)
        : await publicAPI.exportPublicDataset(dataset.id);

      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${dataset.name.replace(/[^\w\-]+/g, '_')}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast.success(`Dataset exported (${payload.readings?.length ?? 0} readings)`);
    } catch (err: any) {
      console.error('Download failed:', err);
      toast.error(err.message || 'Download failed');
    } finally {
      setDownloading(false);
    }
  };

  // Rebuild the Merkle root locally from an uploaded export and compare it
  // against the root on this page. This is the independent check a data
  // recipient actually wants: "does this file match what was anchored?"
  const handleFileVerify = async (file: File) => {
    if (!dataset?.merkleRoot) {
      toast.error('Dataset is not anchored yet — nothing to verify against');
      return;
    }
    setVerifyingFile(true);
    setVerifyResult(null);
    setVerifyFileName(file.name);
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      const readings: any[] = Array.isArray(parsed?.readings) ? parsed.readings : [];
      if (readings.length === 0) {
        setVerifyResult({ status: 'error', message: 'File has no readings to verify' });
        return;
      }
      // Re-sort by (timestamp, id) so tampered ordering still produces the
      // canonical root the backend anchored.
      const sorted = [...readings].sort((a, b) => {
        const dt = new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime();
        if (dt !== 0) return dt;
        return (a.id || '').localeCompare(b.id || '');
      });
      // Recompute the canonical per-reading hash from the raw values so we
      // don't trust any `hash` field in the file. This is the whole point of
      // verification: hashing the data the user can actually see.
      const sensorId = parsed?.dataset?.sensorId ?? dataset.sensorId;
      const enriched: SortedReading[] = await Promise.all(sorted.map(async (r: any) => {
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
        const computedHash = Array.from(new Uint8Array(buf))
          .map((b) => b.toString(16).padStart(2, '0'))
          .join('');
        return {
          id: r.id,
          timestamp: r.timestamp,
          value: r.value,
          unit: r.unit,
          variable: r.variable,
          computedHash,
        };
      }));
      const hashes = enriched.map((r) => r.computedHash);
      const tree = await buildMerkleTreeFull(hashes);
      const computed = tree.root;
      const matches = computed === dataset.merkleRoot;
      if (matches) {
        const anchorMatches =
          !parsed?.anchor?.merkleRoot || parsed.anchor.merkleRoot === dataset.merkleRoot;
        setVerifyResult({
          status: 'ok',
          readingsCount: readings.length,
          computedRoot: computed,
          anchorMatches,
        });
        // Persist the verified readings + tree so individual-reading proofs
        // can be generated client-side with no more server calls.
        setVerifiedReadings(enriched);
        setVerifiedTree(tree);
        setProofPage(1);
      } else {
        setVerifyResult({
          status: 'mismatch',
          readingsCount: readings.length,
          computedRoot: computed,
          expectedRoot: dataset.merkleRoot,
        });
        setVerifiedReadings(null);
        setVerifiedTree(null);
      }
    } catch (err: any) {
      console.error('File verification failed:', err);
      setVerifyResult({ status: 'error', message: err.message || 'Could not parse file' });
    } finally {
      setVerifyingFile(false);
    }
  };

  const resetFileVerify = () => {
    setVerifyResult(null);
    setVerifyFileName(null);
    setVerifiedReadings(null);
    setVerifiedTree(null);
    setActiveProof(null);
    setProofPage(1);
    setProofSearch('');
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  // Walk a single reading from raw values → leaf hash → up through the
  // inclusion proof → final root → compare to the on-chain anchor. All
  // client-side, deterministic, no server involvement.
  const handleProveReading = async (index: number) => {
    if (!verifiedTree || !verifiedReadings || !dataset?.merkleRoot) return;
    setComputingProof(index);
    try {
      const reading = verifiedReadings[index];
      const sensorId = dataset.sensorId;
      const canonical = JSON.stringify({
        sensorId,
        timestamp: reading.timestamp,
        value: reading.value,
        unit: reading.unit,
      });
      const { leafHash, proof } = generateInclusionProof(verifiedTree, index);
      const steps = await traceInclusionProof(leafHash, proof);
      const finalRoot = steps.length > 0 ? steps[steps.length - 1].result : leafHash;
      setActiveProof({
        readingIndex: index,
        reading,
        canonicalString: canonical,
        leafHash,
        steps,
        finalRoot,
        matchesOnchain: finalRoot === dataset.merkleRoot,
      });
    } catch (err: any) {
      toast.error(err.message || 'Failed to generate proof');
    } finally {
      setComputingProof(null);
    }
  };

  // Filter + paginate the readings table for the "prove one" UI.
  const filteredReadings = (verifiedReadings ?? []).map((r, i) => ({ r, i })).filter(({ r }) => {
    if (!proofSearch.trim()) return true;
    const q = proofSearch.trim().toLowerCase();
    return (
      r.timestamp.toLowerCase().includes(q) ||
      r.computedHash.toLowerCase().includes(q) ||
      String(r.value).toLowerCase().includes(q)
    );
  });
  const totalProofPages = Math.max(1, Math.ceil(filteredReadings.length / PROOF_PAGE_SIZE));
  const pageClamped = Math.min(proofPage, totalProofPages);
  const pageRows = filteredReadings.slice(
    (pageClamped - 1) * PROOF_PAGE_SIZE,
    pageClamped * PROOF_PAGE_SIZE,
  );

  const handleAccessRequest = () => {
    if (!requestName || !requestEmail) {
      toast.error('Please fill in all required fields');
      return;
    }

    // Validate email
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(requestEmail)) {
      toast.error('Please enter a valid email address');
      return;
    }

    // Simulate request submission
    toast.info('Submitting dataset access request...');
    setTimeout(() => {
      toast.success('Request submitted! The data owner will review your request within 24-48 hours.');
      setAccessRequestOpen(false);
      setRequestName('');
      setRequestEmail('');
      setRequestPrice('');
    }, 1500);
  };

  // Helper function to safely format dates
  const formatDate = (date: Date | string) => {
    const dateObj = typeof date === 'string' ? new Date(date) : date;
    return dateObj.toLocaleDateString();
  };

  const metadata = [
    { label: 'Dataset Name', value: dataset.name },
    { label: 'Source Sensor', value: sensor.name },
    { label: 'Sensor Type', value: sensor.type.charAt(0).toUpperCase() + sensor.type.slice(1) },
    { label: 'Time Period', value: `${formatDate(dataset.startDate)} - ${formatDate(dataset.endDate)}` },
    { label: 'Total Readings', value: dataset.readingsCount.toLocaleString() },
    { label: 'Created', value: formatDate(dataset.createdAt) },
  ];

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border bg-card/50 backdrop-blur-sm sticky top-0 z-50">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center">
                <Shield className="w-5 h-5 text-primary-foreground" />
              </div>
              <h1 className="text-lg tracking-tight" style={{ fontWeight: 600, color: 'var(--text-primary)' }}>
                SPARKED SENSE
              </h1>
            </div>
            <Badge variant="outline" className="bg-success/20 text-success border-success/30">
              <CheckCircle2 className="w-3 h-3 mr-1" />
              Public Audit
            </Badge>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <Button
          variant="ghost"
          onClick={onBack}
          className="mb-6 -ml-2 hover:bg-muted"
        >
          <ArrowLeft className="w-4 h-4 mr-2" />
          Back
        </Button>

        {/* Title */}
        <div className="mb-8 text-center">
          <h1 className="mb-3" style={{ fontSize: '2rem', fontWeight: 600, color: 'var(--text-primary)' }}>
            Dataset Verification
          </h1>
          <p style={{ color: 'var(--text-secondary)' }}>
            Public verification page for blockchain-anchored sensor dataset
          </p>
        </div>

        {/* Metadata */}
        <Card className="p-8 bg-card border-border mb-6">
          <h2 className="mb-6 pb-4 border-b border-border" style={{ fontSize: '1.25rem', fontWeight: 600, color: 'var(--text-primary)' }}>
            Dataset Metadata
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {metadata.map((item, index) => (
              <div key={index}>
                <p className="text-sm mb-1" style={{ color: 'var(--text-muted)' }}>
                  {item.label}
                </p>
                <p style={{ fontWeight: 500, color: 'var(--text-primary)' }}>
                  {item.value}
                </p>
              </div>
            ))}
          </div>
        </Card>

        {/* Public Dataset Info */}
        {publicSensorId && (
          <Card className="p-4 bg-primary/5 border-primary/20 mb-6">
            <div className="flex items-start gap-3">
              <Info className="w-5 h-5 text-primary flex-shrink-0 mt-0.5" />
              <div>
                <p style={{ fontSize: '0.875rem', color: 'var(--text-primary)', marginBottom: '4px' }}>
                  <strong>Public Dataset</strong>
                </p>
                <p style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', marginBottom: '8px' }}>
                  You can download the full JSON export and recompute its Merkle root locally. If you need direct access to the owner (for commercial use, licensing, or questions), request it below.
                </p>
                <Button
                  size="sm"
                  onClick={() => setAccessRequestOpen(true)}
                  className="bg-primary text-primary-foreground"
                >
                  <Mail className="w-4 h-4 mr-2" />
                  Request Full Dataset Access
                </Button>
              </div>
            </div>
          </Card>
        )}

        {/* Blockchain Verification */}
        <Card className="p-8 bg-card border-border mb-6">
          <h2 className="mb-6 pb-4 border-b border-border" style={{ fontSize: '1.25rem', fontWeight: 600, color: 'var(--text-primary)' }}>
            Blockchain Verification
          </h2>

          {/* Merkle Root Display */}
          <div className="mb-6">
            <Label className="mb-2 block text-sm" style={{ color: 'var(--text-muted)' }}>
              Dataset Merkle Root
            </Label>
            <div className="flex items-center gap-2">
              <code className="flex-1 font-mono p-3 rounded bg-muted/50 border border-border text-sm break-all" style={{ color: 'var(--text-primary)' }}>
                {dataset.merkleRoot}
              </code>
              <Button
                size="icon"
                variant="outline"
                onClick={() => handleCopy(dataset.merkleRoot || '', 'merkle')}
                className="shrink-0 border-border"
              >
                {copiedField === 'merkle' ? (
                  <Check className="w-4 h-4 text-success" />
                ) : (
                  <Copy className="w-4 h-4" />
                )}
              </Button>
            </div>
          </div>

          {/* View onchain anchor — only when the dataset was actually anchored */}
          {dataset.anchorExplorerUrl ? (
            <div className="mb-6">
              <Button
                variant="outline"
                className="w-full border-primary/50 hover:bg-primary/10"
                onClick={() => window.open(dataset.anchorExplorerUrl, '_blank')}
              >
                View onchain anchor on Solana Explorer
                <ExternalLink className="w-4 h-4 ml-2" />
              </Button>
              <p className="text-xs mt-2" style={{ color: 'var(--text-muted)' }}>
                The dataset's Merkle root is anchored in a memo transaction on Solana {dataset.anchorCluster ?? 'devnet'}. Click to verify the root on a block explorer independent of this platform.
              </p>
            </div>
          ) : (
            <div className="mb-6 p-3 rounded bg-muted/40 border border-border">
              <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                This dataset has not been anchored onchain yet. Click <strong>Anchor</strong> in the sensor's Datasets tab to submit the Merkle root as a memo transaction on Solana.
              </p>
            </div>
          )}

          {/* Download Dataset */}
          <div className="p-4 rounded-lg bg-muted/40 border border-border mb-6">
            <div className="flex items-start gap-3 mb-4">
              <Download className="w-5 h-5 text-primary mt-0.5" />
              <div className="flex-1">
                <h3 className="mb-1" style={{ fontWeight: 600, color: 'var(--text-primary)' }}>
                  Download Dataset
                </h3>
                <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                  Exports every reading in this dataset plus the Merkle root and Solana anchor reference as a self-contained JSON file. Share this file with a buyer so they can verify it matches the on-chain anchor.
                </p>
              </div>
            </div>
            <Button
              onClick={handleDownload}
              disabled={downloading || !dataset.merkleRoot}
              className="w-full bg-primary text-primary-foreground"
            >
              {downloading ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Exporting...
                </>
              ) : (
                <>
                  <Download className="w-4 h-4 mr-2" />
                  Download Dataset (JSON)
                </>
              )}
            </Button>
            {!dataset.merkleRoot && (
              <p className="text-xs mt-2" style={{ color: 'var(--text-muted)' }}>
                Download is available after the dataset is anchored.
              </p>
            )}
          </div>
        </Card>

        {/* Verify Downloaded File */}
        <Card className="p-8 bg-card border-border mb-6">
          <h2 className="mb-2" style={{ fontSize: '1.25rem', fontWeight: 600, color: 'var(--text-primary)' }}>
            Verify a Downloaded File
          </h2>
          <p className="text-sm mb-6" style={{ color: 'var(--text-secondary)' }}>
            Have a copy of this dataset's JSON export? Upload it below. The page will recompute the Merkle root locally from your readings and compare it to the root shown above — if anything in the file was tampered with, the roots will not match.
          </p>

          <input
            ref={fileInputRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleFileVerify(file);
            }}
          />

          {!verifyResult && !verifyingFile && (
            <Button
              variant="outline"
              onClick={() => fileInputRef.current?.click()}
              disabled={!dataset.merkleRoot}
              className="w-full border-primary/50 hover:bg-primary/10"
            >
              <Upload className="w-4 h-4 mr-2" />
              Choose JSON File
            </Button>
          )}

          {verifyingFile && (
            <div className="flex items-center justify-center gap-2 p-6 rounded bg-muted/40 border border-border">
              <Loader2 className="w-4 h-4 animate-spin text-primary" />
              <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                Computing Merkle root from {verifyFileName}...
              </span>
            </div>
          )}

          {verifyResult?.status === 'ok' && (
            <div className="p-4 rounded-lg bg-success/10 border border-success/30">
              <div className="flex items-start gap-3">
                <CheckCircle2 className="w-5 h-5 text-success mt-0.5" />
                <div className="flex-1 min-w-0">
                  <p style={{ fontWeight: 600, color: 'var(--success)' }}>
                    File matches the on-chain anchor
                  </p>
                  <p className="text-sm mt-1" style={{ color: 'var(--text-secondary)' }}>
                    Recomputed Merkle root from {verifyResult.readingsCount.toLocaleString()} readings in <code className="font-mono text-xs">{verifyFileName}</code> is identical to the root anchored on Solana.
                  </p>
                  <code className="block mt-3 p-2 rounded bg-background/60 font-mono text-xs break-all" style={{ color: 'var(--text-primary)' }}>
                    {verifyResult.computedRoot}
                  </code>
                  <Button variant="ghost" size="sm" onClick={resetFileVerify} className="mt-3">
                    Verify another file
                  </Button>
                </div>
              </div>
            </div>
          )}

          {verifyResult?.status === 'mismatch' && (
            <div className="p-4 rounded-lg bg-destructive/10 border border-destructive/30">
              <div className="flex items-start gap-3">
                <XCircle className="w-5 h-5 text-destructive mt-0.5" />
                <div className="flex-1 min-w-0">
                  <p style={{ fontWeight: 600, color: 'var(--destructive)' }}>
                    File does not match the on-chain anchor
                  </p>
                  <p className="text-sm mt-1" style={{ color: 'var(--text-secondary)' }}>
                    The root computed from {verifyResult.readingsCount.toLocaleString()} readings in <code className="font-mono text-xs">{verifyFileName}</code> differs from the anchored root. Either the file was altered, the readings are from a different dataset, or the export is corrupted.
                  </p>
                  <div className="mt-3 space-y-2">
                    <div>
                      <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Computed</p>
                      <code className="block p-2 rounded bg-background/60 font-mono text-xs break-all" style={{ color: 'var(--text-primary)' }}>
                        {verifyResult.computedRoot}
                      </code>
                    </div>
                    <div>
                      <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Expected (anchored)</p>
                      <code className="block p-2 rounded bg-background/60 font-mono text-xs break-all" style={{ color: 'var(--text-primary)' }}>
                        {verifyResult.expectedRoot}
                      </code>
                    </div>
                  </div>
                  <Button variant="ghost" size="sm" onClick={resetFileVerify} className="mt-3">
                    Try a different file
                  </Button>
                </div>
              </div>
            </div>
          )}

          {verifyResult?.status === 'error' && (
            <div className="p-4 rounded-lg bg-destructive/10 border border-destructive/30">
              <div className="flex items-start gap-3">
                <XCircle className="w-5 h-5 text-destructive mt-0.5" />
                <div className="flex-1">
                  <p style={{ fontWeight: 600, color: 'var(--destructive)' }}>
                    Could not read file
                  </p>
                  <p className="text-sm mt-1" style={{ color: 'var(--text-secondary)' }}>
                    {verifyResult.message}
                  </p>
                  <Button variant="ghost" size="sm" onClick={resetFileVerify} className="mt-3">
                    Try again
                  </Button>
                </div>
              </div>
            </div>
          )}
        </Card>

        {/* Individual reading proof */}
        {verifyResult?.status === 'ok' && verifiedReadings && verifiedTree && (
          <Card className="p-8 bg-card border-border mb-6">
            <h2 className="mb-2" style={{ fontSize: '1.25rem', fontWeight: 600, color: 'var(--text-primary)' }}>
              Trace any individual reading to the on-chain root
            </h2>
            <p className="text-sm mb-6" style={{ color: 'var(--text-secondary)' }}>
              The check above proved the <em>whole</em> file matches the anchor. The same math can be shown for any single reading — pick one below and watch its hash walk up the Merkle tree until it lands on the exact root that's in the Solana memo.
            </p>

            <div className="relative mb-4">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={proofSearch}
                onChange={(e) => { setProofSearch(e.target.value); setProofPage(1); }}
                placeholder="Filter by timestamp, value or hash prefix..."
                className="pl-10 bg-input border-border"
              />
            </div>

            <div className="rounded-lg border border-border overflow-hidden mb-4">
              <div className="grid grid-cols-[48px_minmax(0,2fr)_minmax(0,1fr)_minmax(0,2fr)_100px] gap-3 px-4 py-2 bg-muted/40 text-xs uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>
                <div>#</div>
                <div>Timestamp</div>
                <div>Value</div>
                <div>Computed hash</div>
                <div className="text-right">Action</div>
              </div>
              {pageRows.length === 0 && (
                <div className="px-4 py-6 text-center text-sm" style={{ color: 'var(--text-muted)' }}>
                  No readings match that filter.
                </div>
              )}
              {pageRows.map(({ r, i }) => (
                <div
                  key={r.id}
                  className={`grid grid-cols-[48px_minmax(0,2fr)_minmax(0,1fr)_minmax(0,2fr)_100px] gap-3 px-4 py-2 items-center text-sm border-t border-border hover:bg-muted/20 ${activeProof?.readingIndex === i ? 'bg-primary/5' : ''}`}
                >
                  <div className="font-mono text-xs" style={{ color: 'var(--text-muted)' }}>
                    {i + 1}
                  </div>
                  <div className="font-mono text-xs truncate" style={{ color: 'var(--text-primary)' }}>
                    {new Date(r.timestamp).toLocaleString()}
                  </div>
                  <div style={{ color: 'var(--text-primary)' }}>
                    {r.value} {r.unit}
                  </div>
                  <div className="font-mono text-xs truncate" style={{ color: 'var(--text-secondary)' }} title={r.computedHash}>
                    {r.computedHash.slice(0, 16)}…
                  </div>
                  <div className="flex justify-end">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleProveReading(i)}
                      disabled={computingProof !== null}
                      className="h-8 px-3 border-primary/40 text-primary hover:bg-primary/10"
                    >
                      {computingProof === i ? (
                        <>
                          <Loader2 className="w-3 h-3 mr-1.5 animate-spin" />
                          Proving
                        </>
                      ) : activeProof?.readingIndex === i ? (
                        <>
                          <Check className="w-3 h-3 mr-1.5" />
                          Proven
                        </>
                      ) : (
                        <>
                          <Shield className="w-3 h-3 mr-1.5" />
                          Prove
                        </>
                      )}
                    </Button>
                  </div>
                </div>
              ))}
            </div>

            <div className="flex items-center justify-between text-sm">
              <span style={{ color: 'var(--text-muted)' }}>
                {filteredReadings.length.toLocaleString()} reading{filteredReadings.length === 1 ? '' : 's'} — page {pageClamped} of {totalProofPages}
              </span>
              <div className="flex gap-1">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setProofPage((p) => Math.max(1, p - 1))}
                  disabled={pageClamped <= 1}
                  className="border-border"
                >
                  <ChevronLeft className="w-4 h-4" />
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setProofPage((p) => Math.min(totalProofPages, p + 1))}
                  disabled={pageClamped >= totalProofPages}
                  className="border-border"
                >
                  <ChevronRight className="w-4 h-4" />
                </Button>
              </div>
            </div>

            {activeProof && (
              <div className="mt-6 rounded-lg bg-background/40 border border-primary/30 overflow-hidden">
                {/* Header */}
                <div className="px-5 py-4 bg-primary/5 border-b border-primary/20 flex items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <Shield className="w-4 h-4 text-primary" />
                      <h3 style={{ fontWeight: 600, color: 'var(--text-primary)' }}>
                        Proof for reading #{activeProof.readingIndex + 1}
                      </h3>
                    </div>
                    <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
                      {new Date(activeProof.reading.timestamp).toLocaleString()} · {activeProof.reading.value} {activeProof.reading.unit}
                    </p>
                  </div>
                  <Button size="sm" variant="ghost" onClick={() => setActiveProof(null)}>
                    <XCircle className="w-4 h-4 mr-1.5" />
                    Close
                  </Button>
                </div>

                <div className="p-5 space-y-6">
                  {/* Step 1 — raw */}
                  <div>
                    <div className="flex items-center gap-2 mb-2">
                      <div className="w-6 h-6 rounded-full bg-primary/20 text-primary flex items-center justify-center text-xs" style={{ fontWeight: 600 }}>1</div>
                      <p className="text-sm" style={{ fontWeight: 600, color: 'var(--text-primary)' }}>
                        The raw values you can see in the file
                      </p>
                    </div>
                    <div className="ml-8 p-4 rounded bg-background/60 border border-border text-xs font-mono space-y-1" style={{ color: 'var(--text-primary)' }}>
                      <div className="flex gap-3"><span className="w-20 shrink-0" style={{ color: 'var(--text-muted)' }}>sensorId</span><span className="break-all">{dataset?.sensorId}</span></div>
                      <div className="flex gap-3"><span className="w-20 shrink-0" style={{ color: 'var(--text-muted)' }}>timestamp</span><span>{activeProof.reading.timestamp}</span></div>
                      <div className="flex gap-3"><span className="w-20 shrink-0" style={{ color: 'var(--text-muted)' }}>value</span><span>{activeProof.reading.value}</span></div>
                      <div className="flex gap-3"><span className="w-20 shrink-0" style={{ color: 'var(--text-muted)' }}>unit</span><span>{activeProof.reading.unit}</span></div>
                    </div>
                  </div>

                  {/* Step 2 — canonical hash */}
                  <div>
                    <div className="flex items-center gap-2 mb-2">
                      <div className="w-6 h-6 rounded-full bg-primary/20 text-primary flex items-center justify-center text-xs" style={{ fontWeight: 600 }}>2</div>
                      <p className="text-sm" style={{ fontWeight: 600, color: 'var(--text-primary)' }}>
                        Canonical JSON → SHA-256 (the reading hash)
                      </p>
                    </div>
                    <div className="ml-8 space-y-2">
                      <div>
                        <p className="text-xs mb-1" style={{ color: 'var(--text-muted)' }}>Canonical string</p>
                        <pre className="text-xs font-mono p-3 rounded bg-background/60 border border-border break-all whitespace-pre-wrap" style={{ color: 'var(--text-secondary)' }}>
{activeProof.canonicalString}
                        </pre>
                      </div>
                      <div>
                        <p className="text-xs mb-1" style={{ color: 'var(--text-muted)' }}>Reading hash = sha256(canonical)</p>
                        <code className="block p-3 rounded bg-background/60 border border-border text-xs font-mono break-all" style={{ color: 'var(--text-primary)' }}>
                          {activeProof.reading.computedHash}
                        </code>
                      </div>
                      <div>
                        <p className="text-xs mb-1" style={{ color: 'var(--text-muted)' }}>Leaf (domain-separated) = sha256(readingHashHex)</p>
                        <code className="block p-3 rounded bg-background/60 border border-border text-xs font-mono break-all" style={{ color: 'var(--text-primary)' }}>
                          {activeProof.leafHash}
                        </code>
                      </div>
                    </div>
                  </div>

                  {/* Step 3 — walk the tree */}
                  <div>
                    <div className="flex items-center gap-2 mb-2">
                      <div className="w-6 h-6 rounded-full bg-primary/20 text-primary flex items-center justify-center text-xs" style={{ fontWeight: 600 }}>3</div>
                      <p className="text-sm" style={{ fontWeight: 600, color: 'var(--text-primary)' }}>
                        Walk {activeProof.steps.length} layer{activeProof.steps.length === 1 ? '' : 's'} up to the root
                      </p>
                    </div>
                    <div className="ml-8 space-y-3">
                      {activeProof.steps.map((s) => (
                        <div key={s.step} className="rounded bg-background/60 border border-border overflow-hidden">
                          <div className="px-3 py-1.5 text-xs bg-muted/30 border-b border-border flex justify-between" style={{ color: 'var(--text-muted)' }}>
                            <span>Layer {s.step}</span>
                            <span>sibling from the <strong style={{ color: 'var(--text-primary)' }}>{s.siblingFromSide}</strong></span>
                          </div>
                          <div className="p-3 text-xs font-mono space-y-1" style={{ color: 'var(--text-secondary)' }}>
                            <div className="flex gap-2">
                              <span className="w-4 shrink-0" style={{ color: 'var(--text-muted)' }}>L</span>
                              <span className="break-all">{s.left}</span>
                            </div>
                            <div className="flex gap-2">
                              <span className="w-4 shrink-0" style={{ color: 'var(--text-muted)' }}>R</span>
                              <span className="break-all">{s.right}</span>
                            </div>
                            <div className="flex gap-2 pt-1 border-t border-border mt-1" style={{ color: 'var(--text-primary)' }}>
                              <span className="w-4 shrink-0" style={{ color: 'var(--text-muted)' }}>→</span>
                              <span className="break-all">sha256(L‖R) = {s.result}</span>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Step 4 — match on-chain */}
                  <div>
                    <div className="flex items-center gap-2 mb-2">
                      <div className="w-6 h-6 rounded-full bg-primary/20 text-primary flex items-center justify-center text-xs" style={{ fontWeight: 600 }}>4</div>
                      <p className="text-sm" style={{ fontWeight: 600, color: 'var(--text-primary)' }}>
                        Compare with the root anchored on Solana
                      </p>
                    </div>
                    <div className={`ml-8 p-4 rounded-lg border ${activeProof.matchesOnchain ? 'bg-success/10 border-success/30' : 'bg-destructive/10 border-destructive/30'}`}>
                      <div className="flex items-start gap-3 mb-3">
                        {activeProof.matchesOnchain ? (
                          <CheckCircle2 className="w-5 h-5 text-success mt-0.5 shrink-0" />
                        ) : (
                          <XCircle className="w-5 h-5 text-destructive mt-0.5 shrink-0" />
                        )}
                        <p style={{ fontWeight: 600, color: activeProof.matchesOnchain ? 'var(--success)' : 'var(--destructive)' }}>
                          {activeProof.matchesOnchain
                            ? 'This reading is cryptographically committed to the on-chain anchor'
                            : 'Final root does not match the on-chain anchor'}
                        </p>
                      </div>
                      <div className="space-y-2">
                        <div>
                          <p className="text-xs mb-1" style={{ color: 'var(--text-muted)' }}>Computed (from walking the proof)</p>
                          <code className="block p-3 rounded bg-background/60 border border-border font-mono text-xs break-all" style={{ color: 'var(--text-primary)' }}>
                            {activeProof.finalRoot}
                          </code>
                        </div>
                        <div>
                          <p className="text-xs mb-1" style={{ color: 'var(--text-muted)' }}>Anchored on Solana</p>
                          <code className="block p-3 rounded bg-background/60 border border-border font-mono text-xs break-all" style={{ color: 'var(--text-primary)' }}>
                            {dataset?.merkleRoot}
                          </code>
                        </div>
                      </div>
                      {dataset?.anchorExplorerUrl && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => window.open(dataset.anchorExplorerUrl, '_blank')}
                          className="mt-3 border-border w-full sm:w-auto"
                        >
                          Cross-check on Solana Explorer
                          <ExternalLink className="w-3 h-3 ml-2" />
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            )}
          </Card>
        )}

        {/* How to Verify */}
        <Card className="p-6 bg-muted/30 border-border">
          <h3 className="mb-3" style={{ fontWeight: 600, color: 'var(--text-primary)' }}>
            How to verify without trusting this page
          </h3>
          <ol className="text-sm space-y-2" style={{ color: 'var(--text-secondary)' }}>
            <li>1. Download the dataset JSON above (or use one shared with you).</li>
            <li>2. Open the Solana Explorer link — read the memo transaction. It contains the anchored Merkle root.</li>
            <li>3. For each reading, compute <code className="font-mono text-xs">hash = sha256(JSON.stringify(&#123;sensorId, timestamp, value, unit&#125;))</code> — this is the canonical hash, you derive it from the raw values you can see in the file.</li>
            <li>4. Sort readings ascending by timestamp, then by id as tiebreaker.</li>
            <li>5. Build a binary Merkle tree: leaf = sha256(readingHashHex), pair siblings and hash left+right, duplicate last node on odd layers.</li>
            <li>6. The resulting root must equal the memo value on-chain. If it does, the file is provably the exact data that was anchored — and nothing you downloaded was tampered with.</li>
          </ol>
        </Card>
      </div>

      {/* Footer */}
      <footer className="border-t border-border bg-card/30 mt-12">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          <div className="text-center">
            <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
              Powered by <span className="text-primary">Sparked Sense</span> — An open infrastructure for verifiable physical data
            </p>
          </div>
        </div>
      </footer>

      {/* Dataset Access Request Modal */}
      <Dialog open={accessRequestOpen} onOpenChange={setAccessRequestOpen}>
        <DialogContent className="bg-card border-border max-w-md">
          <DialogHeader>
            <DialogTitle style={{ color: 'var(--text-primary)' }}>
              Request Full Dataset Access
            </DialogTitle>
            <DialogDescription style={{ color: 'var(--text-secondary)' }}>
              Submit a request to access the complete dataset. The data owner will manually review your request and respond within 24-48 hours.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 mt-4">
            <div className="space-y-2">
              <Label htmlFor="request-name">
                Full Name <span className="text-destructive">*</span>
              </Label>
              <Input
                id="request-name"
                value={requestName}
                onChange={(e) => setRequestName(e.target.value)}
                placeholder="Enter your full name"
                className="bg-input border-border"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="request-email">
                Email Address <span className="text-destructive">*</span>
              </Label>
              <Input
                id="request-email"
                type="email"
                value={requestEmail}
                onChange={(e) => setRequestEmail(e.target.value)}
                placeholder="your.email@example.com"
                className="bg-input border-border"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="request-price">
                Offer or Proposed Price (Optional)
              </Label>
              <Input
                id="request-price"
                type="number"
                value={requestPrice}
                onChange={(e) => setRequestPrice(e.target.value)}
                placeholder="Enter amount in USD"
                className="bg-input border-border"
              />
              <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                Optional: Propose a price if you're willing to pay for access
              </p>
            </div>
          </div>

          <div className="flex gap-3 mt-6">
            <Button
              variant="outline"
              onClick={() => setAccessRequestOpen(false)}
              className="flex-1 border-border"
            >
              Cancel
            </Button>
            <Button
              onClick={handleAccessRequest}
              className="flex-1 bg-primary text-primary-foreground"
            >
              Submit Request
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Label({ children, className, ...props }: React.ComponentProps<'label'>) {
  return (
    <label className={className} {...props}>
      {children}
    </label>
  );
}
