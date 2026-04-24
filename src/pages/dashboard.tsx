import { useState, useEffect } from 'react';
import { Button } from '../components/ui/button';
import { Card } from '../components/ui/card';
import { SensorCard } from '../components/sensor-card';
import { RegisterSensorDialog } from '../components/register-sensor-dialog';
import { ActivateSensorDialog } from '../components/activate-sensor-dialog';
import { Sensor, LiveData } from '../lib/types';
import { generateLiveReading } from '../lib/mock-data';
import { Plus, Activity, Database, CheckCircle2, TrendingUp, Zap } from 'lucide-react';
import { useAuth } from '../lib/auth-context';
import { sensorAPI, statsAPI, readingAPI } from '../lib/api';
import { supabase } from '../utils/supabase/client';
import { toast } from 'sonner@2.0.3';

interface DashboardPageProps {
  onViewSensor: (sensor: Sensor) => void;
}

export function DashboardPage({ onViewSensor }: DashboardPageProps) {
  const { accessToken, user } = useAuth();
  const [registerDialogOpen, setRegisterDialogOpen] = useState(false);
  const [activateDialogOpen, setActivateDialogOpen] = useState(false);
  const [sensors, setSensors] = useState<Sensor[]>([]);
  const [stats, setStats] = useState({
    totalSensors: 0,
    activeSensors: 0,
    totalReadings: 0,
    totalDatasets: 0,
  });
  const [loading, setLoading] = useState(true);
  const [liveDataMap, setLiveDataMap] = useState<Map<string, LiveData>>(new Map());

  // Load sensors and stats on mount
  useEffect(() => {
    const loadData = async () => {
      if (!accessToken) return;
      
      try {
        setLoading(true);
        const [sensorsData, statsData] = await Promise.all([
          sensorAPI.list(accessToken),
          statsAPI.get(accessToken),
        ]);
        
        // Parse dates
        const parsedSensors = sensorsData.map(s => ({
          ...s,
          createdAt: new Date(s.createdAt),
          lastReading: s.lastReading ? {
            ...s.lastReading,
            timestamp: new Date(s.lastReading.timestamp),
          } : undefined,
        }));
        
        setSensors(parsedSensors);
        setStats(statsData);
      } catch (error: any) {
        console.error('Failed to load dashboard data:', error);
        toast.error('Failed to load dashboard data');
      } finally {
        setLoading(false);
      }
    };

    loadData();
  }, [accessToken]);

  // Real-time subscription for sensor updates
  useEffect(() => {
    if (!user) return;

    const channel = supabase
      .channel('sensor-changes')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'kv_store_4a89e1c9',
          filter: `key=like.sensor:${user.id}:%`,
        },
        () => {
          // Reload sensors when changes detected
          if (accessToken) {
            sensorAPI.list(accessToken).then(sensorsData => {
              const parsedSensors = sensorsData.map(s => ({
                ...s,
                createdAt: new Date(s.createdAt),
                lastReading: s.lastReading ? {
                  ...s.lastReading,
                  timestamp: new Date(s.lastReading.timestamp),
                } : undefined,
              }));
              setSensors(parsedSensors);
            });
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user, accessToken]);

  // Poll sensors + stats every 10 seconds (fallback if Supabase Realtime misses updates)
  useEffect(() => {
    if (!accessToken) return;

    const pollDashboard = async () => {
      try {
        const [sensorsData, statsData] = await Promise.all([
          sensorAPI.list(accessToken),
          statsAPI.get(accessToken),
        ]);
        const parsedSensors = sensorsData.map(s => ({
          ...s,
          createdAt: new Date(s.createdAt),
          lastReading: s.lastReading ? {
            ...s.lastReading,
            timestamp: new Date(s.lastReading.timestamp),
          } : undefined,
        }));
        setSensors(parsedSensors);
        setStats(statsData);
      } catch (error) {
        console.error('Dashboard poll error:', error);
      }
    };

    const interval = setInterval(pollDashboard, 10000);
    return () => clearInterval(interval);
  }, [accessToken]);

  // Live data for active sensors: mock sensors use generated data, real sensors poll API
  useEffect(() => {
    const intervals: NodeJS.Timeout[] = [];

    sensors.forEach(sensor => {
      if (sensor.status === 'active') {
        // Initialize with some data
        const initialData: LiveData = {
          sensorId: sensor.id,
          values: Array.from({ length: 30 }, (_, i) => ({
            timestamp: new Date(Date.now() - (29 - i) * 2000),
            value: sensor.lastReading?.value || 0,
          })),
          isConnected: true,
        };

        setLiveDataMap(prev => new Map(prev).set(sensor.id, initialData));

        if (sensor.mode === 'mock') {
          // Mock sensors: generate fake data every 2 seconds
          const interval = setInterval(() => {
            setLiveDataMap(prev => {
              const current = prev.get(sensor.id);
              if (!current) return prev;

              const lastValue = current.values[current.values.length - 1]?.value;
              const newReading = generateLiveReading(sensor.id, sensor.type, lastValue);

              const newValues = [
                ...current.values.slice(-29),
                { timestamp: newReading.timestamp, value: newReading.value }
              ];

              const newMap = new Map(prev);
              newMap.set(sensor.id, { ...current, values: newValues });
              return newMap;
            });
          }, 2000);
          intervals.push(interval);
        } else if (sensor.mode !== 'mock' && accessToken) {
          // Real + unsigned_dev sensors: poll API every 15 seconds.
          // ADR-012: unsigned_dev publishes real firmware events (with signature
          // bypass) and must be polled the same way — never fed synthetic data.
          const pollRealData = async () => {
            try {
              const readingsData = await readingAPI.list(sensor.id, accessToken, 30);
              const parsedReadings = readingsData.map(r => ({
                timestamp: new Date(r.timestamp),
                value: r.value,
              }));
              if (parsedReadings.length > 0) {
                setLiveDataMap(prev => {
                  const newMap = new Map(prev);
                  newMap.set(sensor.id, {
                    sensorId: sensor.id,
                    values: parsedReadings,
                    isConnected: true,
                  });
                  return newMap;
                });
              }
            } catch (error) {
              console.error('Failed to poll real sensor data:', error);
            }
          };
          // Poll immediately, then every 3 seconds for snappy card sparklines.
          // Backend rate-limits ingestion at 5s so this can't out-pace events.
          pollRealData();
          const interval = setInterval(pollRealData, 3000);
          intervals.push(interval);
        }
      }
    });

    return () => {
      intervals.forEach(interval => clearInterval(interval));
    };
  }, [sensors, accessToken]);

  const handleAddSensor = async (newSensor: Omit<Sensor, 'id' | 'owner' | 'createdAt' | 'status'>) => {
    if (!accessToken) return;

    try {
      const sensor = await sensorAPI.create(newSensor, accessToken);
      const parsedSensor = {
        ...sensor,
        createdAt: new Date(sensor.createdAt),
      };
      setSensors(prev => [...prev, parsedSensor]);
      setRegisterDialogOpen(false);
      toast.success('Sensor registered successfully!', {
        description: 'Your sensor has been created',
      });
    } catch (error: any) {
      console.error('Failed to create sensor:', error);
      toast.error('Failed to create sensor');
    }
  };

  const handleActivateSensor = () => {
    // Open register dialog after activation tutorial
    setActivateDialogOpen(false);
    setRegisterDialogOpen(true);
  };

  const statCards = [
    {
      icon: <Activity className="w-5 h-5" />,
      label: 'Active Sensors',
      value: stats.activeSensors.toString(),
      color: 'text-success',
    },
    {
      icon: <Database className="w-5 h-5" />,
      label: 'Total Readings',
      value: stats.totalReadings.toLocaleString(),
      color: 'text-secondary',
    },
    {
      icon: <CheckCircle2 className="w-5 h-5" />,
      label: 'Verified Datasets',
      value: stats.totalDatasets.toString(),
      color: 'text-primary',
    },
    {
      icon: <TrendingUp className="w-5 h-5" />,
      label: 'Total Sensors',
      value: stats.totalSensors.toString(),
      color: 'text-success',
    },
  ];

  if (loading) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="flex items-center justify-center min-h-[400px]">
          <div className="text-center">
            <Activity className="w-8 h-8 animate-pulse text-primary mx-auto mb-4" />
            <p style={{ color: 'var(--text-secondary)' }}>Loading dashboard...</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      {/* Welcome Header */}
      <div className="mb-8">
        <h1 className="mb-2" style={{ fontSize: '1.75rem', fontWeight: 600, color: 'var(--text-primary)' }}>
          Welcome back, <span className="text-primary">{user?.user_metadata?.name || 'User'}</span>
        </h1>
        <p style={{ color: 'var(--text-secondary)' }}>
          Your connected sensors and real-time data streams
        </p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        {statCards.map((stat, index) => (
          <Card key={index} className="p-4 bg-card border-border">
            <div className="flex items-center gap-3">
              <div className={`${stat.color}`}>
                {stat.icon}
              </div>
              <div>
                <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
                  {stat.label}
                </p>
                <p className="text-xl" style={{ fontWeight: 600, color: 'var(--text-primary)' }}>
                  {stat.value}
                </p>
              </div>
            </div>
          </Card>
        ))}
      </div>

      {/* Actions */}
      <div className="flex items-center justify-between mb-6">
        <h2 style={{ fontSize: '1.25rem', fontWeight: 600, color: 'var(--text-primary)' }}>
          Your Sensors
        </h2>
        <div className="flex gap-3">
          <Button
            onClick={() => setActivateDialogOpen(true)}
            variant="outline"
            className="border-primary text-primary hover:bg-primary/10"
          >
            <Zap className="w-4 h-4 mr-2" />
            Activate Sensor
          </Button>
          <Button
            onClick={() => setRegisterDialogOpen(true)}
            className="bg-primary text-primary-foreground"
          >
            <Plus className="w-4 h-4 mr-2" />
            Register Sensor
          </Button>
        </div>
      </div>

      {/* Sensors Grid */}
      {sensors.length === 0 ? (
        <Card className="p-12 bg-card border-border border-dashed text-center">
          <div className="max-w-md mx-auto">
            <div className="w-16 h-16 rounded-full bg-muted/50 flex items-center justify-center mx-auto mb-4">
              <Plus className="w-8 h-8 text-muted-foreground" />
            </div>
            <h3 className="mb-2" style={{ fontWeight: 600, color: 'var(--text-primary)' }}>
              No sensors yet
            </h3>
            <p className="mb-6" style={{ color: 'var(--text-secondary)' }}>
              Click "Register Sensor" to connect your first IoT device and start streaming verifiable data
            </p>
            <Button
              onClick={() => setRegisterDialogOpen(true)}
              className="bg-primary text-primary-foreground"
            >
              <Plus className="w-4 h-4 mr-2" />
              Register Your First Sensor
            </Button>
          </div>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {sensors.map(sensor => (
            <SensorCard
              key={sensor.id}
              sensor={sensor}
              liveData={liveDataMap.get(sensor.id)?.values}
              onViewDetails={onViewSensor}
            />
          ))}
        </div>
      )}

      {/* Register Dialog */}
      <RegisterSensorDialog
        open={registerDialogOpen}
        onOpenChange={setRegisterDialogOpen}
        onRegister={handleAddSensor}
      />

      {/* Activate Dialog */}
      <ActivateSensorDialog
        open={activateDialogOpen}
        onOpenChange={setActivateDialogOpen}
        onComplete={handleActivateSensor}
      />
    </div>
  );
}