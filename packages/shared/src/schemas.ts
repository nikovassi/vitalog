import { z } from 'zod';

/** Zod schemas shared by API validation and web forms. Error messages are Bulgarian. */

export const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Невалидна дата')
  .refine((s) => !Number.isNaN(Date.parse(s)), 'Невалидна дата');

export const passwordSchema = z
  .string()
  .min(10, 'Паролата трябва да е поне 10 символа')
  .max(200, 'Паролата е твърде дълга');

export const emailSchema = z.string().trim().toLowerCase().email('Невалиден email').max(254);

export const CONSENT_VERSION = '2026-10-01';

export const registerSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  displayName: z.string().trim().min(1, 'Въведи име').max(80),
  consentHealthData: z.literal(true, { message: 'Необходимо е съгласие за обработка на здравни данни' }),
  consentVersion: z.string().max(32),
});

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, 'Въведи парола').max(200),
});

export const mfaCodeSchema = z.object({ code: z.string().trim().min(6).max(20) });
export const forgotSchema = z.object({ email: emailSchema });
export const resetSchema = z.object({ token: z.string().min(20).max(200), password: passwordSchema });
export const tokenSchema = z.object({ token: z.string().min(20).max(200) });
export const reauthSchema = z.object({ password: z.string().min(1).max(200) });
export const changePasswordSchema = z.object({ currentPassword: z.string().min(1).max(200), newPassword: passwordSchema });

export const profileUpdateSchema = z.object({
  displayName: z.string().trim().min(1).max(80).optional(),
  fullName: z.string().trim().max(160).nullable().optional(),
  birthYear: z.number().int().min(1900).max(2100).nullable().optional(),
  theme: z.enum(['system', 'light', 'dark']).optional(),
  onboardingCompleted: z.boolean().optional(),
  aiProcessingConsent: z.boolean().optional(),
});

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((s) => (s === '' ? null : s))
    .nullable()
    .optional();

export const referenceRangeInput = z
  .object({
    low: z.number().finite().nullable(),
    high: z.number().finite().nullable(),
    text: z.string().max(120).nullable().optional(),
  })
  .refine((r) => r.low === null || r.high === null || r.low <= r.high, 'Минимумът е по-голям от максимума');

export const manualResultSchema = z.object({
  biomarkerId: z.string().max(64).nullable(),
  originalName: z.string().trim().min(1, 'Въведи показател').max(160),
  collectedAt: isoDate,
  valueText: z.string().trim().min(1, 'Въведи стойност').max(60),
  unit: z.string().trim().max(40).nullable(),
  referenceRange: referenceRangeInput.nullable(),
  sourceLabel: optionalText(160),
  note: optionalText(2000),
  reportId: z.string().uuid().nullable().optional(),
});

export const resultEditSchema = z.object({
  valueText: z.string().trim().min(1).max(60).optional(),
  unit: z.string().trim().max(40).nullable().optional(),
  referenceRange: referenceRangeInput.nullable().optional(),
  biomarkerId: z.string().max(64).nullable().optional(),
  collectedAt: isoDate.optional(),
});

export const reportTypeEnum = z.enum(['blood', 'hormones', 'urine', 'biochemistry', 'mixed', 'other']);

export const reportUpdateSchema = z.object({
  title: z.string().trim().min(1).max(160).optional(),
  reportType: reportTypeEnum.optional(),
  collectedAt: isoDate.optional(),
  specialistId: z.string().uuid().nullable().optional(),
});

export const candidateDecisionSchema = z.object({
  id: z.string().uuid(),
  decision: z.enum(['accepted', 'rejected']),
  biomarkerId: z.string().max(64).nullable(),
  originalName: z.string().trim().min(1).max(160),
  valueText: z.string().trim().min(1).max(60),
  unit: z.string().trim().max(40).nullable(),
  referenceRange: referenceRangeInput.nullable(),
});

