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
