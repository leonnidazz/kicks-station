import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSupplierMessage, looksLikeProduct } from '../parser.mjs';

const SAMPLE =
  'New Riliss‼ Skechers Summits Black size : 41, 42, 43, retail 1.499.000,- Special Price 550.000,-✅ ☎ Wa mimin * https://wa.me/62895611247400';

test('contoh nyata dari supplier', () => {
  assert.equal(looksLikeProduct(SAMPLE), true);
  const r = parseSupplierMessage(SAMPLE);
  assert.equal(r.ok, true);
  assert.equal(r.product.nama, 'Skechers Summits Black');
  assert.equal(r.product.brand, 'skechers');
  assert.deepEqual(r.product.sizes, ['41', '42', '43']);
  assert.equal(r.product.harga_coret, 1499000);
  assert.equal(r.product.harga, 1025000); // (550.000 + 1.499.000) / 2 = 1.024.500 -> 1.025.000
});

test('contoh aturan: 500 ribu dan 1 juta -> 750 ribu', () => {
  const r = parseSupplierMessage('Nike Pegasus 41 size 40-43 retail 1.000.000 special price 500.000');
  assert.equal(r.ok, true);
  assert.equal(r.product.harga, 750000);
  assert.equal(r.product.harga_coret, 1000000);
  assert.deepEqual(r.product.sizes, ['40', '41', '42', '43']);
  assert.equal(r.product.tipe, 'running');
  assert.equal(r.product.brand, 'nike');
});

test('ukuran setengah dan format rb', () => {
  const r = parseSupplierMessage('Adidas Samba OG size 40, 40.5, 41,5 retail 1.200rb special price 600rb');
  assert.equal(r.ok, true);
  assert.deepEqual(r.product.sizes, ['40', '40.5', '41.5']);
  assert.equal(r.product.harga, 900000);
});

test('tanpa harga retail: harga supplier + 200 ribu, tanpa harga coret, ada peringatan', () => {
  const r = parseSupplierMessage('Nike Dunk size 40 41 special price 500.000');
  assert.equal(r.ok, true);
  assert.equal(r.product.harga, 700000);
  assert.equal(r.product.harga_coret, 0);
  assert.ok(r.warnings.some((w) => /retail/i.test(w)));
  assert.equal(parseSupplierMessage('Nike Dunk size 40 special price 500.000', { noRetailMarkup: 150000 }).product.harga, 650000);
});

test('retail lebih kecil dari harga khusus ditolak', () => {
  const r = parseSupplierMessage('Nike Dunk size 40 41 retail 400.000 special price 500.000');
  assert.equal(r.ok, false);
});

test('pesan obrolan biasa bukan produk', () => {
  assert.equal(looksLikeProduct('Selamat pagi semua, stok ready ya kak'), false);
});

const REAL2 = `*New Rillis*‼️  

_Nike Court Lite 4 CLY White_
*Special For Tenis & padel*😍

*Size : 40 [25cm] ready 2 pcs saja* ✅

_Retail ~1.149.000,-~ special price *600.000,-✅*_

☎️ Wa mimin • https://wa.me/62895611247400 
🗺️ Maps •https://maps.app.goo.gl/pJCe1FN7cNHbCFCB7`;

test('teks WhatsApp dengan format tebal/miring/coret dan tagline', () => {
  assert.equal(looksLikeProduct(REAL2), true);
  const r = parseSupplierMessage(REAL2);
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  assert.equal(r.product.nama, 'Nike Court Lite 4 CLY White');
  assert.equal(r.product.brand, 'nike');
  assert.deepEqual(r.product.sizes, ['40']);
  assert.equal(r.product.harga_coret, 1149000);
  assert.equal(r.product.harga, 875000); // (600.000 + 1.149.000) / 2 = 874.500 -> 875.000
});

// ---- format-format nyata dari grup supplier ----
const P = (t) => parseSupplierMessage(t);

test('format "Special price X Sale jadi Y" (X = harga retail yang dicoret)', () => {
  const r = P('New Arrival‼️\n\nDiadora Nevada JR Black-White\n\nSize 34 (21cm) ready 2 pcs✅\n\nSpecial price 399.000,- Sale jadi 180 ✅\n\nFormat Order\n• https://wa.me/62895611247400');
  assert.equal(r.ok, true);
  assert.equal(r.product.nama, 'Diadora Nevada JR Black-White');
  assert.deepEqual(r.product.sizes, ['34']);
  assert.equal(r.supplierPrice, 180000);
  assert.equal(r.product.harga_coret, 399000);
  assert.equal(r.product.harga, 290000); // (180.000 + 399.000) / 2 = 289.500
});

