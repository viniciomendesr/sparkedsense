import { ExternalLink } from 'lucide-react';
import { m } from '../paraglide/messages';

export function Footer() {
  return (
    <footer className="border-t border-border bg-card/30 mt-auto">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
            {m.footer_copy()}
          </p>
          <div className="flex items-center gap-6">
            <a
              href="#"
              className="text-sm hover:text-primary transition-colors flex items-center gap-1"
              style={{ color: 'var(--text-secondary)' }}
            >
              {m.footer_documentation()}
              <ExternalLink className="w-3 h-3" />
            </a>
            <a
              href="#"
              className="text-sm hover:text-primary transition-colors flex items-center gap-1"
              style={{ color: 'var(--text-secondary)' }}
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
