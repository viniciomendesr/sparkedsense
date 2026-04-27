import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '../components/ui/button';
import { Card } from '../components/ui/card';
import { Badge } from '../components/ui/badge';
import { Wifi, Shield, Database, CheckCircle2, ArrowRight, Activity, TrendingUp, GraduationCap, Users, Github, Linkedin, FileText, BookOpen, Hash } from 'lucide-react';
import { useAuth } from '../lib/auth-context';
import { publicAPI } from '../lib/api';
import { SensorMetrics } from '../lib/types';
import { supabase } from '../utils/supabase/client';
import { formatDataSize } from '../lib/format';
import { m } from '../paraglide/messages';

interface HomePageProps {
  onGetStarted: () => void;
}

export function HomePage({ onGetStarted }: HomePageProps) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [featuredSensors, setFeaturedSensors] = useState<SensorMetrics[]>([]);
  const [loadingFeatured, setLoadingFeatured] = useState(true);
  const [visibleCount, setVisibleCount] = useState(0);
  const [fetchError, setFetchError] = useState<string | null>(null);

  useEffect(() => {
    loadFeaturedSensors();
  }, []);

  // Real-time subscription for sensor changes
  useEffect(() => {
    const channel = supabase
      .channel('featured-sensor-changes')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'kv_store_4a89e1c9',
          filter: 'key=like.sensor:%',
        },
        () => {
          // Reload featured sensors when any sensor changes
          console.log('Sensor change detected, reloading featured sensors');
          loadFeaturedSensors();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  const loadFeaturedSensors = async () => {
    try {
      setLoadingFeatured(true);
      setFetchError(null); // Clear previous errors
      setVisibleCount(0); // Reset progressive rendering
      const data = await publicAPI.getFeaturedSensors();
      console.log('Featured sensors loaded:', data.sensors?.length || 0);
      setFeaturedSensors(data.sensors || []);
      setLoadingFeatured(false);
      
      // Progressive rendering: reveal sensors one by one
      if (data.sensors && data.sensors.length > 0) {
        data.sensors.forEach((_: any, index: number) => {
          setTimeout(() => {
            setVisibleCount(index + 1);
          }, index * 100); // 100ms delay between each card
        });
      }
    } catch (error) {
      console.error('Failed to load featured sensors:', error);
      setFeaturedSensors([]);
      setLoadingFeatured(false);
      
      // Set user-friendly error message
      if (error instanceof TypeError && error.message === 'Failed to fetch') {
        setFetchError('Edge Function not deployed. Run: supabase functions deploy server');
      } else {
        setFetchError('Unable to load featured sensors. Please try again later.');
      }
    }
  };

  const handleGetStarted = () => {
    if (user) {
      onGetStarted();
    }
  };

  const steps = [
    { number: 1, title: 'Sign In', description: 'Create your account' },
    { number: 2, title: 'Register', description: 'Register IoT sensors' },
    { number: 3, title: 'Stream', description: 'Send verifiable data' },
    { number: 4, title: 'Audit', description: 'Verify on blockchain' },
  ];

  const features = [
    {
      icon: <Wifi className="w-6 h-6" />,
      title: 'Real-time streaming',
      description: 'Live sensor data with cryptographic verification at the device level',
    },
    {
      icon: <Shield className="w-6 h-6" />,
      title: 'Blockchain anchoring',
      description: 'Dataset integrity proofs anchored on Solana for immutable verification',
    },
    {
      icon: <Database className="w-6 h-6" />,
      title: 'Decentralized storage',
      description: 'No centralized cloud dependency—full data provenance and ownership',
    },
  ];

  return (
    <div className="min-h-[calc(100vh-8rem)] flex flex-col">
      <style>{`
        @keyframes featured-pulse {
          0%, 100% { opacity: 0; background-position: -100% -100%; }
          50% { opacity: 0.12; background-position: 200% 200%; }
        }
        @keyframes featured-scan {
          0% { transform: translateX(-100%); }
          100% { transform: translateX(400%); }
        }
        .featured-card-active {
          animation: featured-glow 4s ease-in-out infinite;
        }
        @keyframes featured-glow {
          0%, 100% { box-shadow: 0 0 0px 0px transparent; }
          50% { box-shadow: 0 0 12px 1px var(--pulse-accent); }
        }
      `}</style>
      {/* Hero Section */}
      <section className="flex-1 flex items-center justify-center px-4 sm:px-6 py-12 sm:py-16">
        <div className="max-w-4xl mx-auto text-center">
          <div className="inline-flex items-center gap-2 px-3 sm:px-4 py-2 rounded-full bg-primary/10 border border-primary/20 mb-6">
            <CheckCircle2 className="w-4 h-4 text-primary shrink-0" />
            <span className="text-xs sm:text-sm" style={{ color: 'var(--primary)' }}>
              {m.home_hero_eyebrow()}
            </span>
          </div>

          <h1 className="text-2xl sm:text-4xl mb-6" style={{ fontWeight: 600, lineHeight: '1.2', color: 'var(--text-primary)' }}>
            {m.home_hero_title_lead()}
            <br />
            <span className="text-primary">{m.home_hero_title_highlight()}</span>
          </h1>

          <p className="mb-8 max-w-2xl mx-auto text-sm sm:text-lg" style={{ color: 'var(--text-secondary)', lineHeight: '1.6' }}>
            {m.home_hero_subtitle()}
          </p>

          <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-center gap-3 sm:gap-4">
            <Button
              onClick={handleGetStarted}
              size="lg"
              className="bg-primary text-primary-foreground"
              disabled={!user}
            >
              {user ? m.home_hero_cta_dashboard() : m.home_hero_cta_signin()}
              <ArrowRight className="w-4 h-4 ml-2" />
            </Button>
            <Button
              variant="outline"
              size="lg"
              className="border-primary/50 hover:bg-primary/5"
              onClick={() => navigate('/public-sensors')}
            >
              <Database className="w-4 h-4" />
              {m.home_hero_cta_public_sensors()}
            </Button>
          </div>
        </div>
      </section>

      {/* Featured Public Sensors */}
      {(featuredSensors.length > 0 || fetchError) && (
        <section className="px-4 sm:px-6 py-12 sm:py-16 border-t border-border">
          <div className="max-w-6xl mx-auto">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8">
              <div>
                <h2 className="text-xl sm:text-2xl" style={{ fontWeight: 600, color: 'var(--text-primary)', marginBottom: '8px' }}>
                  {m.home_featured_title()}
                </h2>
                <p className="text-sm sm:text-base" style={{ color: 'var(--text-secondary)' }}>
                  {m.home_featured_subtitle()}
                </p>
              </div>
              <Button
                variant="outline"
                onClick={() => navigate('/public-sensors')}
              >
                {m.home_featured_view_all()}
                <ArrowRight className="w-4 h-4" />
              </Button>
            </div>

            {fetchError ? (
              <Card className="p-8 bg-card border-border text-center">
                <div className="flex flex-col items-center gap-4">
                  <div className="w-12 h-12 rounded-lg bg-destructive/20 flex items-center justify-center">
                    <Database className="w-6 h-6 text-destructive" />
                  </div>
                  <div>
                    <h3 className="mb-2" style={{ fontWeight: 600, color: 'var(--text-primary)' }}>
                      {m.home_featured_error_title()}
                    </h3>
                    <p className="text-sm mb-4" style={{ color: 'var(--text-secondary)' }}>
                      {fetchError}
                    </p>
                    <p className="text-xs mb-4" style={{ color: 'var(--text-muted)' }}>
                      {m.home_featured_error_hint()}
                    </p>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={loadFeaturedSensors}
                    >
                      {m.home_featured_error_retry()}
                    </Button>
                  </div>
                </div>
              </Card>
            ) : (
              loadingFeatured ? (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  {[1, 2, 3].map((i) => (
                    <Card key={i} className="p-6 animate-pulse">
                      <div className="h-4 bg-muted rounded w-3/4 mb-4"></div>
                      <div className="h-3 bg-muted rounded w-1/2 mb-2"></div>
                      <div className="h-3 bg-muted rounded w-2/3"></div>
                    </Card>
                  ))}
                </div>
              ) : featuredSensors.length === 0 ? null : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  {featuredSensors.map((sensor, index) => (
                    <div
                      key={sensor.id}
                      className={`transition-all duration-500 ${
                        index < visibleCount
                          ? 'opacity-100 translate-y-0'
                          : 'opacity-0 translate-y-4'
                      }`}
                    >
                      <Card
                        className={`bg-card border-border hover:border-primary/50 transition-all duration-200 cursor-pointer relative overflow-hidden ${
                          sensor.status === 'active' ? 'featured-card-active' : ''
                        }`}
                        onClick={() => navigate(`/audit?sensor=${sensor.id}`)}
                      >
                        {sensor.status === 'active' && (
                          <div className="absolute inset-0 pointer-events-none rounded-[inherit] z-0 overflow-hidden">
                            <div className="absolute -inset-[1px] rounded-[inherit]"
                              style={{
                                background: 'linear-gradient(135deg, transparent 40%, var(--chart-1) 50%, transparent 60%)',
                                backgroundSize: '200% 200%',
                                animation: 'featured-pulse 3s ease-in-out infinite',
                              }}
                            />
                          </div>
                        )}

                        <div className="p-6 relative z-[1]">
                          {/* Header */}
                          <div className="flex items-start justify-between mb-3">
                            <div className="flex-1">
                              <div className="flex items-center gap-2 mb-2">
                                <h3 className="text-lg" style={{ fontWeight: 600, color: 'var(--text-primary)' }}>
                                  {sensor.name}
                                </h3>
                              </div>
                            </div>
                          </div>

                          {/* Badges */}
                          <div className="flex flex-wrap items-center gap-2 mb-4">
                            <Badge variant="outline" style={{ textTransform: 'capitalize' }}>
                              {sensor.type.charAt(0).toUpperCase() + sensor.type.slice(1)}
                            </Badge>
                            <Badge variant="outline" className="border-border">
                              <div className="flex items-center gap-1.5">
                                <div className={`w-2 h-2 rounded-full ${
                                  sensor.status === 'active' ? 'bg-success animate-pulse' : 'bg-[var(--text-disabled)]'
                                }`}></div>
                                {sensor.status === 'active' ? m.sensor_card_status_active() : m.sensor_card_status_inactive()}
                              </div>
                            </Badge>
                          </div>

                          {/* Last update */}
                          <div className="flex items-center justify-between p-3 rounded-lg bg-muted/50 mb-4 relative overflow-hidden">
                            <div className="flex items-center gap-2">
                              <Activity className={`w-4 h-4 text-primary ${sensor.status === 'active' ? 'animate-pulse' : ''}`} />
                              <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                                {m.sensor_card_latest_reading()}
                              </span>
                            </div>
                            <div className="text-right">
                              <p className="text-lg" style={{ fontWeight: 600, color: 'var(--text-primary)' }}>
                                {sensor.lastActivity
                                  ? new Date(sensor.lastActivity).toLocaleTimeString()
                                  : 'N/A'}
                              </p>
                              {sensor.lastActivity && (
                                <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                                  {new Date(sensor.lastActivity).toLocaleDateString()}
                                </p>
                              )}
                            </div>
                            {sensor.status === 'active' && (
                              <div className="absolute bottom-0 left-0 right-0 h-[2px] overflow-hidden">
                                <div className="h-full w-1/3 rounded-full"
                                  style={{
                                    background: 'linear-gradient(90deg, transparent, var(--chart-1), transparent)',
                                    animation: 'featured-scan 2.5s ease-in-out infinite',
                                  }}
                                />
                              </div>
                            )}
                          </div>

                          {/* Storage Metrics */}
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
                                {sensor.totalReadingsCount.toLocaleString()}
                              </p>
                            </div>
                          </div>

                          {/* Action button */}
                          <Button
                            className="w-full bg-primary text-primary-foreground"
                            onClick={(e) => {
                              e.stopPropagation();
                              navigate(`/audit?sensor=${sensor.id}`);
                            }}
                          >
                            {m.sensor_card_view_details()}
                          </Button>
                        </div>
                      </Card>
                    </div>
                  ))}
                </div>
              )
            )}
          </div>
        </section>
      )}

      {/* How It Works */}
      <section className="px-4 sm:px-6 py-12 sm:py-16 border-t border-border bg-card/30">
        <div className="max-w-6xl mx-auto">
          <h2 className="text-center mb-8 sm:mb-12 text-xl sm:text-2xl" style={{ fontWeight: 600, color: 'var(--text-primary)' }}>
            How it works
          </h2>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 sm:gap-6">
            {steps.map((step, index) => (
              <div key={step.number} className="relative">
                <Card className="p-6 bg-card border-border text-center h-full">
                  <div className="w-12 h-12 rounded-full bg-primary/20 text-primary flex items-center justify-center mx-auto mb-4" style={{ fontWeight: 600 }}>
                    {step.number}
                  </div>
                  <h3 className="mb-2" style={{ fontWeight: 600, color: 'var(--text-primary)' }}>
                    {step.title}
                  </h3>
                  <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                    {step.description}
                  </p>
                </Card>
                {index < steps.length - 1 && (
                  <div className="hidden md:block absolute top-1/2 -right-3 transform -translate-y-1/2 z-10">
                    <ArrowRight className="w-6 h-6 text-primary/50" />
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="px-4 sm:px-6 py-12 sm:py-16">
        <div className="max-w-6xl mx-auto">
          <h2 className="text-center mb-4 text-xl sm:text-2xl" style={{ fontWeight: 600, color: 'var(--text-primary)' }}>
            Open Infrastructure for verifiable physical data
          </h2>
          <p className="text-center mb-8 sm:mb-12 max-w-2xl mx-auto text-sm sm:text-base" style={{ color: 'var(--text-secondary)' }}>
            Sparked Sense bridges IoT devices, decentralized networks, and open environmental intelligence systems
          </p>
          
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {features.map((feature, index) => (
              <Card key={index} className="p-6 bg-card border-border hover:border-primary/50 transition-all duration-200">
                <div className="w-12 h-12 rounded-lg bg-primary/20 flex items-center justify-center text-primary mb-4">
                  {feature.icon}
                </div>
                <h3 className="mb-2" style={{ fontWeight: 600, color: 'var(--text-primary)' }}>
                  {feature.title}
                </h3>
                <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                  {feature.description}
                </p>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {false && (<>
      {/* Research Foundation */}
        <section className="px-4 sm:px-6 py-12 sm:py-16 border-t border-border bg-card/30">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-8 sm:mb-12">
            <h2 className="mb-3 text-xl sm:text-2xl" style={{ fontWeight: 600, color: 'var(--text-primary)' }}>
              <span style={{ color: 'var(--text-muted)' }}>//</span> Research foundation
            </h2>
            <p className="text-sm sm:text-base" style={{ color: 'var(--text-secondary)' }}>
              Built on rigorous academic research and scientific validation
            </p>
          </div>

          {/* Academic Partners Grid */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
            <Card className="p-6 bg-card border-border">
              <div className="flex items-start gap-3 mb-3">
                <div className="w-10 h-10 rounded-lg bg-primary/20 flex items-center justify-center flex-shrink-0">
                  <GraduationCap className="w-5 h-5 text-primary" />
                </div>
                <div>
                  <h3 className="mb-1" style={{ fontWeight: 600, color: 'var(--text-primary)' }}>
                    Academic partners
                  </h3>
                  <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                    Collaboration with leading research institutions worldwide
                  </p>
                </div>
              </div>
            </Card>

            <Card className="p-6 bg-card border-border">
              <div className="flex items-start gap-3 mb-3">
                <div className="w-10 h-10 rounded-lg bg-primary/20 flex items-center justify-center flex-shrink-0">
                  <FileText className="w-5 h-5 text-primary" />
                </div>
                <div>
                  <h3 className="mb-1" style={{ fontWeight: 600, color: 'var(--text-primary)' }}>
                    Peer-reviewed
                  </h3>
                  <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                    Research papers published in blockchain and IoT conferences
                  </p>
                </div>
              </div>
            </Card>

            <Card className="p-6 bg-card border-border">
              <div className="flex items-start gap-3 mb-3">
                <div className="w-10 h-10 rounded-lg bg-primary/20 flex items-center justify-center flex-shrink-0">
                  <BookOpen className="w-5 h-5 text-primary" />
                </div>
                <div>
                  <h3 className="mb-1" style={{ fontWeight: 600, color: 'var(--text-primary)' }}>
                    Open science
                  </h3>
                  <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                    Transparent methodology and reproducible results
                  </p>
                </div>
              </div>
            </Card>
          </div>

          {/* Research Partnerships */}
          <Card className="p-6 bg-card border-border mb-8">
            <h3 className="mb-4" style={{ fontWeight: 600, color: 'var(--text-primary)' }}>
              Research partnerships
            </h3>
            <p className="text-sm mb-6" style={{ color: 'var(--text-secondary)' }}>
              Partnerships under discussion to expand scientific development and sensor coverage
            </p>
            
            <div className="space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 p-4 rounded-lg bg-muted/30 border border-border">
                <div className="flex-1">
                  <h4 style={{ fontWeight: 500, color: 'var(--text-primary)' }}>
                    University labs
                  </h4>
                  <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
                    Expanding scientific development behind the infrastructure
                  </p>
                </div>
                <Badge variant="outline" className="bg-accent/20 text-accent border-accent/30">
                  Under Discussion
                </Badge>
              </div>

              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 p-4 rounded-lg bg-muted/30 border border-border">
                <div className="flex-1">
                  <h4 style={{ fontWeight: 500, color: 'var(--text-primary)' }}>
                    IoT developers
                  </h4>
                  <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
                    Sensor coverage validation and use case development
                  </p>
                </div>
                <Badge variant="outline" className="bg-success/20 text-success border-success/30">
                  Partnerships Forming
                </Badge>
              </div>

              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 p-4 rounded-lg bg-muted/30 border border-border">
                <div className="flex-1">
                  <h4 style={{ fontWeight: 500, color: 'var(--text-primary)' }}>
                    DePIN ecosystem
                  </h4>
                  <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
                    Integration with decentralized physical infrastructure networks
                  </p>
                </div>
                <Badge variant="outline" className="bg-secondary/20 text-secondary border-secondary/30">
                  Exploring
                </Badge>
              </div>
            </div>
          </Card>

          {/* Scientific Advisors */}
          <div className="mb-4">
            <h3 className="mb-6" style={{ fontWeight: 600, color: 'var(--text-primary)' }}>
              Scientific advisors
            </h3>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Prof. Dr. Eduardo Zancul */}
            <Card className="p-6 bg-card border-border">
              <div className="flex items-start gap-4 mb-4">
                <div className="w-12 h-12 rounded-lg bg-primary/20 flex items-center justify-center flex-shrink-0">
                  <GraduationCap className="w-6 h-6 text-primary" />
                </div>
                <div className="flex-1">
                  <h3 className="mb-1" style={{ fontWeight: 600, color: 'var(--text-primary)' }}>
                    Prof. Dr. Eduardo Zancul
                  </h3>
                  <p className="text-sm mb-2" style={{ color: 'var(--text-secondary)' }}>
                    Scientific advisor
                  </p>
                </div>
              </div>
              <div className="space-y-2">
                <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                  Associate Professor at the University of São Paulo (USP)
                </p>
                <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                  Coordinator of the Future Factory 4.0 Lab • PhD in Production Engineering
                </p>
                <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
                  Guiding methodological and technical validation for Sparked Sense
                </p>
              </div>
            </Card>

            {/* Otávio Vacari */}
            <Card className="p-6 bg-card border-border">
              <div className="flex items-start gap-4 mb-4">
                <div className="w-12 h-12 rounded-lg bg-primary/20 flex items-center justify-center flex-shrink-0">
                  <Shield className="w-6 h-6 text-primary" />
                </div>
                <div className="flex-1">
                  <h3 className="mb-1" style={{ fontWeight: 600, color: 'var(--text-primary)' }}>
                    Otávio Vacari
                  </h3>
                  <p className="text-sm mb-2" style={{ color: 'var(--text-secondary)' }}>
                    Technical advisor
                  </p>
                </div>
              </div>
              <div className="space-y-2">
                <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                  Computer Engineering (Poli-USP) and current master's student at the same institution
                </p>
                <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
                  Working on academic projects investigating applied cryptography, distributed systems, and their optimizations
                </p>
              </div>
            </Card>
          </div>
        </div>
      </section>

      {/* Core Team */}
      <section className="px-4 sm:px-6 py-12 sm:py-16 border-t border-border">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-8 sm:mb-12">
            <h2 className="mb-3 text-xl sm:text-2xl" style={{ fontWeight: 600, color: 'var(--text-primary)' }}>
              <span style={{ color: 'var(--text-muted)' }}>//</span> Core team
            </h2>
            <p className="text-sm sm:text-base" style={{ color: 'var(--text-secondary)' }}>
              Experienced builders combining academic rigor with industry expertise
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {/* Vinicio Mendes */}
            <Card className="p-6 bg-card border-border">
              <div className="mb-4">
                <div className="inline-flex items-center justify-center w-12 h-12 rounded-lg bg-primary/20 mb-3">
                  <span style={{ fontSize: '1.25rem', fontWeight: 600, color: 'var(--primary)' }}>VM</span>
                </div>
                <h3 className="mb-1" style={{ fontWeight: 600, color: 'var(--text-primary)' }}>
                  Vinicio Mendes
                </h3>
                <p className="text-sm mb-3" style={{ color: 'var(--primary)' }}>
                  Project creator & product lead
                </p>
                <p className="text-sm mb-4" style={{ color: 'var(--text-secondary)', lineHeight: '1.5' }}>
                  Production Engineering (POLI-USP) • Ex-Founder 2 educational startups • 3+ years product development experience
                </p>
              </div>
              <div className="mb-4 pb-4 border-b border-border">
                <p className="text-xs mb-2" style={{ color: 'var(--success)' }}>
                  Expertise
                </p>
                <div className="flex flex-wrap gap-2">
                  <Badge variant="outline" className="text-xs">Blockchain Researcher</Badge>
                  <Badge variant="outline" className="text-xs">Product Designer</Badge>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                  <Github className="w-4 h-4" />
                </Button>
                <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                  <Linkedin className="w-4 h-4" />
                </Button>
              </div>
            </Card>

            {/* Nicolas Gabriel */}
            <Card className="p-6 bg-card border-border">
              <div className="mb-4">
                <div className="inline-flex items-center justify-center w-12 h-12 rounded-lg bg-primary/20 mb-3">
                  <span style={{ fontSize: '1.25rem', fontWeight: 600, color: 'var(--primary)' }}>NG</span>
                </div>
                <h3 className="mb-1" style={{ fontWeight: 600, color: 'var(--text-primary)' }}>
                  Nicolas Gabriel
                </h3>
                <p className="text-sm mb-3" style={{ color: 'var(--primary)' }}>
                  Project creator & development lead
                </p>
                <p className="text-sm mb-4" style={{ color: 'var(--text-secondary)', lineHeight: '1.5' }}>
                  Computer Engineering (UFMT) • Ex-Founder 2 educational startups • Mid-Level Full-Stack Developer
                </p>
              </div>
              <div className="mb-4 pb-4 border-b border-border">
                <p className="text-xs mb-2" style={{ color: 'var(--success)' }}>
                  Expertise
                </p>
                <div className="flex flex-wrap gap-2">
                  <Badge variant="outline" className="text-xs">Full-Stack Developer</Badge>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                  <Github className="w-4 h-4" />
                </Button>
                <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                  <Linkedin className="w-4 h-4" />
                </Button>
              </div>
            </Card>

            {/* Pedro Goularte */}
            <Card className="p-6 bg-card border-border">
              <div className="mb-4">
                <div className="inline-flex items-center justify-center w-12 h-12 rounded-lg bg-primary/20 mb-3">
                  <span style={{ fontSize: '1.25rem', fontWeight: 600, color: 'var(--primary)' }}>PG</span>
                </div>
                <h3 className="mb-1" style={{ fontWeight: 600, color: 'var(--text-primary)' }}>
                  Pedro Goularte
                </h3>
                <p className="text-sm mb-3" style={{ color: 'var(--primary)' }}>
                  Project creator & infrastructure lead
                </p>
                <p className="text-sm mb-4" style={{ color: 'var(--text-secondary)', lineHeight: '1.5' }}>
                  Computer Engineering (POLI-USP) • Specialized in decentralized infrastructure
                </p>
              </div>
              <div className="mb-4 pb-4 border-b border-border">
                <p className="text-xs mb-2" style={{ color: 'var(--success)' }}>
                  Expertise
                </p>
                <div className="flex flex-wrap gap-2">
                  <Badge variant="outline" className="text-xs">Distributed Systems</Badge>
                  <Badge variant="outline" className="text-xs">Infrastructure</Badge>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                  <Github className="w-4 h-4" />
                </Button>
                <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                  <Linkedin className="w-4 h-4" />
                </Button>
              </div>
            </Card>

            {/* Paulo Ricardo */}
            <Card className="p-6 bg-card border-border">
              <div className="mb-4">
                <div className="inline-flex items-center justify-center w-12 h-12 rounded-lg bg-primary/20 mb-3">
                  <span style={{ fontSize: '1.25rem', fontWeight: 600, color: 'var(--primary)' }}>PR</span>
                </div>
                <h3 className="mb-1" style={{ fontWeight: 600, color: 'var(--text-primary)' }}>
                  Paulo Ricardo
                </h3>
                <p className="text-sm mb-3" style={{ color: 'var(--primary)' }}>
                  Project creator & communication lead
                </p>
                <p className="text-sm mb-4" style={{ color: 'var(--text-secondary)', lineHeight: '1.5' }}>
                  Production Engineer (UFJF), specialized in project and product management, and institutional communication
                </p>
              </div>
              <div className="mb-4 pb-4 border-b border-border">
                <p className="text-xs mb-2" style={{ color: 'var(--success)' }}>
                  Expertise
                </p>
                <div className="flex flex-wrap gap-2">
                  <Badge variant="outline" className="text-xs">Project Management</Badge>
                  <Badge variant="outline" className="text-xs">Communication</Badge>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                  <Github className="w-4 h-4" />
                </Button>
                <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                  <Linkedin className="w-4 h-4" />
                </Button>
              </div>
            </Card>
          </div>
        </div>
      </section>
      </>)}

      {/* CTA */}
      <section className="px-4 sm:px-6 py-12 sm:py-16 border-t border-border bg-card/30">
        <div className="max-w-4xl mx-auto text-center">
          <h2 className="mb-4 text-xl sm:text-2xl" style={{ fontWeight: 600, color: 'var(--text-primary)' }}>
            Ready to get started?
          </h2>
          <p className="mb-8 text-sm sm:text-base" style={{ color: 'var(--text-secondary)' }}>
            Connect your wallet and register your first sensor in minutes
          </p>
          <Button 
            onClick={onGetStarted}
            size="lg"
            className="bg-primary text-primary-foreground"
          >
            Get started
          </Button>
        </div>
      </section>
    </div>
  );
}