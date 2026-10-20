# Update PWA Admin Kicks Station

## File yang diganti/ditambahkan
- `admin.html` — metadata aplikasi, pendaftaran service worker otomatis, dan pengurangan polling/render ulang chat yang tidak diperlukan.
- `service-worker.js` — cache app shell, fallback offline untuk halaman, dan tetap mempertahankan Web Push serta aksi klik notifikasi.
- `manifest.webmanifest` — identitas dan konfigurasi instalasi PWA.
- `icons/icon-192.png`, `icons/icon-512.png`, `icons/apple-touch-icon.png` — ikon aplikasi.

## Cara memasang update
1. Backup project.
2. Ekstrak ZIP ke folder utama project dan izinkan mengganti file yang ada.
3. Jangan hapus file lain, terutama `backend/server.js`, `package.json`, `package-lock.json`, dan file project lainnya.
4. Periksa: `git diff --check`
5. Commit hanya file update yang diperlukan:

```powershell
git add admin.html service-worker.js manifest.webmanifest icons/icon-192.png icons/icon-512.png icons/apple-touch-icon.png README-PWA-ID.md
git commit -m "Make Kicks Station admin installable PWA and improve chat smoothness"
git pull --rebase origin main
git push origin main
```

6. Pastikan GitHub Pages selesai deploy.
7. Buka `https://leonnidazz.github.io/admin.html` di Chrome/Edge, login, lalu pilih menu browser `Install app` atau `Tambahkan ke layar utama`.
8. Karena service worker berubah, tutup lalu buka kembali aplikasi. Jika masih memakai versi lama, buka halaman admin dan lakukan hard refresh sekali.

## Catatan
- Ini PWA, bukan APK native. Pemasangan tersedia melalui browser yang mendukungnya.
- Offline hanya menjadi fallback untuk halaman statis; login, chat, database, dan notifikasi push tetap memerlukan koneksi internet.
- Perubahan polling mengurangi request berulang dan render ulang daftar chat ketika data tidak berubah. Performa tetap bergantung pada perangkat, jaringan, dan backend.
- Tailwind CDN masih digunakan dan dapat menghasilkan peringatan di console; migrasi Tailwind ke CSS hasil build bisa dilakukan sebagai tahap optimasi terpisah.


## Optimasi tambahan untuk Android
- Efek blur/backdrop-filter, bayangan berat, animasi, dan latar fixed dikurangi di layar kecil untuk mengurangi beban GPU.
- Polling chat aktif menjadi 8 detik dan polling daftar chat saat modal tertutup menjadi 30 detik. Web Push tetap menjadi jalur notifikasi latar belakang.
- Cache service worker dinaikkan ke v5 agar browser mengambil versi shell terbaru.
- Jika masih lambat saat pertama kali dibuka, Tailwind CDN dan Google Fonts masih menjadi sumber beban pemuatan awal; migrasi ke CSS statis hasil build perlu dilakukan terpisah dan diuji agar tidak merusak tampilan.


## Optimasi lanjutan Android (v3)
- Gambar kartu produk memakai lazy loading dan decoding asinkron agar pemuatan awal lebih ringan.
- Kartu katalog di luar layar menggunakan `content-visibility` untuk mengurangi pekerjaan rendering saat scroll.
- Pencarian produk menunggu 140 ms setelah ketikan terakhir sebelum membangun ulang kartu, sehingga input lebih mulus; filter kategori tetap langsung.
- Font eksternal memakai preconnect dan `display=swap` agar teks tidak menunggu font selesai diunduh.
- Versi cache service worker dinaikkan ke v6 agar shell terbaru terdeteksi.

Semua perubahan ini berada di frontend; endpoint backend, autentikasi, fitur chat, dan kode Web Push tidak diubah. Optimasi belum dianggap teruji pada perangkat produksi sampai diuji langsung setelah deploy.


## Optimasi performa lanjutan (v4)
- Tampilan glass tetap dipertahankan, tetapi blur dan bayangan diperingan serta transisi dibatasi ke properti visual yang diperlukan.
- Mengganti foto galeri produk kini memperbarui gambar dan indikator pada kartu tersebut saja, bukan membangun ulang seluruh katalog. Ini mengurangi lonjakan kerja DOM dan pemuatan ulang gambar ketika galeri ditekan.
- Pencarian produk menunggu 180 ms setelah ketikan terakhir dan menyelaraskan render dengan frame browser agar interaksi terasa lebih stabil.
- Kartu katalog memakai containment untuk membatasi pekerjaan layout/paint.
- Cache service worker dinaikkan ke v7. Login, API backend, chat pelanggan, dan alur Web Push tidak diubah.

Catatan: Tailwind CDN tetap dipakai karena migrasi ke CSS hasil build perlu daftar kelas lengkap dan pengujian visual; menghapus CDN tanpa proses build berisiko merusak tampilan/fitur. Performa akhir harus diukur setelah deploy pada perangkat dan jaringan sebenarnya.
