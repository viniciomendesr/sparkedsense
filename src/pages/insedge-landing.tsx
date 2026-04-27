import { useNavigate } from 'react-router-dom';
import { Card } from '../components/ui/card';
import { Badge } from '../components/ui/badge';
import { ArrowRight, Zap, Cpu } from 'lucide-react';
import { m } from '../paraglide/messages';

export default function InsedgeLandingPage() {
  const navigate = useNavigate();

  return (
    <div className="min-h-[calc(100vh-8rem)] flex flex-col">
      {/* Hero */}
      <section className="flex-1 flex items-center justify-center px-4 sm:px-6 py-16 sm:py-24">
        <div className="max-w-3xl mx-auto text-center">
          <div className="inline-flex items-center gap-2 px-3 py-2 rounded-full bg-primary/10 border border-primary/20 mb-6">
            <Cpu className="w-4 h-4 text-primary shrink-0" />
            <span className="text-xs sm:text-sm" style={{ color: 'var(--primary)' }}>
              {m.insedge_eyebrow()}
            </span>
          </div>

          <h1
            className="text-3xl sm:text-5xl mb-6"
            style={{ fontWeight: 600, lineHeight: '1.15', color: 'var(--text-primary)' }}
          >
            {m.insedge_hero_title()}
          </h1>

          <p
            className="mb-8 max-w-2xl mx-auto text-base sm:text-lg"
            style={{ color: 'var(--text-secondary)', lineHeight: '1.6' }}
          >
            {m.insedge_hero_subtitle()}
          </p>
        </div>
      </section>

      {/* Initiatives */}
      <section className="px-4 sm:px-6 py-12 sm:py-16 border-t border-border">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-10">
            <h2
              className="text-2xl sm:text-3xl mb-3"
              style={{ fontWeight: 600, color: 'var(--text-primary)' }}
            >
              {m.insedge_initiatives_title()}
            </h2>
            <p
              className="text-sm sm:text-base"
              style={{ color: 'var(--text-secondary)' }}
            >
              {m.insedge_initiatives_subtitle()}
            </p>
          </div>

          <Card
            role="link"
            tabIndex={0}
            onClick={() => navigate('/edge-tracker')}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                navigate('/edge-tracker');
              }
            }}
            className="p-6 sm:p-8 bg-card border-border hover:border-primary/50 transition-all duration-200 group cursor-pointer"
          >
            <div className="flex items-start gap-4">
              <div className="w-12 h-12 rounded-lg bg-primary/20 flex items-center justify-center flex-shrink-0">
                <Zap
                  className="w-6 h-6 text-primary"
                  strokeWidth={2.5}
                  fill="currentColor"
                />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-3 mb-2 flex-wrap">
                  <h3
                    className="text-xl"
                    style={{ fontWeight: 600, color: 'var(--text-primary)' }}
                  >
                    Edge Tracker
                  </h3>
                  <Badge variant="outline" className="bg-success/10 text-success border-success/30">
                    {m.insedge_status_live()}
                  </Badge>
                </div>
                <p
                  className="mb-4 text-sm sm:text-base"
                  style={{ color: 'var(--text-secondary)', lineHeight: '1.6' }}
                >
                  {m.edge_tracker_card_description()}
                </p>
                <div className="flex items-center gap-2 text-sm text-primary group-hover:gap-3 transition-all">
                  <span>{m.insedge_explore_initiative()}</span>
                  <ArrowRight className="w-4 h-4" />
                </div>
              </div>
            </div>
          </Card>

          <p
            className="text-center text-sm mt-8"
            style={{ color: 'var(--text-muted)' }}
          >
            {m.insedge_more_initiatives_soon()}
          </p>
        </div>
      </section>

      {/* About */}
      <section className="px-4 sm:px-6 py-12 sm:py-16 border-t border-border bg-card/30">
        <div className="max-w-3xl mx-auto text-center">
          <h2
            className="text-xl sm:text-2xl mb-4"
            style={{ fontWeight: 600, color: 'var(--text-primary)' }}
          >
            {m.insedge_about_title()}
          </h2>
          <p
            className="text-sm sm:text-base"
            style={{ color: 'var(--text-secondary)', lineHeight: '1.7' }}
          >
            {m.insedge_about_text()}
          </p>
        </div>
      </section>
    </div>
  );
}
