import express from 'express';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { readFile } from 'node:fs/promises';

import {
  buildForecast,
  cityState,
  corridorState,
  departureAdvice,
  explain,
  REPORT_TYPES,
  LEVELS,
} from './traffic/engine.js';
import { getWeather, weatherMeta } from './traffic/weather.js';
import { nowMs } from './clock.js';
import { addReport, confirmReport, listReports, loadReports, reportsForEngine } from './reports/store.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const CLIENT = path.join(ROOT, 'client');
const DATA = path.join(__dirname, 'data', 'corridors.json');

const dataset = JSON.parse(await readFile(DATA, 'utf8'));
const CORRIDORS = dataset.corridors;
const BY_ID = new Map(CORRIDORS.map((c) => [c.id, c]));
const CORRIDOR_IDS = CORRIDORS.map((c) => c.id);
await loadReports(CORRIDOR_IDS);

// --------------------------------------------------------------------------
// Map tiles. The defaults are the keyless Esri demo tiles used for local
// development. COMMERCIAL BUILDS MUST SET DARJAM_TILE_URL to a licensed
// provider (MapTiler, ArcGIS with a key, Stadia, ...) before shipping.
// --------------------------------------------------------------------------
const TILE_CONFIG = {
  url:
    process.env.DARJAM_TILE_URL ||
    'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}',
  labelsUrl:
    process.env.DARJAM_TILE_LABELS_URL ??
    (process.env.DARJAM_TILE_URL
      ? null
      : 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}'),
  attribution:
    process.env.DARJAM_TILE_ATTRIBUTION ||
    'Tiles &copy; Esri, HERE, Garmin, &copy; OpenStreetMap contributors',
  maxZoom: Number(process.env.DARJAM_TILE_MAX_ZOOM) || 16,
};

function tileOrigins() {
  const origins = new Set();
  for (const value of [TILE_CONFIG.url, TILE_CONFIG.labelsUrl]) {
    if (!value) continue;
    try {
      origins.add(new URL(value.replace('{z}/{y}/{x}', '0/0/0')).origin);
    } catch {
      /* ignore malformed override */
    }
  }
  return [...origins];
}

const APP_CONFIG = {
  name: 'DarJam',
  tagline: 'Dar es Salaam traffic, live',
  website: process.env.DARJAM_WEBSITE || null,
  city: 'Dar es Salaam',
  country: 'Tanzania',
  timezone: 'Africa/Dar_es_Salaam',
  center: dataset.city.center,
  tiles: TILE_CONFIG,
  model: {
    provider: 'darjam-model',
    version: '1.0',
    inputs: ['time of day', 'direction', 'live rain', 'community reports'],
    source: dataset.source,
    generatedAt: dataset.generatedAt,
  },
  levels: LEVELS,
  reportTypes: Object.entries(REPORT_TYPES).map(([key, meta]) => ({
    key,
    label: meta.label,
    icon: meta.icon,
    ttlMin: meta.ttlMin,
  })),
};

function corridorGeometry(corridor) {
  const points = [];
  for (const segment of corridor.segments) {
    for (const point of segment.geometry) {
      const last = points[points.length - 1];
      if (!last || last[0] !== point[0] || last[1] !== point[1]) points.push(point);
    }
  }
  return points;
}

const GEOMETRY = new Map(CORRIDORS.map((c) => [c.id, corridorGeometry(c)]));

function serializeCorridor(state, { geometry = false } = {}) {
  const out = { ...state };
  if (geometry) out.geometry = GEOMETRY.get(state.id) || [];
  return out;
}

function buildContext(weather, now = nowMs()) {
  return { now, reports: reportsForEngine(now), weather };
}

function cityPayload(weather, now = nowMs()) {
  const ctx = buildContext(weather, now);
  const city = cityState(CORRIDORS, ctx);
  return {
    ...city,
    generatedAt: now,
    weather: {
      ...city.weather,
      condition: weather?.condition ?? 'Unknown',
      fetchedAt: weather?.fetchedAt ?? null,
    },
  };
}

function allCorridorStates(weather, { geometry = false, now = nowMs() } = {}) {
  const ctx = buildContext(weather, now);
  return CORRIDORS.map((corridor) => serializeCorridor(corridorState(corridor, ctx), { geometry }));
}

