# KickStation Live Chat + PWA (tahap awal)

## Perubahan
- Tombol WhatsApp di storefront diganti menjadi widget live chat.
- Pesan pelanggan dan admin disimpan di PostgreSQL melalui backend yang sudah ada.
- Panel Chat Pelanggan ditambahkan di `admin.html` dan menggunakan token admin yang sudah ada.
- Daftar chat dan pesan diperbarui dengan polling berkala agar sinkron lintas perangkat.
- Manifest, service worker, dan ikon PWA ditambahkan agar halaman dapat dipasang sebagai aplikasi pada browser yang mendukung.

## Deploy
1. Deploy perubahan ini ke host frontend yang sama dengan `index.html` dan `admin.html`.
2. Deploy `backend/server.js` ke backend yang sudah ada.
3. Pastikan `DATABASE_URL` dan `ADMIN_PIN` yang sekarang digunakan tetap tersedia pada konfigurasi backend.
4. Restart backend. Tabel `public.chat_conversations` dan `public.chat_messages` dibuat otomatis saat endpoint chat pertama kali dipakai.
5. Buka `admin.html`, login seperti biasa, lalu pilih **Chat Pelanggan**.
6. Uji kirim pesan dari storefront dan balas dari admin di perangkat lain.

## Catatan penting
- Chat ini menggunakan polling HTTP 3 detik saat percakapan dibuka; bukan WebSocket. Pesan disimpan di database sehingga tetap tersedia lintas perangkat.
- Notifikasi browser untuk admin saat halaman admin aktif memerlukan izin Notification. Notifikasi push ketika aplikasi sepenuhnya ditutup belum diaktifkan; itu memerlukan konfigurasi Web Push/VAPID dan pengujian khusus, terutama untuk iOS.
- PWA perlu diakses melalui HTTPS (atau localhost untuk pengembangan). Di iPhone, pemasangan biasanya melalui Share → Add to Home Screen. Dukungan pemasangan dan notifikasi berbeda antarversi OS/browser.
- Checkout lama sebelumnya mencatat pesanan ke endpoint order. Tombol checkout sekarang membuka chat dan mengirim ringkasan pesanan ke chat, sementara pencatatan order lama tetap dipertahankan.
- Uji otomatis yang dilakukan saat pembuatan ini adalah pemeriksaan sintaks JavaScript; belum diuji terhadap kredensial Supabase/Render aktif atau transaksi chat produksi.
