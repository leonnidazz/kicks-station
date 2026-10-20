# Kicks Station — Catatan Perbaikan Bug

## Perubahan dalam paket ini

1. **Proteksi chat pelanggan**
   - Setiap sesi chat menggunakan token acak 256-bit yang dibuat browser.
   - Backend hanya menyimpan hash SHA-256 token, bukan token mentah.
   - Endpoint baca/kirim pesan pelanggan memeriksa token pemilik percakapan.
   - Header `X-Chat-Token` ditambahkan ke daftar header CORS.
   - Kolom `visitor_token_hash` ditambahkan otomatis dengan `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` saat endpoint chat pertama kali dipanggil.
   - Token tidak dimasukkan ke URL, sehingga tidak ikut tercatat dalam log URL request.

2. **Perbaikan XSS potensial pada daftar chat admin**
   - Data pengunjung tidak lagi disisipkan ke handler `onclick` inline.
   - Pemilihan percakapan menggunakan `data-*` yang di-escape dan event listener terdelegasi.

3. **Validasi harga checkout fail-closed**
   - Checkout ditolak jika katalog tidak dapat dibaca atau produk tidak ditemukan.
   - Harga final dihitung dari katalog server, bukan mempercayai harga browser.

4. **Pembaruan cache frontend**
   - Cache service worker dinaikkan dari `v1` ke `v2` agar browser memperbarui shell aplikasi.

## Hasil pemeriksaan lokal

- `node --check backend/server.js`: lulus.
- Skrip inline `index.html`: berhasil diparse tanpa kesalahan sintaks.
- Skrip inline `admin.html`: berhasil diparse tanpa kesalahan sintaks.
- Pemeriksaan endpoint dengan database aktif dan uji browser end-to-end **belum dapat dilakukan di lingkungan ini**, karena memerlukan konfigurasi PostgreSQL/Supabase dan lingkungan browser yang terhubung.

## Catatan kompatibilitas

Pengunjung yang memiliki sesi chat lama tanpa token mungkin perlu membuka percakapan baru setelah frontend dan backend sama-sama diperbarui. Ini disengaja: sesi lama tidak boleh tetap terbuka hanya karena ID percakapan diketahui.

Jangan unggah `.env`, `SUPABASE_SERVICE_ROLE_KEY`, `DATABASE_URL`, atau kredensial lain ke repository.
