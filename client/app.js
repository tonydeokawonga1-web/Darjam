/* DarJam client — vanilla JS + Leaflet, no build step. */

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

/**
 * When the UI is bundled into the Android app it is served from
 * capacitor://localhost, so relative /api calls would hit the WebView.
 * Set `window.DARJAM_API_BASE` in client/config.js to the hosted API origin.
 */
const API_BASE = String(window.DARJAM_API_BASE || '').replace(/\/+$/, '');

const state = {
  config: null,
  city: null,
  corridors: [],
  reports: [],
  weather: null,
  geometry: new Map(),
  selectedId: null,
  direction: null,
  tab: 'live',
  lastTab: 'live',
  map: null,
  baseLayer: null,
  layers: new Map(),
  reportLayer: null,
  userMarker: null,
  forecast: { at: 0, hours: [] },
  forecastLoading: false,
  detailForecast: new Map(),
  departure: { corridorId: null, direction: 'inbound', at: 0, data: null, loading: false },
  confirmed: new Set(),
  reportType: 'jam',
  severity: 2,
  toastTimer: null,
  offline: false,
  tileErrors: 0,
  tilesWarned: false,
  requestId: 0,
};

const els = {};

const FALLBACK_LEVELS = [
  { key: 'free', min: 0, label: 'Free flow', color: '#22c55e' },
  { key: 'light', min: 25, label: 'Light', color: '#a3e635' },
  { key: 'moderate', min: 45, label: 'Moderate', color: '#f59e0b' },
  { key: 'heavy', min: 65, label: 'Heavy', color: '#f97316' },
  { key: 'gridlock', min: 85, label: 'Gridlock', color: '#ef4444' },
];

const DEFAULT_REPORT_TYPES = [
  { key: 'jam', label: 'Jam', icon: '🚗' },
  { key: 'accident', label: 'Accident', icon: '💥' },
  { key: 'police', label: 'Police', icon: '👮' },
  { key: 'roadworks', label: 'Roadworks', icon: '🚧' },
  { key: 'flood', label: 'Flooding', icon: '🌊' },
  { key: 'closure', label: 'Closed', icon: '⛔' },
];

// ---------------------------------------------------------------- utilities
function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function hexToRgba(hex, alpha) {
  const clean = String(hex || '').replace('#', '');
  if (clean.length !== 6) return `rgba(255,255,255,${alpha})`;
  const n = parseInt(clean, 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

function levels() {
  return state.config?.levels?.length ? state.config.levels : FALLBACK_LEVELS;
}

function levelFor(score) {
  let out = levels()[0];
  for (const level of levels()) if (score >= level.min) out = level;
  return out;
}

function levelColor(score) {
  return levelFor(score).color;
}

function reportTypes() {
  return state.config?.reportTypes?.length ? state.config.reportTypes : DEFAULT_REPORT_TYPES;
}

const timeFmt = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Africa/Dar_es_Salaam',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});
const clockFmt = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Africa/Dar_es_Salaam',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});

const formatTime = (ts) => timeFmt.format(new Date(ts));
const formatClock = (ts) => clockFmt.format(new Date(ts));

function formatMin(min) {
  const value = Math.round(Number(min) || 0);
  if (value < 60) return `${value} min`;
  const h = Math.floor(value / 60);
  const m = value % 60;
  return m ? `${h} h ${String(m).padStart(2, '0')}` : `${h} h`;
}

function formatAgo(ts) {
  const mins = Math.max(0, Math.floor((Date.now() - ts) / 60000));
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const h = Math.floor(mins / 60);
  if (h < 24) return `${h} h ${mins % 60 ? `${mins % 60} min ` : ''}ago`;
  return `${Math.floor(h / 24)} d ago`;
}

function shortRoadName(name) {
  return String(name).replace(' Road', ' Rd').replace('Barabara ya ', '');
}

function shortDirection(label) {
  if (!label) return '—';
  if (label.startsWith('Towards')) return 'Towards city';
  if (label.startsWith('Out of')) return 'Out of city';
  return label;
}

function trendInfo(trend, delta) {
  if (trend === 'rising') return { arrow: '↑', word: 'Rising', cls: 'up', text: `${delta > 0 ? '+' : ''}${delta} vs an hour ago` };
  if (trend === 'easing') return { arrow: '↓', word: 'Easing', cls: 'down', text: `${delta} vs an hour ago` };
  return { arrow: '→', word: 'Holding steady', cls: 'flat', text: 'about the same as an hour ago' };
}

async function api(path, options = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options,
  });
  let data = null;
  try {
    data = await res.json();
  } catch {
    data = {};
  }
  if (!res.ok) throw new Error(data?.error || `Request failed (${res.status})`);
  return data;
}

function corridorById(id) {
  return state.corridors.find((c) => c.id === id) || null;
}

function showToast(message, tone = 'ok') {
  if (!els.toast) return;
  els.toast.textContent = message;
  els.toast.classList.toggle('is-error', tone === 'error');
  els.toast.classList.add('is-visible');
  clearTimeout(state.toastTimer);
  state.toastTimer = setTimeout(() => els.toast.classList.remove('is-visible'), 3200);
}

// -------------------------------------------------------------------- init
document.addEventListener('DOMContentLoaded', init);

async function init() {
  cacheElements();
  bindEvents();
  startClock();
  initMap();

  try {
    await loadInitial();
  } catch (err) {
    showFatal(err.message);
    return;
  }

  setInterval(() => pollLive({ silent: true }), 30000);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) pollLive({ silent: true });
  });
  window.addEventListener('hashchange', applyRoute);
  setupNativeShell();
}

/** Share DarJam via the native sheet, Web Share API, or clipboard fallback. */
async function shareApp() {
  const text = 'DarJam — live traffic-jam levels for Dar es Salaam, road by road.';
  const website = state.config?.website;
  const message = website ? `${text} ${website}` : text;

  const capacitor = window.Capacitor;
  if (capacitor?.isNativePlatform?.() && capacitor.Plugins?.Share?.share) {
    try {
      await capacitor.Plugins.Share.share({
        title: 'DarJam',
        text: message,
        dialogTitle: 'Share DarJam',
      });
      return;
    } catch (err) {
      // The user may have dismissed the sheet; fall through to other options.
    }
  }

  if (navigator.share) {
    try {
      await navigator.share({ title: 'DarJam', text: message, url: website || undefined });
      return;
    } catch (err) {
      if (err?.name === 'AbortError') return;
    }
  }

  try {
    await navigator.clipboard.writeText(message);
    showToast('Link copied to clipboard.');
  } catch {
    showToast(message);
  }
}