test('format "699.000 Special Price hanya 280.000"', () => {
  const r = P('Gercepp‼️\n\nSkechers Arch Fit - Life Strides\n\nSize : 39 (8), 40 (2)\n\n699.000 Special Price hanya 280.000✅\n\n☎️ Wa mimin');
  assert.equal(r.ok, true);
  assert.equal(r.product.harga_coret, 699000);
  assert.equal(r.supplierPrice, 280000);
  assert.deepEqual(r.product.sizes, ['39', '40']);
});

test('"Retail Muahal" (tanpa angka retail) dan harga ribuan singkat', () => {
  const r = P('SALE PARAH‼️\n\nSkechers Dlux Walker - Retro Cosmos\n\nSize 39, 40\n\nRetail mahal special SALE 375 ✅');
  assert.equal(r.ok, true);
  assert.equal(r.supplierPrice, 375000);
  assert.equal(r.product.harga_coret, 0);
  assert.equal(r.product.harga, 575000);
});

test('harga retail dicoret unicode', () => {
  const r = P('SALE PARAH‼️\n\nSandal Nike Victori One Slide Metalic Silver\n\nsize  39, 40.5\n\nDapatkan hanya\nretail 3̶9̶9̶.̶0̶0̶0̶,- special Sale 200.000,-✅');
  assert.equal(r.ok, true);
  assert.equal(r.product.harga_coret, 399000);
  assert.equal(r.supplierPrice, 200000);
  assert.equal(r.product.nama, 'Sandal Nike Victori One Slide Metalic Silver');
});

test('nama diambil dari baris bermerk, bukan slogan/tagline', () => {
  const r = P('New In Store‼️\nmurce banget, yuk segera amankan size kamu\n🤩🤩\n\nAirwalk Gladiator\n\nLimited Stok‼️\n\nSize : 39, 40, 41, 42,\n\n retail 259.000 Special Price 110.000,-✅');
  assert.equal(r.ok, true);
  assert.equal(r.product.nama, 'Airwalk Gladiator');
  assert.equal(r.product.brand, 'airwalk');
  const r2 = P('Running Special\n\nDiadora Patrow Lime\n\nsize : 41, 42\n\nSpecial Price 275.000,- saja✅');
  assert.equal(r2.product.nama, 'Diadora Patrow Lime');
  assert.equal(r2.product.tipe, 'running');
  const r3 = P('SALE PARAH‼️\n\nNike Isofly Special For Basket\n\nSize : 38.5, 39, 40\n\nRetail muahal Special Price 475.000✅');
  assert.equal(r3.product.nama, 'Nike Isofly');
});

test('tagline "Women/Womens special" -> wanita; nama produk dengan angka tidak dianggap harga', () => {
  const r = P('SALE PARAH‼️\nNew Balance Running special Coast V4\nSize : 37.5, 40\nRetail 899.000,- special price 300.000,-✅');
  assert.equal(r.ok, true);
  assert.equal(r.supplierPrice, 300000);
  assert.equal(r.product.harga_coret, 899000);
  const w = P('Limited Stock‼️\n\nSkechers Arch Vista - Aspiration\nWomens special\n\nSize : 36\n\nRetail 1.299.000,- special price 530.000,-✅');
  assert.equal(w.product.pengguna, 'wanita');
});

test('tas/bola tanpa ukuran ditolak dengan pesan jelas; promo bukan produk', () => {
  const tas = P('Bodypack Adidas V Classic BP Gray\n\n•Kapasitas 25L\n•Ukuran : 45 x 30 x 15 cm\n\n retail 700.000 Special Price 350.000,-✅');
  assert.equal(tas.ok, false);
  assert.ok(tas.errors.some((e) => /Ukuran/i.test(e)));
  assert.equal(looksLikeProduct('Special Buat Customer Promo BUY 2 GET 1 Free Dapat melalui Online'), false);
  assert.equal(looksLikeProduct('Ready Bodypack\n•Skechers\n•Nike\n\nHarga start From 150 an 🤩'), false);
});

test('warna awal: dari nama, kosong bila nama tidak menyebut warna, atau dari baris "Warna :"', () => {
  assert.deepEqual(P('Specs Airglide Women sugar swizzle\n\nSize : 37, 38\n\nSpecial Price 350.000 saja').product.warna, []);
  assert.deepEqual(P('Skechers Summits Black\nSize : 41\nRetail 1.499.000 Special Price 550.000').product.warna, ['hitam']);
  assert.deepEqual(P('Nike Downshifter 14 White Glacier Blue\nSize : 40\nRetail 950.000 Special Price 500.000').product.warna, ['putih', 'biru']);
  assert.deepEqual(P('Specs Airglide X\nWarna : Navy\nSize : 40\nRetail 950.000 Special Price 500.000').product.warna, ['biru']);
});
