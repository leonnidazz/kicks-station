import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createBot } from '../bot.mjs';
import { createKickstationClient } from '../kickstation.mjs';

const TOKEN = 'TESTTOKEN';
const SAMPLE =
  'New Riliss‼ Skechers Summits Black size : 41, 42, 43, retail 1.499.000,- Special Price 550.000,-✅ ☎ Wa mimin * https://wa.me/62895611247400';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const listen = (srv) => new Promise((r) => srv.listen(0, () => r(srv.address().port)));

async function setup() {
  const tg = { sent: [], edits: 0, edited: [], downloads: 0 };
  const ksCalls = [];
  const tgSrv = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      if (req.method === 'GET' && req.url.startsWith(`/file/bot${TOKEN}/`)) {
        tg.downloads++;
        res.writeHead(200); return res.end(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]));
      }
      const method = req.url.split('/').pop();
      const json = body ? JSON.parse(body) : {};
      const ok = (result) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ ok: true, result })); };
      if (method === 'getFile') return ok({ file_path: 'photos/a.jpg' });
      if (method === 'sendMessage') { tg.sent.push(json); return ok({ message_id: 7 }); }
      if (method === 'editMessageReplyMarkup') { tg.edits++; return ok(true); }
      if (method === 'editMessageText') { tg.edited.push(json); return ok(true); }
      return ok(true);
    });
  });
  const ksSrv = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const json = body ? JSON.parse(body) : {};
      ksCalls.push({ url: req.url, auth: req.headers.authorization, json });
      const send = (c, o) => { res.writeHead(c, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };
      if (req.url === '/api/admin/login') return send(200, { success: true, token: 't1', expiresAt: Date.now() + 3.6e6 });
      if (req.url === '/api/products') return send(201, { success: true, product: { id: 42 } });
      send(404, {});
    });
  });
  const tgPort = await listen(tgSrv);
  const ksPort = await listen(ksSrv);
  tgSrv.unref();
  ksSrv.unref(); // supaya tes tidak menggantung bila ada assertion gagal
  const ks = createKickstationClient({ baseUrl: `http://localhost:${ksPort}`, pin: 'pin-benar-12345' });
  const quiet = { log() {}, error() {} };
  const mk = (allowedChatId, extra = {}) =>
    createBot({ token: TOKEN, allowedChatId, ks, collectDelayMs: 30, apiBase: `http://localhost:${tgPort}`, log: quiet, ...extra });
  return { tg, ksCalls, mk, close: () => { tgSrv.close(); ksSrv.close(); } };
}

const photoMsg = (chat, caption) => ({
  update_id: 1,
  message: { chat: { id: chat }, photo: [{ file_id: 's' }, { file_id: 'l' }], ...(caption ? { caption } : {}) },
});

test('foto + caption -> preview dengan tombol -> tekan tambah -> produk terkirim', async () => {
  const { tg, ksCalls, mk, close } = await setup();
  const bot = mk('111');
  await bot.handleUpdate(photoMsg(111, SAMPLE));
  await sleep(150);

  assert.equal(tg.sent.length, 1);
  assert.match(tg.sent[0].text, /Skechers Summits Black/);
  assert.match(tg.sent[0].text, /Rp 1\.025\.000/);
  assert.match(tg.sent[0].text, /coret Rp 1\.499\.000/);
  const rows = tg.sent[0].reply_markup.inline_keyboard;
  const btn = rows.at(-1)[0];
  assert.deepEqual(rows[0].map((b) => b.callback_data), ['t:1:kasual', 't:1:running']);
  assert.deepEqual(rows[1].map((b) => b.callback_data), ['u:1:pria', 'u:1:wanita', 'u:1:unisex']);
  assert.equal(btn.callback_data, 'ok:1');
  assert.equal(ksCalls.length, 0, 'belum boleh posting sebelum tombol ditekan');

  await bot.handleUpdate({ update_id: 2, callback_query: { id: 'c1', data: 'ok:1', from: { id: 111 }, message: { chat: { id: 111 }, message_id: 7 } } });
  const post = ksCalls.find((c) => c.url === '/api/products');
  assert.equal(post.auth, 'Bearer t1');
  assert.equal(post.json.harga, 1025000);
  assert.equal(post.json.gambar.length, 1);
  assert.match(tg.sent.at(-1).text, /✅ Produk ditambahkan/);

  // klik ganda tidak boleh posting dua kali
  await bot.handleUpdate({ update_id: 3, callback_query: { id: 'c2', data: 'ok:1', from: { id: 111 }, message: { chat: { id: 111 }, message_id: 7 } } });
  assert.equal(ksCalls.filter((c) => c.url === '/api/products').length, 1);
  close();
});

