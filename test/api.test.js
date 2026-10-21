process.env.DARJAM_OFFLINE = '1';
process.env.DARJAM_REPORTS_FILE = path.join(tmpdir(), `darjam-test-reports-${process.pid}.json`);

import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

let server;
let base;

before(async () => {
  const { createApp } = await import('../server/index.js');
  const app = createApp();
  server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  await rm(process.env.DARJAM_REPORTS_FILE, { force: true }).catch(() => {});
});

async function json(path, options) {
  const res = await fetch(`${base}${path}`, options);
  const body = await res.json();
  return { res, body };
}

test('health endpoint reports the dataset', async () => {
  const { res, body } = await json('/api/health');
  assert.equal(res.status, 200);
  assert.equal(body.ok, true);
  assert.ok(body.corridors >= 10);
  assert.equal(body.weather.available, false);
});

test('state endpoint returns city, corridors and geometry', async () => {
  const { res, body } = await json('/api/state');
  assert.equal(res.status, 200);
  assert.ok(body.city.score >= 0 && body.city.score <= 100);
  assert.ok(body.corridors.length >= 10);
  const corridor = body.corridors[0];
  assert.ok(Array.isArray(corridor.geometry));
  assert.ok(corridor.geometry.length > 2);
  assert.ok(corridor.directions.inbound.segments.length >= 1);
  assert.ok(Array.isArray(body.reports));
  assert.equal(res.headers.get('cache-control'), 'no-store');
});

test('corridor detail includes an explanation and forecast', async () => {
  const { res, body } = await json('/api/corridors/morogoro-road');
  assert.equal(res.status, 200);
  assert.equal(body.id, 'morogoro-road');
  assert.ok(body.geometry.length > 10);
  assert.ok(body.explain.stage.label);
  assert.equal(body.forecast.length, 12);
});

test('forecast endpoint validates direction', async () => {
  const bad = await json('/api/forecast?direction=sideways');
  assert.equal(bad.res.status, 400);
  const good = await json('/api/forecast?hours=4');
  assert.equal(good.res.status, 200);
  assert.equal(good.body.hours.length, 4);
});

test('departure planner returns a window', async () => {
  const { res, body } = await json('/api/departure?corridor=kilwa-road&direction=outbound&window=4');
  assert.equal(res.status, 200);
  assert.equal(body.series.length, 8);
  assert.ok(body.current.etaMin > 0);
  assert.ok(body.best.etaMin > 0);
  assert.equal(body.label, 'Out of the city centre');
});

test('report validation rejects bad input', async () => {
  const badRoad = await json('/api/reports', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ corridorId: 'nope', type: 'jam', severity: 2 }),
  });
  assert.equal(badRoad.res.status, 400);

  const badSeverity = await json('/api/reports', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ corridorId: 'morogoro-road', type: 'jam', severity: 9 }),
  });
  assert.equal(badSeverity.res.status, 400);

  const badType = await json('/api/reports', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ corridorId: 'morogoro-road', type: 'meteor', severity: 2 }),
  });
  assert.equal(badType.res.status, 400);

  const badJson = await json('/api/reports', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{oops',
  });
  assert.equal(badJson.res.status, 400);
});

test('a valid report is stored, mapped and confirmable', async () => {
  const { res, body } = await json('/api/reports', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      corridorId: 'morogoro-road',
      type: 'police',
      severity: 3,
      note: 'Checkpoint near Ubungo',
    }),
  });
  assert.equal(res.status, 201);
  assert.equal(body.report.corridorId, 'morogoro-road');
  assert.equal(body.report.severity, 3);
  assert.equal(body.report.confirmations, 0);
  // No device location was sent: the server anchors it on the corridor so the map can show it.
  assert.ok(Number.isFinite(body.report.lat) && body.report.lat < -6.4 && body.report.lat > -7.2);
  assert.ok(Number.isFinite(body.report.lng) && body.report.lng > 38.9 && body.report.lng < 39.6);

  const listed = await json('/api/reports');
  assert.ok(listed.body.reports.some((r) => r.id === body.report.id));

  const confirm = await json(`/api/reports/${body.report.id}/confirm`, { method: 'POST' });
  assert.equal(confirm.res.status, 200);
  assert.equal(confirm.body.report.confirmations, 1);

  const missing = await json('/api/reports/r_missing/confirm', { method: 'POST' });
  assert.equal(missing.res.status, 404);
});

test('config exposes tile settings for the client', async () => {
  const { res, body } = await json('/api/config');
  assert.equal(res.status, 200);
  assert.match(body.tiles.url, /\{z\}\/\{y\}\/\{x\}/);
  assert.ok(body.tiles.attribution);
  assert.ok(body.tiles.maxZoom >= 14);
});

test('the API allows the Android app origins', async () => {
  const allowed = await fetch(`${base}/api/health`, {
    headers: { Origin: 'capacitor://localhost' },
  });
  assert.equal(allowed.headers.get('access-control-allow-origin'), 'capacitor://localhost');

  const denied = await fetch(`${base}/api/health`, {
    headers: { Origin: 'https://evil.example' },
  });
  assert.equal(denied.headers.get('access-control-allow-origin'), null);

  const preflight = await fetch(`${base}/api/reports`, {
    method: 'OPTIONS',
    headers: {
      Origin: 'capacitor://localhost',
      'Access-Control-Request-Method': 'POST',
      'Access-Control-Request-Headers': 'content-type',
    },
  });
  assert.equal(preflight.status, 204);
  assert.match(preflight.headers.get('access-control-allow-methods') || '', /POST/);
});

test('privacy and terms pages are served for the Play listing', async () => {
  for (const page of ['/privacy.html', '/terms.html']) {
    const res = await fetch(`${base}${page}`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type') || '', /text\/html/);
    assert.match(await res.text(), /DarJam/);
  }
});

test('unknown API routes return JSON 404', async () => {
  const res = await fetch(`${base}/api/nothing`);
  assert.equal(res.status, 404);
  assert.deepEqual(await res.json(), { error: 'Not found' });
});

test('the client shell is served', async () => {
  const res = await fetch(`${base}/`);
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.match(html, /DarJam/);
  assert.match(html, /\/app\.js/);
});
