const http = require("http");
const https = require("https");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { Pool } = require("pg");

const PORT = process.env.PORT || 3000;
const PUBLIC_BASE_URL =
    process.env.RENDER_EXTERNAL_URL || "https://kicks-station.onrender.com";

const SUPABASE_URL = String(process.env.SUPABASE_URL || "").replace(/\/+$/, "");
const SUPABASE_SERVICE_ROLE_KEY = String(
    process.env.SUPABASE_SERVICE_ROLE_KEY || ""
).trim();
const SUPABASE_BUCKET = "product-images";

const DATABASE_URL = String(process.env.DATABASE_URL || "").trim();

const productsFile = path.join(__dirname, "..", "products.json");
const imagesFolder = path.join(__dirname, "..", "images");

const MAX_IMAGE_SIZE = 5 * 1024 * 1024;
const MAX_IMAGES = 10;
const MAX_REQUEST_SIZE = 60 * 1024 * 1024;

const ADMIN_PIN = String(process.env.ADMIN_PIN || "").trim();
const SESSION_DURATION = 12 * 60 * 60 * 1000;
const adminSessions = new Map();
const loginAttempts = new Map();
const LOGIN_WINDOW = 15 * 60 * 1000;
const MAX_LOGIN_FAILURES = 5;

let pool = null;
let databaseReady = false;
let migrationPromise = null;

if (!DATABASE_URL) {
    console.error("DATABASE_URL belum diset.");
} else {
    pool = new Pool({
        connectionString: DATABASE_URL,
        ssl: { rejectUnauthorized: false },
        max: 5,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 10000,
    });
}

function getClientIP(req) {
    return String(
        req.headers["x-forwarded-for"] ||
        req.socket?.remoteAddress ||
        "unknown"
    )
        .split(",")[0]
        .trim();
}

// =====================================================
// IP GEOLOCATION
// Lokasi dicari dari IP request, tetapi IP TIDAK disimpan
// ke database. Jika layanan geolocation gagal, kunjungan
// tetap dicatat tanpa lokasi.
// =====================================================
const GEO_CACHE_TTL = 60 * 60 * 1000; // 1 jam
const GEO_CACHE_MAX = 500;
const geoCache = new Map();

function normalizeClientIP(ip) {
    let value = String(ip || "").trim();
    if (value.startsWith("::ffff:")) value = value.slice(7);
    if (value === "::1") return "";
    if (value === "127.0.0.1") return "";
    if (value === "unknown") return "";
    return value;
}

function fetchJSON(url, timeoutMs = 5000) {
    return new Promise((resolve, reject) => {
        const request = https.get(
            url,
            { headers: { "User-Agent": "Kick-Station-Analytics/1.0" } },
            response => {
                let body = "";
                response.setEncoding("utf8");
                response.on("data", chunk => { body += chunk; });
                response.on("end", () => {
                    if (response.statusCode < 200 || response.statusCode >= 300) {
                        reject(new Error(`Geolocation HTTP ${response.statusCode}`));
                        return;
                    }
                    try {
                        resolve(JSON.parse(body));
                    } catch {
                        reject(new Error("Respons geolocation bukan JSON yang valid."));
                    }
                });
            }
        );

        request.setTimeout(timeoutMs, () => {
            request.destroy(new Error("Geolocation timeout."));
        });

        request.on("error", reject);
    });
}

function formatLocation(data) {
    return [data?.city, data?.region, data?.country]
        .map(value => String(value || "").trim())
        .filter(Boolean)
        .join(", ");
}

async function getVisitorLocation(ip) {
    const safeIP = normalizeClientIP(ip);

    if (!safeIP) {
        return {
            location: "",
            city: "",
            region: "",
            country: "",
            country_code: "",
            latitude: null,
            longitude: null
        };
    }

    const cached = geoCache.get(safeIP);

    if (cached && cached.expiresAt > Date.now()) {
        return cached.data;
    }

    // ipapi.co digunakan untuk lookup lokasi berdasarkan IP publik.
    const url = `https://ipapi.co/${encodeURIComponent(safeIP)}/json/`;

    try {
        const data = await fetchJSON(url);

        if (data?.error) {
            throw new Error(
                data?.reason ||
                data?.message ||
                "ipapi.co mengembalikan error."
            );
        }

        const result = {
            location: [
                data?.city,
                data?.region,
                data?.country_name
            ]
                .map(value => String(value || "").trim())
                .filter(Boolean)
                .join(", "),

            city: String(data?.city || "").trim(),

            region: String(data?.region || "").trim(),

            country: String(data?.country_name || "").trim(),

            country_code: String(data?.country_code || "").trim(),

            latitude:
                data?.latitude == null
                    ? null
                    : Number(data.latitude),

            longitude:
                data?.longitude == null
                    ? null
                    : Number(data.longitude)
        };

        geoCache.set(safeIP, {
            data: result,
            expiresAt: Date.now() + GEO_CACHE_TTL
        });

        while (geoCache.size > GEO_CACHE_MAX) {
            const firstKey = geoCache.keys().next().value;

            if (firstKey === undefined) break;

            geoCache.delete(firstKey);
        }

        return result;

    } catch (error) {
        console.warn(
            "Geolocation tidak tersedia:",
            error.message
        );

        return {
            location: "",
            city: "",
            region: "",
            country: "",
            country_code: "",
            latitude: null,
            longitude: null
        };
    }
}

function cleanupAdminSessions() {
    const now = Date.now();
    for (const [token, session] of adminSessions) {
        if (session.expiresAt <= now) adminSessions.delete(token);
    }
}

function canAttemptLogin(ip) {
    const now = Date.now();
    const attempts = loginAttempts.get(ip);
    if (!attempts || now - attempts.windowStart >= LOGIN_WINDOW) {
        loginAttempts.delete(ip);
        return true;
    }
    return attempts.failures < MAX_LOGIN_FAILURES;
}

function recordLoginFailure(ip) {
    const now = Date.now();
    const attempts = loginAttempts.get(ip);
    if (!attempts || now - attempts.windowStart >= LOGIN_WINDOW) {
        loginAttempts.set(ip, { windowStart: now, failures: 1 });
    } else {
        attempts.failures++;
    }
}

