import { config } from '../config';

/**
 * Transactional email. Emails contain links only – never medical data.
 * console: prints to the server log (development). smtp: wire a provider with an EU DPA.
 */
export async function sendEmail(to: string, subject: string, text: string): Promise<void> {
  if (config.EMAIL_PROVIDER === 'console') {
    console.info(`\n── email to ${to} ──\n${subject}\n\n${text}\n──────────────\n`);
    return;
  }
  // SMTP transport intentionally not bundled; see docs/07-DEPLOYMENT.md (EU email provider).
  throw new Error('SMTP email provider not configured');
}
