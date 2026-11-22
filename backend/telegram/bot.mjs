import { parseSupplierMessage, looksLikeProduct } from './parser.mjs';
import { COLORS, MAX_COLORS, colorLabel, isColorKey, normalizeColors } from './colors.mjs';

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const SESSION_TTL_MS = 10 * 60 * 1000;
const rp = (n) => 'Rp ' + String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
const chunk = (arr, n) => Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, i * n + n));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function createBot({
  token,
  allowedChatId,
  ks,
  roundTo = 1000,
  noRetailMarkup = 200000,
  vision = null,
  collectDelayMs = 5000,
  apiBase = 'https://api.telegram.org',
  log = console,
}) {
  const sessions = new Map(); // chatId -> { text, lastText, images, timer, updatedAt }
  const previews = new Map(); // id -> { product, images, supplierPrice }
  let seq = 0;

  async function api(method, params = {}, timeoutMs = 30000) {
    const res = await fetch(`${apiBase}/bot${token}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const data = await res.json().catch(() => ({}));
    if (!data.ok) throw new Error(`Telegram ${method}: ${data.description || res.status}`);
    return data.result;
  }

  const say = (chatId, text, extra = {}) =>
    api('sendMessage', { chat_id: chatId, text, ...extra }).catch((e) => log.error(e.message));

  async function downloadFile(fileId) {
    const f = await api('getFile', { file_id: fileId });
    const res = await fetch(`${apiBase}/file/bot${token}/${f.file_path}`, {
      signal: AbortSignal.timeout(60000),
    });
    if (!res.ok) throw new Error(`Unduh foto gagal (${res.status})`);
    return Buffer.from(await res.arrayBuffer());
  }

  function summaryOf(d) {
    const p = d.product;
    return (
      `${p.nama}
Merk: ${p.brand}
Jenis: ${p.tipe} | Untuk: ${p.pengguna}
Ukuran: ${p.sizes.join(', ')}
` +
      `Supplier: ${rp(d.supplierPrice)} → Jual: ${rp(p.harga)} (coret ${rp(p.harga_coret)})
` +
      `Foto: ${d.images.length}\nWarna: ${p.warna?.length ? p.warna.map(colorLabel).join(', ') + (d.warnaSource === 'foto' ? ' (dari foto, cek dulu)' : '') : '⚠️ belum dipilih (tidak muncul di filter warna)'}` +
      (d.warnings.length ? `
Catatan: ${d.warnings.join(' ')}` : '')
    );
  }

  function keyboard(id, p) {
    const mark = (on, label) => (on ? '✓ ' : '') + label;
    const btn = (text, data) => ({ text, callback_data: data });
    return {
      inline_keyboard: [
        [btn(mark(p.tipe === 'kasual', 'Kasual'), `t:${id}:kasual`), btn(mark(p.tipe === 'running', 'Running'), `t:${id}:running`)],
        [
          btn(mark(p.pengguna === 'pria', 'Pria'), `u:${id}:pria`),
          btn(mark(p.pengguna === 'wanita', 'Wanita'), `u:${id}:wanita`),
          btn(mark(p.pengguna === 'unisex', 'Unisex'), `u:${id}:unisex`),
        ],
        ...chunk(COLORS, 4).map((row) =>
          row.map((c) => btn(mark((p.warna || []).includes(c.key), c.label), `c:${id}:${c.key}`))
        ),
        [btn('✅ Tambah ke website', `ok:${id}`), btn('❌ Batal', `no:${id}`)],
      ],
    };
  }

  async function sendPreview(chatId, data, header) {
    const id = String(++seq);
    data.header = header;
    previews.set(id, data);
    await say(chatId, `${header}

${summaryOf(data)}`, { reply_markup: keyboard(id, data.product) });
  }

  async function finalize(chatId) {
    const s = sessions.get(chatId);
    if (!s) return;
    if (!s.text && !s.images.length) { sessions.delete(chatId); return; }
    if (!s.text) {
      let hint = 'Kirim teks produk dari supplier (yang berisi retail dan special price).';
      if (s.lastText) {
        const r = parseSupplierMessage(s.lastText, { roundTo, noRetailMarkup });
        if (!r.ok) hint = `Teks belum bisa dibaca:\n- ${r.errors.join('\n- ')}`;
      }
      await say(chatId, `Foto diterima (${s.images.length}). ${hint}`);
      return;
    }
    if (!s.images.length) {
      await say(chatId, 'Teks produk diterima. Sekarang kirim foto produknya.');
      return;
    }
    const r = parseSupplierMessage(s.text, { roundTo, noRetailMarkup });
    sessions.delete(chatId);
    if (!r.ok) {
      await say(chatId, `⚠️ Tidak bisa diproses:\n- ${r.errors.join('\n- ')}`);
      return;
    }
    let warnaSource = r.product.warna.length ? 'nama' : null;
    if (vision && !r.product.warna.length) {
      try {
        const found = normalizeColors(await vision.detect(s.images[0]));
        if (found.length) { r.product.warna = found; warnaSource = 'foto'; }
        else r.warnings.push('Warna tidak terdeteksi dari foto.');
      } catch (e) {
        r.warnings.push(`Deteksi warna dari foto gagal (${e.message}).`);
      }
    }
    await sendPreview(
      chatId,
      { product: r.product, images: s.images, supplierPrice: r.supplierPrice, warnings: r.warnings, warnaSource },
      'Cek dulu sebelum tayang. Ubah jenis, untuk siapa, dan warna dengan tombol bila perlu:'
    );
  }

  async function onMessage(msg) {
    const chatId = String(msg.chat.id);
    if (!allowedChatId) {
      await say(chatId, `Chat ID kamu: ${chatId}\nIsi ALLOWED_CHAT_ID di .env dengan angka ini, lalu jalankan ulang bot.`);
      return;
    }
    if (chatId !== String(allowedChatId)) return; // orang lain diabaikan total

    const text = msg.text || msg.caption || '';
    if (text.trim().startsWith('/start')) {
      await say(chatId, 'Bot siap. Bagikan foto dan teks produk dari supplier ke sini.');
      return;
    }

    let s = sessions.get(chatId);
    if (!s || Date.now() - s.updatedAt > SESSION_TTL_MS) {
      if (s) clearTimeout(s.timer);
      s = { text: '', lastText: '', images: [], timer: null, updatedAt: 0 };
      sessions.set(chatId, s);
    }
    s.updatedAt = Date.now();

    try {
      if (msg.photo?.length) {
        s.images.push(await downloadFile(msg.photo[msg.photo.length - 1].file_id));
      } else if (msg.document?.mime_type?.startsWith('image/') && (msg.document.file_size || 0) <= MAX_IMAGE_BYTES) {
        s.images.push(await downloadFile(msg.document.file_id));
      }
    } catch (e) {
      await say(chatId, `Gagal mengambil foto: ${e.message}`);
    }

    if (text) {
      s.lastText = text;
      if (looksLikeProduct(text)) s.text = text;
    }

    clearTimeout(s.timer);
    s.timer = setTimeout(() => finalize(chatId).catch((e) => log.error(e)), collectDelayMs);
  }

  async function onCallback(cb) {
    const chatId = String(cb.message?.chat?.id ?? cb.from?.id);
    if (!allowedChatId || chatId !== String(allowedChatId)) return;
    await api('answerCallbackQuery', { callback_query_id: cb.id }).catch(() => {});

    const [action, id, val] = String(cb.data || '').split(':');
    const data = previews.get(id);
    const mid = cb.message?.message_id;
    const clearButtons = () =>
      mid ? api('editMessageReplyMarkup', { chat_id: chatId, message_id: mid, reply_markup: { inline_keyboard: [] } }).catch(() => {}) : null;

    if (!data) {
      await clearButtons();
      await say(chatId, 'Data produk ini sudah tidak ada (bot sempat restart?). Kirim ulang dari WhatsApp.');
      return;
    }
    if (action === 't' || action === 'u' || action === 'c') {
      if (action === 'c') {
        if (!isColorKey(val)) return;
        const cur = data.product.warna || [];
        if (cur.includes(val)) data.product.warna = cur.filter((k) => k !== val);
        else if (cur.length < MAX_COLORS) data.product.warna = [...cur, val];
        else return;
        data.warnaSource = 'manual';
      } else {
        const ok = action === 't' ? ['kasual', 'running'] : ['pria', 'wanita', 'unisex'];
        if (!ok.includes(val)) return;
        data.product[action === 't' ? 'tipe' : 'pengguna'] = val;
      }
      if (mid) {
        await api('editMessageText', {
          chat_id: chatId,
          message_id: mid,
          text: `${data.header}\n\n${summaryOf(data)}`,
          reply_markup: keyboard(id, data.product),
        }).catch(() => {}); // "message is not modified" bila pilihan sama
      }
      return;
    }
    previews.delete(id); // cegah klik ganda
    await clearButtons();

    if (action === 'no') {
      await say(chatId, 'Dibatalkan.');
      return;
    }
    if (action !== 'ok') return;

    try {
      const created = await ks.createProduct(data.product, data.images);
      await say(chatId, `✅ Produk ditambahkan ke website (id ${created?.id ?? '?'}):\n${data.product.nama}`);
    } catch (e) {
      await sendPreview(chatId, data, `❌ ${e.message}\n\nCoba lagi?`);
    }
  }

  async function handleUpdate(u) {
    if (u.message) await onMessage(u.message);
    else if (u.callback_query) await onCallback(u.callback_query);
  }

  async function poll() {
    let offset = 0;
    for (;;) {
      try {
        const updates = await api('getUpdates', { offset, timeout: 50, allowed_updates: ['message', 'callback_query'] }, 65000);
        for (const u of updates) {
          offset = u.update_id + 1;
          await handleUpdate(u).catch((e) => log.error('Error proses update:', e));
        }
      } catch (e) {
        log.error('Polling error:', e.message);
        await sleep(5000);
      }
    }
  }

  return { handleUpdate, poll, api };
}
