import { useMemo, useState } from 'react';
import {
  AreaChart,
  Area,
  Brush,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  ReferenceLine,
} from 'recharts';
import { Card } from './ui/card';
import { Badge } from './ui/badge';
import { TrendingUp, TrendingDown, Minus } from 'lucide-react';
import type { Reading } from '../lib/types';

type Range = '1H' | '6H' | '1D' | '1W' | 'ALL';

const RANGE_WINDOWS: Record<Range, number | null> = {
  '1H': 60 * 60 * 1000,
  '6H': 6 * 60 * 60 * 1000,
  '1D': 24 * 60 * 60 * 1000,
  '1W': 7 * 24 * 60 * 60 * 1000,
  ALL: null,
};

const RANGE_LABELS: Record<Range, string> = { '1H': '1H', '6H': '6H', '1D': '1D', '1W': '1W', ALL: 'All' };

const formatValue = (v: number, unit: string): string => {
  const decimals = Math.abs(v) >= 100 ? 0 : Math.abs(v) >= 10 ? 1 : 2;
  return `${v.toFixed(decimals)}${unit ? ' ' + unit : ''}`;
};

const CustomTooltip = ({ active, payload, unit }: any) => {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  return (
    <div className="rounded-lg px-3 py-2 text-xs" style={{
      background: 'var(--card)',
      border: '1px solid var(--border)',
      color: 'var(--text-primary)',
      boxShadow: '0 8px 16px rgba(0,0,0,0.4)',
    }}>
      <div style={{ color: 'var(--text-muted)' }}>{p.fullTime}</div>
      <div style={{ fontWeight: 600, fontSize: 14 }}>{formatValue(p.value, unit)}</div>
    </div>
  );
};

interface SensorChartProps {
  readings: Reading[];
  mode: 'live' | 'historical';
  unit?: string;
  title?: string;
  // When mode='live', limits how many most-recent points to render; defaults to 60
  liveWindow?: number;
  className?: string;
}