export const confirmReviewSchema = z.object({
  meta: z.object({
    collectedAt: isoDate,
    title: z.string().trim().min(1).max(160),
    reportType: reportTypeEnum,
    laboratoryName: z.string().trim().max(160).nullable(),
    specialistId: z.string().uuid().nullable(),
  }),
  candidates: z.array(candidateDecisionSchema).max(500),
});

export const specialistSchema = z.object({
  name: z.string().trim().min(1, 'Въведи име').max(160),
  specialty: z.string().trim().min(1, 'Въведи специалност').max(120),
  phone: optionalText(40).refine((v) => !v || /^[+\d\s()\-/]{5,40}$/.test(v), 'Невалиден телефон'),
  email: z.union([z.literal(''), emailSchema]).transform((v) => (v === '' ? null : v)).nullable().optional(),
  address: optionalText(300),
  clinic: optionalText(160),
  website: z
    .union([z.literal(''), z.string().trim().url('Невалиден адрес').max(300).refine((u) => /^https?:\/\//i.test(u), 'Само http/https адреси')])
    .transform((v) => (v === '' ? null : v))
    .nullable()
    .optional(),
  note: optionalText(2000),
  lastVisitAt: isoDate.nullable().optional().or(z.literal('').transform(() => null)),
  nextVisitAt: isoDate.nullable().optional().or(z.literal('').transform(() => null)),
});

export const noteSchema = z.object({
  targetType: z.enum(['report', 'biomarker', 'specialist', 'appointment', 'general']),
  targetId: z.string().max(64).nullable(),
  body: z.string().trim().min(1, 'Бележката е празна').max(4000),
});

export const timelineEventSchema = z.object({
  kind: z.enum(['appointment', 'medication_start', 'medication_stop', 'diet_change', 'exercise', 'vaccination', 'imaging', 'note', 'other']),
  title: z.string().trim().min(1, 'Въведи заглавие').max(160),
  date: isoDate,
  description: optionalText(2000),
  showOnCharts: z.boolean().default(true),
});

export const documentUpdateSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  category: z.enum(['lab_results', 'imaging', 'discharge_summary', 'outpatient_sheet', 'prescription', 'other']).optional(),
  documentDate: isoDate.nullable().optional(),
});

export const shareCreateSchema = z.object({
  label: z.string().trim().min(1, 'Въведи име на линка').max(120),
  biomarkerIds: z.union([z.literal('all'), z.array(z.string().max(64)).min(1, 'Избери поне един показател').max(200)]),
  from: isoDate.nullable(),
  to: isoDate.nullable(),
  includeSpecialists: z.boolean(),
  expiresInHours: z.number().int().min(1).max(24 * 30),
});

export const summaryRequestSchema = z.object({
  from: isoDate.nullable(),
  to: isoDate.nullable(),
  biomarkerIds: z.union([z.literal('all'), z.array(z.string().max(64)).max(200)]),
  includePatientName: z.boolean(),
  includeCharts: z.boolean(),
  includeHistory: z.boolean(),
  includeSpecialists: z.boolean(),
  includeDocuments: z.boolean(),
});

export const deleteAccountSchema = z.object({
  password: z.string().min(1).max(200),
  confirmation: z.literal('ИЗТРИЙ', { message: 'Напиши ИЗТРИЙ, за да потвърдиш' }),
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type ManualResultInput = z.infer<typeof manualResultSchema>;
export type ResultEditInput = z.infer<typeof resultEditSchema>;
export type ConfirmReviewInput = z.infer<typeof confirmReviewSchema>;
export type SpecialistInput = z.infer<typeof specialistSchema>;
export type NoteInput = z.infer<typeof noteSchema>;
export type TimelineEventInput = z.infer<typeof timelineEventSchema>;
export type ShareCreateInput = z.infer<typeof shareCreateSchema>;
export type SummaryRequestInput = z.infer<typeof summaryRequestSchema>;
export type ProfileUpdateInput = z.infer<typeof profileUpdateSchema>;
