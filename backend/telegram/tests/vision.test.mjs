import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createVision, parseColors } from '../vision.mjs';

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);

async function mock(handler) {
  const calls = [];
  const srv = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const json = body ? JSON.parse(body) : {};
      calls.push({ url: req.url, headers: req.headers, json });
      const { code = 200, payload } = handler(req, json);
      res.writeHead(code, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(payload));
    });
  });
  srv.unref();
  await new Promise((r) => srv.listen(0, r));
  return { calls, base: `http://localhost:${srv.address().port}`, close: () => srv.close() };
}

test('parseColors: JSON, JSON berpagar kode, teks bebas, kunci tidak valid dibuang', () => {
  assert.deepEqual(parseColors('{"colors":["hijau","krem"]}'), ['krem', 'hijau']); // urutan mengikuti palet website
  assert.deepEqual(parseColors('```json\n{"colors":["putih"]}\n```'), ['putih']);
  assert.deepEqual(parseColors('hitam'), ['hitam']);
  assert.deepEqual(parseColors('{"colors":["ungu-neon","merah","hitam","putih","biru"]}').length, 3);
  assert.deepEqual(parseColors('tidak tahu'), []);
});

test('Gemini: kirim foto base64 dengan kunci di header, baca jawaban JSON', async () => {
  const m = await mock(() => ({ payload: { candidates: [{ content: { parts: [{ text: '{"colors":["hijau","krem"]}' }] } }] } }));
  const v = createVision({ provider: 'gemini', apiKey: 'KUNCI', apiBase: m.base });
  const colors = await v.detect(JPEG);
  assert.deepEqual(colors, ['krem', 'hijau']);
  const c = m.calls[0];
  assert.match(c.url, /^\/v1beta\/models\/gemini-flash-latest:generateContent$/);
  assert.equal(c.headers['x-goog-api-key'], 'KUNCI');
  assert.ok(!c.url.includes('KUNCI'), 'kunci tidak boleh ada di URL');
  const parts = c.json.contents[0].parts;
  assert.equal(parts[0].inline_data.mime_type, 'image/jpeg');
  assert.equal(parts[0].inline_data.data, JPEG.toString('base64'));
  assert.match(parts[1].text, /hijau \(/);
  m.close();
});

test('Anthropic: format pesan gambar dan header', async () => {
  const m = await mock(() => ({ payload: { content: [{ type: 'text', text: '{"colors":["biru"]}' }] } }));
  const v = createVision({ provider: 'anthropic', apiKey: 'K', apiBase: m.base });
  assert.deepEqual(await v.detect(JPEG), ['biru']);
  const c = m.calls[0];
  assert.equal(c.url, '/v1/messages');
  assert.equal(c.headers['x-api-key'], 'K');
  assert.equal(c.headers['anthropic-version'], '2023-06-01');
  assert.equal(c.json.model, 'claude-haiku-5-5');
  assert.equal(c.json.messages[0].content[0].source.type, 'base64');
  m.close();
});

test('error: kuota habis (429), jawaban kosong, foto diblokir', async () => {
  let mode = 429;
  const m = await mock(() =>
    mode === 429 ? { code: 429, payload: { error: { message: 'quota' } } }
    : mode === 'kosong' ? { payload: { candidates: [] } }
    : { payload: { promptFeedback: { blockReason: 'SAFETY' } } }
  );
  const v = createVision({ provider: 'gemini', apiKey: 'K', apiBase: m.base });
  await assert.rejects(() => v.detect(JPEG), /kuota AI habis/);
  mode = 'kosong';
  await assert.rejects(() => v.detect(JPEG), /kosong/);
  mode = 'blok';
  await assert.rejects(() => v.detect(JPEG), /ditolak/);
  m.close();
});

test('createVision: mati bila provider kosong, error jelas bila salah isi', () => {
  assert.equal(createVision({ provider: '' }), null);
  assert.equal(createVision({}), null);
  assert.throws(() => createVision({ provider: 'xyz', apiKey: 'k' }), /tidak dikenal/);
  assert.throws(() => createVision({ provider: 'gemini' }), /VISION_API_KEY/);
});

test('jawaban terlalu lama -> pesan jelas; server tak terjangkau -> pesan jelas', async () => {
  const slow = http.createServer(() => {}); // tidak pernah menjawab
  slow.unref();
  await new Promise((r) => slow.listen(0, r));
  const v = createVision({ provider: 'gemini', apiKey: 'K', apiBase: `http://localhost:${slow.address().port}`, timeoutMs: 80 });
  await assert.rejects(() => v.detect(JPEG), /terlalu lama menjawab/);
  slow.close();
  const dead = createVision({ provider: 'gemini', apiKey: 'K', apiBase: 'http://localhost:1', timeoutMs: 2000 });
  await assert.rejects(() => dead.detect(JPEG), /tidak bisa terhubung/);
});
