import { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from './ui/dialog';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Textarea } from './ui/textarea';
import { Loader2 } from 'lucide-react';
import { Sensor } from '../lib/types';
import { sensorAPI } from '../lib/api';
import { useAuth } from '../lib/auth-context';
import { toast } from 'sonner@2.0.3';

const NAME_MAX = 80;
const DESCRIPTION_MAX = 500;

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
  const [nameError, setNameError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setName(sensor.name);
      setDescription(sensor.description ?? '');
      setNameError('');
    }
  }, [open, sensor.name, sensor.description]);

  const trimmedName = name.trim();
  const trimmedDescription = description.trim();
  const hasChanges = trimmedName !== sensor.name || trimmedDescription !== (sensor.description ?? '');

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

    try {
      setSaving(true);
      const updated = await sensorAPI.update(
        sensor.id,
        { name: trimmedName, description: trimmedDescription },
        accessToken,
      );
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
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>Edit sensor</DialogTitle>
          <DialogDescription>
            Update the title and description of your sensor.
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