/** Android hardware back button + safe-area behaviour. No-op on the web. */
function setupNativeShell() {
  const cap = window.Capacitor;
  if (!cap?.isNativePlatform?.()) return;
  const App = cap.Plugins?.App;
  if (!App) return;

  App.addListener('backButton', () => {
    if (!els.modal.classList.contains('is-hidden')) {
      closeReport();
      return;
    }
    if (state.selectedId) {
      clearSelection();
      return;
    }
    if (state.tab !== 'live') {
      setTab('live');
      return;
    }
    App.exitApp();
  });
}

function cacheElements() {
  Object.assign(els, {
    weatherPill: $('#weatherPill'),
    weatherText: $('#weatherText'),
    clockTime: $('#clockTime'),
    refreshBtn: $('#refreshBtn'),
    shareBtn: $('#shareBtn'),
    tabs: $('#tabs'),
    panelBody: $('#panelBody'),
    hero: $('#hero'),
    worstList: $('#worstList'),
    rainCard: $('#rainCard'),
    roadsList: $('#roadsList'),
    roadsLegend: $('#roadsLegend'),
    reportCount: $('#reportCount'),
    reportsList: $('#reportsList'),
    addReportBtn: $('#addReportBtn'),
    cityChart: $('#cityChart'),
    forecastNowLabel: $('#forecastNowLabel'),
    quietTimes: $('#quietTimes'),
    departureCorridor: $('#departureCorridor'),
    departureDirection: $('#departureDirection'),
    departureResult: $('#departureResult'),
    mapStatus: $('#mapStatus'),
    reportBtn: $('#reportBtn'),
    locateBtn: $('#locateBtn'),
    modal: $('#reportModal'),
    reportForm: $('#reportForm'),
    typeGrid: $('#typeGrid'),
    reportCorridor: $('#reportCorridor'),
    severitySeg: $('#severitySeg'),
    reportNote: $('#reportNote'),
    reportError: $('#reportError'),
    reportSubmit: $('#reportSubmit'),
    toast: $('#toast'),
    fatal: $('#fatal'),
    fatalMessage: $('#fatalMessage'),
    retryBtn: $('#retryBtn'),
    mapShell: $('.map-shell'),
  });
}

function startClock() {
  const tick = () => {
    if (els.clockTime) els.clockTime.textContent = formatTime(Date.now());
  };
  tick();
  setInterval(tick, 10000);
}

function initMap() {
  if (!window.L) {
    showToast('Map library failed to load — list view still works.', 'error');
    return;
  }
  const center = state.config?.center || [-6.8036, 39.2534];
  state.map = L.map('map', {
    zoomControl: false,
    attributionControl: true,
    preferCanvas: true,
    minZoom: 10,
    maxZoom: 17,
  }).setView(center, 12);

  if (window.innerWidth > 960) L.control.zoom({ position: 'topright' }).addTo(state.map);

  state.reportLayer = L.layerGroup().addTo(state.map);
  state.map.on('click', () => {
    if (state.selectedId) clearSelection();
  });
}

/**
 * Tiles come from /api/config, which loads after the map is created, so this is
 * called once the config is available. The development default is the keyless
 * Esri layer; production sets DARJAM_TILE_URL on the server.
 */
function addBaseTiles() {
  if (!state.map || state.baseLayer) return;
  const tiles = state.config?.tiles || {};
  const maxNativeZoom = tiles.maxZoom || 16;

  const baseLayer = L.tileLayer(
    tiles.url || 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}',
    {
      maxZoom: 16,
      maxNativeZoom,
      attribution: tiles.attribution || 'Tiles &copy; OpenStreetMap contributors',
    },
  ).addTo(state.map);

  if (tiles.labelsUrl) {
    L.tileLayer(tiles.labelsUrl, {
      maxZoom: 16,
      maxNativeZoom,
      pane: 'overlayPane',
      opacity: 0.85,
    }).addTo(state.map);
  }

  baseLayer.on('tileerror', () => {
    state.tileErrors += 1;
    if (state.tileErrors >= 6 && !state.tilesWarned) {
      state.tilesWarned = true;
      showToast('Map tiles unavailable — road colours still work.', 'error');
    }
  });

  state.baseLayer = baseLayer;
}

// ------------------------------------------------------------------ loading
async function loadInitial() {
  const data = await api('/api/state');
  state.config = data.config;
  state.city = data.city;
  state.corridors = data.corridors;
  state.reports = data.reports;
  state.weather = data.weather;
  state.corridors.forEach((c) => state.geometry.set(c.id, c.geometry));

  if (state.map) {
    addBaseTiles();
    state.map.setView(state.config.center || [-6.8036, 39.2534], 12);
    addCorridorLayers();
    fitCity();
  }
  els.refreshBtn.classList.remove('is-spinning');
  els.fatal.classList.add('is-hidden');
  renderAll();
  updateMapStatus(data.generatedAt);
  renderWeatherPill();
  if (state.map) {
    // The map starts inside a flex panel, so its size settles a frame after paint.
    // Re-measure first, then frame the city (unless a corridor is open).
    setTimeout(() => {
      state.map.invalidateSize();
      if (!state.selectedId) fitCity();
    }, 80);
  }
  applyRoute();
}

function fitCity() {
  if (!state.map || !state.corridors.length) return;
  const points = [];
  for (const corridor of state.corridors) points.push(...(state.geometry.get(corridor.id) || []));
  if (!points.length) return;
  state.map.fitBounds(L.latLngBounds(points), {
    padding: [24, 24],
    maxZoom: 13,
    animate: false,
  });
}

