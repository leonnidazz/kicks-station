// Menjalankan backend/server.js sungguhan dengan Telegram tiruan (database tidak dipakai).
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { webhookSecret } from '../index.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const freePort = () => new Promise((r) => { const s = net.createServer(); s.listen(0, () => { const p = s.address().port; s.close(() => r(p)); }); });

async function until(fn, ms = 8000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { const v = await fn(); if (v) return v; await sleep(80); }
  throw new Error('timeout menunggu kondisi');
}

test('server.js memasang webhook saat start dan memproses pesan Telegram', async () => {
  const calls = [];
  const tg = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      calls.push({ method: req.url.split('/').pop(), json: body ? JSON.parse(body) : {} });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, result: { message_id: 1 } }));
    });
  });
  tg.unref();
  await new Promise((r) => tg.listen(0, r));
  const port = await freePort();
  const env = {
    PATH: process.env.PATH, PORT: String(port), ADMIN_PIN: 'pin-benar-12345',
    TELEGRAM_BOT_TOKEN: 'TOKEN123', ALLOWED_CHAT_ID: '111',
    RENDER_EXTERNAL_URL: 'https://contoh.onrender.com',
    TELEGRAM_API_BASE: `http://localhost:${tg.address().port}`,
  };
  const child = spawn(process.execPath, ['backend/server.js'], { cwd: ROOT, env, stdio: 'ignore' });
  try {
    await until(async () => (await fetch(`http://127.0.0.1:${port}/`).catch(() => null))?.ok);
    const hook = await until(() => calls.find((c) => c.method === 'setWebhook'));
    const secret = webhookSecret(env);
    assert.equal(hook.json.url, 'https://contoh.onrender.com/telegram');
    assert.equal(hook.json.secret_token, secret);
    assert.deepEqual(hook.json.allowed_updates, ['message', 'callback_query']);

    const post = (body, s) => fetch(`http://127.0.0.1:${port}/telegram`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(s ? { 'X-Telegram-Bot-Api-Secret-Token': s } : {}) },
      body: JSON.stringify(body),
    });
    assert.equal((await post({ update_id: 1, message: { chat: { id: 111 }, text: '/start' } })).status, 403);
    assert.equal((await post({ update_id: 1, message: { chat: { id: 111 }, text: '/start' } }, 'salah-salah-salah-1')).status, 403);
    assert.equal(calls.filter((c) => c.method === 'sendMessage').length, 0);

    assert.equal((await post({ update_id: 2, message: { chat: { id: 111 }, text: '/start' } }, secret)).status, 200);
    const sent = await until(() => calls.find((c) => c.method === 'sendMessage'));
    assert.equal(String(sent.json.chat_id), '111');
    assert.match(sent.json.text, /Bot siap/);

    // chat asing diabaikan
    await post({ update_id: 3, message: { chat: { id: 999 }, text: '/start' } }, secret);
    await sleep(300);
    assert.equal(calls.filter((c) => c.method === 'sendMessage').length, 1);
  } finally {
    child.kill();
  }
});

test('tanpa TELEGRAM_BOT_TOKEN: rute /telegram tidak aktif dan server tetap normal', async () => {
  const port = await freePort();
  const env = { PATH: process.env.PATH, PORT: String(port), ADMIN_PIN: 'pin-benar-12345' };
  const child = spawn(process.execPath, ['backend/server.js'], { cwd: ROOT, env, stdio: 'ignore' });
  try {
    const res = await until(async () => { const r = await fetch(`http://127.0.0.1:${port}/`).catch(() => null); return r?.ok ? r : null; });
    assert.equal(res.status, 200);
    const t = await fetch(`http://127.0.0.1:${port}/telegram`, { method: 'POST', body: '{}' });
    assert.notEqual(t.status, 200);
  } finally {
    child.kill();
  }
});

test('klien bot bisa login admin ke server.js sendiri lewat 127.0.0.1', async () => {
  const { createKickstationClient } = await import('../kickstation.mjs');
  const port = await freePort();
  const env = { PATH: process.env.PATH, PORT: String(port), ADMIN_PIN: 'pin-benar-12345' };
  const child = spawn(process.execPath, ['backend/server.js'], { cwd: ROOT, env, stdio: 'ignore' });
  try {
    await until(async () => (await fetch(`http://127.0.0.1:${port}/`).catch(() => null))?.ok);
    const ok = createKickstationClient({ baseUrl: `http://127.0.0.1:${port}`, pin: 'pin-benar-12345' });
    await ok.login(); // tidak melempar error = token diterima
    const bad = createKickstationClient({ baseUrl: `http://127.0.0.1:${port}`, pin: 'salah-salah-1234' });
    await assert.rejects(() => bad.login(), /Login admin gagal \(401\)/);
  } finally {
    child.kill();
  }
});
