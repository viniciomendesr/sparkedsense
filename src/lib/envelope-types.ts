/**
 * CloudEvents 1.0 envelope carrying a typed payload, per ADR-010.
 * See docs/adr/010-sensor-agnostic-ingestion-envelope.md.
 */
export interface Envelope<TData = unknown> {
  id: string;
  spec_version: string;
  event_type: string;
  source: string;
  time: string;
  datacontenttype: string;
  data: TData;
  device_id: string;
  signature: string;
  created_at: string;
}

export interface SenmlRecord {
  n: string;
  u: string;
  v?: number;
  vs?: string;
  vb?: boolean;
  vd?: string;
  t?: number;
  bn?: string;
  bt?: number;
}

export interface ClassificationData {
  class: string;
  confidence: number;
  class_vocabulary?: string[];
  scores?: number[];
  model_id: string;
  model_version?: string;
  inference_ms?: number;
  source_event_id?: string;
}

export interface RegressionData {
  value: number;
  unit?: string;
  uncertainty?: number;
  model_id: string;
  model_version?: string;
  inference_ms?: number;
  source_event_id?: string;
}

export interface DetectionData {
  detected: boolean;
  event_duration_ms?: number;
  peak_intensity?: number;
  confidence?: number;
  model_id: string;
  model_version?: string;
  source_event_id?: string;
}

export interface TranscriptionData {
  text: string;
  language?: string;
  engine: string;
  duration_processed_ms?: number;
  confidence?: number;
  source_event_id?: string;
}

export interface SemanticSummaryData {
  summary: string;
  keywords?: string[];
  topics?: string[];
  sentiment?: 'positive' | 'neutral' | 'negative' | 'mixed';
  engine: string;
  source_event_id?: string;
  source_event_ids?: string[];
}
