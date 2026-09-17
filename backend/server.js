const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = process.env.PORT || 3000;
const PUBLIC_BASE_URL = process.env.RENDER_EXTERNAL_URL || "https://kicks-station.onrender.com";

const productsFile = path.join(
    __dirname,
    "..",
    "products.json"
);

const imagesFolder = path.join(
    __dirname,
    "..",
    "images"
);


// =========================================================
// BATAS UPLOAD
// =========================================================

const MAX_IMAGE_SIZE = 5 * 1024 * 1024;       // 5 MB / foto
const MAX_IMAGES = 10;                        // maksimal 10 foto / produk
const MAX_REQUEST_SIZE = 60 * 1024 * 1024;   // maksimal 60 MB / request


// =========================================================
// PERSIAPAN FOLDER
// =========================================================

if (!fs.existsSync(imagesFolder)) {

    fs.mkdirSync(
        imagesFolder,
        {
            recursive: true
        }
    );

}


// =========================================================
// HELPER RESPONSE
// =========================================================

function sendJSON(
    res,
    statusCode,
    data
) {

    res.writeHead(
        statusCode,
        {
            "Content-Type":
                "application/json; charset=utf-8"
        }
    );

    res.end(
        JSON.stringify(data)
    );

}


// =========================================================
// BACA DATABASE
// =========================================================

function readProducts() {

    if (!fs.existsSync(productsFile)) {

        return [];

    }

    const content =
        fs.readFileSync(
            productsFile,
            "utf8"
        );

    return JSON.parse(content);

}


// =========================================================
// SIMPAN DATABASE
// =========================================================

function saveProducts(products) {

    fs.writeFileSync(

        productsFile,

        JSON.stringify(
            products,
            null,
            2
        ),

        "utf8"

    );

}


// =========================================================
// SANITASI NAMA FILE
// =========================================================

function sanitizeFilename(
    filename
) {

    return path
        .basename(filename)
        .replace(
            /[<>:"/\\|?*\x00-\x1F]/g,
            "_"
        )
        .replace(
            /\s+/g,
            " "
        )
        .trim();

}


// =========================================================
// NORMALISASI FOTO
// =========================================================

function normalizeImages(
    gambar
) {

    if (!gambar) {

        return [];

    }


    if (Array.isArray(gambar)) {

        return gambar.filter(
            image =>
                typeof image === "string" &&
                image.trim() !== ""
        );

    }


    if (typeof gambar === "string") {

        return gambar.trim()
            ? [gambar]
            : [];

    }


    return [];

}


// =========================================================
// URL FOTO UNTUK CLIENT
// =========================================================

function toStoredImagePath(imagePath) {
    if (typeof imagePath !== "string") return null;

    const value = imagePath.trim();

    if (value.startsWith("images/")) {
        return value;
    }

    try {
        const parsed = new URL(value);
        if (parsed.pathname.startsWith("/images/")) {
            return parsed.pathname.slice(1);
        }
    } catch {}

    return null;
}

function toPublicImageUrl(imagePath) {
    const storedPath = toStoredImagePath(imagePath);
    if (!storedPath) return imagePath;
    return `${PUBLIC_BASE_URL}/${storedPath}`;
}

function productForClient(product) {
    const result = { ...product };
    const images = normalizeImages(product.gambar);

    if (Array.isArray(product.gambar)) {
        result.gambar = images.map(toPublicImageUrl);
    } else if (typeof product.gambar === "string") {
        result.gambar = toPublicImageUrl(product.gambar);
    }

    return result;
}

function productsForClient(products) {
    return products.map(productForClient);
}

// =========================================================
// SERVE FILE GAMBAR
// =========================================================

function serveImage(req, res) {
    if (req.method !== "GET") return false;

    let pathname;
    try {
        pathname = new URL(req.url, "http://localhost").pathname;
    } catch {
        return false;
    }

    if (!pathname.startsWith("/images/")) return false;

    let relativePath;
    try {
        relativePath = decodeURIComponent(pathname.slice("/images/".length));
    } catch {
        res.writeHead(400);
        res.end("Bad Request");
        return true;
    }

    const resolvedFolder = path.resolve(imagesFolder);
    const filePath = path.resolve(imagesFolder, relativePath);

    if (!filePath.startsWith(resolvedFolder + path.sep)) {
        res.writeHead(403);
        res.end("Forbidden");
        return true;
    }

    if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
        res.writeHead(404);
        res.end("Image not found");
        return true;
    }

    const contentTypes = {
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".png": "image/png",
        ".webp": "image/webp"
    };

    const contentType = contentTypes[path.extname(filePath).toLowerCase()];

    if (!contentType) {
        res.writeHead(415);
        res.end("Unsupported image type");
        return true;
    }

    res.writeHead(200, {
        "Content-Type": contentType,
        "Cache-Control": "public, max-age=31536000, immutable"
    });

    fs.createReadStream(filePath).pipe(res);
    return true;
}