function getAdminToken(req) {
    const header = String(req.headers.authorization || "");
    return header.startsWith("Bearer ")
        ? header.slice(7).trim() || null
        : null;
}

function isAdminAuthenticated(req) {
    cleanupAdminSessions();
    const token = getAdminToken(req);
    const session = token ? adminSessions.get(token) : null;
    return Boolean(session && session.expiresAt > Date.now());
}

function requireAdmin(req, res) {
    if (!ADMIN_PIN || !isAdminAuthenticated(req)) {
        sendJSON(res, 401, {
            success: false,
            message: !ADMIN_PIN
                ? "Admin authentication belum dikonfigurasi di server."
                : "Unauthorized. Silakan login sebagai admin.",
        });
        return false;
    }
    return true;
}

function sendJSON(res, statusCode, data) {
    res.writeHead(statusCode, {
        "Content-Type": "application/json; charset=utf-8",
    });
    res.end(JSON.stringify(data));
}

function normalizeImages(gambar) {
    if (!gambar) return [];

    if (Array.isArray(gambar)) {
        return gambar.filter(
            (image) => typeof image === "string" && image.trim() !== ""
        );
    }

    if (typeof gambar === "string") {
        return gambar.trim() ? [gambar.trim()] : [];
    }

    return [];
}

function toStoragePath(imagePath) {
    if (typeof imagePath !== "string") return null;

    const value = imagePath.trim();
    if (!value) return null;

    // Format internal storage yang kita simpan.
    if (value.startsWith("product-images/")) {
        return value.slice("product-images/".length);
    }

    // Path relatif langsung dari bucket, misalnya: products/51/foto.jpg
    if (value.startsWith("products/")) {
        return value;
    }

    // URL Supabase Storage public.
    if (SUPABASE_URL) {
        try {
            const parsed = new URL(value);
            const prefix = `/storage/v1/object/public/${SUPABASE_BUCKET}/`;
            if (parsed.origin === SUPABASE_URL && parsed.pathname.startsWith(prefix)) {
                return decodeURIComponent(parsed.pathname.slice(prefix.length));
            }
        } catch {}
    }

    return null;
}

function toPublicImageUrl(imagePath) {
    if (typeof imagePath !== "string") return imagePath;

    const storagePath = toStoragePath(imagePath);
    if (storagePath && SUPABASE_URL) {
        return `${SUPABASE_URL}/storage/v1/object/public/${SUPABASE_BUCKET}/${storagePath
            .split("/")
            .map(encodeURIComponent)
            .join("/")}`;
    }

    return imagePath;
}

function productForClient(product) {
    const result = { ...product };
    const images = normalizeImages(product.gambar);

    result.gambar = images.map(toPublicImageUrl);
    return result;
}

function productsForClient(products) {
    return products.map(productForClient);
}

function sanitizeFilename(filename) {
    return path
        .basename(String(filename || "image"))
        .replace(/[<>:"/\\|?*\x00-\x1F]/g, "_")
        .replace(/\s+/g, " ")
        .trim();
}

function validateImageData(imageData) {
    if (!imageData || !imageData.data) {
        throw new Error("Data foto tidak lengkap.");
    }

    const cleanName = sanitizeFilename(imageData.name || "image");
    if (!cleanName) {
        throw new Error("Nama file gambar tidak valid.");
    }

    const mimeMatch = String(imageData.data).match(
        /^data:(image\/(?:jpeg|png|webp));base64,/i
    );

    if (!mimeMatch) {
        throw new Error(
            `Format foto "${cleanName}" harus JPG, PNG, atau WEBP.`
        );
    }

    const base64 = imageData.data.replace(
        /^data:image\/(?:jpeg|png|webp);base64,/i,
        ""
    );

    const buffer = Buffer.from(base64, "base64");

    if (!buffer.length) {
        throw new Error("File gambar kosong atau rusak.");
    }

    if (buffer.length > MAX_IMAGE_SIZE) {
        throw new Error(`Ukuran foto "${cleanName}" maksimal 5 MB.`);
    }

    const extension = path.extname(cleanName).toLowerCase();
    const allowedExtensions = [".jpg", ".jpeg", ".png", ".webp"];

    if (!allowedExtensions.includes(extension)) {
        throw new Error(
            `Format foto "${cleanName}" harus JPG, JPEG, PNG, atau WEBP.`
        );
    }

    const mime =
        extension === ".png"
            ? "image/png"
            : extension === ".webp"
              ? "image/webp"
              : "image/jpeg";

    return { cleanName, extension, mime, buffer };
}

function validateProductData(data) {
    if (!data.nama || !String(data.nama).trim()) {
        throw new Error("Nama produk wajib diisi.");
    }

    if (!data.brand || !String(data.brand).trim()) {
        throw new Error("Brand wajib diisi.");
    }

    if (!data.harga || Number(data.harga) <= 0) {
        throw new Error("Harga tidak valid.");
    }

    if (!Array.isArray(data.sizes) || data.sizes.length === 0) {
        throw new Error("Minimal satu ukuran harus dipilih.");
    }
}

function readBody(req) {
    return new Promise((resolve, reject) => {
        let body = "";
        let rejected = false;

        req.on("data", (chunk) => {
            if (rejected) return;

            body += chunk.toString();

            if (Buffer.byteLength(body, "utf8") > MAX_REQUEST_SIZE) {
                rejected = true;
                reject(
                    new Error(
                        "Total ukuran upload terlalu besar. Maksimal 60 MB."
                    )
                );
                req.destroy();
            }
        });

        req.on("end", () => {
            if (rejected) return;

            try {
                resolve(JSON.parse(body));
            } catch {
                reject(new Error("Format data tidak valid."));
            }
        });

        req.on("error", reject);
    });
}

function legacyImageFilePath(imagePath) {
    if (typeof imagePath !== "string") return null;

    const value = imagePath.trim();
    if (!value.startsWith("images/")) return null;

    const filename = path.basename(value);
    const resolvedFolder = path.resolve(imagesFolder);
    const resolvedFile = path.resolve(imagesFolder, filename);

    if (!resolvedFile.startsWith(resolvedFolder + path.sep)) return null;
    return resolvedFile;
}

async function supabaseStorageRequest(endpoint, options = {}) {
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
        throw new Error(
            "SUPABASE_URL dan SUPABASE_SERVICE_ROLE_KEY belum dikonfigurasi."
        );
    }

    const headers = {
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        ...(options.headers || {}),
    };

    const response = await fetch(`${SUPABASE_URL}${endpoint}`, {
        ...options,
        headers,
    });

    const text = await response.text();

    if (!response.ok) {
        let message = text;
        try {
            const parsed = JSON.parse(text);
            message = parsed.message || parsed.error || text;
        } catch {}
        throw new Error(`Supabase Storage: ${message}`);
    }

    return text ? JSON.parse(text) : null;
}

async function uploadBufferToStorage(storagePath, buffer, mime) {
    const encodedPath = storagePath
        .split("/")
        .map(encodeURIComponent)
        .join("/");

    await supabaseStorageRequest(
        `/storage/v1/object/${SUPABASE_BUCKET}/${encodedPath}`,
        {
            method: "POST",
            headers: {
                "Content-Type": mime,
                "x-upsert": "true",
            },
            body: buffer,
        }
    );

    return storagePath;
}

async function deleteStorageImages(imagePaths) {
    const names = normalizeImages(imagePaths)
        .map(toStoragePath)
        .filter(Boolean);

    if (!names.length) return;

    await supabaseStorageRequest("/storage/v1/object/remove", {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
        },
        body: JSON.stringify(
            names.map((name) => ({
                bucket_id: SUPABASE_BUCKET,
                name,
            }))
        ),
    });
}

