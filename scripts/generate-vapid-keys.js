const crypto = require("crypto");
const ecdh = crypto.createECDH("prime256v1");
ecdh.generateKeys();
const toBase64Url = value => Buffer.from(value).toString("base64").replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
console.log("VAPID_PUBLIC_KEY=" + toBase64Url(ecdh.getPublicKey(null, "uncompressed")));
console.log("VAPID_PRIVATE_KEY=" + toBase64Url(ecdh.getPrivateKey()));
console.log("VAPID_SUBJECT=mailto:alamat-email-kamu@example.com");
console.log("Simpan private key hanya di Environment Variables Render; jangan commit ke GitHub.");
