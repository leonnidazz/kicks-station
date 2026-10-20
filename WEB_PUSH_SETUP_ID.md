# Kicks Station — Web Push untuk chat admin

Update ini menambahkan Web Push supaya notifikasi pesan pelanggan dapat diterima pada HP Android dan laptop/PC meskipun tab/halaman admin ditutup. Notifikasi tetap bergantung pada izin browser/OS, koneksi internet, dan dukungan push di perangkat.

## File yang berubah

- `admin.html` — tombol aktivasi notifikasi, registrasi service worker, penyimpanan subscription setelah admin login.
- `service-worker.js` — menerima push, menampilkan notifikasi, getaran jika didukung, dan membuka admin saat notifikasi diklik.
- `backend/server.js` — endpoint VAPID/subscription dan pengiriman push saat pelanggan mengirim pesan.
- `package.json` — menambahkan dependensi `web-push`.
- `scripts/generate-vapid-keys.js` — membuat pasangan kunci VAPID lokal.

## A. Ganti file pada project

1. Backup file lama.
2. Salin file-file di ZIP ke folder project dengan struktur folder yang sama. Jangan menghapus `.git`, `index.html`, `manifest.webmanifest`, `icons/`, atau file produk lainnya.
3. Buka PowerShell di folder utama project.
4. Jalankan:

```powershell
npm install
node scripts/generate-vapid-keys.js
```

`npm install` memasang `web-push` dan memperbarui `package-lock.json`. Perintah generator menampilkan tiga nilai VAPID. Jalankan generator sekali saja dan gunakan pasangan kunci yang sama terus-menerus. Jika kunci diganti setelah subscription dibuat, tiap perangkat perlu berlangganan ulang.

## B. Atur Environment Variables di Render

Render Dashboard → service backend Kicks Station → Environment. Tambahkan tiga variable berikut dengan nilai dari output generator:

- `VAPID_PUBLIC_KEY` = nilai publik
- `VAPID_PRIVATE_KEY` = nilai privat
- `VAPID_SUBJECT` = alamat email yang valid, format contoh `mailto:email-kamu@example.com`

**Jangan** memasukkan `VAPID_PRIVATE_KEY` ke HTML, service worker, GitHub, atau file yang dipublikasikan. Simpan hanya di Environment Variables Render. Setelah disimpan, tunggu backend deploy/restart.

## C. Commit dan push ke GitHub

Setelah `npm install` berhasil:

```powershell
git status
git add admin.html backend/server.js service-worker.js package.json package-lock.json scripts/generate-vapid-keys.js WEB_PUSH_SETUP_ID.md
git commit -m "Add background Web Push for admin chat"
git pull --rebase origin main
git push origin main
```

Jika `git pull --rebase` menampilkan konflik, berhenti dan selesaikan konflik sebelum push. Pastikan `package-lock.json` ikut commit karena `npm install` memperbaruinya.

Render perlu menginstal dependensi `web-push` dan menjalankan ulang backend. Jika Render menggunakan Build Command khusus, gunakan `npm install` (bukan `npm ci` sebelum lockfile diperbarui).

## D. Aktifkan pada setiap perangkat

Lakukan terpisah di HP Android dan laptop/PC:

1. Buka URL admin Kicks Station melalui HTTPS dan login.
2. Buka menu **Chat Pelanggan**.
3. Tekan **🔔 Aktifkan notifikasi** dan izinkan notifikasi browser.
4. Ulangi pada browser/perangkat kedua. Subscription setiap perangkat disimpan secara terpisah.
5. Tutup tab admin, lalu kirim pesan dari website pelanggan memakai perangkat/browser lain.
6. Pastikan notifikasi muncul. Tekan notifikasi untuk membuka admin.

Untuk memasang seperti aplikasi di Android, buka website melalui Chrome lalu pilih menu browser **Install app / Tambahkan ke layar utama** jika tersedia. Di Windows, Chrome/Edge dapat menawarkan **Install this site as an app**.

## Catatan penting

- Database membuat tabel `public.chat_push_subscriptions` otomatis saat endpoint push pertama kali dipakai; tidak perlu menjalankan SQL manual.
- Backend harus tetap hidup dan variabel VAPID harus benar.
- Browser/OS harus mengizinkan notifikasi dan perangkat harus terhubung internet. Mode hemat baterai, Focus/Do Not Disturb, atau pembatasan latar belakang dapat menunda/mematikan notifikasi.
- Web Push dapat menampilkan notifikasi saat tab ditutup; suara/getaran ditentukan oleh browser/OS dan tidak dapat dijamin oleh halaman web. Service worker meminta pola getar, tetapi tidak semua perangkat mendukungnya.
- Jika klik aktivasi menampilkan “Web Push belum dikonfigurasi”, periksa ketiga variable VAPID di Render dan tunggu deploy selesai.
- Uji coba dari dua perangkat/browser berbeda. Mengirim pesan dari halaman admin sendiri bukan tes yang tepat karena push hanya dipicu untuk pesan pelanggan (`sender=customer`).
