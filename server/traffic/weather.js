/**
 * Live Dar es Salaam weather from Open-Meteo.
 * Rain is the single biggest day-to-day multiplier on Dar traffic, so it is
 * fetched on a schedule and cached; the app still works if the API is down.
 *
 * COMPLIANCE: Open-Meteo's free tier is for non-commercial use. Before shipping
 * a paid or ad-supported build, either set OPEN_METEO_API_KEY (paid plan) or
 * set DARJAM_WEATHER=off to run on the dry baseline only.
 */
const BASE_URL = process.env.OPEN_METEO_BASE_URL || 'https://api.open-meteo.com/v1/forecast';
const API_KEY = process.env.OPEN_METEO_API_KEY || '';

function weatherUrl() {
  const params = new URLSearchParams({
    latitude: '-6.8036',
    longitude: '39.2534',
    current: 'temperature_2m,precipitation,rain,weather_code',
    hourly: 'precipitation,precipitation_probability',
    forecast_days: '2',
    timezone: 'Africa/Dar_es_Salaam',
  });
  if (API_KEY) params.set('apikey', API_KEY);
  return `${BASE_URL}?${params.toString()}`;
}

const CACHE_MS = 8 * 60 * 1000;
const FAIL_CACHE_MS = 90 * 1000;
const DAR_OFFSET_MS = 3 * 60 * 60 * 1000;

export const WEATHER_CODES = {
  0: 'Clear sky',
  1: 'Mainly clear',
  2: 'Partly cloudy',
  3: 'Overcast',
  45: 'Fog',
  48: 'Rime fog',
  51: 'Light drizzle',
  53: 'Drizzle',
  55: 'Heavy drizzle',
  61: 'Light rain',
  63: 'Rain',
  65: 'Heavy rain',
  66: 'Freezing rain',
  67: 'Heavy freezing rain',
  80: 'Light showers',
  81: 'Showers',
  82: 'Violent showers',
  95: 'Thunderstorm',
  96: 'Thunderstorm with hail',
  99: 'Severe thunderstorm',
};

let cache = { at: 0, data: null, ttl: CACHE_MS };
let inflight = null;

function parseLocal(iso) {
  // Open-Meteo returns local wall-clock time without an offset.
  return new Date(`${iso}:00+03:00`).getTime();
}

function fallback(reason) {
  return {
    available: false,
    source: 'fallback',
    reason,
    fetchedAt: Date.now(),
    temperatureC: null,
    rainMmPerHour: 0,
    precipitationProbability: 0,
    weatherCode: null,
    condition: 'Weather unavailable',
    isRaining: false,
    hourly: [],
  };
}

async function fetchWeather() {
  const res = await fetch(weatherUrl(), {
    signal: AbortSignal.timeout(6500),
    headers: { 'User-Agent': 'DarJam/1.0 (Dar es Salaam traffic app)' },
  });
  if (!res.ok) throw new Error(`Open-Meteo ${res.status}`);
  const json = await res.json();
  const current = json.current || {};
  const hourly = json.hourly || {};
  const times = hourly.time || [];
  const rain = hourly.precipitation || [];
  const prob = hourly.precipitation_probability || [];
  const hours = times.map((t, i) => ({
    ts: parseLocal(t),
    rain: Number(rain[i] ?? 0),
    prob: Number(prob[i] ?? 0),
  }));

  const nowLocal = new Date(Date.now() + DAR_OFFSET_MS).toISOString().slice(0, 13);
  let currentHour = hours.find((h) => {
    const iso = new Date(h.ts + DAR_OFFSET_MS).toISOString().slice(0, 13);
    return iso === nowLocal;
  });
  if (!currentHour) {
    currentHour = hours.reduce(
      (best, h) => (Math.abs(h.ts - Date.now()) < Math.abs(best.ts - Date.now()) ? h : best),
      hours[0] || { ts: Date.now(), rain: 0, prob: 0 },
    );
  }

  const rainNow = Number(current.precipitation ?? current.rain ?? currentHour.rain ?? 0);
  return {
    available: true,
    source: 'open-meteo',
    fetchedAt: Date.now(),
    temperatureC: current.temperature_2m != null ? Number(current.temperature_2m) : null,
    rainMmPerHour: Number.isFinite(rainNow) ? rainNow : 0,
    precipitationProbability: Math.round(Number(currentHour.prob ?? 0)),
    weatherCode: current.weather_code ?? null,
    condition: WEATHER_CODES[current.weather_code] || 'Dar es Salaam',
    isRaining: rainNow > 0.05,
    hourly: hours,
  };
}

export async function getWeather({ force = false } = {}) {
  if (process.env.DARJAM_OFFLINE === '1') return fallback('offline mode');
  if (process.env.DARJAM_WEATHER === 'off') return fallback('weather disabled');
  const now = Date.now();
  if (!force && cache.data && now - cache.at < cache.ttl) return cache.data;
  if (inflight) return inflight;

  inflight = (async () => {
    try {
      const data = await fetchWeather();
      cache = { at: Date.now(), data, ttl: CACHE_MS };
      return data;
    } catch (err) {
      const previous = cache.data;
      const data = previous
        ? { ...previous, available: false, source: 'cache', reason: err.message, fetchedAt: Date.now() }
        : fallback(err.message);
      cache = { at: Date.now(), data, ttl: FAIL_CACHE_MS };
      return data;
    } finally {
      inflight = null;
    }
  })();

  return inflight;
}

export function weatherMeta(weather) {
  return {
    available: Boolean(weather?.available),
    source: weather?.source || 'unavailable',
    condition: weather?.condition || 'Unknown',
    temperatureC: weather?.temperatureC ?? null,
    rainMmPerHour: weather?.rainMmPerHour ?? 0,
    precipitationProbability: weather?.precipitationProbability ?? 0,
    fetchedAt: weather?.fetchedAt ?? null,
  };
}
