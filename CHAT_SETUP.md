# Kicks Station — Web Chat Feature

File yang perlu direplace:
- `index.html`
- `admin.html`
- `backend/server.js`

Tidak perlu menambah dependency npm. Backend otomatis membuat tabel:
- `public.chat_conversations`
- `public.chat_messages`

## Cara pasang
1. Backup 3 file lama.
2. Replace dengan file dari paket ini.
3. Deploy ulang backend Node/Render dan frontend seperti biasa.
4. Pastikan `DATABASE_URL` dan `ADMIN_PIN` yang sekarang tetap terpasang.
5. Buka `admin.html`, login, lalu masuk menu **Chat Pelanggan**.
6. Klik **Aktifkan Notifikasi** dan izinkan notifikasi browser.

## Alur baru
Produk → Keranjang → **Pesan Sekarang via Chat** → pesan order masuk ke inbox admin.

Order lama tetap dicatat ke `/api/orders`, jadi halaman Pesanan Masuk tidak hilang.

## Chatbot
Bot hanya memberikan pesan pembuka dan tombol pesan cepat:
- Tanya stok
- Tanya ukuran
- Mau pesan
- Rekomendasi

Klik pesan cepat langsung mengirim pesan ke inbox admin. Bot tidak menentukan harga, stok, atau keputusan transaksi.

## Notifikasi
Admin melakukan polling inbox setiap 4 detik. Jika ada pesan customer baru dan izin browser sudah aktif, browser menampilkan Web Notification.
