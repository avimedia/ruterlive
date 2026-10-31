import { test } from 'node:test';
import assert from 'node:assert/strict';
import { securityHeaders, canonicalHost, clientIp, createRateLimiter, createUpstreamBudget, budgetedFetch } from '../server/security.js';

function mockRes() {
  const res = { headers: {}, statusCode: 200, body: null, redirectedTo: null };
  res.set = (k, v) => { if (typeof k === 'object') Object.assign(res.headers, k); else res.headers[k] = v; return res; };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  res.redirect = (c, u) => { res.statusCode = c; res.redirectedTo = u; };
  return res;
}

test('securityHeaders: setter hodene uten script-src (AdSense)', () => {
  const res = mockRes();
  let called = false;
  securityHeaders()({}, res, () => { called = true; });
  assert.ok(called);
  assert.equal(res.headers['X-Content-Type-Options'], 'nosniff');
  assert.equal(res.headers['X-Frame-Options'], 'SAMEORIGIN');
  assert.match(res.headers['Content-Security-Policy'], /frame-ancestors 'self'/);
  assert.doesNotMatch(res.headers['Content-Security-Policy'], /script-src|default-src/);
  assert.match(res.headers['Permissions-Policy'], /geolocation=\(self\)/);
});

test('canonicalHost: onrender.com sendes til livetrafikk.no, unntatt /health', () => {
  const mw = canonicalHost();
  const res = mockRes();
  mw({ headers: { host: 'ruterlive.onrender.com' }, path: '/linje/tog-f4', originalUrl: '/linje/tog-f4?x=1' }, res, () => assert.fail('skulle omdirigert'));
  assert.equal(res.statusCode, 301);
  assert.equal(res.redirectedTo, 'https://livetrafikk.no/linje/tog-f4?x=1');
  let next = 0;
  mw({ headers: { host: 'ruterlive.onrender.com' }, path: '/health', originalUrl: '/health' }, mockRes(), () => next++);
  mw({ headers: { host: 'livetrafikk.no' }, path: '/', originalUrl: '/' }, mockRes(), () => next++);
  assert.equal(next, 2);
});

test('clientIp: Cloudflare-hode først, så X-Forwarded-For', () => {
  assert.equal(clientIp({ headers: { 'cf-connecting-ip': '1.2.3.4', 'x-forwarded-for': '9.9.9.9' } }), '1.2.3.4');
  assert.equal(clientIp({ headers: { 'x-forwarded-for': '5.6.7.8, 10.0.0.1' } }), '5.6.7.8');
  assert.equal(clientIp({ headers: {}, socket: { remoteAddress: '::1' } }), '::1');
});

test('createRateLimiter: 429 over grensen, nytt vindu nullstiller, IP-er telles hver for seg', () => {
  let t = 0;
  const mw = createRateLimiter({ max: 3, windowMs: 1000, now: () => t });
  const req = (ip) => ({ headers: { 'cf-connecting-ip': ip } });
  let passed = 0;
  for (let i = 0; i < 3; i++) mw(req('a'), mockRes(), () => passed++);
  const blocked = mockRes();
  mw(req('a'), blocked, () => passed++);
  assert.equal(passed, 3);
  assert.equal(blocked.statusCode, 429);
  assert.ok(Number(blocked.headers['Retry-After']) >= 1);
  mw(req('b'), mockRes(), () => passed++);
  assert.equal(passed, 4);
  t = 1000;
  mw(req('a'), mockRes(), () => passed++);
  assert.equal(passed, 5);
});

test('createUpstreamBudget + budgetedFetch: avviser over budsjettet og fylles opp igjen', async () => {
  let t = 0;
  const budget = createUpstreamBudget({ perMinute: 60, burst: 2, now: () => t });
  let calls = 0;
  const f = budgetedFetch(budget, async () => { calls++; return 'ok'; });
  assert.equal(await f('u'), 'ok');
  assert.equal(await f('u'), 'ok');
  await assert.rejects(f('u'), /For mange oppslag/);
  assert.equal(calls, 2);
  t = 1000; // 60/min = 1 per sekund
  assert.equal(await f('u'), 'ok');
  assert.equal(calls, 3);
});
