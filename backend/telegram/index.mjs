// Bot Telegram yang berjalan DI DALAM backend Kick Station (satu layanan Render).
// Aktif hanya bila TELEGRAM_BOT_TOKEN diisi. Produk dibuat lewat endpoint backend sendiri
// (login admin + POST /api/products), sehingga semua validasi yang ada tetap dipakai.
import crypto from 'node:crypto';
import { createBot } from './bot.mjs';
import { createKickstationClient } from './kickstation.mjs';
import { createVision } from './vision.mjs';
import { createWebhookHandler } from './server.mjs';

// Kunci rahasia webhook: diturunkan dari token bot, jadi tidak perlu variabel tambahan.
// (Bisa ditimpa lewat TELEGRAM_WEBHOOK_SECRET: 16-256 karakter huruf/angka/_/-.)
export function webhookSecret(env) {
  const custom = String(env.TELEGRAM_WEBHOOK_SECRET || '').trim();
  if (/^[A-Za-z0-9_-]{16,256}$/.test(custom)) return custom;
  return crypto.createHash('sha256').update('kickstation-telegram:' + env.TELEGRAM_BOT_TOKEN).digest('hex').slice(0, 48);
}

const num = (v, fallback) => (v === undefined || v === '' || Number.isNaN(Number(v)) ? fallback : Number(v));

export function createTelegramBot({ env, port, publicBaseUrl, log = console }) {
  let vision = null;
  try {
    vision = createVision({
      provider: env.VISION_PROVIDER,
      apiKey: env.VISION_API_KEY,
      model: env.VISION_MODEL,
      timeoutMs: num(env.VISION_TIMEOUT_SEC, 60) * 1000,
    });
  } catch (e) {
    log.error('[Telegram] Pengaturan deteksi warna dari foto salah, fitur dimatikan:', e.message);
  }
  log.log(vision ? `[Telegram] Deteksi warna dari foto: aktif (${vision.provider}, ${vision.model})` : '[Telegram] Deteksi warna dari foto: mati');

  const ks = createKickstationClient({ baseUrl: `http://127.0.0.1:${port}`, pin: String(env.ADMIN_PIN || '').trim() });
  const bot = createBot({
    token: env.TELEGRAM_BOT_TOKEN,
    allowedChatId: env.ALLOWED_CHAT_ID,
    ks,
    vision,
    roundTo: num(env.ROUND_TO, 1000),
    noRetailMarkup: num(env.NO_RETAIL_MARKUP, 200000),
    collectDelayMs: num(env.COLLECT_DELAY_SEC, 5) * 1000,
    apiBase: env.TELEGRAM_API_BASE || undefined,
    log,
  });

  const secret = webhookSecret(env);
  const handler = createWebhookHandler({ bot, secret, log });

  // Mendaftarkan alamat webhook ke Telegram. Gagal hanya dicatat, server tetap jalan.
  const ready = (async () => {
    const url = `${String(publicBaseUrl).replace(/\/+$/, '')}/telegram`;
    try {
      await bot.api('setWebhook', {
        url,
        secret_token: secret,
        allowed_updates: ['message', 'callback_query'],
        max_connections: 1,
      });
      log.log(`[Telegram] Webhook terpasang: ${url}`);
    } catch (e) {
      log.error('[Telegram] Gagal pasang webhook (cek TELEGRAM_BOT_TOKEN):', e.message);
    }
  })();

  return { handler, ready, bot };
}
