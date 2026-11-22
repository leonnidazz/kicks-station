import { detectColors } from './colors.mjs';

// Parser pesan supplier -> data produk Kick Station.
// Dilatih dari ~630 pesan nyata grup supplier (berbagai format).

// Tambah/ubah daftar ini sesuai merk yang dijual. Alias: tulisan supplier -> merk.
export const BRANDS = [
  'new balance', 'under armour', 'onitsuka tiger', 'on running',
  'nike', 'adidas', 'skechers', 'puma', 'asics', 'converse', 'vans', 'reebok',
  'fila', 'hoka', 'diadora', 'specs', 'mizuno', 'salomon', 'jordan', 'crocs',
  'ortuseight', 'league', 'eagle', 'compass', 'piero', 'ardiles', 'lotto',
  'airwalk', 'astec', 'hundred', 'yonex', 'rs', 'kappa', 'umbro', 'warior', 'warrior',
].sort((a, b) => b.length - a.length);
const BRAND_ALIAS = { skecher: 'skechers', sketchers: 'skechers', 'new ballance': 'new balance', warior: 'warrior' };

const RUNNING_RE =
  /\b(running|run|lari|jogging|trail|pegasus|downshifter|ultraboost|vomero|revolution|invincible|novablast|nimbus|kayano)\b/;
const MIN_PRICE = 20000;
const MAX_PRICE = 50000000;