async function uploadImageObject(imageData, prefix = "products") {
    const validated = validateImageData(imageData);

    const baseName = path.basename(
        validated.cleanName,
        validated.extension
    );

    const safeBaseName =
        baseName
            .replace(/[^a-zA-Z0-9._-]+/g, "-")
            .replace(/-+/g, "-")
            .replace(/^-|-$/g, "") || "image";

    const finalName = `${prefix}/${Date.now()}-${crypto.randomBytes(5).toString("hex")}-${safeBaseName}${validated.extension}`;

    await uploadBufferToStorage(
        finalName,
        validated.buffer,
        validated.mime
    );

    return finalName;
}

async function migrateLegacyImage(imagePath) {
    const storagePath = toStoragePath(imagePath);
    if (storagePath) return storagePath;

    const filePath = legacyImageFilePath(imagePath);
    if (!filePath || !fs.existsSync(filePath)) return null;

    const extension = path.extname(filePath).toLowerCase();
    const mime =
        extension === ".png"
            ? "image/png"
            : extension === ".webp"
              ? "image/webp"
              : "image/jpeg";

    const buffer = fs.readFileSync(filePath);
    if (buffer.length > MAX_IMAGE_SIZE) {
        console.warn("Foto legacy terlalu besar, dilewati:", imagePath);
        return null;
    }

    const cleanName = sanitizeFilename(path.basename(filePath));
    const finalName = `products/legacy-${crypto.randomBytes(5).toString("hex")}-${cleanName}`;

    await uploadBufferToStorage(finalName, buffer, mime);
    return finalName;
}

async function ensureDatabase() {
    if (!pool) {
        throw new Error("DATABASE_URL belum diset di Render.");
    }

    await pool.query(`
        CREATE TABLE IF NOT EXISTS products (
            id INTEGER PRIMARY KEY,
            nama TEXT NOT NULL,
            brand TEXT NOT NULL,
            harga NUMERIC NOT NULL,
            harga_coret NUMERIC DEFAULT 0,
            tipe TEXT DEFAULT 'kasual',
            asal TEXT DEFAULT 'internasional',
            pengguna TEXT DEFAULT 'unisex',
            sizes JSONB NOT NULL DEFAULT '[]'::jsonb,
            gambar JSONB NOT NULL DEFAULT '[]'::jsonb,
            deskripsi TEXT DEFAULT '',
            upload_order INTEGER NOT NULL
        )
    `);

    await pool.query(`ALTER TABLE products DROP COLUMN IF EXISTS stok`);

    databaseReady = true;
}

async function getProducts() {
    await ensureDatabase();

    const result = await pool.query(`
        SELECT
            id,
            nama,
            brand,
            harga,
            harga_coret,
            tipe,
            asal,
            pengguna,
            sizes,
            gambar,
            deskripsi,
            upload_order
        FROM products
        ORDER BY upload_order ASC, id ASC
    `);

    return result.rows.map((row) => ({
        ...row,
        harga: Number(row.harga),
        harga_coret: Number(row.harga_coret || 0),
        sizes: Array.isArray(row.sizes) ? row.sizes : [],
        gambar: normalizeImages(row.gambar),
        upload_order: Number(row.upload_order),
    }));
}

async function insertProduct(product) {
    await pool.query(
        `
        INSERT INTO products
        (id, nama, brand, harga, harga_coret, tipe, asal, pengguna, sizes, gambar, deskripsi, upload_order)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10::jsonb,$11,$12)
        `,
        [
            product.id,
            product.nama,
            product.brand,
            product.harga,
            product.harga_coret,
            product.tipe,
            product.asal,
            product.pengguna,
            JSON.stringify(product.sizes),
            JSON.stringify(product.gambar),
            product.deskripsi,
            product.upload_order,
        ]
    );
}

async function updateProductRow(product) {
    await pool.query(
        `
        UPDATE products SET
            nama=$2,
            brand=$3,
            harga=$4,
            harga_coret=$5,
            tipe=$6,
            asal=$7,
            pengguna=$8,
            sizes=$9::jsonb,
            gambar=$10::jsonb,
            deskripsi=$11,
            upload_order=$12
        WHERE id=$1
        `,
        [
            product.id,
            product.nama,
            product.brand,
            product.harga,
            product.harga_coret,
            product.tipe,
            product.asal,
            product.pengguna,
            JSON.stringify(product.sizes),
            JSON.stringify(product.gambar),
            product.deskripsi,
            product.upload_order,
        ]
    );
}

async function deleteProductRow(id) {
    await pool.query("DELETE FROM products WHERE id=$1", [id]);
}

