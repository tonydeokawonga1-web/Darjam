/**
 * In-memory community reports, persisted to server/data/reports.json.
 * No database required: reports expire on their own and the file is small.
 */
import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { REPORT_TYPES } from '../traffic/engine.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '..', 'data');
/** Overridable so tests (or a read-only install) can point at another file. */
const FILE = process.env.DARJAM_REPORTS_FILE || path.join(DATA_DIR, 'reports.json');
const MAX_REPORTS = 400;

let reports = [];
let saveTimer = null;
let loaded = false;

export async function loadReports(corridorIds = null) {
  try {
    const raw = await readFile(FILE, 'utf8');
    const parsed = JSON.parse(raw);
    const list = Array.isArray(parsed) ? parsed : parsed.reports;
    const now = Date.now();
    reports = (Array.isArray(list) ? list : [])
      .filter((r) => r && typeof r.id === 'string')
      .filter((r) => (r.expiresAt ?? 0) > now)
      .filter((r) => !corridorIds || corridorIds.includes(r.corridorId))
      .slice(0, MAX_REPORTS);
  } catch (err) {
    if (err.code !== 'ENOENT') console.warn('[darjam] could not load reports:', err.message);
    reports = [];
  }
  loaded = true;
  return reports;
}

function persistSoon() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    saveTimer = null;
    try {
      await mkdir(path.dirname(FILE), { recursive: true });
      const tmp = `${FILE}.tmp`;
      await writeFile(tmp, `${JSON.stringify({ updatedAt: Date.now(), reports }, null, 2)}\n`, 'utf8');
      await rename(tmp, FILE);
    } catch (err) {
      console.warn('[darjam] could not save reports:', err.message);
    }
  }, 250);
  if (typeof saveTimer.unref === 'function') saveTimer.unref();
}

function activeAt(report, now) {
  return (report.expiresAt ?? 0) > now;
}

export function listReports({ now = Date.now(), corridorId = null, limit = 50 } = {}) {
  return reports
    .filter((r) => activeAt(r, now))
    .filter((r) => !corridorId || r.corridorId === corridorId)
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, Math.max(1, Math.min(200, limit)));
}

export function addReport(input, corridor) {
  const now = Date.now();
  const meta = REPORT_TYPES[input.type];
  if (!meta) throw Object.assign(new Error('Unknown report type'), { status: 400 });
  const severity = Math.max(1, Math.min(3, Math.round(Number(input.severity) || 1)));
  const report = {
    id: `r_${randomUUID().slice(0, 8)}`,
    type: input.type,
    severity,
    corridorId: corridor.id,
    corridorName: corridor.name,
    note: String(input.note || '').trim().slice(0, 160) || null,
    lat: Number.isFinite(input.lat) ? input.lat : null,
    lng: Number.isFinite(input.lng) ? input.lng : null,
    createdAt: now,
    expiresAt: now + meta.ttlMin * 60_000,
    confirmations: 0,
  };
  reports.unshift(report);
  reports = reports.filter((r) => activeAt(r, now)).slice(0, MAX_REPORTS);
  persistSoon();
  return report;
}

export function confirmReport(id) {
  const report = reports.find((r) => r.id === id);
  if (!report) return null;
  const now = Date.now();
  report.confirmations = Math.min(25, (report.confirmations || 0) + 1);
  // A confirmed report stays useful for up to 30 extra minutes.
  report.expiresAt = Math.max(report.expiresAt || 0, now + 30 * 60_000);
  persistSoon();
  return report;
}

export function reportsForEngine(now = Date.now()) {
  // Only keep what the engine needs and prune dead entries.
  reports = reports.filter((r) => activeAt(r, now));
  return reports.map((r) => ({
    id: r.id,
    type: r.type,
    severity: r.severity,
    corridorId: r.corridorId,
    lat: r.lat,
    lng: r.lng,
    createdAt: r.createdAt,
    expiresAt: r.expiresAt,
    confirmations: r.confirmations,
  }));
}

export function storeReady() {
  return loaded;
}
