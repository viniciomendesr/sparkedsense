import { ExternalLink } from 'lucide-react';
import { m } from '../paraglide/messages';

export function Footer() {
  return (
    <footer className="border-t border-border bg-card/30 mt-auto">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-7">
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
          <div className="flex flex-col gap-1">
            <span
              style={{
                fontSize: 13.5,
                color: 'var(--text-primary)',
                letterSpacing: '-0.005em',
              }}
            >
              {m.footer_copy()}
            </span>
            <span
              className="font-mono"
              style={{
                fontSize: 11.5,
                letterSpacing: '0.04em',
                color: 'var(--text-muted)',
              }}
            >
              {m.footer_tagline()}
            </span>
          </div>
          <div className="flex items-center gap-6">
            <a
              href="#"
              className="font-mono uppercase inline-flex items-center gap-1.5 transition-colors hover:text-primary"
              style={{
                fontSize: 11,
                letterSpacing: '0.16em',
                color: 'var(--text-secondary)',
              }}
            >
              {m.footer_documentation()}
              <ExternalLink className="w-3 h-3" />
            </a>
            <a
              href="#"
              className="font-mono uppercase inline-flex items-center gap-1.5 transition-colors hover:text-primary"
              style={{
                fontSize: 11,
                letterSpacing: '0.16em',
                color: 'var(--text-secondary)',
              }}
            >
              {m.footer_github()}
              <ExternalLink className="w-3 h-3" />
            </a>
          </div>
        </div>
      </div>
    </footer>
  );
}
