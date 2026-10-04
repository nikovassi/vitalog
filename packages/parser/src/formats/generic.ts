import { extractMeta } from '../meta';
import { markDuplicates, parseResultLine } from '../normalize';
import type { LabFormatParser } from '../types';

/**
 * Fallback for any lab: every line shaped like "name · value · unit · range" (any column
 * order after the value, BG/EN, decimal comma or dot) becomes a candidate.
 */
export const genericTableParser: LabFormatParser = {
  id: 'generic-table',
  label: 'Обща таблица (всяка лаборатория)',
  detect: () => 0.1,
  parse(doc) {
    const candidates = markDuplicates(doc.lines.map((l) => parseResultLine(l)).filter((c) => c !== null));
    return { meta: extractMeta(doc, candidates, this.id), candidates };
  },
};