function applyRoute() {
  const raw = location.hash.replace(/^#\/?/, '').trim();
  if (!raw || raw === 'live') {
    setTab('live', { updateHash: false });
    return;
  }
  if (raw.startsWith('road/')) {
    const id = raw.slice('road/'.length);
    if (corridorById(id)) selectCorridor(id, { fly: true, updateHash: false });
    else setTab('live', { updateHash: false });
    return;
  }
  if (['roads', 'forecast', 'reports'].includes(raw)) {
    setTab(raw, { updateHash: false });
  }
}

async function pollLive({ silent = false } = {}) {
  if (!state.city) return;
  els.refreshBtn?.classList.add('is-spinning');
  try {
    const data = await api('/api/live');
    state.city = data.city;
    state.reports = data.reports;
    state.weather = data.weather;
    state.corridors = data.corridors.map((c) => ({
      ...c,
      geometry: state.geometry.get(c.id) || [],
    }));
    state.offline = false;
    els.mapShell?.classList.remove('is-offline');
    renderHero();
    renderWorst();
    renderRainCard();
    renderRoads();
    renderReports();
    renderWeatherPill();
    updateMapStyles();
    renderMapReports();
    updateMapStatus(data.generatedAt);
    if (state.selectedId) renderDetail();
    if (state.tab === 'forecast') renderForecast();
  } catch (err) {
    state.offline = true;
    els.mapShell?.classList.add('is-offline');
    if (els.mapStatus) els.mapStatus.textContent = 'Offline — retrying automatically';
    if (!silent) showToast(`Refresh failed: ${err.message}`, 'error');
  } finally {
    els.refreshBtn?.classList.remove('is-spinning');
  }
}

function updateMapStatus(ts) {
  if (!els.mapStatus) return;
  els.mapStatus.textContent = `${state.offline ? 'Offline' : 'Live'} · updated ${formatClock(ts)} EAT`;
}

function showFatal(message) {
  els.fatalMessage.textContent = message || 'Check that the server is running, then try again.';
  els.fatal.classList.remove('is-hidden');
  els.refreshBtn?.classList.remove('is-spinning');
}

// -------------------------------------------------------------------- tabs
function bindEvents() {
  els.tabs?.addEventListener('click', (event) => {
    const button = event.target.closest('[data-tab]');
    if (!button) return;
    setTab(button.dataset.tab);
  });

  document.addEventListener('click', (event) => {
    const goto = event.target.closest('[data-goto]');
    if (goto) setTab(goto.dataset.goto);
  });

  els.worstList?.addEventListener('click', onRoadClick);
  els.roadsList?.addEventListener('click', onRoadClick);

  els.refreshBtn?.addEventListener('click', () => {
    els.refreshBtn.classList.add('is-spinning');
    pollLive();
  });
  els.shareBtn?.addEventListener('click', shareApp);
  els.retryBtn?.addEventListener('click', async () => {
    els.fatal.classList.add('is-hidden');
    try {
      await loadInitial();
    } catch (err) {
      showFatal(err.message);
    }
  });

  els.addReportBtn?.addEventListener('click', () => openReport());
  els.reportBtn?.addEventListener('click', () => openReport());
  els.locateBtn?.addEventListener('click', locateUser);

  els.reportForm?.addEventListener('submit', submitReport);
  els.modal?.addEventListener('click', (event) => {
    if (event.target.closest('[data-close]')) closeReport();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !els.modal.classList.contains('is-hidden')) closeReport();
  });

  els.typeGrid?.addEventListener('click', (event) => {
    const chip = event.target.closest('[data-type]');
    if (!chip) return;
    state.reportType = chip.dataset.type;
    $$('.type-chip', els.typeGrid).forEach((c) => c.classList.toggle('is-active', c === chip));
  });

  els.severitySeg?.addEventListener('click', (event) => {
    const button = event.target.closest('[data-sev]');
    if (!button) return;
    state.severity = Number(button.dataset.sev);
    $$('button', els.severitySeg).forEach((b) => b.classList.toggle('is-active', b === button));
  });

  els.departureCorridor?.addEventListener('change', () => {
    const corridor = corridorById(els.departureCorridor.value);
    if (!corridor) return;
    state.departure.corridorId = corridor.id;
    state.departure.direction = corridor.busiestDirection;
    updateDepartureLabels(corridor);
    loadDeparture();
  });

  els.departureDirection?.addEventListener('click', (event) => {
    const button = event.target.closest('[data-dir]');
    if (!button) return;
    state.departure.direction = button.dataset.dir;
    $$('button', els.departureDirection).forEach((b) => b.classList.toggle('is-active', b === button));
    loadDeparture();
  });

  els.reportsList?.addEventListener('click', async (event) => {
    const button = event.target.closest('[data-confirm]');
    if (!button) return;
    const id = button.dataset.confirm;
    if (state.confirmed.has(id)) return;
    button.disabled = true;
    try {
      const data = await api(`/api/reports/${id}/confirm`, { method: 'POST' });
      state.confirmed.add(id);
      const existing = state.reports.find((r) => r.id === id);
      if (existing) existing.confirmations = data.report.confirmations;
      renderReports();
      showToast('Thanks — confirmation added.');
    } catch (err) {
      button.disabled = false;
      showToast(err.message, 'error');
    }
  });
}

function setTab(tab, { updateHash = true } = {}) {
  if (!['live', 'roads', 'forecast', 'reports'].includes(tab)) return;
  if (state.selectedId) {
    state.selectedId = null;
    state.direction = null;
    updateMapStyles();
  }
  state.lastTab = tab;
  state.tab = tab;
  if (updateHash) history.replaceState(null, '', `#/${tab}`);
  $$('.tab', els.tabs).forEach((button) => {
    const active = button.dataset.tab === tab;
    button.classList.toggle('is-active', active);
    button.setAttribute('aria-selected', active ? 'true' : 'false');
  });
  $$('.view').forEach((view) => {
    view.classList.toggle('is-hidden', view.dataset.view !== tab);
  });
  els.panelBody.scrollTo({ top: 0, behavior: 'smooth' });
  if (tab === 'forecast') renderForecast();
  if (tab === 'reports') renderReports();
  if (state.map && window.innerWidth > 960) state.map.invalidateSize();
}

function showView(view) {
  $$('.view').forEach((node) => node.classList.toggle('is-hidden', node.dataset.view !== view));
  if (view === 'detail') {
    $$('.tab', els.tabs).forEach((button) => {
      button.classList.remove('is-active');
      button.setAttribute('aria-selected', 'false');
    });
    els.panelBody.scrollTo({ top: 0, behavior: 'smooth' });
  }
}

// -------------------------------------------------------------------- live
function renderAll() {
  renderHero();
  renderWorst();
  renderRainCard();
  renderRoads();
  renderReports();
  renderWeatherPill();
  updateMapStyles();
  renderMapReports();
  updateRoadsLegend();
  if (state.tab === 'forecast') renderForecast();
}

