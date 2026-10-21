import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  cityState,
  corridorState,
  departureAdvice,
  buildForecast,
  levelFor,
  darParts,
  demandProfile,
} from '../server/traffic/engine.js';

const dataset = JSON.parse(
  readFileSync(new URL('../server/data/corridors.json', import.meta.url), 'utf8'),
);
const corridors = dataset.corridors;

// 2026-10-20 is a Tuesday. Convert EAT wall-clock to UTC.
const eat = (day, hour, minute = 0) => Date.UTC(2026, 9, day, hour - 3, minute);

const dry = {
  available: true,
  rainMmPerHour: 0,
  precipitationProbability: 0,
  temperatureC: 29,
  condition: 'Clear sky',
  hourly: [],
};

const wet = {
  ...dry,
  rainMmPerHour: 4,
  precipitationProbability: 92,
  condition: 'Heavy rain',
};

const ctx = (now, weather = dry, reports = []) => ({ now, weather, reports });

test('level thresholds map scores to the five jam levels', () => {
  assert.equal(levelFor(0).key, 'free');
  assert.equal(levelFor(24).key, 'free');
  assert.equal(levelFor(25).key, 'light');
  assert.equal(levelFor(44).key, 'light');
  assert.equal(levelFor(45).key, 'moderate');
  assert.equal(levelFor(64).key, 'moderate');
  assert.equal(levelFor(65).key, 'heavy');
  assert.equal(levelFor(84).key, 'heavy');
  assert.equal(levelFor(85).key, 'gridlock');
  assert.equal(levelFor(100).key, 'gridlock');
});

test('Dar clock uses UTC+3', () => {
  const parts = darParts(eat(20, 7, 30));
  assert.equal(parts.hour, 7.5);
  assert.equal(parts.dow, 2);
});

test('demand peaks at rush hour and bottoms out at night', () => {
  const night = demandProfile(2, 2);
  const midday = demandProfile(12, 2);
  const morning = demandProfile(7.7, 2);
  const evening = demandProfile(17.9, 2);
  assert.ok(night < midday);
  assert.ok(midday < morning);
  assert.ok(midday < evening);
});

test('morning rush favours inbound traffic', () => {
  const corridor = corridors.find((c) => c.id === 'morogoro-road');
  const state = corridorState(corridor, ctx(eat(20, 7, 30)));
  assert.ok(state.directions.inbound.score > state.directions.outbound.score);
  assert.equal(state.busiestDirection, 'inbound');
});

test('evening rush favours outbound traffic', () => {
  const corridor = corridors.find((c) => c.id === 'morogoro-road');
  const state = corridorState(corridor, ctx(eat(20, 17, 45)));
  assert.ok(state.directions.outbound.score > state.directions.inbound.score);
  assert.equal(state.busiestDirection, 'outbound');
});

test('night traffic is freer than rush hour', () => {
  const corridor = corridors.find((c) => c.id === 'kilwa-road');
  const night = corridorState(corridor, ctx(eat(20, 2, 0)));
  const rush = corridorState(corridor, ctx(eat(20, 17, 45)));
  assert.ok(night.score < rush.score);
  assert.ok(night.score <= 20);
});

test('rain increases the jam score and delays', () => {
  const corridor = corridors.find((c) => c.id === 'nyerere-road');
  const now = eat(20, 8, 0);
  const dryState = corridorState(corridor, ctx(now, dry));
  const wetState = corridorState(corridor, ctx(now, wet));
  assert.ok(wetState.score > dryState.score);
  assert.ok(wetState.delayMin >= dryState.delayMin);
});

test('a nearby severe report raises the score', () => {
  const corridor = corridors.find((c) => c.id === 'morogoro-road');
  const now = eat(20, 7, 30);
  const segment = corridor.segments[2];
  const report = {
    id: 'r_test',
    type: 'accident',
    severity: 3,
    corridorId: corridor.id,
    lat: segment.midpoint[0],
    lng: segment.midpoint[1],
    createdAt: now - 5 * 60 * 1000,
    expiresAt: now + 60 * 60 * 1000,
    confirmations: 2,
  };
  const base = corridorState(corridor, ctx(now));
  const withReport = corridorState(corridor, ctx(now, dry, [report]));
  assert.ok(withReport.score > base.score);
});