test('foto dan teks dikirim terpisah tetap digabung', async () => {
  const { tg, mk, close } = await setup();
  const bot = mk('111');
  await bot.handleUpdate(photoMsg(111));
  await bot.handleUpdate(photoMsg(111));
  await sleep(100);
  assert.match(tg.sent.at(-1).text, /Foto diterima \(2\)/);
  await bot.handleUpdate({ update_id: 5, message: { chat: { id: 111 }, text: SAMPLE } });
  await sleep(100);
  assert.match(tg.sent.at(-1).text, /Foto: 2/);
  assert.ok(tg.sent.at(-1).reply_markup);
  close();
});

test('tombol batal tidak memposting', async () => {
  const { ksCalls, mk, close } = await setup();
  const bot = mk('111');
  await bot.handleUpdate(photoMsg(111, SAMPLE));
  await sleep(100);
  await bot.handleUpdate({ update_id: 2, callback_query: { id: 'c', data: 'no:1', from: { id: 111 }, message: { chat: { id: 111 }, message_id: 7 } } });
  assert.equal(ksCalls.length, 0);
  close();
});

test('chat tidak dikenal diabaikan; ALLOWED_CHAT_ID kosong -> balas Chat ID', async () => {
  const { tg, tgSent, mk, close } = await setup();
  const stranger = mk('111');
  await stranger.handleUpdate(photoMsg(999, SAMPLE));
  await sleep(100);
  assert.equal(tg.sent.length, 0);
  assert.equal(tg.downloads, 0);

  const unset = mk('');
  await unset.handleUpdate({ update_id: 9, message: { chat: { id: 555 }, text: 'halo' } });
  assert.match(tg.sent.at(-1).text, /Chat ID kamu: 555/);
  close();
});

test('tombol jenis dan untuk siapa mengubah data yang dikirim ke website', async () => {
  const { tg, ksCalls, mk, close } = await setup();
  const bot = mk('111');
  await bot.handleUpdate(photoMsg(111, SAMPLE));
  await sleep(100);
  const cb = (data) => ({ update_id: 9, callback_query: { id: 'c', data, from: { id: 111 }, message: { chat: { id: 111 }, message_id: 7 } } });

  await bot.handleUpdate(cb('u:1:pria'));
  await bot.handleUpdate(cb('t:1:running'));
  assert.equal(tg.edited.length, 2);
  assert.match(tg.edited.at(-1).text, /Jenis: running \| Untuk: pria/);
  assert.match(JSON.stringify(tg.edited.at(-1).reply_markup), /✓ Pria/);
  assert.equal(ksCalls.length, 0, 'mengubah pilihan tidak boleh memposting');

  await bot.handleUpdate(cb('u:1:semua')); // nilai tidak valid diabaikan
  assert.equal(tg.edited.length, 2);

  await bot.handleUpdate(cb('ok:1'));
  const post = ksCalls.find((c) => c.url === '/api/products');
  assert.equal(post.json.tipe, 'running');
  assert.equal(post.json.pengguna, 'pria');
  close();
});

