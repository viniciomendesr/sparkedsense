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

// Compact metadata cell used inside the project sheet.
function MetaCell({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div
        className="font-mono uppercase"
        style={{
          fontSize: 10.5,
          letterSpacing: '0.16em',
          color: 'var(--text-muted)',
          marginBottom: 8,
        }}
      >
        {label}
      </div>
      <div style={{ fontSize: 13.5, lineHeight: 1.4, color: 'var(--text-primary)' }}>
        {children}
      </div>
    </div>
  );
}

export default function InsedgeLandingPage() {
  const navigate = useNavigate();

  return (
    <div className="flex flex-col">
      {/* INTRO — what Insedge is */}
      <section className="border-b border-border">
        <div
          className="max-w-2xl mx-auto px-6 text-center"
          style={{ paddingTop: 112, paddingBottom: 88 }}
        >
          <h1
            style={{
              fontSize: '36px',
              lineHeight: 1.05,
              letterSpacing: '-0.02em',
              fontWeight: 500,
              color: 'var(--text-primary)',
              marginBottom: 24,
            }}
          >
            Insedge
          </h1>
          <p
            className="mx-auto"
            style={{
              fontSize: '15.5px',
              lineHeight: 1.6,
              color: 'var(--text-secondary)',
              maxWidth: '38ch',
            }}
          >
            {m.insedge_lead()}
          </p>
        </div>
      </section>

      {/* TOOLS — currently shipping & upcoming open-source projects */}
      <section>
        <div
          className="max-w-2xl mx-auto px-6"
          style={{ paddingTop: 88, paddingBottom: 104 }}
        >
          <div
            className="flex justify-center"
            style={{ marginBottom: 56 }}
          >
            <Eyebrow>01 / {m.insedge_initiatives_title()}</Eyebrow>
          </div>

          {/* Edge Tracker — self-contained project sheet */}
          <div className="rounded-md border border-border bg-card/30 overflow-hidden">
            <button
              type="button"
              onClick={() => navigate('/edgetracker')}
              className="block w-full text-left group hover:bg-card/50 transition-colors"
              style={{ padding: '32px 28px' }}
            >
              <div
                className="flex items-baseline justify-between gap-4"
                style={{ marginBottom: 18 }}
              >
                <h2
                  style={{
                    fontSize: '22px',
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
                    style={{ fontSize: 11.5, color: 'var(--accent, #7cd1ce)' }}
                  >
                    {m.insedge_status_live()}
                  </span>
                </div>
              </div>
              <p
                style={{
                  fontSize: '14px',
                  lineHeight: 1.65,
                  color: 'var(--text-secondary)',
                  marginBottom: 26,
                }}
              >
                {m.edge_tracker_card_description()}
              </p>
              <span
                className="inline-flex items-center gap-2 group-hover:gap-3 transition-all"
                style={{ fontSize: 13, color: 'var(--primary)' }}
              >
                {m.insedge_explore_initiative()}
                <ArrowRight className="w-3.5 h-3.5" />
              </span>
            </button>

            <div
              className="border-t border-border grid"
              style={{
                padding: '24px 28px',
                gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))',
                columnGap: 16,
                rowGap: 24,
              }}
            >
              <MetaCell label={m.insedge_meta_status()}>
                <span className="inline-flex items-center gap-2">
                  <LiveDot />
                  {m.insedge_meta_status_value()}
                </span>
              </MetaCell>
              <MetaCell label={m.insedge_meta_anchoring()}>
                {m.insedge_meta_anchoring_value()}
              </MetaCell>
              <MetaCell label={m.insedge_meta_license()}>MIT</MetaCell>
              <MetaCell label={m.insedge_meta_origin()}>
                {m.insedge_meta_origin_value()}
              </MetaCell>
            </div>
          </div>

          <p
            className="text-center font-mono"
            style={{
              fontSize: 12,
              color: 'var(--text-muted)',
              marginTop: 56,
            }}
          >
            {m.insedge_more_initiatives_soon()}
          </p>
        </div>
      </section>
    </div>
  );
}
