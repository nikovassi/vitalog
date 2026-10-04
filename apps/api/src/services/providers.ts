import path from 'node:path';
import { AnthropicProvider, MockProvider, NoopOcr, OpenAICompatibleProvider, TesseractOcr, type AIProvider, type OcrProvider } from '@vitalog/parser';
import { config } from '../config';

/** Provider abstraction: swap OCR/AI vendors via environment variables only. */
let ocr: OcrProvider | null = null;
export function getOcr(): OcrProvider {
  ocr ??= config.OCR_PROVIDER === 'tesseract'
    ? new TesseractOcr({ langPath: config.TESSERACT_LANG_PATH, cachePath: path.resolve(process.cwd(), config.TESSERACT_CACHE_DIR) })
    : new NoopOcr();
  return ocr;
}

export function getAi(): AIProvider | null {
  switch (config.AI_PROVIDER) {
    case 'openai':
      return new OpenAICompatibleProvider({ apiKey: config.AI_API_KEY!, baseUrl: config.AI_BASE_URL, model: config.AI_MODEL });
    case 'anthropic':
      return new AnthropicProvider({ apiKey: config.AI_API_KEY!, model: config.AI_MODEL });
    case 'mock':
      return new MockProvider();
    default:
      return null;
  }
}
