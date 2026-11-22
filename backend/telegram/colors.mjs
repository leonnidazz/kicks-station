// Palet & deteksi warna: memakai langsung ks-colors.js milik website,
// jadi otomatis selalu sama dengan filter warna di website.
import { createRequire } from 'node:module';

const K = createRequire(import.meta.url)('../../ks-colors.js');

export const COLORS = K.COLORS;
export const MAX_COLORS = K.MAX_COLORS;
export const isColorKey = (key) => K.isColorKey(key);
export const colorLabel = (key) => K.label(key);
export const normalizeColors = (list) => K.normalize(list);
export const detectColors = (text) => K.detect(text);
