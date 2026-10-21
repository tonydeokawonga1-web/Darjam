/**
 * DarJam traffic model.
 *
 * There is no free, key-less live speed feed for Dar es Salaam, so the engine
 * estimates congestion from four transparent inputs:
 *
 *   1. Road demand   - a weekday/weekend time-of-day curve per corridor.
 *   2. Direction     - morning inbound / evening outbound peaks.
 *   3. Weather       - live rain from Open-Meteo (rain slows Dar badly).
 *   4. Community     - recent incident reports near each segment.
 *
 * The result is calibrated with a BPR-style speed/flow curve and exposed as a
 * 0-100 jam score. Everything is pure and time-injectable so it can be tested.
 */

export const CBD = { lat: -6.81463, lng: 39.28799 };
export const DAR_OFFSET_MS = 3 * 60 * 60 * 1000; // Africa/Dar_es_Salaam, no DST

export const LEVELS = [
  { key: 'free', min: 0, label: 'Free flow', swahili: 'Wazi', color: '#22c55e' },
  { key: 'light', min: 25, label: 'Light', swahili: 'Kidogo', color: '#a3e635' },
  { key: 'moderate', min: 45, label: 'Moderate', swahili: 'Kati', color: '#f59e0b' },
  { key: 'heavy', min: 65, label: 'Heavy', swahili: 'Kubwa', color: '#f97316' },
  { key: 'gridlock', min: 85, label: 'Gridlock', swahili: 'Mzito', color: '#ef4444' },
];

export const REPORT_TYPES = {
  jam: { label: 'Jam', icon: '🚗', weight: 0.16, ttlMin: 75 },
  accident: { label: 'Accident', icon: '💥', weight: 0.24, ttlMin: 105 },
  police: { label: 'Police check', icon: '👮', weight: 0.07, ttlMin: 55 },
  roadworks: { label: 'Roadworks', icon: '🚧', weight: 0.12, ttlMin: 480 },
  flood: { label: 'Flooding', icon: '🌊', weight: 0.3, ttlMin: 150 },
  closure: { label: 'Road closed', icon: '⛔', weight: 0.45, ttlMin: 360 },
};

const BPR_ALPHA = 1.9;
const BPR_BETA = 3;
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
const round = (n, d = 0) => {
  const f = 10 ** d;
  return Math.round(n * f) / f;
};

export function levelFor(score) {
  let out = LEVELS[0];
  for (const level of LEVELS) if (score >= level.min) out = level;
  return out;
}

