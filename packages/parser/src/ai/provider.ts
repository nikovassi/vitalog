import { z } from 'zod';

/**
 * AI is an assistant for *structuring* text only. It never diagnoses, interprets or advises.
 * Its output is untrusted: validated with Zod, re-normalized by our own code, checked against
 * the source text, and always goes through human review.
 */

export const aiResultSchema = z.object({
  collectedAt: z.string().nullable(),
  laboratoryName: z.string().nullable(),
  results: z
    .array(
      z.object({
        name: z.string().min(1).max(160),
        value: z.string().min(1).max(60),
        unit: z.string().max(40).nullable(),
        referenceRange: z.string().max(80).nullable(),
        page: z.number().int().min(1).nullable(),
      }),
    )
    .max(300),
});
export type AiStructuredReport = z.infer<typeof aiResultSchema>;

export interface AIProvider {
  id: string;
  structure(documentText: string): Promise<AiStructuredReport>;
}

export const SYSTEM_PROMPT = `You convert the text of a laboratory report into JSON.
Rules:
- Copy names, values, units and reference ranges EXACTLY as printed. Do not translate, round, convert or correct anything.
- Only include rows that are laboratory measurements printed in the text. Never invent rows or values.
- If a value is unreadable, copy the characters as they appear.
- referenceRange is the printed range text (e.g. "35 - 52", "< 5,2"), or null.
- collectedAt: the sample collection date as YYYY-MM-DD if printed, else null.
- Do not add any interpretation, diagnosis, advice or commentary.`;

export const JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['collectedAt', 'laboratoryName', 'results'],
  properties: {
    collectedAt: { type: ['string', 'null'] },
    laboratoryName: { type: ['string', 'null'] },
    results: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'value', 'unit', 'referenceRange', 'page'],
        properties: {
          name: { type: 'string' },
          value: { type: 'string' },
          unit: { type: ['string', 'null'] },
          referenceRange: { type: ['string', 'null'] },
          page: { type: ['integer', 'null'] },
        },
      },
    },
  },
} as const;

/**
 * Data minimization before sending text to an AI provider: drop lines with direct
 * identifiers (patient name, personal ID / ЕГН, address, phone, email).
 */
export function redactForAi(text: string): string {
  return text
    .split('\n')
    .filter((l) => !/(пациент|patient|име|name|егн|лнч|personal id|адрес|address|тел|phone|e-?mail|роден|born|dob)\s*[:.]/i.test(l))
    .map((l) => l.replace(/\b\d{10}\b/g, '[ID]').replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, '[EMAIL]'))
    .join('\n');
}
