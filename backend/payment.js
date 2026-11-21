"use strict";
// Pembayaran Midtrans Snap. Harga SELALU dihitung ulang di server dari katalog.
const crypto = require("crypto");

const serverKey = () => String(process.env.MIDTRANS_SERVER_KEY || "").trim();
const clientKey = () => String(process.env.MIDTRANS_CLIENT_KEY || "").trim();
const isProd = () => process.env.MIDTRANS_IS_PRODUCTION === "true";
const base = () => (isProd() ? "https://app.midtrans.com" : "https://app.sandbox.midtrans.com");
const shippingFee = () => Math.max(0, Math.round(Number(process.env.SHIPPING_FEE) || 0));
const TEN_MIN = 10 * 60 * 1000;
const turnstileSecret = () => String(process.env.TURNSTILE_SECRET || "").trim();
const turnstileSiteKey = () => String(process.env.TURNSTILE_SITE_KEY || "").trim();

// CAPTCHA aktif hanya jika TURNSTILE_SECRET dan TURNSTILE_SITE_KEY diisi di Render.
async function verifyTurnstile(token, ip) {
    if (!turnstileSecret() || !turnstileSiteKey()) return true;
    const t = String(token || "");
    if (!t || t.length > 2048) return false;
    try {
        const r = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({ secret: turnstileSecret(), response: t, remoteip: String(ip || "") }),
            signal: AbortSignal.timeout(8000),
        });
        return Boolean((await r.json().catch(() => ({}))).success);
    } catch (e) {
        console.error("Verifikasi Turnstile gagal:", e.message);
        return false;
    }
}

