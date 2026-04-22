import { Card } from '../ui/card';
import { FileJson } from 'lucide-react';
import type { Envelope } from '../../lib/envelope-types';

export function GenericRenderer({ envelope }: { envelope: Envelope }) {
  return (
    <Card className="p-4 bg-card border-border">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2 text-xs uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
          <FileJson className="w-3.5 h-3.5" />
          {envelope.event_type}
        </div>
        <div className="text-xs" style={{ color: 'var(--text-muted)' }}>
          {new Date(envelope.time).toLocaleTimeString()}
        </div>
      </div>

      <pre
        className="text-xs p-3 rounded bg-muted/40 overflow-x-auto"
        style={{ color: 'var(--text-primary)', fontFamily: 'ui-monospace, SFMono-Regular, monospace' }}
      >
        {JSON.stringify(envelope.data, null, 2)}
      </pre>
    </Card>
  );
}
