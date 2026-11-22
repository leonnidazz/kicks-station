# Bot Telegram upload produk (di dalam backend)

Aktif bila variabel `TELEGRAM_BOT_TOKEN` diisi di Render. Bot menerima pesan lewat webhook, jadi laptop tidak perlu menyala.

## Variabel di Render (Environment)
Wajib:
- TELEGRAM_BOT_TOKEN  = token dari @BotFather
- ALLOWED_CHAT_ID     = Chat ID Telegram pemilik toko (hanya chat ini yang boleh upload)
- ADMIN_PIN           = sudah ada (dipakai bot untuk login ke backend sendiri)

Opsional:
- NO_RETAIL_MARKUP    = tambahan harga bila supplier tidak menulis retail (bawaan 200000)
- ROUND_TO            = pembulatan harga jual (bawaan 1000)
- COLLECT_DELAY_SEC   = jeda menunggu foto album (bawaan 5)
- VISION_PROVIDER     = gemini (atau anthropic) untuk deteksi warna dari foto; kosong = mati
- VISION_API_KEY      = kunci API penyedia AI
- VISION_MODEL        = contoh gemini-2.5-flash-lite
- VISION_TIMEOUT_SEC  = batas tunggu AI (bawaan 60)

## Catatan
- Kunci rahasia webhook dibuat otomatis dari token bot.
- Hanya satu cara yang boleh aktif: webhook (di Render) ATAU polling (npm start di laptop), tidak bersamaan.
- Layanan gratis Render tidur setelah 15 menit sepi. Pesan pertama bisa lambat sekitar 1 menit,
  dan pratinjau yang belum ditekan hilang bila layanan sempat tidur.
- Tes: node --test backend/telegram/tests/*.test.mjs