let columnsReady = null;
function ensureColumns(d) {
    if (!columnsReady) {
        columnsReady = (async () => {
            await d.ensureOrdersTable();
            for (const col of [
                "customer_name TEXT DEFAULT ''", "customer_phone TEXT DEFAULT ''",
                "shipping_fee NUMERIC DEFAULT 0", "midtrans_order_id TEXT",
                "payment_status TEXT DEFAULT ''", "payment_type TEXT DEFAULT ''",
                "snap_token TEXT", "paid_at TIMESTAMPTZ", "chat_conversation_token TEXT",
            ]) await d.pool.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS ${col}`);
        })().catch((e) => { columnsReady = null; throw e; });
    }
    return columnsReady;
}

async function handlePaymentRoutes(req, res, pathname, d) {
    const { pool, sendJSON, readBody, getClientIP, isRateLimited, publicErrorMessage } = d;

    if ((req.method === "GET" || req.method === "HEAD") && pathname === "/api/checkout/config") {
        sendJSON(res, 200, { success: true, shipping_fee: shippingFee(), ready: Boolean(serverKey() && clientKey()), turnstile_site_key: turnstileSiteKey() });
        return true;
    }

    if (req.method === "POST" && pathname === "/api/checkout") {
        try {
            const ip = getClientIP(req);
            if (isRateLimited(`checkout:${ip}`, 8, TEN_MIN)) {
                sendJSON(res, 429, { success: false, message: "Terlalu banyak permintaan. Coba lagi nanti." });
                return true;
            }
            if (!serverKey() || !clientKey()) {
                sendJSON(res, 503, { success: false, message: "Pembayaran online belum aktif." });
                return true;
            }
            const body = await readBody(req, 100 * 1024);
            // CAPTCHA dicek SEBELUM kuota global dipakai, supaya bot tidak bisa menghabiskan kuota pembeli asli.
            if (!(await verifyTurnstile(body.cf_token, ip))) {
                sendJSON(res, 400, { success: false, message: "Verifikasi keamanan gagal. Muat ulang halaman lalu coba lagi." });
                return true;
            }
            if (isRateLimited("checkout:global", 100, TEN_MIN)) {
                sendJSON(res, 429, { success: false, message: "Terlalu banyak permintaan. Coba lagi nanti." });
                return true;
            }
            const name = String(body.name || "").trim();
            const phone = String(body.phone || "").replace(/[\s-]/g, "");
            const address = String(body.address || "").trim();
            if (name.length < 2 || name.length > 100) throw new Error("Nama lengkap wajib diisi.");
            if (!/^(\+62|62|0)8\d{8,12}$/.test(phone)) throw new Error("Nomor WhatsApp tidak valid.");
            if (address.length < 15 || address.length > 500) throw new Error("Alamat lengkap wajib diisi (jalan, kelurahan, kota, kode pos).");

            const order = await d.applyCatalogPrices(d.validateOrderData(body));
            const shipping = shippingFee();
            const items = order.items.map((i, n) => ({
                id: `P${n + 1}`, price: Math.round(i.price), quantity: i.qty,
                name: `${i.name}${i.size ? " - " + i.size : ""}`.slice(0, 50),
            }));
            if (shipping > 0) items.push({ id: "ONGKIR", price: shipping, quantity: 1, name: "Ongkos kirim" });
            const gross = items.reduce((s, i) => s + i.price * i.quantity, 0);
            if (gross < 1000) throw new Error("Total pesanan tidak valid.");

            await ensureColumns(d);
            const note = `Nama: ${name}\nWA: ${phone}\nAlamat: ${address}\nOngkir: Rp${shipping}`;
            const ins = await pool.query(
                `INSERT INTO orders (referral, items, total, status, keterangan, customer_name, customer_phone, shipping_fee, payment_status)
                 VALUES ($1,$2,$3,'menunggu_pembayaran',$4,$5,$6,$7,'pending') RETURNING id`,
                [order.referral, JSON.stringify(order.items), gross, note, name, phone, shipping]
            );
            const rowId = ins.rows[0].id;
            // Hubungkan pesanan ke chat pelanggan agar admin bisa konfirmasi lewat chat.
            // Kegagalan di sini tidak boleh menggagalkan checkout.
            if (body.chat_conversation_id && body.chat_visitor_token && d.linkOrderToChat) {
                try {
                    await d.linkOrderToChat(rowId, body.chat_conversation_id, body.chat_visitor_token, name, order.referral);
                } catch (e) { console.warn("Tautan chat pesanan gagal:", e.message); }
            }
            const midtransOrderId = `KS-${rowId}-${Date.now().toString(36)}`;

            const snapRes = await fetch(`${base()}/snap/v1/transactions`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json", Accept: "application/json",
                    Authorization: "Basic " + Buffer.from(serverKey() + ":").toString("base64"),
                },
                body: JSON.stringify({
                    transaction_details: { order_id: midtransOrderId, gross_amount: gross },
                    item_details: items,
                    customer_details: { first_name: name.slice(0, 50), phone, shipping_address: { first_name: name.slice(0, 50), phone, address: address.slice(0, 200) } },
                    expiry: { unit: "hours", duration: 24 },
                }),
                signal: AbortSignal.timeout(15000),
            });
            const snap = await snapRes.json().catch(() => ({}));
            if (!snapRes.ok || !snap.token) {
                console.error("Midtrans gagal:", snapRes.status, JSON.stringify(snap).slice(0, 300));
                await pool.query(`UPDATE orders SET status='gagal', payment_status='gagal_dibuat' WHERE id=$1`, [rowId]);
                throw new Error("Pembayaran tidak dapat dibuat. Coba lagi sebentar.");
            }
            await pool.query(`UPDATE orders SET midtrans_order_id=$1, snap_token=$2 WHERE id=$3`, [midtransOrderId, snap.token, rowId]);
            sendJSON(res, 201, { success: true, token: snap.token, order_id: midtransOrderId, client_key: clientKey(), snap_url: `${base()}/snap/snap.js` });
        } catch (error) {
            console.error("Checkout gagal:", error);
            sendJSON(res, 400, { success: false, message: publicErrorMessage(error) || "Pembayaran tidak dapat diproses." });
        }
        return true;
    }

    if (req.method === "POST" && pathname === "/api/midtrans/notification") {
        try {
            const b = await readBody(req, 100 * 1024);
            const expected = crypto.createHash("sha512")
                .update(`${b.order_id}${b.status_code}${b.gross_amount}${serverKey()}`).digest("hex");
            const given = String(b.signature_key || "");
            if (!serverKey() || given.length !== expected.length ||
                !crypto.timingSafeEqual(Buffer.from(given), Buffer.from(expected))) {
                sendJSON(res, 403, { success: false });
                return true;
            }
            const row = (await pool.query(`SELECT id, total, status FROM orders WHERE midtrans_order_id=$1`, [String(b.order_id)])).rows[0];
            if (!row || Math.round(Number(b.gross_amount)) !== Math.round(Number(row.total))) {
                sendJSON(res, 404, { success: false });
                return true;
            }
            const ts = b.transaction_status, fraud = b.fraud_status;
            let status = null, pay = ts;
            if (ts === "settlement" || (ts === "capture" && fraud !== "challenge")) { status = "dibayar"; pay = "settlement"; }
            else if (ts === "pending" || ts === "capture") status = "menunggu_pembayaran";
            else if (ts === "expire") status = "kedaluwarsa";
            else if (["deny", "cancel", "failure"].includes(ts)) status = "dibatalkan";
            else if (["refund", "partial_refund", "chargeback"].includes(ts)) status = "refund";
            if (status) {
                await pool.query(
                    `UPDATE orders SET status=$2::text, payment_status=$3::text, payment_type=$4::text,
                            paid_at = CASE WHEN $2::text='dibayar' THEN NOW() ELSE paid_at END
                     WHERE id=$1 AND NOT (status IN ('dibayar','diproses','selesai','batal') AND $2::text IN ('menunggu_pembayaran','kedaluwarsa','dibatalkan'))`,
                    [row.id, status, String(pay).slice(0, 40), String(b.payment_type || "").slice(0, 40)]
                );
                // Beri tahu admin hanya saat pesanan BARU menjadi lunas (notifikasi Midtrans bisa berulang).
                if (status === "dibayar" && !["dibayar", "diproses", "selesai"].includes(row.status) && d.notifyAdminOfOrder) {
                    d.notifyAdminOfOrder(row.id).catch((e) => console.warn("Notifikasi pesanan tidak terkirim:", e.message));
                }
            }
            sendJSON(res, 200, { success: true });
        } catch (error) {
            console.error("Notifikasi Midtrans gagal:", error);
            sendJSON(res, 500, { success: false });
        }
        return true;
    }
    return false;
}

module.exports = { handlePaymentRoutes };
