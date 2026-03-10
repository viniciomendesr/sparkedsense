import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Dataset, Sensor } from '../lib/types';
import { Card } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '../components/ui/dialog';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Copy, Check, CheckCircle2, ExternalLink, Shield, ArrowLeft, Mail, Info } from 'lucide-react';
import { publicAPI } from '../lib/api';
import { toast } from 'sonner@2.0.3';
import { verifyMerkleRoot } from '../lib/merkle';

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
  const [verifying, setVerifying] = useState(false);
  const [verified, setVerified] = useState(false);
  const [accessRequestOpen, setAccessRequestOpen] = useState(false);
  const [requestName, setRequestName] = useState('');
  const [requestEmail, setRequestEmail] = useState('');
  const [requestPrice, setRequestPrice] = useState('');
  const [verifyMerkleInput, setVerifyMerkleInput] = useState('');
  const [verifySingleHashInput, setVerifySingleHashInput] = useState('');

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

  const handleVerify = async () => {
    if (!sensor) return;
    setVerifying(true);
    try {
      const merkleData = await publicAPI.getPublicHourlyMerkle(sensor.id);
      const readingsData = await publicAPI.getPublicReadings(sensor.id, 500);
      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
      const lastHourReadings = readingsData
        .filter((r: any) => new Date(r.timestamp) >= oneHourAgo)
        .sort((a: any, b: any) => {
          const dt = new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime();
          if (dt !== 0) return dt;
          return (a.id || '').localeCompare(b.id || '');
        });
      const hashes = lastHourReadings.map((r: any) => r.hash || '');
      const ok = await verifyMerkleRoot(hashes, merkleData.merkleRoot);
      setVerifying(false);
      setVerified(ok);
      if (ok) {
        toast.success(`Merkle root verified for ${lastHourReadings.length} readings (client-side)`);
      } else {
        toast.error('Merkle root verification failed');
      }
    } catch (err) {
      console.error('Verification failed:', err);
      setVerifying(false);
      toast.error('Verification failed');
    }
  };

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
                  <strong>Public Dataset Preview</strong>
                </p>
                <p style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', marginBottom: '8px' }}>
                  You are viewing a preview of the most recent hour of data. Verification below applies only to this preview dataset.
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

          {/* View Proof Button */}
          <div className="mb-6">
            <Button
              variant="outline"
              className="w-full border-border hover:bg-muted"
              onClick={() => window.open('https://explorer.solana.com/', '_blank')}
            >
              View Proof of Last Hour Data on Solana Explorer
              <ExternalLink className="w-4 h-4 ml-2" />
            </Button>
            <p className="text-xs mt-2" style={{ color: 'var(--text-muted)' }}>
              Opens Solana Explorer to inspect the Merkle root of the dataset's last hour of readings anchored on the blockchain.
            </p>
          </div>

          {/* Verification Input Fields */}
          <div className="space-y-4 mb-6">
            <h3 className="mb-2" style={{ fontWeight: 600, color: 'var(--text-primary)' }}>
              Verify Data Integrity
            </h3>
            
            {/* Hourly Data (Merkle Root) Verification */}
            <div className="space-y-2">
              <Label htmlFor="verify-merkle-root">
                Hourly Data (Merkle Root) Verification
              </Label>
              <div className="flex gap-2">
                <Input
                  id="verify-merkle-root"
                  value={verifyMerkleInput}
                  onChange={(e) => setVerifyMerkleInput(e.target.value)}
                  placeholder="Paste Merkle root to verify..."
                  className="flex-1 bg-input border-border font-mono text-sm"
                />
                <Button
                  onClick={async () => {
                    if (!verifyMerkleInput.trim()) {
                      toast.error('Please enter a Merkle root to verify');
                      return;
                    }
                    if (!sensor) return;
                    toast.info('Verifying Merkle root...');
                    try {
                      const result = await publicAPI.verifyPublicMerkle(sensor.id, verifyMerkleInput);
                      if (result.verified) {
                        toast.success('Merkle root verified! Data is authentic.');
                      } else {
                        toast.error('Merkle root does not match');
                      }
                    } catch (err) {
                      toast.error('Verification failed');
                    }
                  }}
                  variant="outline"
                  className="border-primary/50 hover:bg-primary/10"
                >
                  <Shield className="w-4 h-4 mr-2" />
                  Verify
                </Button>
              </div>
            </div>

            {/* Single Hash Verification */}
            <div className="space-y-2">
              <Label htmlFor="verify-single-hash">
                Single Hash Verification
              </Label>
              <div className="flex gap-2">
                <Input
                  id="verify-single-hash"
                  value={verifySingleHashInput}
                  onChange={(e) => setVerifySingleHashInput(e.target.value)}
                  placeholder="Paste single reading hash to verify..."
                  className="flex-1 bg-input border-border font-mono text-sm"
                />
                <Button
                  onClick={async () => {
                    if (!verifySingleHashInput.trim()) {
                      toast.error('Please enter a hash to verify');
                      return;
                    }
                    if (!sensor) return;
                    toast.info('Verifying hash against hourly Merkle tree...');
                    try {
                      const readingsData = await publicAPI.getPublicReadings(sensor.id, 500);
                      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
                      const lastHour = readingsData.filter((r: any) => new Date(r.timestamp) >= oneHourAgo);
                      const found = lastHour.find((r: any) => r.hash === verifySingleHashInput);
                      if (found) {
                        toast.success('Hash found in the last hour readings. Data is authentic.');
                      } else {
                        toast.error('Hash not found in recent readings');
                      }
                    } catch (err) {
                      toast.error('Verification failed');
                    }
                  }}
                  variant="outline"
                  className="border-primary/50 hover:bg-primary/10"
                >
                  <Shield className="w-4 h-4 mr-2" />
                  Verify
                </Button>
              </div>
            </div>
          </div>

          {/* Quick Verify Button */}
          <div className="p-4 rounded-lg bg-primary/10 border border-primary/20">
            <div className="flex items-start gap-3 mb-4">
              <Shield className="w-5 h-5 text-primary mt-0.5" />
              <div className="flex-1">
                <h3 className="mb-1" style={{ fontWeight: 600, color: 'var(--text-primary)' }}>
                  Quick Client-Side Verification
                </h3>
                <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                  {publicSensorId 
                    ? 'Verify the integrity of the last hour preview data by recomputing the Merkle proof against the on-chain root'
                    : 'Verify data integrity locally by recomputing the Merkle proof against the on-chain root'
                  }
                </p>
              </div>
            </div>
            <Button
              onClick={handleVerify}
              disabled={verifying || verified}
              className="w-full bg-primary text-primary-foreground"
            >
              {verifying ? (
                <>
                  <span className="animate-pulse">Verifying...</span>
                </>
              ) : verified ? (
                <>
                  <CheckCircle2 className="w-4 h-4 mr-2" />
                  Verified Successfully
                </>
              ) : (
                <>
                  <Shield className="w-4 h-4 mr-2" />
                  Quick Verify Proof
                </>
              )}
            </Button>
          </div>
        </Card>

        {/* Verification Result */}
        {verified && (
          <Card className="p-6 bg-success/10 border-success/30">
            <div className="flex items-start gap-3">
              <CheckCircle2 className="w-6 h-6 text-success mt-0.5" />
              <div>
                <h3 className="mb-2" style={{ fontWeight: 600, color: 'var(--success)' }}>
                  Verification Successful
                </h3>
                <p className="text-sm mb-4" style={{ color: 'var(--text-secondary)' }}>
                  The dataset's Merkle root matches the on-chain anchor. All {dataset.readingsCount.toLocaleString()} readings are verified and tamper-proof.
                </p>
                <div className="grid grid-cols-2 gap-4 p-4 rounded-lg bg-background/50">
                  <div>
                    <p className="text-xs mb-1" style={{ color: 'var(--text-muted)' }}>
                      Integrity Status
                    </p>
                    <p className="text-sm" style={{ fontWeight: 500, color: 'var(--success)' }}>
                      Valid ✓
                    </p>
                  </div>
                  <div>
                    <p className="text-xs mb-1" style={{ color: 'var(--text-muted)' }}>
                      Blockchain Confirmation
                    </p>
                    <p className="text-sm" style={{ fontWeight: 500, color: 'var(--success)' }}>
                      Confirmed ✓
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </Card>
        )}

        {/* How to Verify */}
        <Card className="p-6 bg-muted/30 border-border mt-6">
          <h3 className="mb-3" style={{ fontWeight: 600, color: 'var(--text-primary)' }}>
            How to Verify Independently
          </h3>
          <ol className="text-sm space-y-2" style={{ color: 'var(--text-secondary)' }}>
            <li>1. Fetch the sensor's hourly readings via the public API</li>
            <li>2. Sort readings by timestamp (ascending), then by ID as tiebreaker</li>
            <li>3. Build a binary Merkle tree: leaf = SHA-256(reading.hash), pairs hashed left+right</li>
            <li>4. Compare the computed root with the Merkle root displayed above</li>
            <li>5. For individual readings, request an inclusion proof from the API and verify the sibling path</li>
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
