"use strict";
// Ulasan produk. Hanya pembeli yang pesanannya tercatat lewat checkout web (Midtrans)
// yang bisa menulis ulasan: harus menyebut nomor pesanan DAN nomor WhatsApp yang dipakai saat checkout.
const crypto = require("crypto");

// Pesanan baru bisa diulas setelah admin menandainya "selesai" (barang sudah diterima).
// Mau dibuka lebih awal? Tambahkan "dibayar" dan "diproses" di daftar ini.
const ELIGIBLE_STATUSES = ["selesai"];
const TEN_MIN = 10 * 60 * 1000;
const GENERIC_ERR = "Nomor pesanan atau nomor WhatsApp tidak cocok.";

let tableReady = null;
function ensureTable(d) {
    if (!tableReady) {
        tableReady = (async () => {
            await d.ensureOrdersTable();
            await d.pool.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS midtrans_order_id TEXT`);
            await d.pool.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS customer_phone TEXT DEFAULT ''`);
            await d.pool.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS customer_name TEXT DEFAULT ''`);
            await d.pool.query(`CREATE TABLE IF NOT EXISTS reviews (
                id BIGSERIAL PRIMARY KEY,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                order_id BIGINT NOT NULL,
                product_key TEXT NOT NULL,
                product_name TEXT NOT NULL,
                rating SMALLINT NOT NULL CHECK (rating BETWEEN 1 AND 5),
                comment TEXT NOT NULL DEFAULT '',
                reviewer_name TEXT NOT NULL DEFAULT '',
                status TEXT NOT NULL DEFAULT 'approved',
                UNIQUE (order_id, product_key)
            )`);
            await d.pool.query(`CREATE INDEX IF NOT EXISTS reviews_product_idx ON reviews (product_key, status)`);
            await d.lockDownTables(["public.reviews"]);
        })().catch((e) => { tableReady = null; throw e; });
    }
    return tableReady;
}

const keyOf = (name) => String(name || "").trim().toLocaleLowerCase("id-ID");
function normPhone(p) {
    let s = String(p || "").replace(/\D/g, "");
    if (s.startsWith("62")) s = "0" + s.slice(2);
    else if (s.startsWith("8")) s = "0" + s;
    return s;
}
const sameText = (a, b) => {
    const ha = crypto.createHash("sha256").update(String(a)).digest();
    const hb = crypto.createHash("sha256").update(String(b)).digest();
    return crypto.timingSafeEqual(ha, hb);
};
function firstName(full) {
    const w = String(full || "").trim().split(/\s+/)[0] || "Pembeli";
    return w.slice(0, 20).replace(/^./, (c) => c.toLocaleUpperCase("id-ID"));
}

// Cari pesanan: nomor pesanan + nomor WhatsApp harus cocok. null = tidak cocok.
async function findOrder(d, orderId, phone) {
    const oid = String(orderId || "").trim();
    if (!/^KS-\d{1,15}-[a-z0-9]{3,20}$/i.test(oid)) return null;
    const row = (await d.pool.query(
        `SELECT id, status, items, customer_name, customer_phone FROM orders WHERE midtrans_order_id=$1`, [oid]
    )).rows[0];
    const given = normPhone(phone);
    if (!row || !given || !row.customer_phone || !sameText(normPhone(row.customer_phone), given)) return null;
    return row;
}

function uniqueProducts(items) {
    const seen = new Map();
    for (const it of Array.isArray(items) ? items : []) {
        const k = keyOf(it && it.name);
        if (k && !seen.has(k)) seen.set(k, String(it.name).trim());
    }
    return seen; // key -> nama
}

async function handleReviewRoutes(req, res, pathname, d) {
    const { pool, sendJSON, readBody, getClientIP, isRateLimited, publicErrorMessage, requireAdmin } = d;
    const isReviewPath = pathname === "/api/reviews" || pathname.startsWith("/api/reviews/") || pathname.startsWith("/api/admin/reviews");
    if (!isReviewPath) return false;
    try {
        await ensureTable(d);
        const ip = getClientIP(req);

        // ---------- publik: ringkasan rating per produk ----------
        if (req.method === "GET" && pathname === "/api/reviews/summary") {
            const r = await pool.query(
                `SELECT product_key, ROUND(AVG(rating)::numeric, 1) AS avg, COUNT(*)::int AS count
                 FROM reviews WHERE status='approved' GROUP BY product_key`
            );
            const summary = {};
            for (const x of r.rows) summary[x.product_key] = { avg: Number(x.avg), count: x.count };
            sendJSON(res, 200, { success: true, summary });
            return true;
        }

        // ---------- publik: daftar ulasan ----------
        if (req.method === "GET" && pathname === "/api/reviews") {
            const q = new URL(req.url, "http://localhost").searchParams;
            const product = keyOf(q.get("product"));
            const limit = Math.min(30, Math.max(1, Number(q.get("limit")) || 12));
            const r = product
                ? await pool.query(`SELECT product_name, rating, comment, reviewer_name, created_at FROM reviews
                                    WHERE status='approved' AND product_key=$1 ORDER BY created_at DESC LIMIT $2`, [product, limit])
                : await pool.query(`SELECT product_name, rating, comment, reviewer_name, created_at FROM reviews
                                    WHERE status='approved' ORDER BY created_at DESC LIMIT $1`, [limit]);
            sendJSON(res, 200, { success: true, reviews: r.rows });
            return true;
        }

        // ---------- pembeli: cek pesanan ----------
        if (req.method === "POST" && pathname === "/api/reviews/lookup") {
            const b = await readBody(req, 4 * 1024);
            const oid = String(b.order_id || "").trim().slice(0, 60);
            if (isRateLimited(`rv:ip:${ip}`, 15, TEN_MIN) || isRateLimited(`rv:order:${oid.toLowerCase()}`, 6, TEN_MIN)) {
                sendJSON(res, 429, { success: false, message: "Terlalu banyak percobaan. Coba lagi dalam beberapa menit." });
                return true;
            }
            const order = await findOrder(d, oid, b.phone);
            if (!order) { sendJSON(res, 404, { success: false, message: GENERIC_ERR }); return true; }
            if (!ELIGIBLE_STATUSES.includes(order.status)) {
                sendJSON(res, 200, { success: true, eligible: false, message: "Ulasan dibuka setelah pesananmu selesai dan barang diterima." });
                return true;
            }
            const done = new Set((await pool.query(`SELECT product_key FROM reviews WHERE order_id=$1`, [order.id])).rows.map((x) => x.product_key));
            const items = [...uniqueProducts(order.items)].map(([k, name]) => ({ name, reviewed: done.has(k) }));
            sendJSON(res, 200, { success: true, eligible: true, items });
            return true;
        }

        // ---------- pembeli: kirim ulasan ----------
        if (req.method === "POST" && pathname === "/api/reviews") {
            const b = await readBody(req, 8 * 1024);
            const oid = String(b.order_id || "").trim().slice(0, 60);
            if (isRateLimited(`rv:ip:${ip}`, 15, TEN_MIN) || isRateLimited(`rv:order:${oid.toLowerCase()}`, 12, TEN_MIN)) {
                sendJSON(res, 429, { success: false, message: "Terlalu banyak percobaan. Coba lagi dalam beberapa menit." });
                return true;
            }
            const order = await findOrder(d, oid, b.phone);
            if (!order) { sendJSON(res, 404, { success: false, message: GENERIC_ERR }); return true; }
            if (!ELIGIBLE_STATUSES.includes(order.status)) {
                sendJSON(res, 403, { success: false, message: "Ulasan dibuka setelah pesananmu selesai dan barang diterima." });
                return true;
            }
            const products = uniqueProducts(order.items);
            const pk = keyOf(b.product);
            const rating = Number(b.rating);
            const comment = String(b.comment || "").replace(/\s+/g, " ").trim();
            if (!products.has(pk)) { sendJSON(res, 400, { success: false, message: "Produk tidak ada di pesanan ini." }); return true; }
            if (!Number.isInteger(rating) || rating < 1 || rating > 5) { sendJSON(res, 400, { success: false, message: "Pilih rating 1 sampai 5." }); return true; }
            if (comment.length > 600) { sendJSON(res, 400, { success: false, message: "Ulasan maksimal 600 karakter." }); return true; }
            const ins = await pool.query(
                `INSERT INTO reviews (order_id, product_key, product_name, rating, comment, reviewer_name)
                 VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (order_id, product_key) DO NOTHING RETURNING id`,
                [order.id, pk, products.get(pk), rating, comment, firstName(order.customer_name)]
            );
            if (!ins.rows.length) { sendJSON(res, 409, { success: false, message: "Kamu sudah mengulas produk ini." }); return true; }
            sendJSON(res, 201, { success: true, message: "Terima kasih, ulasanmu sudah terbit." });
            return true;
        }

        // ---------- admin ----------
        if (pathname.startsWith("/api/admin/reviews")) {
            if (!requireAdmin(req, res)) return true;
            if (req.method === "GET" && pathname === "/api/admin/reviews") {
                const r = await pool.query(`SELECT id, created_at, order_id, product_name, rating, comment, reviewer_name, status
                                            FROM reviews ORDER BY created_at DESC LIMIT 300`);
                sendJSON(res, 200, { success: true, reviews: r.rows });
                return true;
            }
            const m = pathname.match(/^\/api\/admin\/reviews\/(\d{1,15})$/);
            if (m && req.method === "PATCH") {
                const b = await readBody(req, 1024);
                const st = String(b.status || "");
                if (!["approved", "hidden"].includes(st)) { sendJSON(res, 400, { success: false, message: "Status tidak valid." }); return true; }
                const r = await pool.query(`UPDATE reviews SET status=$2 WHERE id=$1 RETURNING id`, [m[1], st]);
                sendJSON(res, r.rows.length ? 200 : 404, { success: r.rows.length > 0 });
                return true;
            }
            if (m && req.method === "DELETE") {
                const r = await pool.query(`DELETE FROM reviews WHERE id=$1 RETURNING id`, [m[1]]);
                sendJSON(res, r.rows.length ? 200 : 404, { success: r.rows.length > 0 });
                return true;
            }
        }
        return false;
    } catch (error) {
        console.error("Ulasan gagal:", error);
        sendJSON(res, 500, { success: false, message: publicErrorMessage(error) || "Ulasan tidak dapat diproses." });
        return true;
    }
}

module.exports = { handleReviewRoutes };