function renderHero() {
  if (!state.city || !els.hero) return;
  const city = state.city;
  const level = city.level;
  const color = level.color;
  const trend = trendInfo(city.trend, city.trendDelta);
  const worst = city.worst?.[0];
  const worstName = worst ? shortRoadName(worst.name) : '—';
  const rain = city.weather.rainMmPerHour;
  const temp = city.weather.temperatureC;

  const circumference = 2 * Math.PI * 52;
  const offset = circumference * (1 - city.score / 100);

  els.hero.innerHTML = `
    <div class="hero-head">
      <div class="ring" style="--ring-color:${color}" aria-label="City jam score ${city.score} out of 100">
        <svg viewBox="0 0 120 120" aria-hidden="true">
          <circle class="ring-track" cx="60" cy="60" r="52"></circle>
          <circle class="ring-value" cx="60" cy="60" r="52"
            stroke-dasharray="${circumference.toFixed(1)}"
            stroke-dashoffset="${offset.toFixed(1)}"></circle>
        </svg>
        <div class="ring-center"><strong>${city.score}</strong><span>/ 100</span></div>
      </div>
      <div class="hero-copy">
        <span class="eyebrow">City jam level</span>
        <h2 class="hero-level" style="color:${color}">${level.label}<span>· ${level.swahili}</span></h2>
        <div class="hero-trend">
          <span class="trend-arrow ${trend.cls}" aria-hidden="true">${trend.arrow}</span>
          <span><b>${trend.word}</b> · ${escapeHtml(trend.text)}</span>
        </div>
        <div class="chips">
          <span class="chip">${escapeHtml(city.stage.label)}</span>
          ${rain > 0.05 ? `<span class="chip wet">🌧 ${rain} mm/h</span>` : ''}
          ${temp != null ? `<span class="chip ${temp >= 30 ? 'hot' : ''}">${Math.round(temp)}°C</span>` : ''}
          ${city.activeReports ? `<span class="chip">${city.activeReports} report${city.activeReports === 1 ? '' : 's'}</span>` : ''}
        </div>
      </div>
    </div>
    <div class="hero-stats">
      <div class="hero-stat"><span>Avg speed</span><strong>${city.speedKph || '—'} km/h</strong></div>
      <div class="hero-stat"><span>City delay</span><strong>+${Math.round(city.delayMin)} min</strong></div>
      <div class="hero-stat"><span>Heaviest</span><strong title="${escapeHtml(worst?.name || '')}">${escapeHtml(worstName)}</strong></div>
    </div>`;
}

function onRoadClick(event) {
  const row = event.target.closest('[data-road]');
  if (!row) return;
  selectCorridor(row.dataset.road);
}

function roadRow(corridor, rank) {
  const level = corridor.level;
  const color = level.color;
  const direction = corridor.directions[corridor.busiestDirection];
  const delay = Math.round(corridor.delayMin);
  return `
    <button class="road-row ${corridor.score >= 75 ? 'is-hot' : ''}" data-road="${corridor.id}" aria-label="${escapeHtml(corridor.name)}, ${level.label}, score ${corridor.score}">
      <span class="road-rank">${String(rank).padStart(2, '0')}</span>
      <span class="road-main">
        <span class="road-top">
          <span class="road-name">${escapeHtml(corridor.name)}</span>
          <span class="level-pill" style="color:${color};background:${hexToRgba(color, 0.12)};border-color:${hexToRgba(color, 0.28)}">${level.label} ${corridor.score}</span>
        </span>
        <span class="road-sub">
          <span>${escapeHtml(shortDirection(direction.label))}</span>
          <span class="sep">·</span>
          <span>${corridor.speedKph} km/h</span>
          <span class="sep">·</span>
          <span>${formatMin(corridor.etaMin)}</span>
          ${delay > 0 ? `<span class="sep">·</span><span class="delay">+${delay} min</span>` : ''}
        </span>
        <span class="meter"><i style="width:${corridor.score}%;background:${color}"></i></span>
      </span>
    </button>`;
}

function renderWorst() {
  if (!els.worstList || !state.city) return;
  const list = (state.city.worst || [])
    .map((worst) => corridorById(worst.id))
    .filter(Boolean)
    .slice(0, 4);
  els.worstList.innerHTML = list.length
    ? list.map((corridor, index) => roadRow(corridor, index + 1)).join('')
    : '<div class="empty"><strong>No data yet</strong>Traffic estimates will appear here.</div>';
}

function renderRoads() {
  if (!els.roadsList) return;
  const sorted = [...state.corridors].sort((a, b) => b.score - a.score);
  els.roadsList.innerHTML = sorted.length
    ? sorted.map((corridor, index) => roadRow(corridor, index + 1)).join('')
    : '<div class="empty"><strong>No roads loaded</strong>Check the server connection.</div>';
  updateRoadsLegend();
}

function updateRoadsLegend() {
  if (!els.roadsLegend) return;
  const heavy = state.corridors.filter((c) => c.score >= 65).length;
  els.roadsLegend.textContent = heavy ? `${heavy} of ${state.corridors.length} heavy` : 'All moving';
}

function renderRainCard() {
  if (!els.rainCard || !state.city) return;
  const weather = state.city.weather || {};
  const rain = Number(weather.rainMmPerHour) || 0;
  const prob = Number(weather.precipitationProbability) || 0;
  const temp = weather.temperatureC;
  const available = weather.available;
  const condition = weather.condition || 'Dar es Salaam';

  if (!available) {
    els.rainCard.className = 'rain-card is-dry';
    els.rainCard.innerHTML = `
      <div class="rain-icon" aria-hidden="true">🛰️</div>
      <div class="rain-copy">
        <strong>Live weather unavailable</strong>
        <p>Running on the dry baseline. Time-of-day demand and community reports still apply.</p>
      </div>`;
    return;
  }

  if (rain > 0.05) {
    const bump = Math.min(50, Math.round(rain * 16));
    els.rainCard.className = 'rain-card';
    els.rainCard.innerHTML = `
      <div class="rain-icon" aria-hidden="true">🌧️</div>
      <div class="rain-copy">
        <strong>Rain is slowing the city</strong>
        <p>${rain} mm/h now · ${prob}% chance this hour. Wet roads add about ${bump}% demand in the model.</p>
      </div>
      ${temp != null ? `<div class="rain-temp">${Math.round(temp)}°</div>` : ''}`;
  } else {
    els.rainCard.className = 'rain-card is-dry';
    els.rainCard.innerHTML = `
      <div class="rain-icon" aria-hidden="true">${prob >= 50 ? '⛅' : '☀️'}</div>
      <div class="rain-copy">
        <strong>Dry roads right now</strong>
        <p>${escapeHtml(condition)} · ${prob}% rain chance this hour. No rain multiplier is applied.</p>
      </div>
      ${temp != null ? `<div class="rain-temp">${Math.round(temp)}°</div>` : ''}`;
  }
}

function renderWeatherPill() {
  if (!els.weatherPill || !state.weather) return;
  const weather = state.weather;
  const rain = Number(weather.rainMmPerHour) || 0;
  const temp = weather.temperatureC;
  els.weatherPill.classList.toggle('is-rain', rain > 0.05);
  els.weatherPill.classList.toggle('is-offline', !weather.available);
  if (!weather.available) {
    els.weatherText.textContent = 'Weather offline';
    return;
  }
  if (rain > 0.05) {
    els.weatherText.textContent = `Rain ${rain} mm/h`;
  } else if (temp != null) {
    els.weatherText.textContent = `${weather.condition || 'Dry'} · ${Math.round(temp)}°C`;
  } else {
    els.weatherText.textContent = weather.condition || 'Dar es Salaam';
  }
}

