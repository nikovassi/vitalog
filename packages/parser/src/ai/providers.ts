import { aiResultSchema, JSON_SCHEMA, SYSTEM_PROMPT, type AIProvider, type AiStructuredReport } from './provider';

const TIMEOUT_MS = 60_000;

async function postJson(url: string, headers: Record<string, string>, body: unknown): Promise<unknown> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`AI provider HTTP ${res.status}`);
  return res.json();
}

/**
 * OpenAI Chat Completions–compatible API. Works with OpenAI, Azure OpenAI (EU Data Zone
 * deployment) and Mistral La Plateforme (EU) by changing AI_BASE_URL / AI_MODEL.
 */
export class OpenAICompatibleProvider implements AIProvider {
  id = 'openai-compatible';
  constructor(private cfg: { apiKey: string; baseUrl: string; model: string }) {}

  async structure(documentText: string): Promise<AiStructuredReport> {
    const json = (await postJson(
      `${this.cfg.baseUrl.replace(/\/$/, '')}/chat/completions`,
      { authorization: `Bearer ${this.cfg.apiKey}` },
      {
        model: this.cfg.model,
        temperature: 0,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: documentText },
        ],
        response_format: { type: 'json_schema', json_schema: { name: 'lab_report', strict: true, schema: JSON_SCHEMA } },
      },
    )) as { choices?: Array<{ message?: { content?: string } }> };
    const content = json.choices?.[0]?.message?.content;
    if (!content) throw new Error('AI provider returned no content');
    return aiResultSchema.parse(JSON.parse(content));
  }
}

/** Anthropic Messages API with a forced tool call for structured output. */
export class AnthropicProvider implements AIProvider {
  id = 'anthropic';
  constructor(private cfg: { apiKey: string; model: string; baseUrl?: string }) {}

  async structure(documentText: string): Promise<AiStructuredReport> {
    const json = (await postJson(
      `${(this.cfg.baseUrl ?? 'https://api.anthropic.com').replace(/\/$/, '')}/v1/messages`,
      { 'x-api-key': this.cfg.apiKey, 'anthropic-version': '2023-06-01' },
      {
        model: this.cfg.model,
        max_tokens: 8000,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: documentText }],
        tools: [{ name: 'lab_report', description: 'Structured laboratory report rows', input_schema: JSON_SCHEMA }],
        tool_choice: { type: 'tool', name: 'lab_report' },
      },
    )) as { content?: Array<{ type: string; input?: unknown }> };
    const tool = json.content?.find((c) => c.type === 'tool_use');
    if (!tool) throw new Error('AI provider returned no tool output');
    return aiResultSchema.parse(tool.input);
  }
}

/** Deterministic provider for tests and demo – returns a canned response. */
export class MockProvider implements AIProvider {
  id = 'mock';
  calls = 0;
  constructor(private response: AiStructuredReport | ((text: string) => AiStructuredReport) = { collectedAt: null, laboratoryName: null, results: [] }) {}
  async structure(text: string): Promise<AiStructuredReport> {
    this.calls++;
    return aiResultSchema.parse(typeof this.response === 'function' ? this.response(text) : this.response);
  }
}