async function migrateProductsFromJSONIfNeeded() {
    await ensureDatabase();

    const countResult = await pool.query(
        "SELECT COUNT(*)::int AS count FROM products"
    );
    const count = Number(countResult.rows[0].count);

    if (count > 0) {
        console.log(`Supabase sudah berisi ${count} produk. Migrasi dilewati.`);
        return;
    }

    if (!fs.existsSync(productsFile)) {
        console.log("products.json tidak ditemukan. Database dimulai kosong.");
        return;
    }

    let legacyProducts;
    try {
        legacyProducts = JSON.parse(fs.readFileSync(productsFile, "utf8"));
    } catch (error) {
        console.error("Gagal membaca products.json:", error);
        return;
    }

    if (!Array.isArray(legacyProducts) || !legacyProducts.length) {
        console.log("products.json kosong. Database dimulai kosong.");
        return;
    }

    console.log(
        `Memulai migrasi ${legacyProducts.length} produk lama ke Supabase...`
    );

    for (let index = 0; index < legacyProducts.length; index++) {
        const old = legacyProducts[index];

        const oldImages = normalizeImages(old.gambar);
        const migratedImages = [];

        for (const image of oldImages) {
            try {
                const migrated = await migrateLegacyImage(image);
                if (migrated) {
                    migratedImages.push(migrated);
                } else {
                    migratedImages.push(image);
                }
            } catch (error) {
                console.error("Gagal migrasi foto:", image, error.message);
                migratedImages.push(image);
            }
        }

        const product = {
            id: Number(old.id) || index + 1,
            nama: String(old.nama || "").trim(),
            brand: String(old.brand || "").trim(),
            harga: Number(old.harga) || 0,
            harga_coret: Number(old.harga_coret) || 0,
            tipe: old.tipe || "kasual",
            asal: old.asal || "internasional",
            pengguna: old.pengguna || "unisex",
            sizes: Array.isArray(old.sizes)
                ? old.sizes.map(String)
                : [],
            gambar: migratedImages,
            deskripsi: String(old.deskripsi || "").trim(),
            upload_order: Number(old.upload_order) || index + 1,
        };

        if (!product.nama || !product.brand || product.harga <= 0) {
            console.warn("Produk legacy tidak valid, dilewati:", old);
            continue;
        }

        await insertProduct(product);
    }

    console.log("Migrasi produk lama selesai.");
}

async function initializeDatabase() {
    if (migrationPromise) return migrationPromise;

    migrationPromise = (async () => {
        await migrateProductsFromJSONIfNeeded();
        databaseReady = true;
        console.log("Database Supabase siap digunakan.");
    })().catch((error) => {
        databaseReady = false;
        console.error("Gagal menyiapkan database:", error);
        throw error;
    });

    return migrationPromise;
}

function renumberProducts(products) {
    products.forEach((product, index) => {
        product.id = index + 1;
        product.upload_order = index + 1;
    });
}

async function renumberDatabaseProducts(products) {
    // Renumbering dilakukan dalam transaction agar tidak bentrok dengan
    // primary key ketika ID 1,2,3,... berubah.
    const client = await pool.connect();

    try {
        await client.query("BEGIN");

        for (const product of products) {
            await client.query(
                "UPDATE products SET id=$2, upload_order=$3 WHERE id=$1",
                [product._oldId, 1000000000 + product._oldId, product.upload_order]
            );
        }

        for (const product of products) {
            await client.query(
                "UPDATE products SET id=$2, upload_order=$3 WHERE id=$1",
                [1000000000 + product._oldId, product.id, product.upload_order]
            );
        }

        await client.query("COMMIT");
    } catch (error) {
        await client.query("ROLLBACK");
        throw error;
    } finally {
        client.release();
    }
}

function extractProductId(req) {
    const pathname = new URL(req.url, "http://localhost").pathname;
    const id = Number(pathname.split("/").pop());
    if (!Number.isInteger(id)) {
        throw new Error("ID produk tidak valid.");
    }
    return id;
}

// =========================================================
// PESANAN / CHECKOUT
// =========================================================

function validateOrderData(data) {
    if (!data || typeof data !== "object") throw new Error("Data pesanan tidak valid.");
    const referral = typeof data.referral === "string" ? data.referral.trim().slice(0, 100) : "";
    if (!Array.isArray(data.items) || !data.items.length) throw new Error("Pesanan tidak memiliki produk.");
    if (data.items.length > 30) throw new Error("Pesanan terlalu banyak.");
    const items = data.items.map((item) => {
        if (!item || typeof item !== "object") throw new Error("Data item pesanan tidak valid.");
        const name = String(item.name || item.nama || "").trim();
        const size = String(item.size || "").trim();
        const qty = Number(item.qty);
        const price = Number(item.price);
        if (!name) throw new Error("Nama produk pada pesanan tidak valid.");
        if (name.length > 200) throw new Error("Nama produk terlalu panjang.");
        if (size.length > 50) throw new Error("Ukuran produk tidak valid.");
        if (!Number.isInteger(qty) || qty < 1 || qty > 99) throw new Error("Jumlah produk tidak valid.");
        if (!Number.isFinite(price) || price < 0 || price > 1000000000) throw new Error("Harga produk tidak valid.");
        return { name, size, qty, price };
    });
    const total = items.reduce((sum, item) => sum + item.price * item.qty, 0);
    if (!Number.isFinite(total) || total < 0 || total > 100000000000) throw new Error("Total pesanan tidak valid.");
    return { referral, items, total };
}

