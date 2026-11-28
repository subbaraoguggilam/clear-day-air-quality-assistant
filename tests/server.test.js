import test, { describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import app from '../server.js';

describe('Express Server Routes and Security Headers', () => {
  let server;
  let baseUrl;

  before(async () => {
    await new Promise((resolve) => {
      server = app.listen(0, '127.0.0.1', () => {
        const { port } = server.address();
        baseUrl = `http://127.0.0.1:${port}`;
        resolve();
      });
    });
  });

  after(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  test('GET /api/health returns service status and security headers', async () => {
    const res = await fetch(`${baseUrl}/api/health`);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('x-powered-by'), null);
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(res.headers.get('referrer-policy'), 'no-referrer');
    assert.ok(res.headers.get('content-security-policy')?.includes("default-src 'self'"));

    const data = await res.json();
    assert.equal(data.status, 'ok');
    assert.equal(data.service, 'clear-day');
    assert.equal(typeof data.aiConfigured, 'boolean');
    assert.equal(typeof data.uptimeSeconds, 'number');
    assert.ok(data.timestamp);
  });

  test('POST /api/advice rejects malformed JSON with 400', async () => {
    const res = await fetch(`${baseUrl}/api/advice`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{invalid-json',
    });
    assert.equal(res.status, 400);
    const data = await res.json();
    assert.equal(data.error, 'Request body must be valid JSON.');
  });

  test('POST /api/advice rejects missing location with 400', async () => {
    const res = await fetch(`${baseUrl}/api/advice`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ profile: { commute: 'metro', distanceKm: 5 } }),
    });
    assert.equal(res.status, 400);
    const data = await res.json();
    assert.ok(data.error);
  });

  test('POST /api/ask rejects missing question with 400', async () => {
    const res = await fetch(`${baseUrl}/api/ask`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ city: 'Anantapur', profile: { commute: 'metro', distanceKm: 5 } }),
    });
    assert.equal(res.status, 400);
    const data = await res.json();
    assert.ok(data.error);
  });

  test('GET unknown route returns 404 HTML page', async () => {
    const res = await fetch(`${baseUrl}/does-not-exist`);
    assert.equal(res.status, 404);
    const html = await res.text();
    assert.ok(html.includes('Clear Day'));
  });
});
