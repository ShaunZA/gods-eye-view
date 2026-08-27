// src/data/aurora.test.mjs
// Focused tests for the pure OVATION helpers — no viewer/DOM/network needed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as Cesium from 'cesium';
import {
  AURORA_MAX_POINTS,
  AURORA_MIN_PROBABILITY,
  auroraStyle,
  createAuroraLayer,
  normalizeLongitude,
  parseOvation,
  selectAuroraCohort,
} from './aurora.js';
import auroraLayer from './aurora.js';
import { DataLayerManager } from './manager.js';
import { LAYER_STATE_REGISTRY } from './layerState.js';

void Cesium; // parity with sibling tests; the module imports Cesium at load

test('normalizeLongitude wraps OVATION 0..359 into [-180, 180)', () => {
  assert.equal(normalizeLongitude(0), 0);
  assert.equal(normalizeLongitude(179), 179);
  assert.equal(normalizeLongitude(180), -180);
  assert.equal(normalizeLongitude(359), -1);
  assert.equal(normalizeLongitude(360), 0);
});

test('normalizeLongitude is defensive against junk', () => {
  assert.equal(normalizeLongitude(NaN), 0);
  assert.equal(normalizeLongitude('abc'), 0);
});

test('auroraStyle ramps green -> amber -> red with rising probability', () => {
  const low = auroraStyle(5);
  const high = auroraStyle(90);
  // Faint green at the bottom of the ramp.
  assert.deepEqual({ r: low.r, g: low.g, b: low.b }, { r: 56, g: 255, b: 140 });
  // Intense end is red-dominant.
  assert.equal(high.r, 255);
  assert.ok(high.g < 120, `expected reddish green channel, got ${high.g}`);
  // Stronger aurora is both more opaque and larger.
  assert.ok(high.alpha > low.alpha);
  assert.ok(high.pixelSize > low.pixelSize);
});

test('auroraStyle clamps out-of-range probabilities', () => {
  assert.deepEqual(auroraStyle(-10), auroraStyle(0));
  assert.deepEqual(auroraStyle(999), auroraStyle(100));
  // Bad input degrades to the zero style, never NaN.
  const junk = auroraStyle('nope');
  assert.ok(Number.isFinite(junk.alpha) && Number.isFinite(junk.pixelSize));
});

test('parseOvation extracts fields and rejects malformed bodies', () => {
  const ok = parseOvation({
    'Observation Time': '2026-08-27T15:39:00Z',
    'Forecast Time': '2026-08-27T17:25:00Z',
    coordinates: [[0, 90, 3]],
  });
  assert.equal(ok.observationTime, '2026-08-27T15:39:00Z');
  assert.equal(ok.forecastTime, '2026-08-27T17:25:00Z');
  assert.equal(ok.coordinates.length, 1);

  assert.equal(parseOvation(null), null);
  assert.equal(parseOvation({}), null);
  assert.equal(parseOvation({ coordinates: 'nope' }), null);
  // Missing timestamps degrade to null, not undefined.
  const noTimes = parseOvation({ coordinates: [] });
  assert.equal(noTimes.observationTime, null);
  assert.equal(noTimes.forecastTime, null);
});

test('selectAuroraCohort filters below threshold and normalizes longitude', () => {
  const grid = [
    [10, 70, 2], // below default threshold (5) -> dropped
    [359, 75, 8], // kept, lon normalized to -1
    [20, -65, 40],
  ];
  const cohort = selectAuroraCohort(grid);
  assert.equal(cohort.length, 2);
  // Strongest first.
  assert.equal(cohort[0].probability, 40);
  const wrapped = cohort.find((c) => c.probability === 8);
  assert.equal(wrapped.lon, -1);
});

test('selectAuroraCohort honors threshold + limit and drops junk rows', () => {
  const grid = [
    [0, 80, 90],
    [1, 81, 70],
    [2, 82, 60],
    [3, 83, 50],
    ['x', 84, 99], // bad lon -> dropped
    [5, 85], // too short -> dropped
    null, // junk -> dropped
  ];
  const cohort = selectAuroraCohort(grid, { threshold: 55, limit: 2 });
  assert.equal(cohort.length, 2); // 90 and 70 clear threshold; capped at 2
  assert.deepEqual(cohort.map((c) => c.probability), [90, 70]);
});

test('selectAuroraCohort returns [] for empty/invalid input', () => {
  assert.deepEqual(selectAuroraCohort(null), []);
  assert.deepEqual(selectAuroraCohort([], { limit: 0 }), []);
  assert.deepEqual(selectAuroraCohort([[0, 90, 50]], { limit: 0 }), []);
});

test('layer exposes the manager contract and clean initial stats', () => {
  const layer = createAuroraLayer();
  assert.equal(layer.id, 'aurora');
  assert.equal(typeof layer.name, 'string');
  assert.equal(typeof layer.icon, 'string');
  assert.equal(typeof layer.updateInterval, 'number');
  for (const method of ['init', 'enable', 'disable', 'update', 'destroy', 'getStats']) {
    assert.equal(typeof layer[method], 'function', `missing ${method}()`);
  }
  const stats = layer.getStats();
  assert.equal(stats.count, 0);
  assert.equal(stats.lastUpdate, null);
  assert.equal(stats.error, null);
});

test('exported budget constants are sane defaults', () => {
  assert.ok(AURORA_MIN_PROBABILITY > 0 && AURORA_MIN_PROBABILITY < 100);
  assert.ok(AURORA_MAX_POINTS > 0);
});

// Regression: a registered layer MUST have a matching share-link registry entry,
// or DataLayerManager.finalizeRegistrations() throws at startup with
// "Layer serialization registry mismatch (missing: aurora; ...)".
test('aurora is declared in the share-link registry, matching the layer id', () => {
  const entry = LAYER_STATE_REGISTRY.find((e) => e.id === 'aurora');
  assert.ok(entry, 'aurora missing from LAYER_STATE_REGISTRY');
  assert.equal(entry.id, auroraLayer.id);
  assert.equal(entry.disposition, 'enabled-only'); // no persisted options
  assert.match(entry.token, /^[a-z0-9]$/); // single-char, registry-validated
});

test('registering aurora finalizes cleanly against its registry entry', () => {
  const manager = new DataLayerManager({}, {}); // stub viewer; ctor touches none of it
  manager.register(auroraLayer);
  const auroraEntry = LAYER_STATE_REGISTRY.find((e) => e.id === 'aurora');
  // This is the exact call that failed at launch before the registry entry existed.
  assert.doesNotThrow(() => manager.finalizeRegistrations([auroraEntry]));
});
