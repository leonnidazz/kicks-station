# Kicks Station

Toko sepatu: frontend statis (GitHub Pages/Vercel) + backend Node.js (Render) + Postgres (Supabase).

## Struktur
- `index.html`, `checkout.html`, `info.html`, `ulasan.html` — toko publik
- `admin.html` — panel admin (PWA, chat pelanggan, pesanan, produk, analitik)
- `backend/` — `server.js`, `payment.js` (Midtrans), `reviews.js`
- `service-worker.js`, `manifest*.webmanifest`, `icons/` — PWA
- `products.json`, `images/` — katalog awal
- `tailwind-*.css` — hasil build (`npm run build:css`)

## Menjalankan
```
npm install
npm start
```

## Environment variables (Render)
`DATABASE_URL`, `ADMIN_PIN` (min. 12 karakter, bukan angka saja), `CORS_ALLOWED_ORIGINS`,
`MIDTRANS_SERVER_KEY`, `MIDTRANS_CLIENT_KEY`, `MIDTRANS_IS_PRODUCTION`,
`TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`,
`VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` (`mailto:...`), `SHIPPING_FEE`, `ORDER_RETENTION_DAYS`.

## Web Push admin
1. `node scripts/generate-vapid-keys.js` (sekali saja), simpan 3 nilai VAPID di Render. Jangan taruh kunci privat di repo.
2. Buka admin via HTTPS, login, Chat Pelanggan, tekan "Aktifkan notifikasi" (per perangkat).
3. Tes dengan mengirim pesan dari sisi pelanggan di perangkat lain.
4. Kunci VAPID yang diganti membuat semua perangkat harus berlangganan ulang.

## Catatan
- Tabel database dibuat otomatis saat endpoint pertama dipakai.
- Chat memakai polling HTTP, bukan WebSocket.
- Jika service worker berubah, naikkan `CACHE_NAME` di `service-worker.js`.
