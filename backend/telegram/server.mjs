// Server HTTP kecil untuk webhook Telegram (dipakai saat dipasang di Render).
import http from 'node:http';
import crypto from 'node:crypto';

const safeEqual = (a, b) => {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};

// Penangan permintaan webhook (dipakai di dalam server backend, atau server mandiri di bawah).
export function createWebhookHandler({ bot, secret, log = console }) {
  const seen = new Set(); // cegah update yang sama diproses dua kali (Telegram bisa mengirim ulang)

  return function handle(req, res) {
    const header = req.headers['x-telegram-bot-api-secret-token'] || '';
    if (!secret || !safeEqual(header, secret)) {
      res.writeHead(403);
      return res.end();
    }
    let body = '';
    let size = 0;
    let tooBig = false;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > 1_000_000) {
        tooBig = true;
        res.writeHead(413);
        res.end();
        req.destroy();
        return;
      }
      body += chunk;
    });
    req.on('end', () => {
      if (tooBig) return;
      let update;
      try { update = JSON.parse(body); } catch { res.writeHead(400); return res.end(); }
      res.writeHead(200); // balas cepat; proses di latar belakang
      res.end('ok');
      if (seen.has(update.update_id)) return;
      seen.add(update.update_id);
      if (seen.size > 1000) seen.delete(seen.values().next().value);
      bot.handleUpdate(update).catch((e) => log.error('Error proses update:', e));
    });
  };
}

export function createWebhookServer({ bot, secret, path = '/telegram', log = console }) {
  const handle = createWebhookHandler({ bot, secret, log });
  return http.createServer((req, res) => {
    const url = (req.url || '').split('?')[0];
    if (req.method === 'POST' && url === path) return handle(req, res);
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('ok');
  });
}