// =========================================================
// VALIDASI PATH FOTO EXISTING
// =========================================================
//
// Hanya mengizinkan foto yang memang berada
// di folder images.
// =========================================================

function isValidImagePath(
    imagePath
) {

    if (
        typeof imagePath !== "string"
    ) {

        return false;

    }

    return imagePath.startsWith("images/");

}


// =========================================================
// SIMPAN SATU FOTO BARU
// =========================================================

function saveSingleImage(
    imageData
) {

    if (
        !imageData ||
        !imageData.data ||
        !imageData.name
    ) {

        throw new Error(
            "Data foto tidak lengkap."
        );

    }


    const cleanName =
        sanitizeFilename(
            imageData.name
        );


    if (!cleanName) {

        throw new Error(
            "Nama file gambar tidak valid."
        );

    }


    // ---------------------------------------------------------
    // VALIDASI MIME
    // ---------------------------------------------------------

    const mimeMatch =
        String(
            imageData.data
        ).match(
            /^data:(image\/(?:jpeg|png|webp));base64,/i
        );


    if (!mimeMatch) {

        throw new Error(
            `Format foto "${cleanName}" harus JPG, PNG, atau WEBP.`
        );

    }


    const base64 =
        imageData.data.replace(
            /^data:image\/(?:jpeg|png|webp);base64,/i,
            ""
        );


    const buffer =
        Buffer.from(
            base64,
            "base64"
        );


    if (
        buffer.length === 0
    ) {

        throw new Error(
            "File gambar kosong atau rusak."
        );

    }


    if (
        buffer.length >
        MAX_IMAGE_SIZE
    ) {

        throw new Error(
            `Ukuran foto "${cleanName}" maksimal 5 MB.`
        );

    }


    // ---------------------------------------------------------
    // CEK EXTENSION
    // ---------------------------------------------------------

    const extension =
        path.extname(
            cleanName
        ).toLowerCase();


    const allowedExtensions = [
        ".jpg",
        ".jpeg",
        ".png",
        ".webp"
    ];


    if (
        !allowedExtensions.includes(
            extension
        )
    ) {

        throw new Error(
            `Format foto "${cleanName}" harus JPG, JPEG, PNG, atau WEBP.`
        );

    }


    const originalName =
        path.basename(
            cleanName,
            extension
        );


    let finalName =
        cleanName;


    let counter = 1;


    while (
        fs.existsSync(
            path.join(
                imagesFolder,
                finalName
            )
        )
    ) {

        finalName =
            `${originalName} (${counter})${extension}`;

        counter++;

    }


    const destination =
        path.join(
            imagesFolder,
            finalName
        );


    fs.writeFileSync(
        destination,
        buffer
    );


    console.log(
        "Foto disimpan:",
        finalName
    );


    return `images/${finalName}`;

}


// =========================================================
// SIMPAN BANYAK FOTO BARU
// =========================================================

