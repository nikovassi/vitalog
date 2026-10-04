import type { ExtractedReportMeta, ExtractionCandidate, JobErrorCode, JobStage } from '@vitalog/shared';

/** One reconstructed text line. Cells are separated where the horizontal gap is large. */
export interface TextLine {
  page: number;
  text: string;
  cells: string[];
  /** 0..1, only for OCR lines. Text-layer lines are 1. */
  confidence: number;
  y: number;
}

export interface ExtractedDocument {
  pageCount: number;
  lines: TextLine[];
  usedOcr: boolean;
}

/** Candidate before it gets a DB id. */
export type DraftCandidate = Omit<ExtractionCandidate, 'id' | 'jobId' | 'decision'>;

export interface ParsedReport {
  meta: ExtractedReportMeta;
  candidates: DraftCandidate[];
}

/**
 * A laboratory/PDF format. Add a new lab by implementing this interface in
 * src/formats/<lab>.ts and registering it in src/formats/registry.ts.
 */
export interface LabFormatParser {
  id: string;
  label: string;
  /** 0..1 – how confident the parser is that the document is in its format. */
  detect(doc: ExtractedDocument): number;
  parse(doc: ExtractedDocument): ParsedReport;
}

export interface OcrWord { text: string; x0: number; x1: number; confidence: number }
export interface OcrLine { words: OcrWord[]; y: number; confidence: number }

export interface OcrProvider {
  id: string;
  /** Recognize one rendered page image (PNG). */
  recognize(png: Uint8Array, pageNumber: number): Promise<OcrLine[]>;
  terminate?(): Promise<void>;
}

export interface ProgressUpdate {
  stage: JobStage;
  stageProgress: number;
  pagesTotal?: number;
  pagesDone?: number;
}

export class ProcessingError extends Error {
  constructor(public code: JobErrorCode, message?: string) {
    super(message ?? code);
  }
}