export function haversineKm(a, b) {
  const R = 6371;
  const toRad = (d) => (d * Math.PI) / 180;
  const lat1 = Array.isArray(a) ? a[0] : a.lat;
  const lng1 = Array.isArray(a) ? a[1] : a.lng;
  const lat2 = Array.isArray(b) ? b[0] : b.lat;
  const lng2 = Array.isArray(b) ? b[1] : b.lng;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

/** Local Dar es Salaam clock parts for a timestamp. */
export function darParts(ts = Date.now()) {
  const d = new Date(ts + DAR_OFFSET_MS);
  return {
    hour: d.getUTCHours() + d.getUTCMinutes() / 60,
    dow: d.getUTCDay(),
    minutes: d.getUTCHours() * 60 + d.getUTCMinutes(),
    dateKey: d.toISOString().slice(0, 10),
  };
}

const bell = (x, center, width) => Math.exp(-(((x - center) / width) ** 2));

/** Relative travel demand over the day (0.2 quiet night ... ~1.2 peaks). */
export function demandProfile(hour, dow) {
  const weekend = dow === 0 || dow === 6;
  if (weekend) {
    return (
      0.26 +
      0.36 * bell(hour, 11.2, 2.7) +
      0.44 * bell(hour, 18.1, 2.8) +
      0.16 * bell(hour, 7.6, 1.5)
    );
  }
  let f = 0.34 + 0.8 * bell(hour, 7.7, 1.55) + 0.88 * bell(hour, 17.9, 1.85) + 0.48 * bell(hour, 12.8, 3.4);
  if (dow === 5) f += 0.09 * bell(hour, 18.6, 2.2); // Friday evenings are heavier
  return f;
}

export function peakStage(hour, dow) {
  const weekend = dow === 0 || dow === 6;
  if (weekend) {
    if (hour >= 10 && hour < 20) return { key: 'weekend', label: 'Weekend daytime' };
    return { key: 'off', label: 'Quiet hours' };
  }
  if (hour >= 5.5 && hour < 10.5) return { key: 'morning', label: 'Morning rush' };
  if (hour >= 14.5 && hour < 20.5) return { key: 'evening', label: 'Evening rush' };
  return { key: 'off', label: 'Between peaks' };
}

function directionalFactor(hour, dow, direction, bias) {
  const weekend = dow === 0 || dow === 6;
  let target;
  if (weekend) {
    target = hour >= 9 && hour < 20 ? 0.9 : 0.6;
  } else if (hour >= 5.5 && hour < 10.5) {
    target = direction === 'inbound' ? 1 : 0.38;
  } else if (hour >= 14.5 && hour < 20.5) {
    target = direction === 'inbound' ? 0.45 : 1;
  } else if (hour >= 10.5 && hour < 14.5) {
    target = direction === 'inbound' ? 0.72 : 0.78;
  } else {
    target = 0.3;
  }
  return 1 - bias + bias * target;
}

function weatherFactors(weather) {
  const rain = Math.max(0, weather?.rainMmPerHour ?? 0);
  const prob = Math.max(0, weather?.precipitationProbability ?? 0);
  return {
    demand: 1 + Math.min(0.5, rain * 0.16) + (rain < 0.05 && prob >= 70 ? 0.06 : 0),
    speed: 1 - Math.min(0.2, rain * 0.045),
  };
}

function reportsNear(segment, corridorId, reports, now) {
  let boost = 0;
  let count = 0;
  let worstType = null;
  for (const report of reports) {
    if (report.expiresAt && report.expiresAt <= now) continue;
    const meta = REPORT_TYPES[report.type];
    if (!meta) continue;

    let proximity;
    if (report.corridorId === corridorId) {
      if (report.lat != null && report.lng != null && segment.midpoint) {
        const km = haversineKm(segment.midpoint, [report.lat, report.lng]);
        if (km > 0.9) continue;
        proximity = 1 - km / 0.9;
      } else {
        proximity = 1;
      }
    } else if (report.lat != null && report.lng != null && segment.midpoint) {
      const km = haversineKm(segment.midpoint, [report.lat, report.lng]);
      if (km > 0.5) continue;
      proximity = 1 - km / 0.5;
    } else {
      continue;
    }

    const ageMin = Math.max(0, (now - report.createdAt) / 60000);
    const decay = Math.max(0, 1 - ageMin / meta.ttlMin);
    if (decay <= 0) continue;
    const severity = clamp(Number(report.severity) || 1, 0.6, 1.4);
    const confirms = clamp(Number(report.confirmations) || 0, 0, 5);
    boost += meta.weight * severity * proximity * decay * (1 + confirms * 0.05);
    count += 1;
    if (!worstType || meta.weight > REPORT_TYPES[worstType].weight) worstType = report.type;
  }
  return { boost: Math.min(0.55, boost), count, worstType };
}

function forwardDirection(segment) {
  const first = segment.geometry[0];
  const last = segment.geometry[segment.geometry.length - 1];
  return haversineKm(last, CBD) >= haversineKm(first, CBD) ? 'outbound' : 'inbound';
}

/** State of one segment in one physical direction. */
export function segmentState(segment, corridor, direction, ctx) {
  const { now, reports, weather } = ctx;
  const { hour, dow } = darParts(now);
  const profile = demandProfile(hour, dow);
  const dirFactor = directionalFactor(hour, dow, direction, corridor.bias);
  const wf = weatherFactors(weather);
  const nearby = reportsNear(segment, corridor.id, reports, now);
  const vc = segment.baseLoad * profile * dirFactor * wf.demand * (1 + nearby.boost);
  const freeFlowKph = segment.freeFlowKph * wf.speed;
  const speedKph = freeFlowKph / (1 + BPR_ALPHA * vc ** BPR_BETA);
  const congestion = clamp(1 - speedKph / freeFlowKph, 0, 0.95);
  const score = clamp(Math.round(100 * congestion ** 0.75), 0, 100);
  const freeMin = (segment.lengthKm / segment.freeFlowKph) * 60;
  const etaMin = (segment.lengthKm / Math.max(3, speedKph)) * 60;
  const level = levelFor(score);
  return {
    id: segment.id,
    from: segment.from,
    to: segment.to,
    lengthKm: segment.lengthKm,
    freeFlowKph: round(segment.freeFlowKph),
    speedKph: round(speedKph),
    score,
    level,
    congestion: round(congestion, 3),
    vcRatio: round(vc, 2),
    etaMin: round(etaMin, 1),
    freeMin: round(freeMin, 1),
    delayMin: round(Math.max(0, etaMin - freeMin), 1),
    reports: nearby.count,
    reportType: nearby.worstType,
  };
}

function aggregate(segments, direction, label) {
  const totalLength = segments.reduce((n, s) => n + s.lengthKm, 0);
  const etaMin = segments.reduce((n, s) => n + s.etaMin, 0);
  const freeMin = segments.reduce((n, s) => n + s.freeMin, 0);
  const weightSum = segments.reduce((n, s) => n + s.lengthKm * 1, 0) || 1;
  const score = Math.round(segments.reduce((n, s) => n + s.score * s.lengthKm, 0) / weightSum);
  const speedKph = totalLength / (etaMin / 60);
  const level = levelFor(score);
  return {
    direction,
    label,
    score,
    level,
    speedKph: round(speedKph),
    etaMin: round(etaMin),
    freeMin: round(freeMin),
    delayMin: round(Math.max(0, etaMin - freeMin)),
    lengthKm: round(totalLength, 1),
    segments,
  };
}

/**
 * Full corridor state, both directions.
 * `direction` on each result is the physical direction of travel.
 */
export function corridorState(corridor, ctx) {
  const fwd = forwardDirection(corridor.segments[0]);
  const reverse = fwd === 'outbound' ? 'inbound' : 'outbound';
  const radial = corridor.bias >= 0.6;

  const build = (physicalDirection, forward) => {
    const segs = forward ? corridor.segments : [...corridor.segments].reverse();
    const states = segs.map((segment) => {
      const st = segmentState(segment, corridor, physicalDirection, ctx);
      return forward ? st : { ...st, from: st.to, to: st.from };
    });
    let label;
    if (radial) {
      label =
        physicalDirection === 'inbound'
          ? 'Towards city centre'
          : 'Out of the city centre';
    } else {
      label = forward ? `${corridor.from} → ${corridor.to}` : `${corridor.to} → ${corridor.from}`;
    }
    return aggregate(states, physicalDirection, label);
  };

  const outbound = build('outbound', fwd === 'outbound');
  const inbound = build('inbound', fwd === 'inbound');
  const busier = outbound.score >= inbound.score ? outbound : inbound;

  return {
    id: corridor.id,
    name: corridor.name,
    swahili: corridor.swahili,
    from: corridor.from,
    to: corridor.to,
    description: corridor.description,
    bias: corridor.bias,
    radial,
    lengthKm: round(corridor.segments.reduce((n, s) => n + s.lengthKm, 0), 1),
    score: busier.score,
    level: busier.level,
    speedKph: busier.speedKph,
    etaMin: busier.etaMin,
    freeMin: busier.freeMin,
    delayMin: busier.delayMin,
    busiestDirection: busier.direction,
    directions: { inbound, outbound },
  };
}

export function cityState(corridors, ctx) {
  const { now, reports, weather } = ctx;
  const { hour, dow } = darParts(now);
  const profile = demandProfile(hour, dow);
  const stage = peakStage(hour, dow);

  let weightSum = 0;
  let scoreSum = 0;
  let freeMin = 0;
  let etaMin = 0;
  let lengthKm = 0;
  let delayMin = 0;
  const worst = [];

  for (const corridor of corridors) {
    const state = corridorState(corridor, ctx);
    worst.push({ id: state.id, name: state.name, score: state.score, level: state.level, delayMin: state.delayMin });
    for (const direction of ['inbound', 'outbound']) {
      for (const segment of state.directions[direction].segments) {
        const weight = segment.lengthKm * (corridor.segments.find((s) => s.id === segment.id)?.baseLoad ?? 1);
        weightSum += weight;
        scoreSum += segment.score * weight;
        if (direction === state.busiestDirection) {
          freeMin += segment.freeMin;
          etaMin += segment.etaMin;
          lengthKm += segment.lengthKm;
          delayMin += segment.delayMin;
        }
      }
    }
  }

  const score = clamp(Math.round(scoreSum / (weightSum || 1)), 0, 100);
  const level = levelFor(score);
  const avgSpeed = lengthKm > 0 && etaMin > 0 ? (lengthKm / etaMin) * 60 : 0;

  // Trend against one hour ago.
  const past = cityStateScore(corridors, { ...ctx, now: now - 60 * 60 * 1000 });
  const trendDelta = score - past;
  const trend =
    Math.abs(trendDelta) < 3 ? 'steady' : trendDelta > 0 ? 'rising' : 'easing';

  worst.sort((a, b) => b.score - a.score);
  const activeReports = reports.filter((r) => (r.expiresAt ?? Infinity) > now).length;

  return {
    score,
    level,
    speedKph: round(avgSpeed),
    delayMin: round(delayMin),
    lengthKm: round(lengthKm, 1),
    etaMin: round(etaMin),
    freeMin: round(freeMin),
    trend,
    trendDelta,
    stage,
    profile: round(profile, 2),
    activeReports,
    weather: {
      rainMmPerHour: round(weather?.rainMmPerHour ?? 0, 1),
      precipitationProbability: Math.round(weather?.precipitationProbability ?? 0),
      temperatureC: weather?.temperatureC != null ? round(weather.temperatureC, 1) : null,
      available: Boolean(weather?.available),
      source: weather?.source ?? 'unavailable',
    },
    worst: worst.slice(0, 4),
  };
}

function cityStateScore(corridors, ctx) {
  let weightSum = 0;
  let scoreSum = 0;
  for (const corridor of corridors) {
    const state = corridorState(corridor, ctx);
    for (const direction of ['inbound', 'outbound']) {
      for (const segment of state.directions[direction].segments) {
        const weight = segment.lengthKm * (corridor.segments.find((s) => s.id === segment.id)?.baseLoad ?? 1);
        weightSum += weight;
        scoreSum += segment.score * weight;
      }
    }
  }
  return Math.round(scoreSum / (weightSum || 1));
}

/** Hourly rain from the weather payload, falling back to current conditions. */
export function rainAt(weather, ts) {
  const hourly = weather?.hourly;
  if (Array.isArray(hourly) && hourly.length) {
    let best = null;
    let bestDiff = Infinity;
    for (const h of hourly) {
      const diff = Math.abs(h.ts - ts);
      if (diff < bestDiff) {
        bestDiff = diff;
        best = h;
      }
    }
    if (best && bestDiff <= 45 * 60 * 1000) {
      return { rainMmPerHour: best.rain ?? 0, precipitationProbability: best.prob ?? 0 };
    }
  }
  return {
    rainMmPerHour: weather?.rainMmPerHour ?? 0,
    precipitationProbability: weather?.precipitationProbability ?? 0,
  };
}

export function buildForecast({ corridors, reports, weather, now, hours = 24, corridorId = null, direction = null }) {
  const start = Math.floor(now / 3_600_000) * 3_600_000;
  const out = [];
  for (let i = 0; i < hours; i += 1) {
    const ts = start + i * 3_600_000;
    const rain = rainAt(weather, ts);
    const ctx = {
      now: ts,
      reports,
      weather: {
        ...rain,
        temperatureC: weather?.temperatureC ?? null,
        available: weather?.available ?? false,
        source: weather?.source ?? 'unavailable',
      },
    };
    if (corridorId) {
      const corridor = corridors.find((c) => c.id === corridorId);
      if (!corridor) throw new Error(`Unknown corridor: ${corridorId}`);
      const state = corridorState(corridor, ctx);
      const chosen = direction ? state.directions[direction] : state.directions[state.busiestDirection];
      out.push({
        ts,
        score: chosen.score,
        level: chosen.level,
        etaMin: chosen.etaMin,
        rainMmPerHour: round(rain.rainMmPerHour, 1),
        precipitationProbability: Math.round(rain.precipitationProbability),
      });
    } else {
      const city = cityState(corridors, ctx);
      out.push({
        ts,
        score: city.score,
        level: city.level,
        etaMin: city.etaMin,
        rainMmPerHour: round(rain.rainMmPerHour, 1),
        precipitationProbability: Math.round(rain.precipitationProbability),
      });
    }
  }
  return out;
}

/** Best 30-minute departure slot for one corridor + direction over the next N hours. */
export function departureAdvice({ corridor, direction, reports, weather, now, windowHours = 6 }) {
  const dir = direction || 'outbound';
  const series = [];
  const start = Math.ceil(now / (30 * 60_000)) * 30 * 60_000;
  const steps = Math.max(1, Math.floor((windowHours * 60) / 30));
  for (let i = 0; i < steps; i += 1) {
    const ts = start + i * 30 * 60_000;
    const rain = rainAt(weather, ts);
    const ctx = {
      now: ts,
      reports,
      weather: {
        ...rain,
        temperatureC: weather?.temperatureC ?? null,
        available: weather?.available ?? false,
        source: weather?.source ?? 'unavailable',
      },
    };
    const state = corridorState(corridor, ctx).directions[dir];
    series.push({
      ts,
      etaMin: state.etaMin,
      score: state.score,
      level: state.level,
      rainMmPerHour: round(rain.rainMmPerHour, 1),
    });
  }
  const best = series.reduce((a, b) => (b.etaMin < a.etaMin ? b : a), series[0]);
  const nowCtx = {
    now,
    reports,
    weather,
  };
  const current = corridorState(corridor, nowCtx).directions[dir];
  return {
    direction: dir,
    current: {
      ts: now,
      etaMin: current.etaMin,
      score: current.score,
      level: current.level,
    },
    best,
    savingsMin: round(Math.max(0, current.etaMin - best.etaMin)),
    series,
  };
}

export function explain(corridorStateValue, ctx) {
  const { now, reports, weather } = ctx;
  const { hour, dow } = darParts(now);
  const stage = peakStage(hour, dow);
  const dir = corridorStateValue.busiestDirection;
  const nearby = reports.filter((r) => {
    if ((r.expiresAt ?? Infinity) <= now) return false;
    if (r.corridorId === corridorStateValue.id) return true;
    return false;
  });
  return {
    stage,
    rainMmPerHour: round(weather?.rainMmPerHour ?? 0, 1),
    precipitationProbability: Math.round(weather?.precipitationProbability ?? 0),
    reports: nearby.length,
    busiestDirection: dir,
    directionLabel: corridorStateValue.directions[dir].label,
    rush: stage.key === 'morning' || stage.key === 'evening',
  };
}
