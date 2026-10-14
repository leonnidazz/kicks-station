# KickStation Live Chat + PWA (tahap awal)

## Perubahan
- Tombol WhatsApp di storefront diganti menjadi widget live chat.
- Pesan pelanggan dan admin disimpan di PostgreSQL melalui backend yang sudah ada.
- Panel Chat Pelanggan ditambahkan di `admin.html` dan menggunakan token admin yang sudah ada.
- Daftar chat dan pesan diperbarui dengan polling berkala agar sinkron lintas perangkat. Operasi simpan pesan memakai transaksi PostgreSQL sehingga insert pesan dan pembaruan waktu percakapan dilakukan bersama.
- Manifest, service worker, dan ikon PWA ditambahkan agar halaman dapat dipasang sebagai aplikasi pada browser yang mendukung.

## Deploy
1. Deploy perubahan ini ke host frontend yang sama dengan `index.html` dan `admin.html`.
2. Deploy `backend/server.js` ke backend yang sudah ada. Dari root repository, perintah start yang disediakan sekarang adalah `npm start` (`node backend/server.js`). Jika Render memakai Root Directory `backend`, jangan gunakan script root ini tanpa menyesuaikan konfigurasi; gunakan root repository atau set Start Command ke `node backend/server.js`.
3. Pastikan `DATABASE_URL` dan `ADMIN_PIN` yang sekarang digunakan tetap tersedia pada konfigurasi backend.
4. Redeploy/restart backend. Tabel `public.chat_conversations` dan `public.chat_messages` dibuat otomatis saat endpoint chat pertama kali dipakai. Pastikan Render menggunakan commit dan entry point yang berisi route `/api/chat/start`; jika request publik masih 404, periksa Root Directory, Start Command, dan log deployment karena kode lokal saja tidak mengubah layanan yang sudah berjalan.
5. Buka `admin.html`, login seperti biasa, lalu pilih **Chat Pelanggan**.
6. Uji kirim pesan dari storefront dan balas dari admin di perangkat lain.

## Catatan penting
- Chat ini menggunakan polling HTTP 3 detik saat percakapan dibuka; bukan WebSocket. Pesan disimpan di database sehingga tetap tersedia lintas perangkat.
- Notifikasi browser untuk admin saat halaman admin aktif memerlukan izin Notification. Notifikasi push ketika aplikasi sepenuhnya ditutup belum diaktifkan; itu memerlukan konfigurasi Web Push/VAPID dan pengujian khusus, terutama untuk iOS.
- PWA perlu diakses melalui HTTPS (atau localhost untuk pengembangan). Di iPhone, pemasangan biasanya melalui Share → Add to Home Screen. Dukungan pemasangan dan notifikasi berbeda antarversi OS/browser.
- Checkout lama sebelumnya mencatat pesanan ke endpoint order. Tombol checkout sekarang membuka chat dan mengirim ringkasan pesanan ke chat, sementara pencatatan order lama tetap dipertahankan.
- Uji otomatis yang dilakukan saat pembuatan ini adalah pemeriksaan sintaks JavaScript; belum diuji terhadap kredensial Supabase/Render aktif atau transaksi chat produksi.
