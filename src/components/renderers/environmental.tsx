import { Card } from '../ui/card';
import { Thermometer, Droplets, Gauge, Activity } from 'lucide-react';
import type { Envelope, SenmlRecord } from '../../lib/envelope-types';

const iconFor = (name: string) => {
  const n = name.toLowerCase();
  if (n.includes('temp')) return <Thermometer className="w-4 h-4" />;
  if (n.includes('humid')) return <Droplets className="w-4 h-4" />;
  if (n.includes('press') || n.includes('ph')) return <Gauge className="w-4 h-4" />;
  return <Activity className="w-4 h-4" />;
};

const formatUnit = (u: string): string => {
  switch (u) {
    case 'Cel': return '°C';
    case '%RH': return '%';
    default: return u;
  }
};

export function EnvironmentalRenderer({ envelope }: { envelope: Envelope<SenmlRecord[]> }) {
  const records = Array.isArray(envelope.data) ? envelope.data : [];
  if (records.length === 0) return null;

  return (
    <Card className="p-4 bg-card border-border">
      <div className="flex items-center justify-between mb-3">
        <div className="text-xs uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
          Environmental
        </div>
        <div className="text-xs" style={{ color: 'var(--text-muted)' }}>
          {new Date(envelope.time).toLocaleTimeString()}
        </div>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {records.map((rec, i) => (
          <div key={i} className="flex items-center gap-3 p-3 rounded-lg bg-muted/40">
            <div className="text-primary">{iconFor(rec.n)}</div>
            <div className="flex-1">
              <p className="text-xs capitalize" style={{ color: 'var(--text-muted)' }}>{rec.n}</p>
              <p className="text-lg" style={{ fontWeight: 600, color: 'var(--text-primary)' }}>
                {typeof rec.v === 'number' ? rec.v.toFixed(rec.v >= 100 ? 0 : 1) : '—'}
                <span className="text-sm ml-1" style={{ color: 'var(--text-secondary)' }}>
                  {formatUnit(rec.u)}
                </span>
              </p>
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}