// ------------------------------------------------------------------ detail
function selectCorridor(id, { fly = true, updateHash = true } = {}) {
  const corridor = corridorById(id);
  if (!corridor) return;
  if (!state.selectedId) state.lastTab = state.tab;
  state.selectedId = id;
  state.direction = corridor.busiestDirection;
  if (updateHash) history.replaceState(null, '', `#/road/${id}`);
  renderDetail();
  showView('detail');
  updateMapStyles();
  if (fly) fitCorridor(corridor);
}

function clearSelection() {
  state.selectedId = null;
  state.direction = null;
  updateMapStyles();
  setTab(state.lastTab || 'live');
}

function fitCorridor(corridor) {
  const geometry = state.geometry.get(corridor.id);
  if (!state.map || !geometry?.length) return;
  const bounds = L.latLngBounds(geometry);
  state.map.fitBounds(bounds, {
    paddingTopLeft: [34, 58],
    paddingBottomRight: [34, 100],
    maxZoom: 14,
    animate: true,
    duration: 0.6,
  });
}

function renderDetail() {
  const corridor = corridorById(state.selectedId);
  if (!corridor) return;
  const direction = corridor.directions[state.direction] || corridor.directions[corridor.busiestDirection];
  const level = direction.level;
  const color = level.color;
  const other = corridor.directions[state.direction === 'inbound' ? 'outbound' : 'inbound'];
  const directionKey = state.direction;

  const forecastKey = `${corridor.id}:${directionKey}`;
  const cached = state.detailForecast.get(forecastKey);
  const chartHtml = cached
    ? lineChart(cached.hours, { height: 118, rain: false, compact: true })
    : '<div class="skeleton skeleton-chart" style="height:96px"></div>';

  const reportsNear = state.reports.filter(
    (r) => r.corridorId === corridor.id && (r.expiresAt ?? Infinity) > Date.now(),
  ).length;
  const rain = Number(state.city?.weather?.rainMmPerHour) || 0;

  const explanation = [
    `<span class="chip">${escapeHtml(state.city?.stage?.label || 'Live estimate')}</span>`,
    `<span class="chip">${escapeHtml(shortDirection(direction.label))}</span>`,
    rain > 0.05 ? `<span class="chip wet">🌧 Rain ${rain} mm/h</span>` : '<span class="chip">Dry roads</span>',
    reportsNear ? `<span class="chip">${reportsNear} report${reportsNear === 1 ? '' : 's'} on this road</span>` : '',
  ].filter(Boolean).join('');

  const segments = direction.segments
    .map((segment) => {
      const segLevel = segment.level;
      return `
        <div class="segment-row">
          <span class="segment-dot" style="background:${segLevel.color}"></span>
          <span class="segment-main">
            <span class="segment-name"><b>${escapeHtml(segment.from)}</b> → ${escapeHtml(segment.to)}</span>
            <span class="segment-meta">${segment.speedKph} km/h · ${formatMin(segment.etaMin)}${segment.delayMin >= 1 ? ` · +${Math.round(segment.delayMin)} min` : ''}${segment.reports ? ` · ${segment.reports} report${segment.reports === 1 ? '' : 's'}` : ''}</span>
          </span>
          <span class="segment-bar"><i style="width:${segment.score}%;background:${segLevel.color}"></i></span>
          <span class="segment-score" style="color:${segLevel.color}">${segment.score}</span>
        </div>`;
    })
    .join('');

  const view = $('#view-detail');
  view.innerHTML = `
    <div class="detail-top">
      <button class="back-btn" id="detailBack">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 6l-6 6 6 6"/></svg>
        Back
      </button>
    </div>

    <div class="card detail-hero">
      <div class="detail-title-row">
        <div>
          <h2>${escapeHtml(corridor.name)}</h2>
          <div class="swahili">${escapeHtml(corridor.swahili)}</div>
        </div>
        <div class="detail-score" style="color:${color}" aria-label="Jam score ${direction.score} out of 100">
          <strong>${direction.score}</strong><span>/100</span>
        </div>
      </div>
      <p class="detail-desc">${escapeHtml(corridor.description)}</p>

      <div class="seg" role="group" aria-label="Direction" style="margin-top:12px">
        <button type="button" data-detail-dir="inbound" class="${directionKey === 'inbound' ? 'is-active' : ''}">${escapeHtml(shortDirection(corridor.directions.inbound.label))}</button>
        <button type="button" data-detail-dir="outbound" class="${directionKey === 'outbound' ? 'is-active' : ''}">${escapeHtml(shortDirection(corridor.directions.outbound.label))}</button>
      </div>

      <div class="detail-stats">
        <div class="detail-stat"><span>Speed</span><strong style="color:${color}">${direction.speedKph} km/h</strong></div>
        <div class="detail-stat"><span>Travel</span><strong>${formatMin(direction.etaMin)}</strong></div>
        <div class="detail-stat"><span>Delay</span><strong style="color:${direction.delayMin >= 1 ? 'var(--orange)' : 'var(--green-soft)'}">${direction.delayMin >= 1 ? '+' : ''}${formatMin(direction.delayMin)}</strong></div>
        <div class="detail-stat"><span>Distance</span><strong>${direction.lengthKm} km</strong></div>
      </div>

      <div class="why" style="margin-top:11px">${explanation}</div>
    </div>

    <div class="section">
      <div class="section-head"><h3>Next 12 hours</h3><span class="muted">${escapeHtml(other.label)}: ${other.score}</span></div>
      <div class="card" style="padding:10px 8px 4px" id="detailChart">${chartHtml}</div>
    </div>

    <div class="section">
      <div class="section-head"><h3>Road segments</h3><span class="muted">${direction.segments.length} segments</span></div>
      <div class="segment-list">${segments}</div>
    </div>

    <button class="btn btn-primary" id="detailReport" style="width:100%">Report something on this road</button>
    <p class="muted" style="text-align:center;font-size:9px;line-height:1.5">Estimated from Dar demand patterns, live rain and community reports — not a GPS speed feed.</p>
  `;

  $('#detailBack')?.addEventListener('click', clearSelection);
  $$('[data-detail-dir]', view).forEach((button) => {
    button.addEventListener('click', () => {
      state.direction = button.dataset.detailDir;
      renderDetail();
    });
  });
  $('#detailReport')?.addEventListener('click', () => openReport(corridor.id));

  fetchDetailForecast(corridor.id, directionKey);
}

async function fetchDetailForecast(corridorId, direction) {
  const key = `${corridorId}:${direction}`;
  const cached = state.detailForecast.get(key);
  if (cached && Date.now() - cached.at < 5 * 60 * 1000) return;
  if (cached?.loading) return;
  state.detailForecast.set(key, { ...(cached || {}), loading: true });
  try {
    const data = await api(`/api/forecast?corridor=${encodeURIComponent(corridorId)}&direction=${direction}&hours=12`);
    state.detailForecast.set(key, { at: Date.now(), hours: data.hours, loading: false });
    if (state.selectedId === corridorId && state.direction === direction) {
      const target = $('#detailChart');
      if (target) target.innerHTML = lineChart(data.hours, { height: 118, rain: false, compact: true });
    }
  } catch {
    state.detailForecast.set(key, { ...(cached || {}), loading: false });
  }
}

