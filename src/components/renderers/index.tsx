import type { Envelope } from '../../lib/envelope-types';
import { EnvironmentalRenderer } from './environmental';
import { ClassificationRenderer } from './classification';
import { TranscriptionRenderer } from './transcription';
import { GenericRenderer } from './generic';

/**
 * Dispatches to the correct renderer based on the envelope's event_type.
 * Unknown or third-party types fall back to the generic JSON viewer.
 * See ADR-010 §Rendering strategy (frontend).
 */
export function EnvelopeRenderer({ envelope }: { envelope: Envelope }) {
  switch (envelope.event_type) {
    case 'io.sparkedsense.sensor.environmental':
    case 'io.sparkedsense.sensor.generic':
      return <EnvironmentalRenderer envelope={envelope as Envelope<any>} />;
    case 'io.sparkedsense.inference.classification':
      return <ClassificationRenderer envelope={envelope as Envelope<any>} />;
    case 'io.sparkedsense.inference.transcription':
      return <TranscriptionRenderer envelope={envelope as Envelope<any>} />;
    default:
      return <GenericRenderer envelope={envelope} />;
  }
}

export { EnvironmentalRenderer, ClassificationRenderer, TranscriptionRenderer, GenericRenderer };
