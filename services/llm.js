/**
 * Pluggable LLM client using the OpenAI-compatible /v1/chat/completions format.
 *
 * Works with any compatible endpoint:
 *   - Ollama local:  http://localhost:11434  (no apiKey needed)
 *   - OpenAI:        https://api.openai.com  (apiKey required)
 *   - vLLM / LM Studio / any OpenAI-compatible server
 *
 * Uses Node's built-in fetch (Node 18+). No external npm dependency.
 */
async function chatCompletion({ endpoint, model, messages, apiKey }) {
  const base = String(endpoint || '').replace(/\/+$/, '');
  const url = `${base}/v1/chat/completions`;

  const headers = { 'Content-Type': 'application/json' };
  if (apiKey) {
    headers['Authorization'] = `Bearer ${apiKey}`;
  }

  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({ model, messages, stream: false }),
    });
  } catch (err) {
    throw new Error(
      `Could not reach LLM endpoint at ${base}. Is the server running? (${err.message})`
    );
  }

  if (!res.ok) {
    let detail = '';
    try {
      const body = await res.json();
      detail = body.error?.message || body.error || JSON.stringify(body);
    } catch {
      detail = await res.text().catch(() => res.statusText);
    }
    throw new Error(`LLM request failed (${res.status}): ${detail}`);
  }

  const data = await res.json();
  const reply = data.choices?.[0]?.message?.content;
  if (!reply) {
    throw new Error('LLM returned an empty response.');
  }
  const usage = data.usage || null;
  return { reply, usage };
}

module.exports = { chatCompletion };