async function ensureOrdersTable() {
    if (!pool) throw new Error("DATABASE_URL belum diset di Render.");
    await pool.query(`CREATE TABLE IF NOT EXISTS orders (
        id BIGSERIAL PRIMARY KEY,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        referral TEXT DEFAULT '',
        user_agent TEXT DEFAULT '',
        items JSONB NOT NULL DEFAULT '[]'::jsonb,
        total NUMERIC NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'baru',
        keterangan TEXT DEFAULT ''
    )`);

    
    await pool.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS keterangan TEXT DEFAULT ''`);
    await pool.query(`ALTER TABLE orders ENABLE ROW LEVEL SECURITY`);
}

function mapOrder(row) {
    return {
        id: Number(row.id),
        created_at: row.created_at,
        referral: row.referral || "",
        items: Array.isArray(row.items) ? row.items : [],
        total: Number(row.total || 0),
        status: row.status || "baru",
        keterangan: row.keterangan || ""
    };
}

async function createOrder(order) {
    await ensureOrdersTable();
    const result = await pool.query(
        `INSERT INTO orders (referral, items, total, status)
         VALUES ($1, $2::jsonb, $3, 'baru')
         RETURNING id, created_at, referral, items, total, status, keterangan`,
        [order.referral, JSON.stringify(order.items), order.total]
    );
    return result.rows[0];
}

async function getOrders() {
    await ensureOrdersTable();
    const result = await pool.query(
        `SELECT id, created_at, referral, items, total, status, keterangan
         FROM orders ORDER BY created_at DESC, id DESC`
    );
    return result.rows.map(mapOrder);
}

async function updateOrderStatus(id, status, keterangan) {
    await ensureOrdersTable();
    const allowedStatuses = ["baru", "diproses", "selesai", "batal"];
    if (!allowedStatuses.includes(status)) throw new Error("Status pesanan tidak valid.");
    const result = await pool.query(
        `UPDATE orders
         SET status=$2, keterangan=COALESCE($3, keterangan)
         WHERE id=$1
         RETURNING id, created_at, referral, items, total, status, keterangan`,
        [id, status, keterangan === undefined ? null : String(keterangan).slice(0, 1000)]
    );
    if (!result.rows.length) throw new Error("Pesanan tidak ditemukan.");
    return mapOrder(result.rows[0]);
}

async function deleteOrder(id) {
    await ensureOrdersTable();
    const result = await pool.query(`DELETE FROM orders WHERE id=$1 RETURNING id`, [id]);
    if (!result.rows.length) throw new Error("Pesanan tidak ditemukan.");
}

async function deleteAllOrders() {
    await ensureOrdersTable();
    await pool.query(`DELETE FROM orders`);
}

async function deleteAllVisits() {
    await ensureAnalyticsTable();
    await pool.query(`DELETE FROM public.site_visits`);
}

async function deleteVisitById(id) {
    await ensureAnalyticsTable();

    const result = await pool.query(
        `DELETE FROM public.site_visits WHERE id = $1 RETURNING id`,
        [id]
    );

    if (!result.rowCount) {
        throw new Error("Kunjungan tidak ditemukan.");
    }
}

async function ensureAnalyticsTable() {
    if (!pool) throw new Error("DATABASE_URL belum diset di Render.");

    await pool.query(`
        CREATE TABLE IF NOT EXISTS public.site_visits (
            id BIGSERIAL PRIMARY KEY,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            visitor_id TEXT NOT NULL,
            referral TEXT DEFAULT '',
            user_agent TEXT DEFAULT ''
        )
    `);

    await pool.query(`
        ALTER TABLE public.site_visits
        ADD COLUMN IF NOT EXISTS user_agent TEXT DEFAULT ''
    `);

    await pool.query(`
        CREATE INDEX IF NOT EXISTS idx_site_visits_visitor_id
        ON public.site_visits(visitor_id)
    `);

    await pool.query(`
        ALTER TABLE public.site_visits
        ADD COLUMN IF NOT EXISTS location TEXT DEFAULT ''
    `);

    await pool.query(`
        ALTER TABLE public.site_visits
        ADD COLUMN IF NOT EXISTS city TEXT DEFAULT ''
    `);

    await pool.query(`
        ALTER TABLE public.site_visits
        ADD COLUMN IF NOT EXISTS region TEXT DEFAULT ''
    `);

    await pool.query(`
        ALTER TABLE public.site_visits
        ADD COLUMN IF NOT EXISTS country TEXT DEFAULT ''
    `);

    await pool.query(`
        ALTER TABLE public.site_visits
        ADD COLUMN IF NOT EXISTS country_code TEXT DEFAULT ''
    `);

    await pool.query(`
        ALTER TABLE public.site_visits
        ADD COLUMN IF NOT EXISTS latitude DOUBLE PRECISION
    `);

    await pool.query(`
        ALTER TABLE public.site_visits
        ADD COLUMN IF NOT EXISTS longitude DOUBLE PRECISION
    `);
}


async function recordVisit(visitorId, referral, userAgent, locationData = {}) {
    await ensureAnalyticsTable();

    const safeVisitor = String(visitorId || '').trim().slice(0, 100);
    const safeReferral = String(referral || '').trim().toLowerCase().slice(0, 100);
    const safeUserAgent = String(userAgent || '').slice(0, 500);
    const safeLocation = String(locationData.location || '').trim().slice(0, 255);
    const safeCity = String(locationData.city || '').trim().slice(0, 100);
    const safeRegion = String(locationData.region || '').trim().slice(0, 100);
    const safeCountry = String(locationData.country || '').trim().slice(0, 100);
    const safeCountryCode = String(locationData.country_code || '').trim().slice(0, 10);

    const latitude = Number.isFinite(Number(locationData.latitude))
        ? Number(locationData.latitude)
        : null;
    const longitude = Number.isFinite(Number(locationData.longitude))
        ? Number(locationData.longitude)
        : null;

    if (!safeVisitor) {
        throw new Error('visitor_id wajib diisi.');
    }

    await pool.query(
        `INSERT INTO public.site_visits
        (visitor_id, referral, user_agent, location, city, region, country, country_code, latitude, longitude)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [
            safeVisitor,
            safeReferral,
            safeUserAgent,
            safeLocation,
            safeCity,
            safeRegion,
            safeCountry,
            safeCountryCode,
            latitude,
            longitude
        ]
    );
}
async function getAnalytics() {
    await ensureAnalyticsTable();

    const result = await pool.query(`
        SELECT
            COUNT(*)::int AS total_visits,
            COUNT(DISTINCT visitor_id)::int AS unique_visitors,
            COUNT(*) FILTER (WHERE referral <> '')::int AS referral_visits
        FROM public.site_visits
    `);

    return result.rows[0];
}

async function getRecentVisits(limit = 100) {
    await ensureAnalyticsTable();

    const result = await pool.query(`
        SELECT
            id,
            created_at,
            visitor_id,
            referral,
            user_agent,
            location,
            city,
            region,
            country,
            country_code,
            latitude,
            longitude
        FROM public.site_visits
        ORDER BY created_at DESC, id DESC
        LIMIT $1
    `, [Math.min(Math.max(Number(limit) || 100, 1), 500)]);

    return result.rows.map(row => ({
        id: Number(row.id),
        created_at: row.created_at,
        visitor_id: row.visitor_id,
        referral: row.referral || '',
        user_agent: row.user_agent || '',
        location: row.location || '',
        city: row.city || '',
        region: row.region || '',
        country: row.country || '',
        country_code: row.country_code || '',
        latitude: row.latitude == null ? null : Number(row.latitude),
        longitude: row.longitude == null ? null : Number(row.longitude)
    }));
}