test('expired reports are ignored', () => {
  const corridor = corridors.find((c) => c.id === 'morogoro-road');
  const now = eat(20, 7, 30);
  const segment = corridor.segments[2];
  const report = {
    id: 'r_old',
    type: 'closure',
    severity: 3,
    corridorId: corridor.id,
    lat: segment.midpoint[0],
    lng: segment.midpoint[1],
    createdAt: now - 8 * 60 * 60 * 1000,
    expiresAt: now - 60 * 1000,
  };
  const base = corridorState(corridor, ctx(now));
  const withOld = corridorState(corridor, ctx(now, dry, [report]));
  assert.equal(withOld.score, base.score);
});

test('city state is bounded and internally consistent', () => {
  const now = eat(20, 17, 30);
  const city = cityState(corridors, ctx(now));
  assert.ok(city.score >= 0 && city.score <= 100);
  assert.ok(city.speedKph > 0 && city.speedKph < 120);
  assert.ok(city.delayMin >= 0);
  assert.ok(city.worst.length > 0 && city.worst.length <= 4);
  assert.equal(city.level.key, levelFor(city.score).key);
  assert.ok(['rising', 'easing', 'steady'].includes(city.trend));
});

test('forecast returns one point per hour with rain', () => {
  const now = eat(20, 10, 20);
  const forecast = buildForecast({
    corridors,
    reports: [],
    weather: wet,
    now,
    hours: 24,
  });
  assert.equal(forecast.length, 24);
  for (let i = 1; i < forecast.length; i += 1) {
    assert.equal(forecast[i].ts - forecast[i - 1].ts, 3_600_000);
    assert.ok(forecast[i].score >= 0 && forecast[i].score <= 100);
  }
  assert.equal(forecast[0].rainMmPerHour, 4);
});

test('corridor forecast respects the requested direction', () => {
  const now = eat(20, 7, 30);
  const inbound = buildForecast({
    corridors,
    reports: [],
    weather: dry,
    now,
    hours: 3,
    corridorId: 'morogoro-road',
    direction: 'inbound',
  });
  const outbound = buildForecast({
    corridors,
    reports: [],
    weather: dry,
    now,
    hours: 3,
    corridorId: 'morogoro-road',
    direction: 'outbound',
  });
  assert.equal(inbound.length, 3);
  assert.ok(inbound[0].score > outbound[0].score);
});

test('departure advice finds a slot no slower than leaving now', () => {
  const corridor = corridors.find((c) => c.id === 'morogoro-road');
  const now = eat(20, 17, 5);
  const advice = departureAdvice({
    corridor,
    direction: 'outbound',
    reports: [],
    weather: dry,
    now,
    windowHours: 6,
  });
  assert.equal(advice.series.length, 12);
  assert.ok(advice.best.etaMin <= advice.current.etaMin + 0.01);
  assert.ok(advice.savingsMin >= 0);
});

test('corridor dataset is geometrically valid', () => {
  assert.ok(corridors.length >= 10);
  let segments = 0;
  for (const corridor of corridors) {
    assert.ok(corridor.segments.length >= 1);
    assert.ok(corridor.bias > 0 && corridor.bias <= 1);
    for (const segment of corridor.segments) {
      segments += 1;
      assert.ok(segment.lengthKm > 0.1);
      assert.ok(segment.freeFlowKph >= 20);
      assert.ok(segment.geometry.length >= 2);
      for (const [lat, lng] of segment.geometry) {
        assert.ok(lat >= -7.2 && lat <= -6.4, `lat out of range: ${lat}`);
        assert.ok(lng >= 38.9 && lng <= 39.6, `lng out of range: ${lng}`);
      }
    }
  }
  assert.ok(segments >= 25);
});
