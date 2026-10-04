import type { ExtractedDocument, LabFormatParser } from '../types';
import { genericTableParser } from './generic';
import { syntheticBetaParser } from './synthetic-beta';

/** Register lab-specific parsers here. The generic parser is always the fallback. */
export const FORMAT_PARSERS: LabFormatParser[] = [syntheticBetaParser, genericTableParser];

export function selectParser(doc: ExtractedDocument, parsers = FORMAT_PARSERS): LabFormatParser {
  let best = genericTableParser;
  let bestScore = 0;
  for (const p of parsers) {
    const s = p.detect(doc);
    if (s > bestScore) {
      best = p;
      bestScore = s;
    }
  }
  return best;
}