const server = http.createServer(async (req, res) => {
    console.log("REQUEST:", req.method, req.url);
    res.setHeader("Access-Control-Allow-Origin", "https://leonnidazz.github.io");
    res.setHeader("Access-Control-Allow-Credentials", "true");
    res.setHeader(
        "Access-Control-Allow-Methods",
        "GET, POST, PUT, PATCH, DELETE, OPTIONS"
    );
    res.setHeader(
        "Access-Control-Allow-Headers",
        "Content-Type, Authorization"
    );

    if (req.method === "OPTIONS") {
        res.writeHead(204);
        res.end();
        return;
    }

    try {
        if (req.method === "GET" && req.url === "/") {
            sendJSON(res, 200, {
                status: "online",
                message: "Kicks Station Backend berhasil berjalan!",
                database: databaseReady ? "supabase" : "not-ready",
            });
            return;
        }

        if (req.method === "POST" && new URL(req.url, "http://localhost").pathname === "/api/analytics/visit") {
    try {
        const data = await readBody(req);
        const clientIP = getClientIP(req);

        console.log("KICKSTATION VISITOR IP:", clientIP);

        const locationData = await getVisitorLocation(clientIP);

        console.log(
            "KICKSTATION LOCATION DATA:",
            JSON.stringify(locationData)
        );

        await recordVisit(
            data?.visitor_id,
            data?.referral,
            data?.user_agent,
            locationData
        );

        sendJSON(res, 201, {
            success: true,
            location: locationData.location || ""
        });
    } catch (error) {
        console.error("Gagal mencatat kunjungan:", error);

        sendJSON(res, 400, {
            success: false,
            message:
                error.message ||
                "Kunjungan tidak dapat dicatat."
        });
    }

    return;
}

        // =====================================================
        // POST PESANAN / CHECKOUT
        // =====================================================
        if (req.method === "POST" && req.url === "/api/orders") {
            try {
                const order = validateOrderData(await readBody(req));
                const savedOrder = await createOrder(order);
                sendJSON(res, 201, { success:true, message:"Checkout berhasil dicatat.", order:{ id:Number(savedOrder.id), created_at:savedOrder.created_at, referral:savedOrder.referral || "", total:Number(savedOrder.total || 0), status:savedOrder.status } });
            } catch (error) {
                console.error("Gagal menyimpan pesanan:", error);
                sendJSON(res, 400, { success:false, message:error.message || "Pesanan tidak dapat disimpan." });
            }
            return;
        }

        if (req.method === "POST" && req.url === "/api/admin/login") {
            const ip = getClientIP(req);

            if (!ADMIN_PIN) {
                sendJSON(res, 503, {
                    success: false,
                    message: "ADMIN_PIN belum diset di server.",
                });
                return;
            }

            if (!canAttemptLogin(ip)) {
                sendJSON(res, 429, {
                    success: false,
                    message:
                        "Terlalu banyak percobaan login. Coba lagi dalam 15 menit.",
                });
                return;
            }

            const data = await readBody(req);
            const pin = String(data?.pin || "").trim();

            if (!/^\d{6}$/.test(pin) || pin !== ADMIN_PIN) {
                recordLoginFailure(ip);
                sendJSON(res, 401, {
                    success: false,
                    message: /^\d{6}$/.test(pin)
                        ? "PIN salah."
                        : "PIN harus terdiri dari 6 angka.",
                });
                return;
            }

            loginAttempts.delete(ip);

            const token = crypto.randomBytes(32).toString("hex");
            const expiresAt = Date.now() + SESSION_DURATION;

            adminSessions.set(token, { expiresAt });

            sendJSON(res, 200, {
                success: true,
                token,
                expiresAt,
            });
            return;
        }

        if (req.method === "GET" && req.url === "/api/admin/check") {
            if (!isAdminAuthenticated(req)) {
                sendJSON(res, 401, {
                    success: false,
                    message: "Sesi admin tidak valid.",
                });
                return;
            }

            sendJSON(res, 200, { success: true });
            return;
        }

        if (req.method === "POST" && req.url === "/api/admin/logout") {
            const token = getAdminToken(req);
            if (token) adminSessions.delete(token);

            sendJSON(res, 200, {
                success: true,
                message: "Logout berhasil.",
            });
            return;
        }

        if (req.method === "GET" && req.url === "/api/products") {
            const products = await getProducts();

            sendJSON(res, 200, {
                success: true,
                products: productsForClient(products),
            });
            return;
        }

        if (req.method === "POST" && req.url === "/api/products") {
            if (!requireAdmin(req, res)) return;

            await initializeDatabase();

            const data = await readBody(req);
            validateProductData(data);

            const products = await getProducts();

            const maxId = products.reduce(
                (max, product) => Math.max(max, Number(product.id) || 0),
                0
            );

            const maxOrder = products.reduce(
                (max, product) =>
                    Math.max(Number(max), Number(product.upload_order) || 0),
                0
            );

            let imagePaths = [];

            if (Array.isArray(data.gambar)) {
                if (data.gambar.length > MAX_IMAGES) {
                    throw new Error(
                        `Maksimal ${MAX_IMAGES} foto untuk satu produk.`
                    );
                }

                for (const image of data.gambar) {
                    imagePaths.push(
                        await uploadImageObject(image, `products/${maxId + 1}`)
                    );
                }
            } else if (data.gambar?.data) {
                imagePaths.push(
                    await uploadImageObject(data.gambar, `products/${maxId + 1}`)
                );
            }

            if (!imagePaths.length) {
                throw new Error("Produk harus memiliki minimal satu foto.");
            }

            const newProduct = {
                id: maxId + 1,
                nama: String(data.nama).trim(),
                brand: String(data.brand).trim(),
                harga: Number(data.harga),
                harga_coret: Number(data.harga_coret) || 0,
                tipe: data.tipe || "kasual",
                asal: data.asal || "internasional",
                pengguna: data.pengguna || "unisex",
                sizes: data.sizes.map((size) => String(size)),
                gambar: imagePaths,
                deskripsi: String(data.deskripsi || "").trim(),
                upload_order: maxOrder + 1,
            };

            try {
                await insertProduct(newProduct);
            } catch (error) {
                await deleteStorageImages(imagePaths).catch(() => {});
                throw error;
            }

            sendJSON(res, 201, {
                success: true,
                message: "Produk dan semua foto berhasil disimpan.",
                product: productForClient(newProduct),
            });
            return;
        }

        if (
            req.method === "PUT" &&
            new URL(req.url, "http://localhost").pathname.startsWith(
                "/api/products/"
            )
        ) {
            if (!requireAdmin(req, res)) return;

            await initializeDatabase();

            const id = extractProductId(req);
            const data = await readBody(req);
            const products = await getProducts();

            const index = products.findIndex(
                (product) => Number(product.id) === id
            );

            if (index === -1) {
                throw new Error("Produk tidak ditemukan.");
            }

            const oldProduct = products[index];

            if (
                data.nama !== undefined &&
                !String(data.nama).trim()
            ) {
                throw new Error("Nama produk wajib diisi.");
            }

            if (
                data.brand !== undefined &&
                !String(data.brand).trim()
            ) {
                throw new Error("Brand wajib diisi.");
            }

            if (
                data.harga !== undefined &&
                Number(data.harga) <= 0
            ) {
                throw new Error("Harga tidak valid.");
            }

            if (
                data.sizes !== undefined &&
                (!Array.isArray(data.sizes) || data.sizes.length === 0)
            ) {
                throw new Error("Minimal satu ukuran harus dipilih.");
            }

            const oldImages = normalizeImages(oldProduct.gambar);
            let imagePaths = oldImages.slice();
            let newlySavedImages = [];

            if (data.gambar !== undefined) {
                if (!Array.isArray(data.gambar)) {
                    throw new Error("Format foto edit harus berupa array.");
                }

                if (data.gambar.length === 0) {
                    throw new Error("Produk harus memiliki minimal satu foto.");
                }

                if (data.gambar.length > MAX_IMAGES) {
                    throw new Error(
                        `Maksimal ${MAX_IMAGES} foto untuk satu produk.`
                    );
                }

                const keptExistingImages = [];
                const newImageObjects = [];

                for (const image of data.gambar) {
                    if (typeof image === "string") {
                        const storagePath = toStoragePath(image);

                        if (!storagePath) {
                            throw new Error("Path foto tidak valid.");
                        }

                        const belongsToProduct = oldImages.some(
                            (oldImage) =>
                                toStoragePath(oldImage) === storagePath
                        );

                        if (!belongsToProduct) {
                            throw new Error(
                                "Foto lama tidak valid atau bukan milik produk ini."
                            );
                        }

                        if (!keptExistingImages.includes(storagePath)) {
                            keptExistingImages.push(storagePath);
                        }

                        continue;
                    }

                    if (
                        image &&
                        typeof image === "object" &&
                        image.data
                    ) {
                        newImageObjects.push(image);
                        continue;
                    }

                    throw new Error("Format data foto tidak valid.");
                }

                if (
                    keptExistingImages.length + newImageObjects.length === 0
                ) {
                    throw new Error("Produk harus memiliki minimal satu foto.");
                }

                if (
                    keptExistingImages.length + newImageObjects.length >
                    MAX_IMAGES
                ) {
                    throw new Error(
                        `Maksimal ${MAX_IMAGES} foto untuk satu produk.`
                    );
                }

                for (const image of newImageObjects) {
                    newlySavedImages.push(
                        await uploadImageObject(image, `products/${id}`)
                    );
                }

                imagePaths = [
                    ...keptExistingImages,
                    ...newlySavedImages,
                ];

                const imagesToDelete = oldImages.filter((oldImage) => {
                    const oldStorage = toStoragePath(oldImage);
                    return (
                        oldStorage &&
                        !keptExistingImages.includes(oldStorage)
                    );
                });

                if (imagesToDelete.length) {
                    await deleteStorageImages(imagesToDelete);
                }
            }

            const updatedProduct = {
                ...oldProduct,
                id,
                nama:
                    data.nama !== undefined
                        ? String(data.nama).trim()
                        : oldProduct.nama,
                brand:
                    data.brand !== undefined
                        ? String(data.brand).trim()
                        : oldProduct.brand,
                harga:
                    data.harga !== undefined
                        ? Number(data.harga)
                        : oldProduct.harga,
                harga_coret:
                    data.harga_coret !== undefined
                        ? Number(data.harga_coret) || 0
                        : oldProduct.harga_coret,
                tipe:
                    data.tipe !== undefined
                        ? data.tipe
                        : oldProduct.tipe,
                asal:
                    data.asal !== undefined
                        ? data.asal
                        : oldProduct.asal,
                pengguna:
                    data.pengguna !== undefined
                        ? data.pengguna
                        : oldProduct.pengguna,
                sizes:
                    Array.isArray(data.sizes)
                        ? data.sizes.map(String)
                        : oldProduct.sizes,
                gambar: imagePaths,
                deskripsi:
                    data.deskripsi !== undefined
                        ? String(data.deskripsi).trim()
                        : oldProduct.deskripsi,
            };

            try {
                await updateProductRow(updatedProduct);
            } catch (error) {
                if (newlySavedImages.length) {
                    await deleteStorageImages(newlySavedImages).catch(() => {});
                }
                throw error;
            }

            sendJSON(res, 200, {
                success: true,
                message: "Produk berhasil diperbarui.",
                product: productForClient(updatedProduct),
            });
            return;
        }

        if (
            req.method === "DELETE" &&
            new URL(req.url, "http://localhost").pathname.startsWith(
                "/api/products/"
            )
        ) {
            if (!requireAdmin(req, res)) return;

            await initializeDatabase();

            const id = extractProductId(req);
            const products = await getProducts();

            const index = products.findIndex(
                (product) => Number(product.id) === id
            );

            if (index === -1) {
                throw new Error("Produk tidak ditemukan.");
            }

            const deletedProduct = products[index];

            await deleteStorageImages(deletedProduct.gambar);
            await deleteProductRow(id);

            // Pertahankan perilaku lama: ID dirapikan menjadi 1..N.
            const remaining = products
                .filter((_, productIndex) => productIndex !== index)
                .map((product, productIndex) => ({
                    ...product,
                    _oldId: product.id,
                    id: productIndex + 1,
                    upload_order: productIndex + 1,
                }));

            await renumberDatabaseProducts(remaining);

            sendJSON(res, 200, {
                success: true,
                message:
                    "Produk berhasil dihapus dan nomor produk otomatis dirapikan.",
                product: productForClient(deletedProduct),
                products: productsForClient(remaining),
            });
            return;
        }

        // =====================================================
        // ANALYTICS - ADMIN
        // =====================================================
        if (req.method === "GET" && req.url === "/api/analytics") {
            if (!requireAdmin(req, res)) return;
            try {
                const analytics = await getAnalytics();
                const visits = await getRecentVisits(100);
                sendJSON(res, 200, { success: true, analytics, visits });
            } catch (error) {
                console.error("Gagal mengambil analytics:", error);
                sendJSON(res, 500, { success: false, message: error.message || "Analytics tidak dapat diambil." });
            }
            return;
        }

        // =====================================================
        // GET SEMUA PESANAN - ADMIN
        // =====================================================
        if (req.method === "GET" && req.url === "/api/orders") {
            if (!requireAdmin(req, res)) return;
            try { sendJSON(res, 200, { success:true, orders:await getOrders() }); }
            catch (error) { console.error("Gagal mengambil pesanan:", error); sendJSON(res, 500, { success:false, message:error.message || "Pesanan tidak dapat diambil." }); }
            return;
        }

        // =====================================================
        // HAPUS SEMUA RIWAYAT PESANAN - ADMIN
        // =====================================================
        if (req.method === "DELETE" && req.url === "/api/orders") {
            if (!requireAdmin(req, res)) return;
            try {
                await deleteAllOrders();
                sendJSON(res, 200, { success:true, message:"Seluruh riwayat pesanan berhasil dihapus." });
            } catch (error) {
                console.error("Gagal menghapus riwayat pesanan:", error);
                sendJSON(res, 500, { success:false, message:error.message || "Riwayat pesanan tidak dapat dihapus." });
            }
            return;
        }

        // =====================================================
        // HAPUS SATU KUNJUNGAN - ADMIN
        // =====================================================
        if (req.method === "DELETE" && new URL(req.url, "http://localhost").pathname.startsWith("/api/analytics/visits/") && new URL(req.url, "http://localhost").pathname !== "/api/analytics/visits") {
            if (!requireAdmin(req, res)) return;

            try {
                const pathname = new URL(req.url, "http://localhost").pathname;
                const id = Number(pathname.split("/").pop());

                if (!Number.isInteger(id) || id <= 0) {
                    throw new Error("ID kunjungan tidak valid.");
                }

                await deleteVisitById(id);

                sendJSON(res, 200, {
                    success: true,
                    message: "Kunjungan berhasil dihapus."
                });
            } catch (error) {
                console.error("Gagal menghapus kunjungan:", error);

                sendJSON(res, 400, {
                    success: false,
                    message: error.message || "Kunjungan tidak dapat dihapus."
                });
            }

            return;
        }

        if (req.method === "DELETE" && new URL(req.url, "http://localhost").pathname === "/api/analytics/visits") {
    if (!requireAdmin(req, res)) return;

    try {
        await deleteAllVisits();

        sendJSON(res, 200, {
            success: true,
            message: "Seluruh riwayat kunjungan berhasil dihapus."
        });
    } catch (error) {
        console.error("Gagal menghapus riwayat kunjungan:", error);

        sendJSON(res, 500, {
            success: false,
            message:
                error.message ||
                "Riwayat kunjungan tidak dapat dihapus."
        });
    }

    return;
}

        // =====================================================
        // HAPUS SATU PESANAN - ADMIN
        // =====================================================
        if (req.method === "DELETE" && new URL(req.url, "http://localhost").pathname.startsWith("/api/orders/")) {
            if (!requireAdmin(req, res)) return;
            try {
                const pathname = new URL(req.url, "http://localhost").pathname;
                const id = Number(pathname.split("/").pop());
                if (!Number.isInteger(id) || id <= 0) throw new Error("ID pesanan tidak valid.");
                await deleteOrder(id);
                sendJSON(res, 200, { success:true, message:"Pesanan berhasil dihapus." });
            } catch (error) {
                console.error("Gagal menghapus pesanan:", error);
                sendJSON(res, 400, { success:false, message:error.message || "Pesanan tidak dapat dihapus." });
            }
            return;
        }

        // =====================================================
        // PATCH STATUS / KETERANGAN PESANAN - ADMIN
        // =====================================================
        if (req.method === "PATCH" && new URL(req.url, "http://localhost").pathname.startsWith("/api/orders/")) {
            if (!requireAdmin(req, res)) return;
            try {
                const pathname = new URL(req.url, "http://localhost").pathname;
                const id = Number(pathname.split("/").pop());
                if (!Number.isInteger(id) || id <= 0) throw new Error("ID pesanan tidak valid.");
                const data = await readBody(req);
                const order = await updateOrderStatus(id, String(data?.status || "baru").trim(), data?.keterangan);
                sendJSON(res, 200, { success:true, message:"Pesanan berhasil diperbarui.", order });
            } catch (error) { console.error("Gagal memperbarui pesanan:", error); sendJSON(res, 400, { success:false, message:error.message || "Pesanan tidak dapat diperbarui." }); }
            return;
        }

        sendJSON(res, 404, {
            success: false,
            message: "Endpoint tidak ditemukan.",
        });
    } catch (error) {
        console.error("API error:", error);

        sendJSON(res, 500, {
            success: false,
            message: error.message || "Terjadi kesalahan pada server.",
        });
    }
});

initializeDatabase().catch(() => {
    console.error(
        "Server tetap dijalankan, tetapi database belum siap. Render akan dapat mencoba lagi."
    );
});

server.listen(PORT, () => {
    console.log("=================================");
    console.log("KICKS STATION BACKEND");
    console.log("=================================");
    console.log(`Server berjalan di http://localhost:${PORT}`);
    console.log("Database: Supabase PostgreSQL");
    console.log(`Storage: Supabase bucket "${SUPABASE_BUCKET}"`);
});