// ------------------------------------------------------------------ forecast
async function renderForecast() {
  const hours = state.forecast.hours;
  const stale = !state.forecast.at || Date.now() - state.forecast.at > 5 * 60 * 1000;
  if (stale && !state.forecastLoading) {
    state.forecastLoading = true;
    if (!hours.length && els.cityChart) {
      els.cityChart.innerHTML = '<div class="skeleton skeleton-chart"></div>';
    }
    try {
      const data = await api('/api/forecast?hours=24');
      state.forecast = { at: Date.now(), hours: data.hours };
    } catch (err) {
      showToast(`Forecast unavailable: ${err.message}`, 'error');
    } finally {
      state.forecastLoading = false;
    }
  }

  const data = state.forecast.hours;
  if (!data.length) {
    if (els.cityChart) els.cityChart.innerHTML = '<div class="empty">Forecast unavailable right now.</div>';
    return;
  }

  const now = data[0];
  if (els.forecastNowLabel) {
    els.forecastNowLabel.innerHTML = `<span style="color:${levelColor(now.score)}">${levelFor(now.score).label} · ${now.score}/100</span>`;
  }
  if (els.cityChart) els.cityChart.innerHTML = lineChart(data, { height: 214, rain: true });
  renderQuietTimes(data);
  populateDepartureSelect();
  if (!state.departure.data && !state.departure.loading) loadDeparture();
}

function renderQuietTimes(hours) {
  if (!els.quietTimes) return;
  const chosen = [];
  for (const hour of [...hours].sort((a, b) => a.score - b.score)) {
    if (chosen.every((pick) => Math.abs(pick.ts - hour.ts) >= 2 * 60 * 60 * 1000)) chosen.push(hour);
    if (chosen.length === 3) break;
  }
  els.quietTimes.innerHTML = chosen
    .map((hour) => {
      const level = levelFor(hour.score);
      return `<div class="quiet-card">
        <span>${formatTime(hour.ts)}</span>
        <strong>${hour.score}<small style="font-size:9px;color:var(--muted-2);font-weight:700"> /100</small></strong>
        <em style="color:${level.color}">${level.label}</em>
      </div>`;
    })
    .join('');
}

function populateDepartureSelect() {
  if (!els.departureCorridor) return;
  if (!els.departureCorridor.options.length) {
    const sorted = [...state.corridors].sort((a, b) => a.name.localeCompare(b.name));
    els.departureCorridor.innerHTML = sorted
      .map((c) => `<option value="${c.id}">${escapeHtml(c.name)}</option>`)
      .join('');
    const preferred = state.selectedId || state.city?.worst?.[0]?.id || sorted[0]?.id;
    if (preferred) els.departureCorridor.value = preferred;
  }
  if (!state.departure.corridorId) {
    const corridor = corridorById(els.departureCorridor.value) || state.corridors[0];
    if (corridor) {
      state.departure.corridorId = corridor.id;
      state.departure.direction = corridor.busiestDirection;
      updateDepartureLabels(corridor);
    }
  }
}

function updateDepartureLabels(corridor) {
  if (!els.departureDirection) return;
  const inbound = $('[data-dir="inbound"]', els.departureDirection);
  const outbound = $('[data-dir="outbound"]', els.departureDirection);
  if (inbound) {
    inbound.textContent = shortDirection(corridor.directions.inbound.label);
    inbound.classList.toggle('is-active', state.departure.direction === 'inbound');
  }
  if (outbound) {
    outbound.textContent = shortDirection(corridor.directions.outbound.label);
    outbound.classList.toggle('is-active', state.departure.direction === 'outbound');
  }
}

async function loadDeparture() {
  const corridorId = state.departure.corridorId;
  if (!corridorId) return;
  const direction = state.departure.direction;
  state.departure.loading = true;
  if (els.departureResult) els.departureResult.innerHTML = '<div class="skeleton skeleton-row"></div>';
  try {
    const data = await api(
      `/api/departure?corridor=${encodeURIComponent(corridorId)}&direction=${direction}&window=6`,
    );
    if (state.departure.corridorId !== corridorId || state.departure.direction !== direction) return;
    state.departure.data = data;
    renderDeparture();
  } catch (err) {
    if (els.departureResult) {
      els.departureResult.innerHTML = `<div class="empty">Could not load departure advice.<br />${escapeHtml(err.message)}</div>`;
    }
  } finally {
    state.departure.loading = false;
  }
}

function renderDeparture() {
  const data = state.departure.data;
  if (!data || !els.departureResult) return;
  const nowLevel = levelFor(data.current.score);
  const bestLevel = levelFor(data.best.score);
  const savings = Math.round(data.savingsMin);
  const bestTime = formatTime(data.best.ts);
  const slots = data.series.filter((_, index) => index % 2 === 0).slice(0, 6);
  const advice =
    savings >= 2
      ? `Leaving at <b>${bestTime}</b> is about <b>${savings} min</b> faster than leaving now.`
      : 'Now is as good as it gets in the next 6 hours.';

  els.departureResult.innerHTML = `
    <div class="departure-compare">
      <div class="departure-side">
        <span>Leave now</span>
        <strong>${formatMin(data.current.etaMin)}</strong>
        <em style="color:${nowLevel.color}">${nowLevel.label} · ${data.current.score}</em>
      </div>
      <div class="departure-arrow" aria-hidden="true">→</div>
      <div class="departure-side best">
        <span>Best at ${bestTime}</span>
        <strong>${formatMin(data.best.etaMin)}</strong>
        <em style="color:${bestLevel.color}">${bestLevel.label} · ${data.best.score}</em>
      </div>
    </div>
    <p class="departure-advice">${advice}</p>
    <div class="departure-slots">
      ${slots
        .map(
          (slot) => `<div class="departure-slot ${slot.ts === data.best.ts ? 'is-best' : ''}">
            <b>${formatTime(slot.ts)}</b>${formatMin(slot.etaMin)}
          </div>`,
        )
        .join('')}
    </div>`;
}

// ------------------------------------------------------------------- charts
let chartSeq = 0;

