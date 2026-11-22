// Klien untuk backend Kick Station: login admin lalu POST /api/products.
export function sniff(buf) {
  if (buf[0] === 0x89 && buf[1] === 0x50) return ['image/png', 'png'];
  if (buf.length > 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') {
    return ['image/webp', 'webp'];
  }
  return ['image/jpeg', 'jpg'];
}

// Merapikan KS_BASE_URL: buang "KS_BASE_URL=" yang tertulis dobel, tanda kutip, "/api/..." dan garis miring.
export function normalizeBaseUrl(raw) {
  let s = String(raw || '').trim().replace(/^["']|["']$/g, '');
  s = s.replace(/^KS_BASE_URL\s*=\s*/i, '');
  s = s.replace(/\/api(\/.*)?$/i, '').replace(/\/+$/, '');
  if (!/^https?:\/\/[^\s/]+/i.test(s)) {
    throw new Error('KS_BASE_URL harus berbentuk https://kicks-station.onrender.com (tanpa tambahan lain)');
  }
  return s;
}

export function createKickstationClient({ baseUrl, pin, timeoutMs = 90000 }) {
  let token = null;
  let expiresAt = 0;

  async function call(path, body, headers = {}) {
    const res = await fetch(normalizeBaseUrl(baseUrl) + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs), // Render gratis bisa lambat saat "bangun"
    });
    const data = await res.json().catch(() => ({}));
    return { status: res.status, data };
  }

  async function login() {
    if (!pin) throw new Error('KS_ADMIN_PIN belum diisi di .env');
    const { status, data } = await call('/api/admin/login', { pin });
    if (status !== 200 || !data.token) {
      throw new Error(`Login admin gagal (${status}): ${data.message || 'tanpa pesan'}`);
    }
    token = data.token;
    expiresAt = Number(data.expiresAt) || Date.now() + 11 * 3600 * 1000;
  }

  async function ensureToken() {
    if (!token || Date.now() > expiresAt - 60000) await login();
  }

  async function createProduct(product, images) {
    const gambar = images.slice(0, 10).map((buf, i) => {
      const [mime, ext] = sniff(buf);
      return { name: `foto-${i + 1}.${ext}`, data: `data:${mime};base64,${buf.toString('base64')}` };
    });
    const payload = { ...product, gambar };

    for (let attempt = 0; attempt < 2; attempt++) {
      await ensureToken();
      const { status, data } = await call('/api/products', payload, {
        Authorization: `Bearer ${token}`,
      });
      if (status === 401 && attempt === 0) {
        token = null; // sesi kedaluwarsa, login ulang sekali
        continue;
      }
      if (status !== 201) {
        throw new Error(`Gagal tambah produk (${status}): ${data.message || 'tanpa pesan'}`);
      }
      return data.product;
    }
  }

  return { login, createProduct };
}