function saveImages(
    images
) {

    if (!Array.isArray(images)) {

        throw new Error(
            "Format foto harus berupa array."
        );

    }


    if (
        images.length >
        MAX_IMAGES
    ) {

        throw new Error(
            `Maksimal ${MAX_IMAGES} foto untuk satu produk.`
        );

    }


    const savedImages = [];


    try {

        for (
            const image of images
        ) {

            const imagePath =
                saveSingleImage(
                    image
                );


            savedImages.push(
                imagePath
            );

        }


        return savedImages;

    } catch (error) {

        // Jika ada foto gagal disimpan,
        // hapus foto yang sudah berhasil disimpan.

        for (
            const imagePath of savedImages
        ) {

            deleteSingleImage(
                imagePath
            );

        }


        throw error;

    }

}


// =========================================================
// HAPUS SATU FOTO
// =========================================================

function deleteSingleImage(
    imagePath
) {

    if (
        !imagePath ||
        typeof imagePath !== "string"
    ) {

        return;

    }


    if (
        !imagePath.startsWith(
            "images/"
        )
    ) {

        return;

    }


    const filename =
        path.basename(
            imagePath
        );


    const filePath =
        path.join(
            imagesFolder,
            filename
        );


    // Keamanan tambahan:
    // pastikan file benar-benar berada
    // di folder images.

    const resolvedFolder =
        path.resolve(
            imagesFolder
        );

    const resolvedFile =
        path.resolve(
            filePath
        );


    if (
        !resolvedFile.startsWith(
            resolvedFolder + path.sep
        )
    ) {

        return;

    }


    if (
        fs.existsSync(
            filePath
        )
    ) {

        fs.unlinkSync(
            filePath
        );


        console.log(
            "Foto dihapus:",
            filename
        );

    }

}


// =========================================================
// HAPUS FOTO
// =========================================================

function deleteImage(
    imagePath
) {

    const images =
        normalizeImages(
            imagePath
        );


    for (
        const image of images
    ) {

        deleteSingleImage(
            image
        );

    }

}


// =========================================================
// BACA BODY REQUEST
// =========================================================

function readBody(
    req
) {

    return new Promise(
        (resolve, reject) => {

            let body = "";

            let rejected =
                false;


            req.on(
                "data",
                chunk => {

                    if (
                        rejected
                    ) {

                        return;

                    }


                    body +=
                        chunk.toString();


                    if (
                        Buffer.byteLength(
                            body,
                            "utf8"
                        ) >
                        MAX_REQUEST_SIZE
                    ) {

                        rejected =
                            true;


                        reject(
                            new Error(
                                "Total ukuran upload terlalu besar. Maksimal 60 MB."
                            )
                        );


                        req.destroy();

                    }

                }
            );


            req.on(
                "end",
                () => {

                    if (
                        rejected
                    ) {

                        return;

                    }


                    try {

                        resolve(
                            JSON.parse(body)
                        );

                    } catch {

                        reject(
                            new Error(
                                "Format data tidak valid."
                            )
                        );

                    }

                }
            );


            req.on(
                "error",
                reject
            );

        }
    );

}


// =========================================================
// RENOMOR PRODUK
// =========================================================

function renumberProducts(
    products
) {

    products.forEach(
        (
            product,
            index
        ) => {

            product.id =
                index + 1;

            product.upload_order =
                index + 1;

        }
    );

}


// =========================================================
// VALIDASI DATA PRODUK
// =========================================================

function validateProductData(
    data
) {

    if (
        !data.nama ||
        !String(data.nama).trim()
    ) {

        throw new Error(
            "Nama produk wajib diisi."
        );

    }


    if (
        !data.brand ||
        !String(data.brand).trim()
    ) {

        throw new Error(
            "Brand wajib diisi."
        );

    }


    if (
        !data.harga ||
        Number(data.harga) <= 0
    ) {

        throw new Error(
            "Harga tidak valid."
        );

    }


    if (
        !Array.isArray(data.sizes) ||
        data.sizes.length === 0
    ) {

        throw new Error(
            "Minimal satu ukuran harus dipilih."
        );

    }

}


// =========================================================
// SERVER
// =========================================================