function lineChart(hours, { height = 210, rain = true, compact = false } = {}) {
  if (!hours?.length) return '<div class="empty">No forecast available.</div>';
  const W = 620;
  const H = height;
  const padL = compact ? 6 : 26;
  const padR = 8;
  const padT = 10;
  const padB = rain ? 36 : 20;
  const rainH = rain ? 16 : 0;
  const innerH = H - padT - padB - rainH;
  const innerW = W - padL - padR;
  const last = Math.max(1, hours.length - 1);
  const x = (i) => padL + (i / last) * innerW;
  const y = (score) => padT + (1 - score / 100) * innerH;
  const color = levelFor(hours[0].score).color;
  const id = `chart${++chartSeq}`;
  const maxRain = Math.max(2, ...hours.map((h) => h.rainMmPerHour || 0));

  const line = hours.map((hour, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(hour.score).toFixed(1)}`).join(' ');
  const area = `${line} L${x(last).toFixed(1)},${(padT + innerH).toFixed(1)} L${x(0).toFixed(1)},${(padT + innerH).toFixed(1)} Z`;

  const grid = compact
    ? ''
    : [0, 25, 50, 75, 100]
        .map(
          (value) => `<line x1="${padL}" x2="${W - padR}" y1="${y(value).toFixed(1)}" y2="${y(value).toFixed(1)}"
            stroke="rgba(255,255,255,0.055)" stroke-width="1" ${value === 0 ? '' : 'stroke-dasharray="3 5"'} />
          <text x="${padL - 5}" y="${(y(value) + 2.5).toFixed(1)}" text-anchor="end" class="axis-label">${value}</text>`,
        )
        .join('');

  const rainBars = rain
    ? hours
        .map((hour, i) => {
          const barHeight = Math.max(0.6, ((hour.rainMmPerHour || 0) / maxRain) * rainH);
          const opacity = hour.rainMmPerHour > 0.05 ? 0.65 : 0.16;
          return `<rect x="${(x(i) - 5).toFixed(1)}" y="${(H - padB + 4 + (rainH - barHeight)).toFixed(1)}" width="10" height="${barHeight.toFixed(1)}" rx="2" fill="rgba(56,189,248,${opacity})">
            <title>${formatTime(hour.ts)} — ${hour.rainMmPerHour} mm/h</title>
          </rect>`;
        })
        .join('')
    : '';

  const labelEvery = compact ? 5 : 4;
  const xLabels = hours
    .map((hour, i) => {
      if (i % labelEvery !== 0 && i !== last) return '';
      return `<text x="${x(i).toFixed(1)}" y="${H - 5}" text-anchor="${i === 0 ? 'start' : i === last ? 'end' : 'middle'}" class="axis-label ${i === 0 ? 'now' : ''}">${i === 0 ? 'Now' : formatTime(hour.ts)}</text>`;
    })
    .join('');

  const dots = hours
    .map(
      (hour, i) => `<circle cx="${x(i).toFixed(1)}" cy="${y(hour.score).toFixed(1)}" r="${i === 0 ? 3.4 : compact ? 1.4 : 2.2}"
        fill="${i === 0 ? levelFor(hour.score).color : '#0b141a'}" stroke="${levelFor(hour.score).color}" stroke-width="${i === 0 ? 2 : 1.2}">
        <title>${formatTime(hour.ts)} — ${levelFor(hour.score).label} (${hour.score}/100)${hour.rainMmPerHour > 0.05 ? `, rain ${hour.rainMmPerHour} mm/h` : ''}</title>
      </circle>`,
    )
    .join('');

  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Jam score forecast for the next ${hours.length} hours" preserveAspectRatio="xMidYMid meet">
    <defs>
      <linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="${color}" stop-opacity="0.28" />
        <stop offset="100%" stop-color="${color}" stop-opacity="0.01" />
      </linearGradient>
    </defs>
    ${grid}
    <path d="${area}" fill="url(#${id})" />
    <path d="${line}" fill="none" stroke="${color}" stroke-width="${compact ? 2 : 2.6}" stroke-linecap="round" stroke-linejoin="round" />
    <line x1="${x(0).toFixed(1)}" x2="${x(0).toFixed(1)}" y1="${padT}" y2="${(H - padB).toFixed(1)}" stroke="rgba(34,197,94,0.35)" stroke-width="1" stroke-dasharray="3 4" />
    ${rainBars}
    ${dots}
    ${xLabels}
  </svg>`;
}

// ------------------------------------------------------------------ reports
function renderReports() {
  if (!els.reportsList) return;
  const now = Date.now();
  const active = state.reports.filter((report) => (report.expiresAt ?? Infinity) > now);
  if (els.reportCount) {
    els.reportCount.textContent = active.length;
    els.reportCount.classList.toggle('has-items', active.length > 0);
  }

  if (!active.length) {
    els.reportsList.innerHTML = `<div class="empty"><strong>No reports right now</strong>Spotted something? Add the first report and help other drivers.</div>`;
    return;
  }

  const types = new Map(reportTypes().map((type) => [type.key, type]));
  els.reportsList.innerHTML = active
    .map((report) => {
      const type = types.get(report.type) || { label: report.type, icon: '⚠️' };
      const severityLabel = report.severity >= 3 ? 'Severe' : report.severity <= 1 ? 'Light' : 'Moderate';
      const confirmed = state.confirmed.has(report.id);
      return `<article class="report-card">
        <div class="report-icon" aria-hidden="true">${type.icon}</div>
        <div class="report-body">
          <div class="report-title">${escapeHtml(type.label)}
            <span class="report-sev sev-${report.severity}">${severityLabel}</span>
          </div>
          <div class="report-meta">${escapeHtml(report.corridorName)} · ${formatAgo(report.createdAt)}</div>
          ${report.note ? `<p class="report-note">${escapeHtml(report.note)}</p>` : ''}
        </div>
        <button class="report-confirm" data-confirm="${report.id}" ${confirmed ? 'disabled' : ''} aria-label="Confirm this report">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12 5 5L20 7"/></svg>
          ${report.confirmations || 0}
        </button>
      </article>`;
    })
    .join('');
}

function openReport(corridorId = null) {
  if (!els.modal) return;
  state.reportType = 'jam';
  state.severity = 2;
  els.reportNote.value = '';
  els.reportError.classList.add('is-hidden');
  els.reportSubmit.disabled = false;
  els.reportSubmit.textContent = 'Send report';

  els.typeGrid.innerHTML = reportTypes()
    .map(
      (type) => `<button type="button" class="type-chip ${type.key === 'jam' ? 'is-active' : ''}" data-type="${type.key}" role="radio" aria-checked="${type.key === 'jam'}">
        <span aria-hidden="true">${type.icon}</span>${escapeHtml(type.label)}
      </button>`,
    )
    .join('');

  const sorted = [...state.corridors].sort((a, b) => a.name.localeCompare(b.name));
  const preferred =
    corridorId ||
    state.selectedId ||
    state.city?.worst?.[0]?.id ||
    sorted[0]?.id;
  els.reportCorridor.innerHTML = sorted
    .map((corridor) => `<option value="${corridor.id}" ${corridor.id === preferred ? 'selected' : ''}>${escapeHtml(corridor.name)}</option>`)
    .join('');

  $$('button', els.severitySeg).forEach((button) => {
    button.classList.toggle('is-active', Number(button.dataset.sev) === 2);
  });

  els.modal.classList.remove('is-hidden');
  setTimeout(() => els.typeGrid.querySelector('button')?.focus(), 40);
}

function closeReport() {
  els.modal?.classList.add('is-hidden');
}

async function submitReport(event) {
  event.preventDefault();
  const corridorId = els.reportCorridor.value;
  if (!corridorId) {
    showReportError('Choose a road first.');
    return;
  }
  els.reportSubmit.disabled = true;
  els.reportSubmit.textContent = 'Sending…';
  els.reportError.classList.add('is-hidden');
  try {
    await api('/api/reports', {
      method: 'POST',
      body: JSON.stringify({
        type: state.reportType,
        severity: state.severity,
        corridorId,
        note: els.reportNote.value.trim() || null,
      }),
    });
    closeReport();
    showToast('Asante! Your report is live.');
    await pollLive({ silent: true });
    setTab('reports');
  } catch (err) {
    showReportError(err.message);
    els.reportSubmit.disabled = false;
    els.reportSubmit.textContent = 'Send report';
  }
}

function showReportError(message) {
  els.reportError.textContent = message;
  els.reportError.classList.remove('is-hidden');
}

// ---------------------------------------------------------------------- map
function addCorridorLayers() {
  if (!state.map) return;
  for (const corridor of state.corridors) {
    const geometry = state.geometry.get(corridor.id);
    if (!geometry?.length) continue;
    const color = corridor.level.color;
    const glow = L.polyline(geometry, {
      color,
      weight: 15,
      opacity: 0.14,
      lineCap: 'round',
      lineJoin: 'round',
      interactive: false,
    }).addTo(state.map);
    const line = L.polyline(geometry, {
      color,
      weight: 7,
      opacity: 0.92,
      lineCap: 'round',
      lineJoin: 'round',
    }).addTo(state.map);
    line.on('click', (event) => {
      L.DomEvent.stopPropagation(event);
      selectCorridor(corridor.id);
    });
    line.on('mouseover', () => {
      if (state.selectedId !== corridor.id) line.setStyle({ weight: 9, opacity: 1 });
    });
    line.on('mouseout', () => {
      if (state.selectedId !== corridor.id) line.setStyle({ weight: 7, opacity: 0.92 });
    });
    line.bindTooltip(`${escapeHtml(corridor.name)} · ${corridor.level.label}`, {
      sticky: true,
      direction: 'top',
      opacity: 0.92,
    });
    state.layers.set(corridor.id, { line, glow });
  }
}

function updateMapStyles() {
  if (!state.map) return;
  for (const corridor of state.corridors) {
    const layer = state.layers.get(corridor.id);
    if (!layer) continue;
    const color = corridor.level.color;
    const selected = state.selectedId === corridor.id;
    const dimmed = state.selectedId && !selected;
    layer.line.setStyle({
      color,
      weight: selected ? 9 : 7,
      opacity: dimmed ? 0.32 : 0.94,
    });
    layer.glow.setStyle({
      color,
      weight: selected ? 22 : 15,
      opacity: dimmed ? 0.035 : selected ? 0.3 : 0.14,
    });
  }
}

function renderMapReports() {
  if (!state.map || !state.reportLayer) return;
  state.reportLayer.clearLayers();
  const now = Date.now();
  const types = new Map(reportTypes().map((type) => [type.key, type]));
  for (const report of state.reports) {
    if ((report.expiresAt ?? 0) <= now || report.lat == null || report.lng == null) continue;
    const type = types.get(report.type) || { icon: '⚠️', label: report.type };
    const marker = L.marker([report.lat, report.lng], {
      icon: L.divIcon({
        className: 'report-marker',
        html: `<div class="report-pin"><span>${type.icon}</span></div>`,
        iconSize: [28, 28],
        iconAnchor: [14, 28],
      }),
      keyboard: true,
      title: `${type.label} on ${report.corridorName}`,
    });
    marker.bindPopup(
      `<b>${escapeHtml(type.label)}</b> · ${escapeHtml(report.corridorName)}<br />${formatAgo(report.createdAt)}${report.note ? `<br />${escapeHtml(report.note)}` : ''}`,
    );
    state.reportLayer.addLayer(marker);
  }
}

function locateUser() {
  const nativeGeo = window.Capacitor?.isNativePlatform?.()
    ? window.Capacitor.Plugins?.Geolocation
    : null;
  if (!nativeGeo && !navigator.geolocation) {
    showToast('Location is not available on this device.', 'error');
    return;
  }
  els.locateBtn.classList.add('is-locating');
  const options = { enableHighAccuracy: true, timeout: 9000, maximumAge: 60000 };

  const onSuccess = (position) => {
    els.locateBtn.classList.remove('is-locating');
    const { latitude, longitude } = position.coords;
    if (state.userMarker) state.userMarker.remove();
    state.userMarker = L.marker([latitude, longitude], {
      icon: L.divIcon({ className: 'user-dot', html: '<span></span>', iconSize: [14, 14], iconAnchor: [7, 7] }),
      interactive: false,
    }).addTo(state.map);

    let best = null;
    let bestDistance = Infinity;
    for (const corridor of state.corridors) {
      for (const point of state.geometry.get(corridor.id) || []) {
        const distance = haversineKm([latitude, longitude], point);
        if (distance < bestDistance) {
          bestDistance = distance;
          best = corridor;
        }
      }
    }
    state.map.flyTo([latitude, longitude], 14, { duration: 0.7 });
    if (best) {
      setTimeout(() => selectCorridor(best.id, { fly: false }), 350);
      showToast(`You're near ${best.name} (${bestDistance < 1 ? `${Math.round(bestDistance * 1000)} m` : `${bestDistance.toFixed(1)} km`}).`);
    } else {
      showToast('Location found, but no corridor is nearby.');
    }
  };

  const onError = (error) => {
    els.locateBtn.classList.remove('is-locating');
    const denied = error?.code === 1 || /denied|permission/i.test(error?.message || '');
    showToast(denied ? 'Location permission was denied.' : 'Could not get your location.', 'error');
  };

  if (nativeGeo) {
    nativeGeo.getCurrentPosition(options).then(onSuccess).catch(onError);
  } else {
    navigator.geolocation.getCurrentPosition(onSuccess, onError, options);
  }
}

function haversineKm(a, b) {
  const R = 6371;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b[0] - a[0]);
  const dLng = toRad(b[1] - a[1]);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a[0])) * Math.cos(toRad(b[0])) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}
