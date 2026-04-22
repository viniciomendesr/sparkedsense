import { Card } from '../ui/card';
import { Badge } from '../ui/badge';
import { Brain } from 'lucide-react';
import type { Envelope, ClassificationData } from '../../lib/envelope-types';

export function ClassificationRenderer({ envelope }: { envelope: Envelope<ClassificationData> }) {
  const { class: cls, confidence, class_vocabulary, scores, model_id, inference_ms } = envelope.data;
  const pct = Math.round(confidence * 100);

  const distribution = class_vocabulary && scores && class_vocabulary.length === scores.length
    ? class_vocabulary
        .map((name, i) => ({ name, score: scores[i] }))
        .sort((a, b) => b.score - a.score)
        .slice(0, 5)
    : null;

  return (
    <Card className="p-4 bg-card border-border">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2 text-xs uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
          <Brain className="w-3.5 h-3.5" />
          Classification · {model_id}
        </div>
        <div className="text-xs" style={{ color: 'var(--text-muted)' }}>
          {new Date(envelope.time).toLocaleTimeString()}
          {typeof inference_ms === 'number' && ` · ${inference_ms.toFixed(0)}ms`}
        </div>
      </div>

      <div className="mb-3">
        <p className="text-2xl" style={{ fontWeight: 600, color: 'var(--text-primary)' }}>
          {cls}
        </p>
        <div className="flex items-center gap-2 mt-1">
          <div className="flex-1 h-2 rounded-full bg-muted overflow-hidden">
            <div className="h-full bg-primary" style={{ width: `${pct}%` }} />
          </div>
          <span className="text-sm font-mono" style={{ color: 'var(--text-secondary)' }}>
            {pct}%
          </span>
        </div>
      </div>

      {distribution && (
        <div className="space-y-1 pt-2 border-t border-border">
          <p className="text-xs mb-1" style={{ color: 'var(--text-muted)' }}>Top classes</p>
          {distribution.map((d) => (
            <div key={d.name} className="flex items-center justify-between text-xs">
              <Badge variant="outline" className="font-normal border-border">{d.name}</Badge>
              <span className="font-mono" style={{ color: 'var(--text-secondary)' }}>
                {(d.score * 100).toFixed(1)}%
              </span>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
