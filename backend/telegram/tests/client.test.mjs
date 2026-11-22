import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createKickstationClient } from '../kickstation.mjs';

function mockServer({ expireFirstToken = false } = {}) {
  const calls = [];
  let logins = 0;
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const json = body ? JSON.parse(body) : {};
      calls.push({ url: req.url, auth: req.headers.authorization, json });
      const send = (code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
      if (req.url === '/api/admin/login') {
        if (json.pin !== 'pin-benar-12345') return send(401, { success: false, message: 'Kata sandi salah.' });
        logins++;
        return send(200, { success: true, token: 'tok' + logins, expiresAt: Date.now() + 3600000 });
      }
      if (req.url === '/api/products') {
        const expected = expireFirstToken ? 'Bearer tok2' : 'Bearer tok1';
        if (req.headers.authorization !== expected) return send(401, { success: false });
        return send(201, { success: true, product: { id: 99, nama: json.nama } });
      }
      send(404, {});
    });
  });
  return new Promise((r) => server.listen(0, () => r({ server, calls, port: server.address().port })));
}

test('login lalu tambah produk dengan Bearer token dan foto base64', async () => {
  const { server, calls, port } = await mockServer();
  const ks = createKickstationClient({ baseUrl: `http://localhost:${port}/`, pin: 'pin-benar-12345' });
  const p = await ks.createProduct({ nama: 'X', harga: 1, sizes: ['40'] }, [Buffer.from('abc')]);
  assert.equal(p.id, 99);
  const post = calls.find((c) => c.url === '/api/products');
  assert.equal(post.auth, 'Bearer tok1');
  assert.match(post.json.gambar[0].data, /^data:image\/jpeg;base64,/);
  server.close();
});

test('PIN salah -> error jelas', async () => {
  const { server, port } = await mockServer();
  const ks = createKickstationClient({ baseUrl: `http://localhost:${port}`, pin: 'salah' });
  await assert.rejects(() => ks.createProduct({ nama: 'X' }, [Buffer.from('a')]), /Login admin gagal \(401\)/);
  server.close();
});

test('token kedaluwarsa (401) -> login ulang sekali', async () => {
  const { server, calls, port } = await mockServer({ expireFirstToken: true });
  const ks = createKickstationClient({ baseUrl: `http://localhost:${port}`, pin: 'pin-benar-12345' });
  const p = await ks.createProduct({ nama: 'X', harga: 1, sizes: ['40'] }, [Buffer.from('a')]);
  assert.equal(p.id, 99);
  assert.equal(calls.filter((c) => c.url === '/api/admin/login').length, 2);
  server.close();
});
