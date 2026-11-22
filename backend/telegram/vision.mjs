// Deteksi warna sepatu dari foto memakai AI penglihat (Gemini gratis, atau Claude berbayar).
import { COLORS, normalizeColors } from './colors.mjs';
import { sniff } from './kickstation.mjs';

const MAX_DETECTED = 3;

function buildPrompt() {
  const list = COLORS.map((c) => `${c.key} (${c.words.slice(0, 5).join(', ')})`).join('; ');
  return (
    'You are helping an online shoe shop tag its products by color. ' +
    'Look ONLY at the shoe in the photo. Ignore hands, skin, watches, floor, shoe boxes, tissue paper and background. ' +
    `Pick the main colors of the shoe (upper and sole), at most ${MAX_DETECTED}, using ONLY these keys: ${list}. ` +
    'Ignore tiny logos and small accents. If there are more than three equally strong colors, answer multi. ' +
    'Reply with JSON only, no other text: {"colors":["key"]}'
  );
}

export function parseColors(text) {
  const raw = String(text || '');
  let list = [];
  try {
    const m = raw.match(/\{[\s\S]*\}/);
    list = JSON.parse(m ? m[0] : raw).colors;
  } catch {
    list = raw.toLowerCase().match(/[a-z]+/g) || [];
  }
  return normalizeColors(Array.isArray(list) ? list : []).slice(0, MAX_DETECTED);
}

async function post(url, headers, body, timeoutMs, fetchImpl) {
  let res;
  try {
    res = await fetchImpl(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (e) {
    if (e?.name === 'TimeoutError' || e?.name === 'AbortError') {
      throw new Error(`AI terlalu lama menjawab (lebih dari ${Math.round(timeoutMs / 1000)} detik)`);
    }
    throw new Error('tidak bisa terhubung ke AI, cek internet');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = String(data.error?.message || data.error?.type || '').slice(0, 120);
    throw new Error(res.status === 429 ? 'kuota AI habis, coba lagi nanti' : `AI penglihat ${res.status}${msg ? ': ' + msg : ''}`);
  }
  return data;
}

const PROVIDERS = {
  gemini: {
    model: 'gemini-flash-latest',
    base: 'https://generativelanguage.googleapis.com',
    async run({ buf, apiKey, model, base, timeoutMs, fetchImpl }) {
      const [mime] = sniff(buf);
      const data = await post(
        `${base}/v1beta/models/${model}:generateContent`,
        { 'x-goog-api-key': apiKey },
        {
          contents: [{ parts: [{ inline_data: { mime_type: mime, data: buf.toString('base64') } }, { text: buildPrompt() }] }],
          generationConfig: { temperature: 0, responseMimeType: 'application/json' },
        },
        timeoutMs,
        fetchImpl
      );
      const text = (data.candidates?.[0]?.content?.parts || []).map((p) => p.text || '').join('');
      if (!text) throw new Error(data.promptFeedback?.blockReason ? 'foto ditolak penyaring AI' : 'jawaban AI kosong');
      return text;
    },
  },
  anthropic: {
    model: 'claude-haiku-5-5',
    base: 'https://api.anthropic.com',
    async run({ buf, apiKey, model, base, timeoutMs, fetchImpl }) {
      const [mime] = sniff(buf);
      const data = await post(
        `${base}/v1/messages`,
        { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
        {
          model,
          max_tokens: 100,
          messages: [{
            role: 'user',
            content: [
              { type: 'image', source: { type: 'base64', media_type: mime, data: buf.toString('base64') } },
              { type: 'text', text: buildPrompt() },
            ],
          }],
        },
        timeoutMs,
        fetchImpl
      );
      const text = (data.content || []).find((b) => b.type === 'text')?.text;
      if (!text) throw new Error('jawaban AI kosong');
      return text;
    },
  },
};

// Mengembalikan null bila fitur tidak diaktifkan (VISION_PROVIDER kosong).
export function createVision({ provider, apiKey, model, apiBase, timeoutMs = 60000, fetchImpl = fetch } = {}) {
  const name = String(provider || '').trim().toLowerCase();
  if (!name) return null;
  const p = PROVIDERS[name];
  if (!p) throw new Error(`VISION_PROVIDER "${provider}" tidak dikenal. Pilih: gemini atau anthropic.`);
  if (!apiKey) throw new Error('VISION_API_KEY belum diisi.');
  const cfg = { apiKey, model: model || p.model, base: String(apiBase || p.base).replace(/\/+$/, ''), timeoutMs, fetchImpl };
  return {
    provider: name,
    model: cfg.model,
    async detect(buf) {
      return parseColors(await p.run({ ...cfg, buf }));
    },
  };
}