test('tombol warna: pilihan awal dari nama, bisa diubah, dikirim eksplisit ke website', async () => {
  const { tg, ksCalls, mk, close } = await setup();
  const bot = mk('111');
  await bot.handleUpdate(photoMsg(111, SAMPLE)); // "Skechers Summits Black" -> hitam
  await sleep(100);
  assert.match(tg.sent[0].text, /Warna: Hitam/);
  const rows = tg.sent[0].reply_markup.inline_keyboard;
  const colorBtns = rows.slice(2, -1).flat();
  assert.equal(colorBtns.length, 13);
  assert.match(JSON.stringify(rows), /✓ Hitam/);

  const cb = (data) => ({ update_id: 9, callback_query: { id: 'c', data, from: { id: 111 }, message: { chat: { id: 111 }, message_id: 7 } } });
  await bot.handleUpdate(cb('c:1:hijau'));
  await bot.handleUpdate(cb('c:1:hitam'));
  assert.match(tg.edited.at(-1).text, /Warna: Hijau/);
  assert.doesNotMatch(tg.edited.at(-1).text, /Hitam/);
  await bot.handleUpdate(cb('c:1:bukan-warna')); // tidak valid diabaikan
  assert.equal(tg.edited.length, 2);

  await bot.handleUpdate(cb('ok:1'));
  const post = ksCalls.find((c) => c.url === '/api/products');
  assert.deepEqual(post.json.warna, ['hijau']);
  close();
});

const NO_COLOR_TEXT = '*New Rillis‼️*\n\n_Specs Airglide Women sugar swizzle_\n\n*Size : 37, 38, 39*\n\n *Special Price 350.000 saja✅*';

test('nama tanpa warna -> warna dideteksi dari foto, ditandai, bisa dikoreksi, terkirim ke website', async () => {
  const { tg, ksCalls, mk, close } = await setup();
  const seen = [];
  const vision = { detect: async (buf) => { seen.push(buf.length); return ['hijau', 'krem']; } };
  const bot = mk('111', { vision });
  await bot.handleUpdate(photoMsg(111, NO_COLOR_TEXT));
  await sleep(120);
  assert.equal(seen.length, 1);
  assert.match(tg.sent[0].text, /Warna: Krem, Hijau \(dari foto, cek dulu\)/);

  const cb = (data) => ({ update_id: 9, callback_query: { id: 'c', data, from: { id: 111 }, message: { chat: { id: 111 }, message_id: 7 } } });
  await bot.handleUpdate(cb('c:1:krem')); // koreksi manual
  assert.match(tg.edited.at(-1).text, /Warna: Hijau\n/);
  assert.doesNotMatch(tg.edited.at(-1).text, /dari foto/);
  await bot.handleUpdate(cb('ok:1'));
  assert.deepEqual(ksCalls.find((c) => c.url === '/api/products').json.warna, ['hijau']);
  close();
});

test('nama sudah menyebut warna -> AI tidak dipanggil (hemat kuota)', async () => {
  const { tg, mk, close } = await setup();
  let called = 0;
  const bot = mk('111', { vision: { detect: async () => { called++; return ['merah']; } } });
  await bot.handleUpdate(photoMsg(111, SAMPLE)); // "... Black"
  await sleep(120);
  assert.equal(called, 0);
  assert.match(tg.sent[0].text, /Warna: Hitam(\n|$)/);
  close();
});

test('AI gagal -> pratinjau tetap muncul dengan peringatan dan warna belum dipilih', async () => {
  const { tg, mk, close } = await setup();
  const bot = mk('111', { vision: { detect: async () => { throw new Error('kuota AI habis, coba lagi nanti'); } } });
  await bot.handleUpdate(photoMsg(111, NO_COLOR_TEXT));
  await sleep(120);
  assert.match(tg.sent[0].text, /Deteksi warna dari foto gagal \(kuota AI habis/);
  assert.match(tg.sent[0].text, /belum dipilih/);
  assert.ok(tg.sent[0].reply_markup);
  close();
});