export function SensorChart({ readings, mode, unit = '', title, liveWindow = 60, className }: SensorChartProps) {
  const [range, setRange] = useState<Range>('ALL');

  // Normalize + sort ascending by time
  const all = useMemo(() => {
    return readings
      .map((r) => {
        const ts = r.timestamp instanceof Date ? r.timestamp : new Date(r.timestamp);
        return { ts, value: r.value };
      })
      .filter((r) => Number.isFinite(r.value))
      .sort((a, b) => a.ts.getTime() - b.ts.getTime());
  }, [readings]);

  const visible = useMemo(() => {
    if (mode === 'live') return all.slice(-liveWindow);
    const windowMs = RANGE_WINDOWS[range];
    if (windowMs == null) return all;
    const since = Date.now() - windowMs;
    return all.filter((r) => r.ts.getTime() >= since);
  }, [all, mode, range, liveWindow]);

  const series = useMemo(
    () =>
      visible.map((r) => ({
        ts: r.ts.getTime(),
        value: r.value,
        time: r.ts.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        fullTime: r.ts.toLocaleString(),
      })),
    [visible],
  );

  const stats = useMemo(() => {
    if (visible.length === 0) return null;
    const values = visible.map((r) => r.value);
    const first = values[0];
    const last = values[values.length - 1];
    const min = Math.min(...values);
    const max = Math.max(...values);
    const avg = values.reduce((s, v) => s + v, 0) / values.length;
    const delta = last - first;
    const pct = first !== 0 ? (delta / first) * 100 : 0;
    return { first, last, min, max, avg, delta, pct, count: values.length };
  }, [visible]);

  const trend: 'up' | 'down' | 'flat' =
    stats == null || Math.abs(stats.delta) < 1e-6 ? 'flat' : stats.delta > 0 ? 'up' : 'down';

  const trendColor = trend === 'up' ? 'var(--success)' : trend === 'down' ? 'var(--destructive)' : 'var(--text-muted)';

  const yDomain = useMemo<[number | string, number | string]>(() => {
    if (visible.length === 0) return ['auto', 'auto'];
    const values = visible.map((r) => r.value);
    const lo = Math.min(...values);
    const hi = Math.max(...values);
    if (lo === hi) return [lo - 1, hi + 1];
    const pad = (hi - lo) * 0.12;
    return [Number((lo - pad).toFixed(2)), Number((hi + pad).toFixed(2))];
  }, [visible]);

  const trendIcon = trend === 'up' ? <TrendingUp className="w-3.5 h-3.5" /> : trend === 'down' ? <TrendingDown className="w-3.5 h-3.5" /> : <Minus className="w-3.5 h-3.5" />;

  return (
    <Card className={`p-6 bg-card border-border ${className ?? ''}`}>
      {/* Header: title + stats + timeframe */}
      <div className="flex flex-col gap-3 mb-4">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            {title && (
              <h3 className="mb-1" style={{ fontWeight: 600, color: 'var(--text-primary)' }}>
                {title}
              </h3>
            )}
            {stats && (
              <div className="flex items-baseline gap-3">
                <span style={{ fontSize: '1.5rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                  {formatValue(stats.last, unit)}
                </span>
                <span
                  className="inline-flex items-center gap-1 text-sm"
                  style={{ color: trendColor, fontWeight: 500 }}
                >
                  {trendIcon}
                  {stats.delta >= 0 ? '+' : ''}
                  {stats.delta.toFixed(2)}{unit ? ` ${unit}` : ''}
                  <span style={{ color: 'var(--text-muted)' }}>
                    ({stats.pct >= 0 ? '+' : ''}{stats.pct.toFixed(2)}%)
                  </span>
                </span>
              </div>
            )}
          </div>

          {mode === 'historical' && (
            <div className="flex items-center gap-1 p-1 rounded-lg bg-muted/40 border border-border">
              {(Object.keys(RANGE_LABELS) as Range[]).map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => setRange(r)}
                  className="px-2.5 py-1 text-xs rounded transition-colors"
                  style={{
                    background: range === r ? 'var(--primary)' : 'transparent',
                    color: range === r ? 'var(--primary-foreground)' : 'var(--text-secondary)',
                    fontWeight: range === r ? 600 : 400,
                  }}
                >
                  {RANGE_LABELS[r]}
                </button>
              ))}
            </div>
          )}
        </div>

        {stats && (
          <div className="flex flex-wrap gap-2">
            <Badge variant="outline" className="border-border font-normal">
              Min <span className="ml-1 font-mono" style={{ color: 'var(--text-primary)' }}>{formatValue(stats.min, unit)}</span>
            </Badge>
            <Badge variant="outline" className="border-border font-normal">
              Max <span className="ml-1 font-mono" style={{ color: 'var(--text-primary)' }}>{formatValue(stats.max, unit)}</span>
            </Badge>
            <Badge variant="outline" className="border-border font-normal">
              Avg <span className="ml-1 font-mono" style={{ color: 'var(--text-primary)' }}>{formatValue(stats.avg, unit)}</span>
            </Badge>
            <Badge variant="outline" className="border-border font-normal">
              Points <span className="ml-1 font-mono" style={{ color: 'var(--text-primary)' }}>{stats.count.toLocaleString()}</span>
            </Badge>
          </div>
        )}
      </div>

      <div className="h-80">
        {series.length < 2 ? (
          <div className="h-full flex items-center justify-center text-sm" style={{ color: 'var(--text-muted)' }}>
            Not enough data to render a chart yet.
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={series} margin={{ top: 10, right: 16, left: 0, bottom: mode === 'historical' ? 24 : 0 }}>
              <defs>
                <linearGradient id="sensorAreaFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={trendColor} stopOpacity={0.35} />
                  <stop offset="100%" stopColor={trendColor} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
              <XAxis
                dataKey="time"
                stroke="var(--text-muted)"
                tick={{ fill: 'var(--text-muted)', fontSize: 11 }}
                minTickGap={40}
              />
              <YAxis
                stroke="var(--text-muted)"
                tick={{ fill: 'var(--text-muted)', fontSize: 11 }}
                domain={yDomain}
                width={55}
                tickFormatter={(v: number) => formatValue(v, '')}
              />
              <Tooltip content={<CustomTooltip unit={unit} />} />
              {stats && (
                <ReferenceLine
                  y={stats.avg}
                  stroke="var(--text-muted)"
                  strokeDasharray="4 4"
                  strokeOpacity={0.4}
                />
              )}
              <Area
                type="monotone"
                dataKey="value"
                stroke={trendColor}
                strokeWidth={2}
                fill="url(#sensorAreaFill)"
                isAnimationActive={false}
              />
              {mode === 'historical' && series.length > 20 && (
                <Brush
                  dataKey="time"
                  height={22}
                  stroke="var(--primary)"
                  fill="transparent"
                  travellerWidth={8}
                  tickFormatter={() => ''}
                />
              )}
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>
    </Card>
  );
}
