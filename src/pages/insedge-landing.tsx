import { useNavigate } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { m } from '../paraglide/messages';

// Small-caps eyebrow with accent bar — editorial section label.
function Eyebrow({ children, center = false }: { children: React.ReactNode; center?: boolean }) {
  return (
    <div className={`inline-flex items-center gap-3 ${center ? 'justify-center' : ''}`}>
      <span
        aria-hidden
        className="inline-block w-[18px] h-[2px]"
        style={{ background: 'var(--primary)' }}
      />
      <span
        className="font-mono uppercase"
        style={{
          fontSize: '11.5px',
          letterSpacing: '0.16em',
          color: 'var(--text-muted)',
        }}
      >
        {children}
      </span>
    </div>
  );
}

// Animated live dot used for status indicators.
function LiveDot() {
  return (
    <span
      aria-hidden
      className="inline-block rounded-full"
      style={{
        width: 7,
        height: 7,
        background: 'var(--accent, #7cd1ce)',
        boxShadow: '0 0 0 3px rgba(124, 209, 206, 0.15)',
      }}
    />
  );
}

export default function InsedgeLandingPage() {
  const navigate = useNavigate();

  return (
    <div className="flex flex-col">
      {/* HERO — narrow centered rail, editorial type */}
      <section className="border-b border-border relative overflow-hidden">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              'radial-gradient(ellipse 60% 40% at 50% -10%, rgba(151,170,247,0.08), transparent 65%)',
          }}
        />
        <div className="max-w-2xl mx-auto px-6 pt-24 sm:pt-32 pb-20 sm:pb-24 relative text-center">
          <div className="mb-8 flex justify-center">
            <Eyebrow>{m.insedge_eyebrow()}</Eyebrow>
          </div>

          <h1
            className="mx-auto"
            style={{
              fontSize: 'clamp(32px, 4.5vw, 56px)',
              lineHeight: 1.08,
              letterSpacing: '-0.02em',
              fontWeight: 500,
              color: 'var(--text-primary)',
            }}
          >
            {m.insedge_hero_title()}
          </h1>

          <p
            className="mt-6 sm:mt-8 mx-auto"
            style={{
              fontSize: '16.5px',
              lineHeight: 1.6,
              color: 'var(--text-secondary)',
              maxWidth: '38ch',
            }}
          >
            {m.insedge_hero_subtitle()}
          </p>
        </div>
      </section>

      {/* INITIATIVES — centered stack, no card chrome */}
      <section className="border-b border-border">
        <div className="max-w-2xl mx-auto px-6 py-16 sm:py-20 text-center">
          <div className="mb-6 flex justify-center">
            <Eyebrow>01 / {m.insedge_initiatives_title()}</Eyebrow>
          </div>

          <p
            className="mb-12 mx-auto"
            style={{
              fontSize: '15px',
              lineHeight: 1.6,
              color: 'var(--text-secondary)',
              maxWidth: '40ch',
            }}
          >
            {m.insedge_initiatives_subtitle()}
          </p>

          <button
            type="button"
            onClick={() => navigate('/edgetracker')}
            className="block w-full text-left group rounded-md transition-colors hover:bg-card/40 px-4 py-5 -mx-4 border-t border-border"
          >
            <div className="flex items-baseline justify-between gap-4 mb-3">
              <h2
                style={{
                  fontSize: '24px',
                  lineHeight: 1.1,
                  letterSpacing: '-0.015em',
                  fontWeight: 500,
                  color: 'var(--text-primary)',
                }}
              >
                Edge Tracker
              </h2>
              <div className="flex items-center gap-2 shrink-0">
                <LiveDot />
                <span
                  className="font-mono"
                  style={{ fontSize: 12, color: 'var(--accent, #7cd1ce)' }}
                >
                  {m.insedge_status_live()}
                </span>
              </div>
            </div>
            <p
              className="mb-3"
              style={{
                fontSize: '14.5px',
                lineHeight: 1.6,
                color: 'var(--text-secondary)',
              }}
            >
              {m.edge_tracker_card_description()}
            </p>
            <span
              className="inline-flex items-center gap-2 group-hover:gap-3 transition-all"
              style={{ fontSize: 13.5, color: 'var(--primary)' }}
            >
              {m.insedge_explore_initiative()}
              <ArrowRight className="w-3.5 h-3.5" />
            </span>
          </button>

          <p
            className="mt-10 pt-8 border-t border-border font-mono"
            style={{ fontSize: 12.5, color: 'var(--text-muted)' }}
          >
            {m.insedge_more_initiatives_soon()}
          </p>
        </div>
      </section>

      {/* STATUS STRIP — compact, centered grid */}
      <section>
        <div className="max-w-2xl mx-auto px-6 py-12 sm:py-14">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-6 text-center">
            <div>
              <div className="mb-2 flex justify-center">
                <Eyebrow>Status</Eyebrow>
              </div>
              <div className="flex items-center justify-center gap-2" style={{ fontSize: 14, color: 'var(--text-primary)' }}>
                <LiveDot />
                <span>MVP live</span>
              </div>
            </div>
            <div>
              <div className="mb-2 flex justify-center">
                <Eyebrow>Anchoring</Eyebrow>
              </div>
              <div style={{ fontSize: 14, color: 'var(--text-primary)' }}>Solana devnet</div>
            </div>
            <div>
              <div className="mb-2 flex justify-center">
                <Eyebrow>License</Eyebrow>
              </div>
              <div style={{ fontSize: 14, color: 'var(--text-primary)' }}>MIT</div>
            </div>
            <div>
              <div className="mb-2 flex justify-center">
                <Eyebrow>Origin</Eyebrow>
              </div>
              <div style={{ fontSize: 14, color: 'var(--text-primary)' }}>Poli-USP, 2025</div>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
