import { extractMeta } from '../meta';
import { markDuplicates, parseResultLine } from '../normalize';
import type { LabFormatParser } from '../types';

/**
 * Example of a lab-specific format (synthetic test lab "Бета", used by the fixtures).
 * Fixed columns: Код | Изследване | Резултат | Флаг | Мерна единица | Референтни стойности.
 * A real lab is added the same way: detect a unique header, map the columns.
 */
const HEADER = /SYNTHLAB-BETA/;

export const syntheticBetaParser: LabFormatParser = {
  id: 'synthetic-beta-v1',
  label: 'Синтетична лаборатория „Бета“ (тестов формат)',
  detect(doc) {
    return doc.lines.slice(0, 15).some((l) => HEADER.test(l.text)) ? 0.95 : 0;
  },
  parse(doc) {
    const headerIdx = doc.lines.findIndex((l) => /^код$/i.test(l.cells[0] ?? '') && /изследване/i.test(l.cells[1] ?? ''));
    const rows = doc.lines.filter((l, i) => i > headerIdx && /^\d{3,5}$/.test(l.cells[0] ?? ''));
    const candidates = markDuplicates(
      rows
        .map((l) => {
          // the flag column is empty for most rows → shift columns accordingly
          const hasFlag = /^(H|L|\*|↑|↓)$/.test(l.cells[3] ?? '');
          return parseResultLine(l, {
            columns: hasFlag
              ? { code: 0, name: 1, value: 2, unit: 4, range: 5, comment: 6 }
              : { code: 0, name: 1, value: 2, unit: 3, range: 4, comment: 5 },
          });
        })
        .filter((c) => c !== null),
    );
    return { meta: extractMeta(doc, candidates, this.id), candidates };
  },
};
