import { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from './ui/dialog';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Textarea } from './ui/textarea';
import { Loader2, MapPin } from 'lucide-react';
import { Sensor } from '../lib/types';
import { sensorAPI } from '../lib/api';
import { useAuth } from '../lib/auth-context';
import { toast } from 'sonner@2.0.3';

const NAME_MAX = 80;
const DESCRIPTION_MAX = 500;
const LOCATION_MAX = 120;

interface EditSensorDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sensor: Sensor;
  onSaved: (updated: Sensor) => void;
}

export function EditSensorDialog({ open, onOpenChange, sensor, onSaved }: EditSensorDialogProps) {
  const { accessToken } = useAuth();
  const [name, setName] = useState(sensor.name);
  const [description, setDescription] = useState(sensor.description ?? '');
  const [location, setLocation] = useState(sensor.location ?? '');
  const [latitude, setLatitude] = useState(sensor.latitude?.toString() ?? '');
  const [longitude, setLongitude] = useState(sensor.longitude?.toString() ?? '');
  const [nameError, setNameError] = useState('');
  const [coordsError, setCoordsError] = useState('');
  const [saving, setSaving] = useState(false);

  // ADR-014: unverified sensors accept user-supplied location until mint.
  // `real` sensors receive location from signed firmware; `mock` are virtual.
  const canEditLocation = sensor.mode === 'unverified';

  useEffect(() => {
    if (open) {
      setName(sensor.name);
      setDescription(sensor.description ?? '');
      setLocation(sensor.location ?? '');
      setLatitude(sensor.latitude?.toString() ?? '');
      setLongitude(sensor.longitude?.toString() ?? '');
      setNameError('');
      setCoordsError('');
    }
  }, [open, sensor.name, sensor.description, sensor.location, sensor.latitude, sensor.longitude]);

  const trimmedName = name.trim();
  const trimmedDescription = description.trim();
  const trimmedLocation = location.trim();
  const trimmedLat = latitude.trim();
  const trimmedLng = longitude.trim();

  const nameChanged = trimmedName !== sensor.name;
  const descriptionChanged = trimmedDescription !== (sensor.description ?? '');
  const locationChanged = canEditLocation && trimmedLocation !== (sensor.location ?? '');
  const latChanged =
    canEditLocation && trimmedLat !== (sensor.latitude?.toString() ?? '');
  const lngChanged =
    canEditLocation && trimmedLng !== (sensor.longitude?.toString() ?? '');
  const hasChanges =
    nameChanged || descriptionChanged || locationChanged || latChanged || lngChanged;

  const parseCoord = (raw: string): number | null | 'invalid' => {
    if (raw === '') return null; // user cleared the field
    const n = Number(raw);
    if (!Number.isFinite(n)) return 'invalid';
    return n;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!trimmedName) {
      setNameError('Name is required');
      return;
    }
    if (trimmedName.length > NAME_MAX) {
      setNameError(`Name must be ${NAME_MAX} characters or fewer`);
      return;
    }
    if (trimmedDescription.length > DESCRIPTION_MAX) {
      return;
    }
    if (!accessToken) {
      toast.error('Not authenticated');
      return;
    }
    if (!hasChanges) {
      onOpenChange(false);
      return;
    }

    const payload: Partial<Sensor> = {
      name: trimmedName,
      description: trimmedDescription,
    };

    if (canEditLocation) {
      const lat = parseCoord(trimmedLat);
      const lng = parseCoord(trimmedLng);
      if (lat === 'invalid' || lng === 'invalid') {
        setCoordsError('Latitude and longitude must be numbers.');
        return;
      }
      if (typeof lat === 'number' && (lat < -90 || lat > 90)) {
        setCoordsError('Latitude must be between -90 and 90.');
        return;
      }
      if (typeof lng === 'number' && (lng < -180 || lng > 180)) {
        setCoordsError('Longitude must be between -180 and 180.');
        return;
      }
      setCoordsError('');

      // Only send fields the user actually touched so we don't overwrite
      // a previously-stored value with a blank one by accident.
      if (locationChanged) (payload as any).location = trimmedLocation;
      if (latChanged) (payload as any).latitude = lat;
      if (lngChanged) (payload as any).longitude = lng;
    }

    try {
      setSaving(true);
      const updated = await sensorAPI.update(sensor.id, payload, accessToken);
      onSaved(updated);
      toast.success('Sensor updated');
      onOpenChange(false);
    } catch (error: any) {
      console.error('Failed to update sensor:', error);
      toast.error(error.message || 'Failed to update sensor');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!saving) onOpenChange(next); }}>
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle>Edit sensor</DialogTitle>
          <DialogDescription>
            {canEditLocation
              ? 'Update title, description, and location. Location is editable here because this sensor has not been minted yet (ADR-014). After minting, location becomes firmware-attested and read-only.'
              : 'Update the title and description of your sensor.'}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="edit-sensor-name">Name</Label>
            <Input
              id="edit-sensor-name"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                if (nameError) setNameError('');
              }}
              maxLength={NAME_MAX}
              autoFocus
              disabled={saving}
            />
            {nameError && (
              <p className="text-sm text-destructive">{nameError}</p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="edit-sensor-description">Description</Label>
            <Textarea
              id="edit-sensor-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={DESCRIPTION_MAX}
              rows={4}
              disabled={saving}
            />
            <p className="text-xs text-muted-foreground text-right">
              {description.length}/{DESCRIPTION_MAX}
            </p>
          </div>

          {canEditLocation && (
            <div className="space-y-4 pt-2 border-t border-border">
              <div className="flex items-center gap-2">
                <MapPin className="w-4 h-4 text-warning" />
                <Label className="m-0">Location</Label>
              </div>

              <div className="space-y-2">
                <Label htmlFor="edit-sensor-location" className="text-xs text-muted-foreground">
                  Display text (e.g., "Shopping Center Claro — SP")
                </Label>
                <Input
                  id="edit-sensor-location"
                  value={location}
                  onChange={(e) => {
                    setLocation(e.target.value);
                    if (coordsError) setCoordsError('');
                  }}
                  maxLength={LOCATION_MAX}
                  placeholder="Where is this sensor installed?"
                  disabled={saving}
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label htmlFor="edit-sensor-lat" className="text-xs text-muted-foreground">
                    Latitude
                  </Label>
                  <Input
                    id="edit-sensor-lat"
                    value={latitude}
                    onChange={(e) => {
                      setLatitude(e.target.value);
                      if (coordsError) setCoordsError('');
                    }}
                    inputMode="decimal"
                    placeholder="-23.5678"
                    disabled={saving}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="edit-sensor-lng" className="text-xs text-muted-foreground">
                    Longitude
                  </Label>
                  <Input
                    id="edit-sensor-lng"
                    value={longitude}
                    onChange={(e) => {
                      setLongitude(e.target.value);
                      if (coordsError) setCoordsError('');
                    }}
                    inputMode="decimal"
                    placeholder="-46.6234"
                    disabled={saving}
                  />
                </div>
              </div>

              {coordsError && (
                <p className="text-sm text-destructive">{coordsError}</p>
              )}

              <p className="text-xs text-muted-foreground">
                Tip: paste the pin coordinates from Google Maps (right-click the spot → copy lat/lng). Display text is free-form.
              </p>
            </div>
          )}

          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
              disabled={saving}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Save changes
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
