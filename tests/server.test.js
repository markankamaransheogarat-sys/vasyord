const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { server, io } = require('../server/index');

test('Vasyord server starts and responds on /health', async () => {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();

  const res = await new Promise((resolve, reject) => {
    http.get(`http://127.0.0.1:${port}/health`, (r) => {
      let body = '';
      r.on('data', (chunk) => { body += chunk; });
      r.on('end', () => resolve({ status: r.statusCode, body: JSON.parse(body) }));
    }).on('error', reject);
  });

  assert.equal(res.status, 200);
  assert.equal(res.body.status, 'ok');
  assert.equal(res.body.app, 'Vasyord Voice & WebRTC Server');
  assert.equal(typeof res.body.activeRooms, 'number');

  await new Promise((resolve) => io.close(resolve));
});
