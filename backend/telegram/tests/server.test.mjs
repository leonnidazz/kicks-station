import test from 'node:test';
import assert from 'node:assert/strict';
import { createWebhookServer } from '../server.mjs';
import { normalizeBaseUrl } from '../kickstation.mjs';

const SECRET = 'rahasia-rahasia-1234';

async function start() {
  const got = [];
  const bot = { handleUpdate: async (u) => { got.push(u); } };
  const srv = createWebhookServer({ bot, secret: SECRET, log: { error() {} } });
  await new Promise((r) => srv.listen(0, r));
  const base = `http://localhost:${srv.address().port}`;
  const post = (body, secret) =>
    fetch(`${base}/telegram`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(secret ? { 'X-Telegram-Bot-Api-Secret-Token': secret } : {}) },
      body: JSON.stringify(body),
    });
  return { got, base, post, close: () => srv.close() };
}

test('webhook menolak tanpa/dengan rahasia salah, menerima yang benar', async () => {
  const { got, post, close } = await start();
  assert.equal((await post({ update_id: 1 })).status, 403);
  assert.equal((await post({ update_id: 1 }, 'salah-salah-salah-1')).status, 403);
  assert.equal(got.length, 0);
  assert.equal((await post({ update_id: 1, message: {} }, SECRET)).status, 200);
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(got.length, 1);
  close();
});

test('update yang sama (kirim ulang Telegram) hanya diproses sekali', async () => {
  const { got, post, close } = await start();
  await post({ update_id: 7 }, SECRET);
  await post({ update_id: 7 }, SECRET);
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(got.length, 1);
  close();
});

test('halaman utama membalas ok (cek hidup Render)', async () => {
  const { base, close } = await start();
  const res = await fetch(base + '/');
  assert.equal(res.status, 200);
  assert.equal(await res.text(), 'ok');
  close();
});

test('normalizeBaseUrl memperbaiki isian yang salah', () => {
  assert.equal(
    normalizeBaseUrl('KS_BASE_URL=https://kicks-station.onrender.com/api/admin/login'),
    'https://kicks-station.onrender.com'
  );
  assert.equal(normalizeBaseUrl('"https://kicks-station.onrender.com/"'), 'https://kicks-station.onrender.com');
  assert.throws(() => normalizeBaseUrl('kicks-station.onrender.com'), /KS_BASE_URL harus/);
  assert.throws(() => normalizeBaseUrl(''), /KS_BASE_URL harus/);
});
