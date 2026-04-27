import { Sensor } from '../lib/types';
import { Card } from './ui/card';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { Activity, Eye, EyeOff, Lock, AlertCircle, Calendar, Clock, Hexagon, MapPin, Database, Hash, ShieldAlert } from 'lucide-react';
import { ImageWithFallback } from './figma/ImageWithFallback';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from './ui/tooltip';
import { formatDataSize } from '../lib/format';
import { m } from '../paraglide/messages';

interface SensorCardProps {
  sensor: Sensor;
  liveData?: { timestamp: Date; value: number }[];
  onViewDetails: (sensor: Sensor) => void;
  showMiniSparkline?: boolean;
}

export function SensorCard({ sensor, liveData, onViewDetails, showMiniSparkline = true }: SensorCardProps) {
  const statusColors = {
    active: 'bg-success',
    inactive: 'bg-[var(--text-disabled)]',
    reconnecting: 'bg-warning',
  };

  const statusLabels = {
    active: m.sensor_status_active(),
    inactive: m.sensor_status_inactive(),
    reconnecting: m.sensor_status_reconnecting(),
  };

  const visibilityLabels = {
    public: m.sensor_visibility_public(),
    private: m.sensor_visibility_private(),
    partial: m.sensor_visibility_partial(),
  };

  const visibilityIcons = {
    public: <Eye className="w-3 h-3" />,
    private: <Lock className="w-3 h-3" />,
    partial: <EyeOff className="w-3 h-3" />,
  };

  const getTypeColor = (type: string) => {
    const colors: Record<string, string> = {
      temperature: 'bg-chart-1/20 text-chart-1 border-chart-1/30',
      humidity: 'bg-chart-2/20 text-chart-2 border-chart-2/30',
      ph: 'bg-chart-3/20 text-chart-3 border-chart-3/30',
      pressure: 'bg-chart-4/20 text-chart-4 border-chart-4/30',
      light: 'bg-chart-5/20 text-chart-5 border-chart-5/30',
      co2: 'bg-accent/20 text-accent border-accent/30',
    };
    return colors[type] || colors.temperature;
  };

  const formatDate = (date: Date | string | undefined) => {
    if (!date) return m.sensor_field_na();
    const dateObj = typeof date === 'string' ? new Date(date) : date;
    return dateObj.toLocaleDateString();
  };

  return (
    <Card className="overflow-hidden bg-card border-border hover:border-primary/50 transition-all duration-200">
      {/* Thumbnail Image */}
      {sensor.thumbnailUrl && (
        <div className="relative w-full h-48 bg-muted/50">
          <ImageWithFallback
            src={sensor.thumbnailUrl}
            alt={sensor.name}
            className="w-full h-full object-cover"
          />
          <div className="absolute top-3 right-3 flex gap-2">
            <div className={`px-2 py-1 rounded-full ${statusColors[sensor.status]} backdrop-blur-sm`}>
              <span className="text-xs text-white">{statusLabels[sensor.status]}</span>
            </div>
          </div>
        </div>
      )}

      <div className="p-6">
        {/* Header */}
        <div className="flex items-start justify-between mb-3">
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-2">
              <h3 className="text-lg" style={{ fontWeight: 600, color: 'var(--text-primary)' }}>
                {sensor.name}
              </h3>
              {sensor.status === 'reconnecting' && (
                <AlertCircle className="w-4 h-4 text-warning" />
              )}
            </div>
          </div>
        </div>

        {/* Description */}
        <p className="text-sm mb-4 line-clamp-2" style={{ color: 'var(--text-secondary)' }}>
          {sensor.description}
        </p>

        {/* Location */}
        {sensor.location && (
          <div className="flex items-center gap-1.5 mb-4">
            <MapPin className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
            <span className="text-sm truncate" style={{ color: 'var(--text-secondary)' }}>
              {sensor.location}
            </span>
          </div>
        )}

        {/* Badges */}
        <div className="flex flex-wrap items-center gap-2 mb-4">
          <Badge variant="outline" className={`${getTypeColor(sensor.type)} border`}>
            {sensor.type.charAt(0).toUpperCase() + sensor.type.slice(1)}
          </Badge>
          {!sensor.thumbnailUrl && (
            <Badge variant="outline" className="border-border">
              <div className="flex items-center gap-1.5">
                <div className={`w-2 h-2 rounded-full ${statusColors[sensor.status]}`}></div>
                {statusLabels[sensor.status]}
              </div>
            </Badge>
          )}
          <Badge variant="outline" className="border-border">
            <div className="flex items-center gap-1.5">
              {visibilityIcons[sensor.visibility]}
              {visibilityLabels[sensor.visibility]}
            </div>
          </Badge>
          {sensor.mode === 'real' ? (
            <Badge variant="outline" className="bg-accent/20 text-accent border-accent/30">
              {m.sensor_mode_real_data()}
            </Badge>
          ) : sensor.mode === 'unverified' ? (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <div>
                    <Badge variant="outline" className="bg-warning/20 text-warning border-warning/30 cursor-help">
                      <ShieldAlert className="w-3 h-3 mr-1" />
                      {m.sensor_mode_unverified()}
                    </Badge>
                  </div>
                </TooltipTrigger>
                <TooltipContent side="top" className="max-w-xs">
                  <p className="text-sm">
                    {m.sensor_mode_unverified_tooltip()}
                  </p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          ) : (
            <Badge variant="outline" className="bg-secondary/20 text-secondary border-secondary/30">
              {m.sensor_mode_mock_data()}
            </Badge>
          )}
          {sensor.mode !== 'unverified' && (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <div>
                    <Badge variant="outline" className="bg-secondary/20 text-secondary border-secondary/30 cursor-help">
                      <Hexagon className="w-3 h-3 mr-1" />
                      {m.sensor_mode_nft()}
                    </Badge>
                  </div>
                </TooltipTrigger>
                <TooltipContent side="top" className="max-w-xs">
                  <p className="text-sm">
                    {m.sensor_mode_nft_tooltip()}
                  </p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
        </div>

        {/* Dates */}
        <div className="grid grid-cols-2 gap-3 mb-4 pb-4 border-b border-border">
          <div>
            <div className="flex items-center gap-1.5 mb-1">
              <Calendar className="w-3 h-3 text-muted-foreground" />
              <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                {m.sensor_field_created()}
              </span>
            </div>
            <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
              {formatDate(sensor.createdAt)}
            </p>
          </div>
          <div>
            <div className="flex items-center gap-1.5 mb-1">
              <Clock className="w-3 h-3 text-muted-foreground" />
              <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                {m.sensor_field_updated()}
              </span>
            </div>
            <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
              {formatDate(sensor.updatedAt || sensor.createdAt)}
            </p>
          </div>
        </div>

        {/* Last Reading */}
        {sensor.lastReading && (
          <div className="flex items-center justify-between p-3 rounded-lg bg-muted/50 mb-4">
            <div className="flex items-center gap-2">
              <Activity className="w-4 h-4 text-primary" />
              <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                {m.sensor_card_latest_reading()}
              </span>
            </div>
            <div className="text-right">
              <p className="text-lg" style={{ fontWeight: 600, color: 'var(--text-primary)' }}>
                {sensor.lastReading.value} {sensor.lastReading.unit}
              </p>
              <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                {new Date(sensor.lastReading.timestamp).toLocaleTimeString()}
              </p>
            </div>
          </div>
        )}

        {/* Storage Metrics */}
        {(sensor.totalReadingsCount ?? 0) > 0 && (
          <div className="grid grid-cols-2 gap-3 mb-4">
            <div className="p-3 rounded-lg bg-primary/5 border border-primary/10 text-center">
              <div className="flex items-center justify-center gap-1.5 mb-1">
                <Database className="w-3 h-3 text-primary/60" />
                <span className="text-xs uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>{m.sensor_card_stored()}</span>
              </div>
              <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
                {formatDataSize(sensor.totalDataBytes ?? 0)}
              </p>
            </div>
            <div className="p-3 rounded-lg bg-primary/5 border border-primary/10 text-center">
              <div className="flex items-center justify-center gap-1.5 mb-1">
                <Hash className="w-3 h-3 text-primary/60" />
                <span className="text-xs uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>{m.sensor_card_readings()}</span>
              </div>
              <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
                {(sensor.totalReadingsCount ?? 0).toLocaleString()}
              </p>
            </div>
          </div>
        )}

        {/* Mini Sparkline */}
        {showMiniSparkline && liveData && liveData.length > 1 && (
          <div className="h-12 relative mb-4">
            <svg className="w-full h-full" viewBox="0 0 100 100" preserveAspectRatio="none">
              <polyline
                fill="none"
                stroke="var(--chart-1)"
                strokeWidth="2"
                vectorEffect="non-scaling-stroke"
                points={liveData.map((d, i) => {
                  const x = (i / (liveData.length - 1)) * 100;
                  const minVal = Math.min(...liveData.map(p => p.value));
                  const maxVal = Math.max(...liveData.map(p => p.value));
                  const range = maxVal - minVal || 1;
                  const y = 100 - ((d.value - minVal) / range) * 100;
                  return `${x},${y}`;
                }).join(' ')}
              />
            </svg>
          </div>
        )}

        {/* Actions */}
        <Button
          onClick={() => onViewDetails(sensor)}
          className="w-full bg-primary text-primary-foreground"
        >
          {m.sensor_card_view_details()}
        </Button>
      </div>
    </Card>
  );
}
