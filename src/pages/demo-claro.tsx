import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Button } from '../components/ui/button';
import { Card } from '../components/ui/card';
import { Badge } from '../components/ui/badge';
import { RefreshCw, Radio } from 'lucide-react';
import { publicAPI } from '../lib/api';
import { EnvelopeRenderer } from '../components/renderers';
import type { Envelope } from '../lib/envelope-types';

/**
 * ADR-010 demo: live feed of heterogeneous envelopes from a single sensor,
 * rendered via the type-dispatched renderer framework.
 *
 * URL: /demo-claro?sensor=<uuid>
 */
export default function DemoClaroPage() {
  const [searchParams] = useSearchParams();
  const sensorId = searchParams.get('sensor') ?? '';

  const [envelopes, setEnvelopes] = useState<Envelope[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadEnvelopes = async () => {
    if (!sensorId) return;
    try {
      setLoading(true);
      setError(null);
      const rows = await publicAPI.getEnvelopes(sensorId, { limit: 50 });
      setEnvelopes(rows as Envelope[]);
    } catch (err: any) {
      setError(err.message || 'Failed to load envelopes');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadEnvelopes();
    const interval = setInterval(loadEnvelopes, 15000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sensorId]);

  if (!sensorId) {
    return (
      <div className="max-w-4xl mx-auto p-8">
        <Card className="p-6 text-center">
          <p style={{ color: 'var(--text-primary)' }}>
            Missing <code>?sensor=&lt;id&gt;</code> query parameter.
          </p>
        </Card>
      </div>
    );
  }

  const grouped = envelopes.reduce<Record<string, number>>((acc, e) => {
    acc[e.event_type] = (acc[e.event_type] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-xs uppercase tracking-wider mb-1" style={{ color: 'var(--text-muted)' }}>
            <Radio className="w-3.5 h-3.5" />
            ADR-010 live envelopes
          </div>
          <h1 style={{ fontSize: '1.5rem', fontWeight: 600, color: 'var(--text-primary)' }}>
            Demo · heterogeneous modalities
          </h1>
          <p className="text-sm mt-1" style={{ color: 'var(--text-secondary)' }}>
            Single ingestion endpoint, envelope with discriminator, type-dispatched renderers.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={loadEnvelopes} disabled={loading}>
          <RefreshCw className={`w-4 h-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </div>

      <div className="flex flex-wrap gap-2 mb-6">
        {Object.entries(grouped).map(([t, count]) => (
          <Badge key={t} variant="outline" className="border-border font-mono text-xs">
            {t} · {count}
          </Badge>
        ))}
        {envelopes.length === 0 && !loading && (
          <Badge variant="outline" className="border-border text-xs">
            no envelopes yet
          </Badge>
        )}
      </div>

      {error && (
        <Card className="p-4 mb-4 border-destructive/50">
          <p className="text-sm text-destructive">{error}</p>
        </Card>
      )}

      <div className="space-y-3">
        {envelopes.map((envelope) => (
          <EnvelopeRenderer key={envelope.id} envelope={envelope} />
        ))}
      </div>
    </div>
  );
}
