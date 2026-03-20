import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Database, Mail } from 'lucide-react';
import { Card } from '../components/ui/card';
import { publicAPI } from '../lib/api';
import { Sensor } from '../lib/types';
import { SensorCard } from '../components/sensor-card';
import { supabase } from '../utils/supabase/client';

export default function PublicSensorsPage() {
  const navigate = useNavigate();
  const [sensors, setSensors] = useState<Sensor[]>([]);
  const [loading, setLoading] = useState(true);
  const [visibleCount, setVisibleCount] = useState(0);
  const [fetchError, setFetchError] = useState<string | null>(null);

  useEffect(() => {
    loadPublicSensors();
  }, []);

  // Real-time subscription for sensor changes
  useEffect(() => {
    const channel = supabase
      .channel('public-sensor-changes')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'kv_store_4a89e1c9',
          filter: 'key=like.sensor:%',
        },
        () => {
          // Reload public sensors when any sensor changes
          console.log('Sensor change detected, reloading public sensors');
          loadPublicSensors();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  const loadPublicSensors = async () => {
    try {
      setLoading(true);
      setFetchError(null); // Clear previous errors
      setVisibleCount(0); // Reset progressive rendering
      const data = await publicAPI.listPublicSensors();
      console.log('Public sensors loaded:', data?.length || 0);
      
      // Parse dates
      const parsedSensors = (data || []).map(sensor => ({
        ...sensor,
        createdAt: new Date(sensor.createdAt),
        updatedAt: sensor.updatedAt ? new Date(sensor.updatedAt) : undefined,
        lastReading: sensor.lastReading ? {
          ...sensor.lastReading,
          timestamp: new Date(sensor.lastReading.timestamp),
        } : undefined,
      }));
      
      setSensors(parsedSensors);
      setLoading(false);
      
      // Progressive rendering: reveal sensors one by one
      if (parsedSensors.length > 0) {
        parsedSensors.forEach((_, index) => {
          setTimeout(() => {
            setVisibleCount(index + 1);
          }, index * 100); // 100ms delay between each card
        });
      }
    } catch (error) {
      console.error('Failed to load public sensors:', error);
      setSensors([]);
      setLoading(false);
      
      // Set user-friendly error message
      if (error instanceof TypeError && error.message === 'Failed to fetch') {
        setFetchError('Edge Function not deployed. Run: supabase functions deploy server');
      } else {
        setFetchError('Unable to load public sensors. Please try again later.');
      }
    }
  };

  const handleViewSensor = (sensor: Sensor) => {
    navigate(`/audit?sensor=${sensor.id}`);
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="border-b border-border bg-card/50">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8 sm:py-10">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
              <Database className="w-5 h-5" style={{ color: 'var(--primary)' }} />
            </div>
            <div className="flex items-center gap-3">
              <h1 className="text-xl sm:text-2xl" style={{ fontWeight: 600, color: 'var(--text-primary)' }}>
                Public sensors
              </h1>
              {!loading && sensors.length > 0 && (
                <span className="text-xs px-2 py-0.5 rounded-full bg-primary/10 text-primary">
                  {sensors.length} {sensors.length === 1 ? 'sensor' : 'sensors'}
                </span>
              )}
            </div>
          </div>
          <p className="text-sm" style={{
            color: 'var(--text-secondary)',
            maxWidth: '600px',
            lineHeight: '1.6',
          }}>
            Real-time IoT sensor data verified on the Solana blockchain.
            Public datasets available for audit and acquisition.
          </p>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
        {fetchError ? (
          <Card className="p-8 bg-card border-border text-center max-w-lg mx-auto">
            <div className="flex flex-col items-center gap-4">
              <div className="w-12 h-12 rounded-lg bg-destructive/20 flex items-center justify-center">
                <Database className="w-6 h-6 text-destructive" />
              </div>
              <div>
                <h3 className="mb-2" style={{ fontWeight: 600, color: 'var(--text-primary)' }}>
                  Unable to load public sensors
                </h3>
                <p className="text-sm mb-4" style={{ color: 'var(--text-secondary)' }}>
                  {fetchError}
                </p>
                <button
                  className="px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm hover:opacity-90"
                  onClick={loadPublicSensors}
                >
                  Try again
                </button>
              </div>
            </div>
          </Card>
        ) : loading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {[1, 2, 3].map((i) => (
              <Card key={i} className="p-6 animate-pulse">
                <div className="h-4 bg-muted rounded w-3/4 mb-4"></div>
                <div className="h-3 bg-muted rounded w-1/2 mb-2"></div>
                <div className="h-3 bg-muted rounded w-2/3"></div>
              </Card>
            ))}
          </div>
        ) : sensors.length === 0 ? (
          <Card className="p-12 text-center max-w-lg mx-auto">
            <Database className="w-12 h-12 mx-auto mb-4" style={{ color: 'var(--muted-foreground)' }} />
            <h3 style={{ color: 'var(--text-primary)', marginBottom: '8px' }}>
              No public sensors available
            </h3>
            <p style={{ color: 'var(--text-secondary)', marginBottom: '12px' }}>
              Public sensors will appear here once sensor owners mark their datasets as public.
            </p>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>
              Check back later or register your own sensor to contribute to the public collection.
            </p>
          </Card>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {sensors.map((sensor, index) => (
              <div
                key={sensor.id}
                className={`transition-all duration-500 ${
                  index < visibleCount
                    ? 'opacity-100 translate-y-0'
                    : 'opacity-0 translate-y-4'
                }`}
              >
                <SensorCard
                  sensor={sensor}
                  onViewDetails={handleViewSensor}
                  showMiniSparkline={false}
                />
              </div>
            ))}
          </div>
        )}

        {/* Info Card */}
        <div className="mt-8 flex items-start gap-3 p-4 rounded-lg border border-border/50 bg-muted/20">
          <Mail className="w-4 h-4 mt-0.5 shrink-0" style={{ color: 'var(--text-muted)' }} />
          <p className="text-xs" style={{ color: 'var(--text-muted)', lineHeight: '1.5' }}>
            All datasets are available for acquisition through data negotiation.
            Click any sensor to view its data feed and public datasets, or contact the sensor owner for access details.
          </p>
        </div>
      </div>
    </div>
  );
}