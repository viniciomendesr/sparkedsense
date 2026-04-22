import { Card } from '../ui/card';
import { MessageSquareText } from 'lucide-react';
import type { Envelope, TranscriptionData } from '../../lib/envelope-types';

export function TranscriptionRenderer({ envelope }: { envelope: Envelope<TranscriptionData> }) {
  const { text, language, engine, duration_processed_ms, confidence } = envelope.data;

  return (
    <Card className="p-4 bg-card border-border">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2 text-xs uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
          <MessageSquareText className="w-3.5 h-3.5" />
          Transcription · {engine}
        </div>
        <div className="text-xs" style={{ color: 'var(--text-muted)' }}>
          {new Date(envelope.time).toLocaleTimeString()}
        </div>
      </div>

      <p className="leading-relaxed" style={{ color: 'var(--text-primary)' }}>
        {text || <span style={{ color: 'var(--text-muted)' }}>(empty)</span>}
      </p>

      <div className="mt-3 flex flex-wrap gap-3 text-xs" style={{ color: 'var(--text-muted)' }}>
        {language && <span>lang: <span className="font-mono">{language}</span></span>}
        {typeof duration_processed_ms === 'number' && (
          <span>audio: <span className="font-mono">{(duration_processed_ms / 1000).toFixed(1)}s</span></span>
        )}
        {typeof confidence === 'number' && (
          <span>conf: <span className="font-mono">{(confidence * 100).toFixed(0)}%</span></span>
        )}
      </div>
    </Card>
  );
}