const server =
    http.createServer(
        async (
            req,
            res
        ) => {

            // =================================================
            // CORS
            // =================================================

            res.setHeader(
                "Access-Control-Allow-Origin",
                "*"
            );


            res.setHeader(
                "Access-Control-Allow-Methods",
                "GET, POST, PUT, DELETE, OPTIONS"
            );


            res.setHeader(
                "Access-Control-Allow-Headers",
                "Content-Type"
            );


            // =================================================
            // FILE GAMBAR
            // =================================================

            if (serveImage(req, res)) {
                return;
            }


            // =================================================
            // OPTIONS
            // =================================================

            if (
                req.method === "OPTIONS"
            ) {

                res.writeHead(
                    204
                );

                res.end();

                return;

            }


            // =================================================
            // ROOT
            // =================================================

            if (
                req.method === "GET" &&
                req.url === "/"
            ) {

                sendJSON(
                    res,
                    200,
                    {

                        status:
                            "online",

                        message:
                            "Kicks Station Backend berhasil berjalan!"

                    }
                );

                return;

            }


            // =================================================
            // GET SEMUA PRODUK
            // =================================================

            if (
                req.method === "GET" &&
                req.url === "/api/products"
            ) {

                try {

                    const products =
                        readProducts();


                    sendJSON(
                        res,
                        200,
                        {

                            success:
                                true,

                            products:
                                productsForClient(products)

                        }
                    );


                } catch (error) {

                    sendJSON(
                        res,
                        500,
                        {

                            success:
                                false,

                            message:
                                error.message

                        }
                    );

                }


                return;

            }


            // =================================================
            // POST TAMBAH PRODUK
            // =================================================

            if (
                req.method === "POST" &&
                req.url === "/api/products"
            ) {

                try {

                    const data =
                        await readBody(
                            req
                        );


                    const products =
                        readProducts();


                    validateProductData(
                        data
                    );


                    // -------------------------------------------------
                    // ID
                    // -------------------------------------------------

                    const maxId =
                        products.reduce(

                            (
                                max,
                                product
                            ) =>
                                Math.max(
                                    max,
                                    Number(
                                        product.id
                                    ) || 0
                                ),

                            0

                        );


                    // -------------------------------------------------
                    // UPLOAD ORDER
                    // -------------------------------------------------

                    const maxOrder =
                        products.reduce(

                            (
                                max,
                                product
                            ) =>
                                Math.max(
                                    max,
                                    Number(
                                        product.upload_order
                                    ) || 0
                                ),

                            0

                        );


                    // -------------------------------------------------
                    // FOTO
                    // -------------------------------------------------

                    let imagePaths = [];


                    if (
                        Array.isArray(
                            data.gambar
                        )
                    ) {

                        imagePaths =
                            saveImages(
                                data.gambar
                            );

                    } else if (
                        data.gambar &&
                        data.gambar.data
                    ) {

                        imagePaths = [
                            saveSingleImage(
                                data.gambar
                            )
                        ];

                    }


                    // -------------------------------------------------
                    // PRODUK BARU
                    // -------------------------------------------------

                    const newProduct = {

                        id:
                            maxId + 1,

                        nama:
                            String(
                                data.nama
                            ).trim(),

                        brand:
                            String(
                                data.brand
                            ).trim(),

                        harga:
                            Number(
                                data.harga
                            ),

                        harga_coret:
                            Number(
                                data.harga_coret
                            ) || 0,

                        tipe:
                            data.tipe ||
                            "kasual",

                        asal:
                            data.asal ||
                            "internasional",

                        pengguna:
                            data.pengguna ||
                            "unisex",

                        stok:
                            Number(
                                data.stok
                            ) || 0,

                        sizes:
                            data.sizes.map(
                                size =>
                                    String(size)
                            ),

                        gambar:
                            imagePaths,

                        deskripsi:
                            String(
                                data.deskripsi ||
                                ""
                            ).trim(),

                        upload_order:
                            maxOrder + 1

                    };


                    products.push(
                        newProduct
                    );


                    saveProducts(
                        products
                    );


                    console.log(
                        "\n================================="
                    );


                    console.log(
                        "PRODUK BERHASIL DITAMBAHKAN"
                    );


                    console.log(
                        newProduct
                    );


                    console.log(
                        "================================="
                    );


                    sendJSON(
                        res,
                        201,
                        {

                            success:
                                true,

                            message:
                                "Produk dan semua foto berhasil disimpan.",

                            product:
                                productForClient(newProduct)

                        }
                    );


                } catch (error) {

                    console.error(
                        "Gagal tambah produk:",
                        error
                    );


                    sendJSON(
                        res,
                        500,
                        {

                            success:
                                false,

                            message:
                                error.message

                        }
                    );

                }


                return;

            }


            // =================================================
            // PUT EDIT PRODUK
            // =================================================

            if (
                req.method === "PUT" &&
                req.url.startsWith(
                    "/api/products/"
                )
            ) {

                try {

                    // -------------------------------------------------
                    // AMBIL ID
                    // -------------------------------------------------

                    const id =
                        Number(
                            req.url
                                .split("/")
                                .pop()
                        );


                    if (
                        !Number.isInteger(
                            id
                        )
                    ) {

                        throw new Error(
                            "ID produk tidak valid."
                        );

                    }


                    // -------------------------------------------------
                    // BODY
                    // -------------------------------------------------

                    const data =
                        await readBody(
                            req
                        );


                    const products =
                        readProducts();


                    // -------------------------------------------------
                    // CARI PRODUK
                    // -------------------------------------------------

                    const index =
                        products.findIndex(
                            product =>
                                Number(
                                    product.id
                                ) === id
                        );


                    if (
                        index === -1
                    ) {

                        throw new Error(
                            "Produk tidak ditemukan."
                        );

                    }


                    const oldProduct =
                        products[index];


                    // -------------------------------------------------
                    // VALIDASI DATA DASAR
                    // -------------------------------------------------

                    if (
                        data.nama !== undefined &&
                        !String(data.nama).trim()
                    ) {

                        throw new Error(
                            "Nama produk wajib diisi."
                        );

                    }


                    if (
                        data.brand !== undefined &&
                        !String(data.brand).trim()
                    ) {

                        throw new Error(
                            "Brand wajib diisi."
                        );

                    }


                    if (
                        data.harga !== undefined &&
                        Number(data.harga) <= 0
                    ) {

                        throw new Error(
                            "Harga tidak valid."
                        );

                    }


                    if (
                        data.sizes !== undefined &&
                        (
                            !Array.isArray(data.sizes) ||
                            data.sizes.length === 0
                        )
                    ) {

                        throw new Error(
                            "Minimal satu ukuran harus dipilih."
                        );

                    }


                    // =================================================
                    // SISTEM FOTO EDIT
                    // =================================================
                    //
                    // data.gambar dapat berisi campuran:
                    //
                    // "images/foto-lama.jpeg"
                    //
                    // dan
                    //
                    // {
                    //    name: "...",
                    //    data: "data:image/jpeg;base64,..."
                    // }
                    //
                    // Foto lama yang masih ada akan dipertahankan.
                    // Foto lama yang tidak ada lagi akan dihapus.
                    // Foto baru akan disimpan.
                    // =================================================

                    const oldImages =
                        normalizeImages(
                            oldProduct.gambar
                        );


                    let imagePaths =
                        oldImages.slice();


                    let newlySavedImages = [];


                    if (
                        data.gambar !== undefined
                    ) {

                        if (
                            !Array.isArray(
                                data.gambar
                            )
                        ) {

                            throw new Error(
                                "Format foto edit harus berupa array."
                            );

                        }


                        if (
                            data.gambar.length === 0
                        ) {

                            throw new Error(
                                "Produk harus memiliki minimal satu foto."
                            );

                        }


                        if (
                            data.gambar.length >
                            MAX_IMAGES
                        ) {

                            throw new Error(
                                `Maksimal ${MAX_IMAGES} foto untuk satu produk.`
                            );

                        }


                        // -------------------------------------------------
                        // PISAHKAN:
                        //
                        // 1. PATH FOTO LAMA
                        // 2. FOTO BARU BASE64
                        // -------------------------------------------------

                        const keptExistingImages = [];

                        const newImageObjects = [];


                        for (
                            const image of data.gambar
                        ) {

                            // ---------------------------------------------
                            // FOTO LAMA
                            // ---------------------------------------------

                            if (
                                typeof image === "string"
                            ) {

                                const storedImage =
                                    toStoredImagePath(image);

                                if (
                                    !storedImage ||
                                    !isValidImagePath(storedImage)
                                ) {
                                    throw new Error(
                                        "Path foto tidak valid."
                                    );
                                }

                                if (
                                    !oldImages.includes(storedImage)
                                ) {
                                    throw new Error(
                                        "Foto lama tidak valid atau bukan milik produk ini."
                                    );
                                }

                                if (
                                    !keptExistingImages.includes(storedImage)
                                ) {
                                    keptExistingImages.push(storedImage);
                                }

                                continue;
                            }


                            // ---------------------------------------------
                            // FOTO BARU
                            // ---------------------------------------------

                            if (
                                image &&
                                typeof image === "object" &&
                                image.data
                            ) {

                                newImageObjects.push(
                                    image
                                );

                                continue;

                            }


                            throw new Error(
                                "Format data foto tidak valid."
                            );

                        }


                        // -------------------------------------------------
                        // HITUNG TOTAL FOTO
                        // -------------------------------------------------

                        const totalImages =
                            keptExistingImages.length +
                            newImageObjects.length;


                        if (
                            totalImages === 0
                        ) {

                            throw new Error(
                                "Produk harus memiliki minimal satu foto."
                            );

                        }


                        if (
                            totalImages >
                            MAX_IMAGES
                        ) {

                            throw new Error(
                                `Maksimal ${MAX_IMAGES} foto untuk satu produk.`
                            );

                        }


                        // -------------------------------------------------
                        // SIMPAN FOTO BARU
                        // -------------------------------------------------

                        if (
                            newImageObjects.length > 0
                        ) {

                            newlySavedImages =
                                saveImages(
                                    newImageObjects
                                );

                        }


                        // -------------------------------------------------
                        // GABUNGKAN FOTO
                        //
                        // Foto lama tetap mengikuti urutan
                        // yang dikirim admin.
                        //
                        // Foto baru berada setelah foto lama.
                        // -------------------------------------------------

                        imagePaths = [
                            ...keptExistingImages,
                            ...newlySavedImages
                        ];


                        // -------------------------------------------------
                        // HAPUS FOTO LAMA YANG TIDAK DIPERTAHANKAN
                        // -------------------------------------------------

                        const imagesToDelete =
                            oldImages.filter(
                                image =>
                                    !keptExistingImages.includes(
                                        image
                                    )
                            );


                        deleteImage(
                            imagesToDelete
                        );

                    }


                    // =================================================
                    // UPDATE DATA PRODUK
                    // =================================================

                    products[index] = {

                        ...oldProduct,

                        nama:
                            data.nama !== undefined
                                ? String(
                                    data.nama
                                ).trim()
                                : oldProduct.nama,

                        brand:
                            data.brand !== undefined
                                ? String(
                                    data.brand
                                ).trim()
                                : oldProduct.brand,

                        harga:
                            data.harga !== undefined
                                ? Number(
                                    data.harga
                                )
                                : oldProduct.harga,

                        harga_coret:
                            data.harga_coret !== undefined
                                ? Number(
                                    data.harga_coret
                                ) || 0
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

                        stok:
                            data.stok !== undefined
                                ? Number(
                                    data.stok
                                ) || 0
                                : oldProduct.stok,

                        sizes:
                            Array.isArray(
                                data.sizes
                            )
                                ? data.sizes.map(
                                    size =>
                                        String(size)
                                )
                                : oldProduct.sizes,

                        gambar:
                            imagePaths,

                        deskripsi:
                            data.deskripsi !== undefined
                                ? String(
                                    data.deskripsi
                                ).trim()
                                : oldProduct.deskripsi

                    };


                    // -------------------------------------------------
                    // SIMPAN DATABASE
                    // -------------------------------------------------

                    saveProducts(
                        products
                    );


                    console.log(
                        "\n================================="
                    );


                    console.log(
                        "PRODUK BERHASIL DIUPDATE"
                    );


                    console.log(
                        products[index]
                    );


                    console.log(
                        "================================="
                    );


                    sendJSON(
                        res,
                        200,
                        {

                            success:
                                true,

                            message:
                                "Produk berhasil diperbarui.",

                            product:
                                productForClient(products[index])

                        }
                    );


                } catch (error) {

                    console.error(
                        "Gagal edit produk:",
                        error
                    );


                    sendJSON(
                        res,
                        500,
                        {

                            success:
                                false,

                            message:
                                error.message

                        }
                    );

                }


                return;

            }


            // =================================================
            // DELETE PRODUK
            // =================================================

            if (
                req.method === "DELETE" &&
                req.url.startsWith(
                    "/api/products/"
                )
            ) {

                try {

                    const id =
                        Number(
                            req.url
                                .split("/")
                                .pop()
                        );


                    if (
                        !Number.isInteger(
                            id
                        )
                    ) {

                        throw new Error(
                            "ID produk tidak valid."
                        );

                    }


                    const products =
                        readProducts();


                    const index =
                        products.findIndex(
                            product =>
                                Number(
                                    product.id
                                ) === id
                        );


                    if (
                        index === -1
                    ) {

                        throw new Error(
                            "Produk tidak ditemukan."
                        );

                    }


                    // -------------------------------------------------
                    // PRODUK YANG DIHAPUS
                    // -------------------------------------------------

                    const deletedProduct =
                        products[index];


                    // -------------------------------------------------
                    // HAPUS SEMUA FOTO
                    // -------------------------------------------------

                    deleteImage(
                        deletedProduct.gambar
                    );


                    // -------------------------------------------------
                    // HAPUS PRODUK
                    // -------------------------------------------------

                    products.splice(
                        index,
                        1
                    );


                    // -------------------------------------------------
                    // RENOMOR
                    // -------------------------------------------------

                    renumberProducts(
                        products
                    );


                    // -------------------------------------------------
                    // SIMPAN
                    // -------------------------------------------------

                    saveProducts(
                        products
                    );


                    console.log(
                        "\n================================="
                    );


                    console.log(
                        "PRODUK BERHASIL DIHAPUS"
                    );


                    console.log(
                        "Produk dihapus:",
                        deletedProduct.nama
                    );


                    console.log(
                        "ID sebelumnya:",
                        deletedProduct.id
                    );


                    console.log(
                        "Jumlah produk sekarang:",
                        products.length
                    );


                    console.log(
                        "ID produk terakhir:",
                        products.length
                    );


                    console.log(
                        "================================="
                    );


                    sendJSON(
                        res,
                        200,
                        {

                            success:
                                true,

                            message:
                                "Produk berhasil dihapus dan nomor produk otomatis dirapikan.",

                            product:
                                productForClient(deletedProduct),

                            products:
                                productsForClient(products)

                        }
                    );


                } catch (error) {

                    console.error(
                        "Gagal hapus produk:",
                        error
                    );


                    sendJSON(
                        res,
                        500,
                        {

                            success:
                                false,

                            message:
                                error.message

                        }
                    );

                }


                return;

            }


            // =================================================
            // 404
            // =================================================

            sendJSON(
                res,
                404,
                {

                    success:
                        false,

                    message:
                        "Endpoint tidak ditemukan."

                }
            );

        }
    );


// =========================================================
// START SERVER
// =========================================================

server.listen(
    PORT,
    () => {

        console.log(
            "================================="
        );


        console.log(
            "KICKS STATION BACKEND"
        );


        console.log(
            "================================="
        );


        console.log(
            `Server berjalan di http://localhost:${PORT}`
        );


        console.log(
            `Database: ${productsFile}`
        );


        console.log(
            `Folder gambar: ${imagesFolder}`
        );

    }
);