// ---------------------------------------------------------------------------
// Rate limiting for community reports (per IP, in memory).
// ---------------------------------------------------------------------------
const buckets = new Map();
function rateLimit(req, res, next) {
  const key = req.ip || 'unknown';
  const now = Date.now();
  const windowMs = 10 * 60 * 1000;
  const bucket = buckets.get(key) || { count: 0, reset: now + windowMs };
  if (now > bucket.reset) {
    bucket.count = 0;
    bucket.reset = now + windowMs;
  }
  bucket.count += 1;
  buckets.set(key, bucket);
  if (bucket.count > 12) {
    res.setHeader('Retry-After', Math.ceil((bucket.reset - now) / 1000));
    return res.status(429).json({ error: 'Too many reports. Please try again in a few minutes.' });
  }
  return next();
}

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', true);

  // The Android build serves the UI from capacitor://localhost (or https://localhost)
  // and calls this API cross-origin, so allow an explicit list of app origins.
  const allowedOrigins = (
    process.env.DARJAM_ALLOWED_ORIGINS ||
    'capacitor://localhost,https://localhost,http://localhost:5173'
  )
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);

  app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (origin && (allowedOrigins.includes('*') || allowedOrigins.includes(origin))) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
      res.setHeader('Access-Control-Max-Age', '86400');
    }
    if (req.method === 'OPTIONS') return res.status(204).end();
    return next();
  });

  app.use(express.json({ limit: '16kb' }));

  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader(
      'Content-Security-Policy',
      [
        "default-src 'self'",
        "script-src 'self'",
        "style-src 'self' 'unsafe-inline'",
        "font-src 'self' data:",
        `img-src 'self' data: blob: ${tileOrigins().join(' ')}`.trim(),
        "connect-src 'self'",
        "base-uri 'none'",
        "form-action 'self'",
        "frame-ancestors 'none'",
      ].join('; '),
    );
    if (req.path.startsWith('/api/')) res.setHeader('Cache-Control', 'no-store');
    next();
  });

  app.get('/api/health', async (_req, res) => {
    const weather = await getWeather();
    res.json({
      ok: true,
      app: 'darjam',
      uptimeSec: Math.round(process.uptime()),
      corridors: CORRIDORS.length,
      reports: listReports({ limit: 200 }).length,
      weather: weatherMeta(weather),
      datasetGeneratedAt: dataset.generatedAt,
    });
  });

  app.get('/api/config', (_req, res) => {
    res.json(APP_CONFIG);
  });

  app.get('/api/state', async (_req, res) => {
    const weather = await getWeather();
    const now = nowMs();
    res.json({
      config: APP_CONFIG,
      city: cityPayload(weather, now),
      corridors: allCorridorStates(weather, { geometry: true, now }),
      reports: listReports({ now, limit: 40 }),
      weather: weatherMeta(weather),
      generatedAt: now,
    });
  });

  app.get('/api/live', async (_req, res) => {
    const weather = await getWeather();
    const now = nowMs();
    res.json({
      city: cityPayload(weather, now),
      corridors: allCorridorStates(weather, { now }),
      reports: listReports({ now, limit: 40 }),
      weather: weatherMeta(weather),
      generatedAt: now,
    });
  });

  app.get('/api/corridors', async (req, res) => {
    const weather = await getWeather();
    const geometry = req.query.geometry === '1';
    res.json({ corridors: allCorridorStates(weather, { geometry }), generatedAt: nowMs() });
  });

  app.get('/api/corridors/:id', async (req, res) => {
    const corridor = BY_ID.get(req.params.id);
    if (!corridor) return res.status(404).json({ error: 'Corridor not found' });
    const weather = await getWeather();
    const now = nowMs();
    const ctx = buildContext(weather, now);
    const state = corridorState(corridor, ctx);
    const forecast = buildForecast({
      corridors: CORRIDORS,
      reports: ctx.reports,
      weather,
      now,
      hours: 12,
      corridorId: corridor.id,
      direction: state.busiestDirection,
    });
    res.json({
      ...serializeCorridor(state, { geometry: true }),
      explain: explain(state, ctx),
      forecast,
      generatedAt: now,
    });
  });

  app.get('/api/forecast', async (req, res) => {
    const hours = Math.max(1, Math.min(48, Number(req.query.hours) || 24));
    const corridorId = req.query.corridor ? String(req.query.corridor) : null;
    const direction = req.query.direction ? String(req.query.direction) : null;
    if (corridorId && !BY_ID.has(corridorId)) return res.status(404).json({ error: 'Corridor not found' });
    if (direction && !['inbound', 'outbound'].includes(direction)) {
      return res.status(400).json({ error: 'direction must be inbound or outbound' });
    }
    const weather = await getWeather();
    const now = nowMs();
    const ctx = buildContext(weather, now);
    res.json({
      hours: buildForecast({
        corridors: CORRIDORS,
        reports: ctx.reports,
        weather,
        now,
        hours,
        corridorId,
        direction,
      }),
      weather: weatherMeta(weather),
      generatedAt: now,
    });
  });

  app.get('/api/departure', async (req, res) => {
    const corridor = BY_ID.get(String(req.query.corridor || ''));
    if (!corridor) return res.status(400).json({ error: 'A valid corridor is required' });
    const direction = ['inbound', 'outbound'].includes(req.query.direction) ? req.query.direction : null;
    const windowHours = Math.max(1, Math.min(12, Number(req.query.window) || 6));
    const weather = await getWeather();
    const now = nowMs();
    const ctx = buildContext(weather, now);
    const state = corridorState(corridor, ctx);
    const advice = departureAdvice({
      corridor,
      direction: direction || state.busiestDirection,
      reports: ctx.reports,
      weather,
      now,
      windowHours,
    });
    res.json({
      corridor: { id: corridor.id, name: corridor.name, swahili: corridor.swahili },
      label: state.directions[advice.direction].label,
      ...advice,
      generatedAt: now,
    });
  });

  app.get('/api/reports', (req, res) => {
    const now = nowMs();
    const limit = Math.max(1, Math.min(100, Number(req.query.limit) || 40));
    const corridorId = req.query.corridor ? String(req.query.corridor) : null;
    res.json({ reports: listReports({ now, limit, corridorId }), generatedAt: now });
  });

  app.post('/api/reports', rateLimit, (req, res) => {
    const body = req.body || {};
    const corridor = BY_ID.get(String(body.corridorId || ''));
    if (!corridor) return res.status(400).json({ error: 'Choose a valid road' });
    if (!REPORT_TYPES[body.type]) return res.status(400).json({ error: 'Choose a valid report type' });
    const severity = Number(body.severity);
    if (![1, 2, 3].includes(severity)) return res.status(400).json({ error: 'severity must be 1, 2 or 3' });
    if (body.note != null && typeof body.note !== 'string') {
      return res.status(400).json({ error: 'note must be text' });
    }
    if (body.note && body.note.length > 160) return res.status(400).json({ error: 'note is too long' });
    const lat = Number(body.lat);
    const lng = Number(body.lng);
    const hasCoords = Number.isFinite(lat) && Number.isFinite(lng);
    if (body.lat != null && !hasCoords) return res.status(400).json({ error: 'invalid coordinates' });
    if (hasCoords && (lat < -7.2 || lat > -6.4 || lng < 38.9 || lng > 39.6)) {
      return res.status(400).json({ error: 'location must be in Dar es Salaam' });
    }
    // Reports without a device location are placed at the corridor's middle segment,
    // so they still show up on the map.
    const anchor = corridor.segments[Math.floor(corridor.segments.length / 2)]?.midpoint ?? [null, null];
    const report = addReport({
      ...body,
      lat: hasCoords ? lat : anchor[0],
      lng: hasCoords ? lng : anchor[1],
    }, corridor);
    res.status(201).json({ report });
  });

  app.post('/api/reports/:id/confirm', (req, res) => {
    const report = confirmReport(req.params.id);
    if (!report) return res.status(404).json({ error: 'Report not found or expired' });
    res.json({ report });
  });

  app.use('/vendor/leaflet', express.static(path.join(ROOT, 'node_modules', 'leaflet', 'dist'), {
    maxAge: '7d',
    immutable: true,
  }));
  app.use(express.static(CLIENT, { maxAge: '10m', extensions: ['html'] }));

  app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found' }));

  app.use((err, _req, res, _next) => {
    if (err?.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid JSON body' });
    console.error('[darjam]', err);
    return res.status(500).json({ error: 'Something went wrong' });
  });

  return app;
}

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '0.0.0.0';

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const app = createApp();
  app.listen(PORT, HOST, () => {
    console.log(`\n  DarJam — Dar es Salaam traffic`);
    console.log(`  http://localhost:${PORT}\n`);
    const weatherMode = process.env.DARJAM_WEATHER === 'off'
      ? 'disabled'
      : process.env.OPEN_METEO_API_KEY
        ? 'Open-Meteo (commercial key)'
        : 'Open-Meteo (free, non-commercial)';
    console.log(`  ${CORRIDORS.length} corridors · weather: ${weatherMode} · model v1.0\n`);

    if (process.env.NODE_ENV === 'production' && !process.env.DARJAM_TILE_URL) {
      console.warn(
        '  ⚠  Using keyless Esri demo tiles. For a commercial release set DARJAM_TILE_URL\n' +
        '     (e.g. MapTiler) or ArcGIS with an API key before publishing.\n',
      );
    }
    if (process.env.NODE_ENV === 'production' && !process.env.OPEN_METEO_API_KEY && process.env.DARJAM_WEATHER !== 'off') {
      console.warn(
        '  ⚠  Open-Meteo free tier is non-commercial. Set OPEN_METEO_API_KEY (paid plan)\n' +
        '     or DARJAM_WEATHER=off for a commercial release.\n',
      );
    }
  });
}
