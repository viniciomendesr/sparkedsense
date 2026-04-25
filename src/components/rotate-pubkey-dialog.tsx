import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from './ui/dialog';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Loader2, KeyRound, AlertCircle } from 'lucide-react';
import { Sensor } from '../lib/types';
import { sensorAPI } from '../lib/api';
import { useAuth } from '../lib/auth-context';
import { toast } from 'sonner@2.0.3';

interface RotatePubkeyDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sensor: Sensor;
  onRotated: (updated: Sensor) => void;
}

// ADR-014/ADR-016: triggered when firmware acquires real signing capability and
// the registered pubkey on the backend needs to catch up. The existing NFT
// identity, claim token, and historical readings remain — only the bound key
// changes (and a `pubkeyRotatedAt` timestamp is recorded for audit).
export function RotatePubkeyDialog({ open, onOpenChange, sensor, onRotated }: RotatePubkeyDialogProps) {
  const { accessToken } = useAuth();
  const [newPublicKey, setNewPublicKey] = useState('');
  const [newMacAddress, setNewMacAddress] = useState('');
  const [pubkeyError, setPubkeyError] = useState('');
  const [macError, setMacError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const validatePubkey = (key: string): boolean => {
    // 64 = compressed (no 02/03), 66 = compressed w/prefix,
    // 128 = uncompressed (no 04), 130 = uncompressed w/prefix.
    return /^[0-9a-fA-F]+$/.test(key) && [64, 66, 128, 130].includes(key.length);
  };

  const validateMac = (mac: string): boolean => {
    return /^([0-9A-Fa-f]{2}[:-]){5}([0-9A-Fa-f]{2})$/.test(mac);
  };

  const handlePubkeyChange = (value: string) => {
    setNewPublicKey(value.trim());
    if (value && !validatePubkey(value.trim())) {
      setPubkeyError('Hex string with length 64, 66, 128, or 130');
    } else {
      setPubkeyError('');
    }
  };

  const handleMacChange = (value: string) => {
    setNewMacAddress(value.trim());
    if (value && !validateMac(value.trim())) {
      setMacError('Format: AA:BB:CC:DD:EE:FF');
    } else {
      setMacError('');
    }
  };

  const handleSubmit = async () => {
    if (!accessToken) {
      toast.error('Not authenticated');
      return;
    }
    if (!validatePubkey(newPublicKey)) {
      setPubkeyError('Invalid hex pubkey');
      return;
    }
    if (newMacAddress && !validateMac(newMacAddress)) {
      setMacError('Invalid MAC format');
      return;
    }

    setSubmitting(true);
    try {
      const updated = await sensorAPI.rotatePubkey(
        sensor.id,
        { newPublicKey, ...(newMacAddress ? { newMacAddress } : {}) },
        accessToken,
      );
      onRotated(updated);
      toast.success('Device key rotated', {
        description: `Now bound to ${newPublicKey.substring(0, 16)}…`,
      });
      onOpenChange(false);
    } catch (err: any) {
      console.error('Rotate failed:', err);
      toast.error(err?.message || 'Rotation failed');
    } finally {
      setSubmitting(false);
    }
  };

  const handleClose = () => {
    if (submitting) return;
    setNewPublicKey('');
    setNewMacAddress('');
    setPubkeyError('');
    setMacError('');
    onOpenChange(false);
  };

  const currentPub = sensor.devicePublicKey || '(not set)';

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <KeyRound className="w-5 h-5 text-warning" />
            Rotate Device Key
          </DialogTitle>
          <DialogDescription>
            Replace the public key bound to this sensor while keeping the NFT identity, claim token, and historical readings. Use this when the firmware just acquired real signing capability and needs the platform to recognize its new key.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 mt-2">
          <div className="p-3 rounded-lg bg-muted/50 border border-border">
            <Label className="text-xs text-muted-foreground mb-1 block">Current pubkey</Label>
            <code className="text-xs font-mono break-all" style={{ color: 'var(--text-secondary)' }}>
              {currentPub}
            </code>
          </div>

          <div className="space-y-2">
            <Label htmlFor="new-pubkey">New device public key (hex)</Label>
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
              secp256k1 pubkey the firmware will sign with. 64/66 hex chars (compressed) or 128/130 (uncompressed). Read it from the Serial monitor of the freshly-flashed device.
            </p>
            <Input
              id="new-pubkey"
              value={newPublicKey}
              onChange={(e) => handlePubkeyChange(e.target.value)}
              placeholder="04a1b2c3...deadbeef"
              className={`font-mono text-xs ${pubkeyError ? 'border-error' : ''}`}
              disabled={submitting}
            />
            {pubkeyError && (
              <p className="text-sm" style={{ color: 'var(--error)' }}>
                {pubkeyError}
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="new-mac" className="text-xs text-muted-foreground">
              New MAC address (optional — only if hardware also changed)
            </Label>
            <Input
              id="new-mac"
              value={newMacAddress}
              onChange={(e) => handleMacChange(e.target.value)}
              placeholder="AA:BB:CC:DD:EE:FF"
              className={macError ? 'border-error' : ''}
              disabled={submitting}
            />
            {macError && (
              <p className="text-sm" style={{ color: 'var(--error)' }}>
                {macError}
              </p>
            )}
          </div>

          <div className="p-3 rounded-lg bg-warning/10 border border-warning/30">
            <div className="flex items-start gap-2">
              <AlertCircle className="w-4 h-4 text-warning shrink-0 mt-0.5" />
              <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                Past readings keep their original signature and the old pubkey at envelope time. Auditors will see a <code>pubkeyRotatedAt</code> timestamp on the sensor — events before that point belong to a separate trust epoch.
              </p>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="ghost"
            onClick={handleClose}
            disabled={submitting}
          >
            Cancel
          </Button>
          <Button
            type="button"
            onClick={handleSubmit}
            disabled={submitting || !newPublicKey || !!pubkeyError || !!macError}
          >
            {submitting && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
            Rotate Key
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