// ---------- pembersihan teks ----------
export function cleanText(text) {
  return String(text || '')
    .replace(/[\u0300-\u036f]/g, '') // angka dicoret unicode (3̶9̶9̶) -> angka biasa
    .replace(/<(?:gambar|video|pesan)[^>]*>/gi, ' ')
    .replace(/https?:\/\/\S+/gi, ' ')
    .replace(/wa\.me\/\S+/gi, ' ')
    .replace(/(?:^|\s)(?:\+?62|0)8\d[\d\s-]{7,12}/g, ' ')
    .replace(/[\u{1F000}-\u{1FFFF}\u{2600}-\u{27BF}\u{FE0F}\u200d\u203c*•_~`]+/gu, ' ')
    .replace(/[ \t]+/g, ' ')
    .trim();
}

// ---------- harga ----------
export function toRupiah(raw, suffix) {
  let s = String(raw).replace(/[.,]+$/, '');
  s = s.replace(/,\d{1,2}$/, ''); // "1.499.000,00" -> "1.499.000"
  let n = Number(s.replace(/[^\d]/g, ''));
  if (!n) return 0;
  if (n < 10000) n *= 1000; // "180" / "140" / "600rb" = ribuan rupiah
  return n;
}

const SIZE_RE = /\bsize\s*[:=]?\s*(?=\d)/i; // "size 40"/"size : 40", bukan kata "size kamu"
const KW_STOP = /\b(retail|ritel|special|spesial|sale|harga|price|jadi)\b/i;

function sizeSegment(text) {
  const m = text.match(SIZE_RE);
  if (!m) return null;
  const start = m.index + m[0].length;
  let end = start;
  for (;;) {
    const nl = text.indexOf('\n', end);
    const lineEnd = nl < 0 ? text.length : nl;
    const line = text.slice(end, lineEnd);
    const stop = line.search(KW_STOP);
    if (stop >= 0) { end += stop; break; }
    end = lineEnd;
    if (nl < 0 || !/[,\-–]\s*$/.test(line)) break; // baris ukuran lanjutan hanya bila diakhiri koma
    end = nl + 1;
  }
  return { start: m.index, end, seg: text.slice(start, end) };
}

// Baris harga: hanya yang jelas menyebut harga (bukan nama produk seperti "Running special V4").
const PRICE_LINE_RE =
  /\b(?:retail|ritel|harga|price|jadi|sale)\b|\b(?:special|spesial)\s*[:=]?\s*(?:rp\.?\s*)?\d/i;

function priceText(text) {
  const sz = sizeSegment(text);
  const t = sz ? text.slice(0, sz.start) + '\n' + text.slice(sz.end) : text;
  return t
    .split('\n')
    .filter((l) => PRICE_LINE_RE.test(l) && /\d/.test(l))
    .join('\n');
}

export function extractPrices(text) {
  const pt = priceText(text);
  const re = /(retail|ritel)|(jadi|menjadi)|(special|spesial|sale|harga|price)|(\d[\d.,]*)\s*(?:rb|ribu|k)?/gi;
  const tokens = [];
  let m;
  while ((m = re.exec(pt))) {
    if (m[1]) tokens.push({ k: 'retail' });
    else if (m[2]) tokens.push({ k: 'jadi' });
    else if (m[3]) tokens.push({ k: 'special' });
    else if (m[4]) {
      const v = toRupiah(m[4]);
      if (v) tokens.push({ n: v });
    }
  }
  let retail = 0;
  let special = 0;

  const jadiAt = tokens.findIndex((t) => t.k === 'jadi');
  if (jadiAt >= 0) {
    for (let i = jadiAt - 1; i >= 0; i--) if (tokens[i].n) { retail = tokens[i].n; break; }
    for (let i = jadiAt + 1; i < tokens.length; i++) if (tokens[i].n) { special = tokens[i].n; break; }
  } else {
    let ctx = null;
    const loose = [];
    for (const t of tokens) {
      if (t.k) { ctx = t.k; continue; }
      if (ctx === 'retail' && !retail) retail = t.n;
      else if (ctx === 'special' && !special) special = t.n;
      else loose.push(t.n);
    }
    if (loose.length) {
      if (!retail && special && loose[0]) retail = loose[0]; // "699.000 Special Price hanya 280.000"
      else if (!special && !retail && loose.length >= 2) {
        [retail, special] = [Math.max(...loose.slice(0, 2)), Math.min(...loose.slice(0, 2))];
      } else if (!special && retail && loose[0]) special = loose[0];
    }
  }
  const ok = (v) => v >= MIN_PRICE && v <= MAX_PRICE;
  return { retail: ok(retail) ? retail : 0, special: ok(special) ? special : 0 };
}

// ---------- ukuran ----------
function parseSizes(text) {
  const info = sizeSegment(text);
  if (!info) return [];
  const seg = info.seg
    .replace(/\[[^\]]*\]|\([^)]*\)/g, ' ')
    .replace(/\d+\s*(?:cm|pcs|pc|pasang)\b/gi, ' ');

  const sizes = new Set();
  const range = seg.match(/(\d{2})\s*(?:-|–|~|sd|s\/d|sampai)\s*(\d{2})/i);
  if (range) {
    const a = Number(range[1]), b = Number(range[2]);
    if (b >= a && b - a <= 15) for (let i = a; i <= b; i++) sizes.add(i);
  } else {
    for (const tok of seg.match(/\b\d{2}(?:[.,]5)?(?!\d)/g) || []) sizes.add(Number(tok.replace(',', '.')));
  }
  return [...sizes].filter((n) => n >= 20 && n <= 50).sort((a, b) => a - b).map(String);
}

// ---------- nama & merk ----------
const HEADER_RE =
  /^(?:new\s*(?:in\s*store|in\s*r+i+l+i+s+|in|arrival|r+i+l+i+s+(?:\s*in\s*store)?|release|stock|stok)|sale(?:\s+(?:parah|ambyar|gila|banting))?|r[e3]+stok+|re-?stock|gercep+|limited\s*stok+k?|ready(?:\s+di\s+store\s+\S+|\s+stock|\s+stok)?|hot\s*item|best\s*seller)\b[\s:,.!-]*/i;
const TAGLINE_RE =
  /^(?:special|spesial|size|ukuran|tersedia|retail|ritel|harga|price|wa\s*mimin|maps|format\s*order|komposisi|dapatkan|cocok|yakin|ready|limited|limit|gaya|free|promo|ongkir|catatan|note|bonus|\[|-|\d+\.)/i;

const findBrand = (s) => {
  const low = s.toLowerCase();
  for (const [alias, brand] of Object.entries(BRAND_ALIAS)) {
    if (new RegExp(`(^|\\s)${alias}(\\s|$)`, 'i').test(low)) return brand;
  }
  return BRANDS.find((b) => new RegExp(`(^|\\s)${b}(\\s|$)`, 'i').test(low));
};

const STOP_RE = /^(?:size|ukuran|retail|ritel|special\s*price|spesial\s*price|harga|price)\b/i;
const CATEGORY_RE =
  /^(?:running|cass?ual|womens?|mens?|kids|unisex|full\s*black|badminton|padel|futsal|football|basket|tenis|school)\b.*\bspeciall?\b/i;

function parseName(text) {
  const cands = [];
  for (const raw of text.split('\n')) {
    let s = raw.trim().replace(/\s+/g, ' ');
    let prev;
    do { prev = s; s = s.replace(HEADER_RE, ''); } while (s !== prev);
    s = s.trim();
    if (!s) continue;
    if (STOP_RE.test(s)) break; // sudah masuk baris ukuran/harga
    if (TAGLINE_RE.test(s) || CATEGORY_RE.test(s)) continue;
    const cut = s.search(/\b(size|ukuran|retail|ritel|special|spesial|harga|price|jadi)\b/i);
    const part = (cut >= 0 ? s.slice(0, cut) : s).replace(/^[\s:,\-–|]+|[\s:,\-–|]+$/g, '');
    if (part.length >= 3) cands.push(part);
    if (cut >= 0 && part.length >= 3 && findBrand(part)) break; // nama + ukuran/harga satu baris
  }
  // utamakan baris yang memuat merk (baris lain bisa hanya slogan)
  const name = cands.find(findBrand) ?? cands[0] ?? '';
  return name.replace(/\bSkechers?\b/gi, 'Skechers');
}

// ---------- API ----------
export function looksLikeProduct(text) {
  const t = cleanText(text);
  const { special, retail } = extractPrices(t);
  return Boolean(special) && (Boolean(retail) || SIZE_RE.test(t));
}

export function parseSupplierMessage(rawText, { roundTo = 1000, noRetailMarkup = 200000 } = {}) {
  const errors = [];
  const warnings = [];
  const text = cleanText(rawText);

  const { retail, special } = extractPrices(text);
  const nama = parseName(text);
  const sizes = parseSizes(text);

  if (!nama) errors.push('Nama produk tidak terbaca.');
  if (!special) errors.push('Harga khusus (special price) tidak terbaca.');
  if (special && retail && retail <= special) {
    errors.push(`Harga retail (${retail}) tidak lebih besar dari harga khusus (${special}). Periksa manual.`);
  }
  if (!sizes.length) errors.push('Ukuran tidak terbaca (produk tanpa ukuran seperti tas atau bola belum didukung).');
  if (errors.length) return { ok: false, errors, warnings };

  let brand = findBrand(nama);
  if (!brand) {
    brand = nama.toLowerCase().split(' ')[0];
    warnings.push(`Merk tidak dikenal, dipakai kata pertama: "${brand}".`);
  }

  // Aturan harga: harga jual = nilai tengah (harga khusus + retail) / 2; harga coret = retail.
  let harga;
  let hargaCoret;
  if (retail) {
    harga = Math.round((special + retail) / 2 / roundTo) * roundTo;
    hargaCoret = retail;
  } else {
    harga = special + noRetailMarkup;
    hargaCoret = 0;
    warnings.push(`Harga retail tidak ada di teks: harga jual = harga supplier + Rp ${noRetailMarkup.toLocaleString('id-ID')}, tanpa harga coret.`);
  }

  const low = text.toLowerCase();
  const female = /\b(women|womens|wanita|ladies|cewek|girl|girls|ballet)\b/.test(low);
  const male = /\b(men|mens|pria|cowok|boy|boys)\b/.test(low);
  const pengguna = female && !male ? 'wanita' : male && !female ? 'pria' : 'unisex';

  return {
    ok: true,
    warnings,
    product: {
      nama,
      brand,
      harga,
      harga_coret: hargaCoret,
      tipe: RUNNING_RE.test(low) ? 'running' : 'kasual',
      asal: /\b(lokal|local)\b/.test(low) ? 'lokal' : 'internasional',
      pengguna,
      sizes,
      warna: detectColors([nama, ...text.split('\n').filter((l) => /^\s*warna\b/i.test(l))].join(' ')),
      deskripsi: '',
    },
    supplierPrice: special,
  };
}
