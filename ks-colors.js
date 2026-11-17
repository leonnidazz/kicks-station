/*
 * Kicks Station - Palet & pengelompokan warna produk.
 * Dipakai bersama oleh index.html, admin.html (browser) dan backend/server.js (Node).
 *
 * Setiap produk menyimpan daftar "kelompok warna" (key), mis. ["hitam", "putih"].
 * Nama warna spesifik (navy, grey, off white, taupe, dll.) otomatis dikelompokkan
 * ke salah satu kelompok di bawah lewat daftar kata kunci.
 */
(function (root, factory) {
    var api = factory();
    if (typeof module === "object" && module.exports) module.exports = api;
    else root.KSColors = api;
})(typeof self !== "undefined" ? self : this, function () {
    // section: pengelompokan tampilan di form admin
    var COLORS = [
        { key: "hitam",   label: "Hitam",     hex: "#111111", section: "Netral",
          words: ["black", "hitam", "noir", "jet black", "onyx"] },
        { key: "putih",   label: "Putih",     hex: "#ffffff", section: "Netral",
          words: ["white", "putih", "off white", "offwhite", "snow"] },
        { key: "abu",     label: "Abu-abu",   hex: "#9ca3af", section: "Netral",
          words: ["grey", "gray", "abu", "abu-abu", "silver", "charcoal", "anthracite", "slate", "graphite"] },
        { key: "krem",    label: "Krem",      hex: "#e8dcc2", section: "Netral",
          words: ["beige", "cream", "krem", "taupe", "sand", "khaki", "ivory", "natural", "stone", "oat"] },
        { key: "cokelat", label: "Cokelat",   hex: "#7b4a2b", section: "Netral",
          words: ["brown", "cokelat", "coklat", "tan", "chocolate", "mocha", "camel", "coffee"] },

        { key: "merah",   label: "Merah",     hex: "#dc2626", section: "Warna",
          words: ["red", "merah", "maroon", "burgundy", "crimson", "scarlet"] },
        { key: "oranye",  label: "Oranye",    hex: "#f97316", section: "Warna",
          words: ["orange", "oranye", "jingga", "coral"] },
        { key: "kuning",  label: "Kuning",    hex: "#facc15", section: "Warna",
          words: ["yellow", "kuning", "gold", "mustard", "lemon"] },
        { key: "hijau",   label: "Hijau",     hex: "#16a34a", section: "Warna",
          words: ["green", "hijau", "olive", "lime", "mint", "emerald", "sage", "teal"] },
        { key: "biru",    label: "Biru",      hex: "#2563eb", section: "Warna",
          words: ["blue", "biru", "biru tua", "navy", "sky", "cobalt", "denim", "turquoise", "cyan", "royal"] },
        { key: "ungu",    label: "Ungu",      hex: "#9333ea", section: "Warna",
          words: ["purple", "ungu", "violet", "viotect", "lilac", "lavender", "plum"] },
        { key: "pink",    label: "Pink",      hex: "#ec4899", section: "Warna",
          words: ["pink", "rose", "fuchsia", "magenta", "blush", "salmon"] },

        { key: "multi",   label: "Multi",     hex: "linear-gradient(135deg,#ef4444 0%,#facc15 33%,#22c55e 66%,#3b82f6 100%)", section: "Lainnya",
          words: ["multi", "multicolor", "multicolour", "multi color", "mix", "rainbow", "colorful"] }
    ];

    var BY_KEY = {};
    COLORS.forEach(function (c) { BY_KEY[c.key] = c; });

    var MAX_COLORS = 6;

    function escapeRegExp(text) {
        return String(text).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    }

    // Susun satu regex per kelompok. Kata harus berdiri sendiri (bukan bagian kata lain),
    // sehingga "red" tidak cocok dengan "Reveal" dan "tan" tidak cocok dengan "Titan".
    var MATCHERS = COLORS.map(function (c) {
        var parts = c.words
            .slice()
            .sort(function (a, b) { return b.length - a.length; })
            .map(escapeRegExp);
        return { key: c.key, re: new RegExp("(^|[^a-z0-9])(" + parts.join("|") + ")(?=$|[^a-z0-9])", "i") };
    });

    function isColorKey(key) {
        return Object.prototype.hasOwnProperty.call(BY_KEY, key);
    }

    // Ubah masukan apa pun (array / string "a,b" / JSON) jadi array key warna yang valid, unik, berurutan palet.
    function normalize(value) {
        var list = value;
        if (typeof list === "string") {
            try {
                var parsed = JSON.parse(list);
                list = Array.isArray(parsed) ? parsed : list.split(",");
            } catch (e) {
                list = list.split(",");
            }
        }
        if (!Array.isArray(list)) return [];
        var seen = {};
        list.forEach(function (item) {
            var key = String(item || "").trim().toLowerCase();
            if (isColorKey(key)) seen[key] = true;
        });
        return COLORS.map(function (c) { return c.key; })
            .filter(function (key) { return seen[key]; })
            .slice(0, MAX_COLORS);
    }

    // Deteksi kelompok warna dari teks (mis. nama produk). Urutan hasil mengikuti urutan palet.
    function detect(text) {
        var source = String(text || "")
            .toLowerCase()
            .replace(/[_/\\]+/g, " ");
        if (!source.trim()) return [];
        var found = [];
        MATCHERS.forEach(function (m) {
            if (m.re.test(source)) found.push(m.key);
        });
        // "multi" hanya relevan bila tidak ada warna spesifik lain yang terdeteksi bersamanya
        // (contoh "Optimis Mix" -> multi, tapi "Black Mix" -> hitam saja).
        if (found.length > 1 && found.indexOf("multi") !== -1) {
            found = found.filter(function (key) { return key !== "multi"; });
        }
        return normalize(found);
    }

    function label(key) {
        return isColorKey(key) ? BY_KEY[key].label : String(key || "");
    }

    function swatchStyle(key) {
        var c = BY_KEY[key];
        if (!c) return "";
        var bg = c.hex.indexOf("gradient") !== -1 ? "background:" + c.hex : "background-color:" + c.hex;
        return bg;
    }

    return {
        COLORS: COLORS,
        MAX_COLORS: MAX_COLORS,
        isColorKey: isColorKey,
        normalize: normalize,
        detect: detect,
        label: label,
        swatchStyle: swatchStyle
    };
});
