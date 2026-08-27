import * as Cesium from 'cesium';

/**
 * Auroral oval — NOAA SWPC OVATION short-term aurora forecast.
 *
 * Renders the modeled probability of visible aurora as a glowing point field
 * hugging the high latitudes. The feed is a global grid of
 * `[longitude(0-359), latitude(-90..90), probability(0-100 %)]` triples,
 * refreshed by NOAA every few minutes.
 *
 * Design notes:
 *  - **Direct browser fetch, no dev-server proxy.** The endpoint returns
 *    `access-control-allow-origin: *`, so — like `earthquakes.js` fetching USGS
 *    — we hit it directly and never touch `vite.config.js`.
 *  - **Ground-clamped static points, no per-frame animation.** Real aurora sits
 *    ~100 km up, but a clamped translucent glow reads cleanly and avoids a
 *    floating-dot look and per-frame terrain work. Points are cheap primitives
 *    (Cesium batches them) and are rebuilt only on each poll, so — like the
 *    quake discs — this layer holds no continuous render; the manager's
 *    post-update tick covers the redraw.
 *  - **Thresholded + capped.** The 65k-point grid is filtered to the auroral
 *    bands (probability >= AURORA_MIN_PROBABILITY) and capped at
 *    AURORA_MAX_POINTS, keeping the strongest cells. Quiet nights draw a few
 *    thousand faint green points; a geomagnetic storm floods the cap with red.
 */

const API_URL = 'https://services.swpc.noaa.gov/json/ovation_aurora_latest.json';

/** Minimum modeled probability (%) worth drawing — below this is imperceptible. */
export const AURORA_MIN_PROBABILITY = 5;
/** Hard cap on rendered points; the strongest cells win the budget. */
export const AURORA_MAX_POINTS = 4000;

/**
 * Wrap any longitude into the [-180, 180) range Cesium expects.
 * OVATION reports 0..359; e.g. 359 -> -1, 180 -> -180, 0 -> 0.
 * @param {number} lon Longitude in degrees, any range.
 * @returns {number} Longitude in [-180, 180).
 */
export function normalizeLongitude(lon) {
  const value = Number(lon);
  if (!Number.isFinite(value)) return 0;
  return ((value + 180) % 360 + 360) % 360 - 180;
}

/**
 * Map an aurora probability (%) to a presentation style. Pure numbers only —
 * no Cesium types — so it is unit-testable and the render path converts.
 * Ramp: green (faint) -> amber (moderate) -> red (intense).
 * @param {number} probability 0-100.
 * @returns {{r:number,g:number,b:number,alpha:number,pixelSize:number}}
 *   r/g/b are 0-255 bytes; alpha 0-1; pixelSize in CSS px.
 */
export function auroraStyle(probability) {
  const p = Math.max(0, Math.min(100, Number(probability) || 0));
  let r;
  let g;
  let b;
  if (p <= 20) {
    r = 56; g = 255; b = 140; // classic auroral green
  } else if (p <= 50) {
    const t = (p - 20) / 30; // green -> amber
    r = Math.round(56 + (255 - 56) * t);
    g = Math.round(255 + (210 - 255) * t);
    b = Math.round(140 + (70 - 140) * t);
  } else {
    const t = (p - 50) / 50; // amber -> red
    r = 255;
    g = Math.round(210 + (60 - 210) * t);
    b = Math.round(70 + (90 - 70) * t);
  }
  const alpha = Math.round((0.22 + 0.63 * Math.min(1, p / 60)) * 1000) / 1000;
  const pixelSize = Math.round((4 + 11 * Math.min(1, p / 55)) * 100) / 100;
  return { r, g, b, alpha, pixelSize };
}

/**
 * Validate an OVATION response into the fields we use. Pure; returns null on
 * anything malformed rather than throwing.
 * @param {*} json Parsed JSON body.
 * @returns {{observationTime:string|null, forecastTime:string|null,
 *   coordinates:Array}|null}
 */
export function parseOvation(json) {
  if (!json || typeof json !== 'object') return null;
  if (!Array.isArray(json.coordinates)) return null;
  const str = (v) => (typeof v === 'string' && v.trim() ? v : null);
  return {
    observationTime: str(json['Observation Time']),
    forecastTime: str(json['Forecast Time']),
    coordinates: json.coordinates,
  };
}

/**
 * Filter the OVATION grid to drawable cells, normalize longitude, and keep the
 * strongest up to `limit`. Pure — no Cesium/network.
 * @param {Array<Array<number>>} coordinates OVATION `[lon, lat, prob]` triples.
 * @param {object} [opts]
 * @param {number} [opts.threshold=AURORA_MIN_PROBABILITY] Min probability (%).
 * @param {number} [opts.limit=AURORA_MAX_POINTS] Max points to keep.
 * @returns {Array<{lon:number, lat:number, probability:number}>}
 *   Sorted strongest-first; longitudes normalized to [-180, 180).
 */
export function selectAuroraCohort(
  coordinates,
  { threshold = AURORA_MIN_PROBABILITY, limit = AURORA_MAX_POINTS } = {},
) {
  if (!Array.isArray(coordinates)) return [];
  const cap = Math.max(0, Math.floor(Number(limit) || 0));
  if (cap === 0) return [];
  const thr = Number(threshold);
  const picked = [];
  for (const entry of coordinates) {
    if (!Array.isArray(entry) || entry.length < 3) continue;
    const lon = Number(entry[0]);
    const lat = Number(entry[1]);
    const probability = Number(entry[2]);
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;
    if (!Number.isFinite(probability) || probability < thr) continue;
    picked.push({ lon: normalizeLongitude(lon), lat, probability });
  }
  // Strongest first; lat/lon tie-breaks keep the cohort stable across polls.
  picked.sort((a, b) => (
    b.probability - a.probability || a.lat - b.lat || a.lon - b.lon
  ));
  return picked.slice(0, cap);
}

function isAbortError(error) {
  return error?.name === 'AbortError';
}

/**
 * Factory for the aurora data layer. Follows the same lifecycle contract the
 * DataLayerManager drives on every layer: init/enable/disable/update/destroy
 * plus getStats.
 * @param {object} [opts]
 * @param {number} [opts.threshold] Override the min drawn probability (%).
 * @param {number} [opts.limit] Override the rendered-point cap.
 * @returns {object} Layer module.
 */
export function createAuroraLayer({
  threshold = AURORA_MIN_PROBABILITY,
  limit = AURORA_MAX_POINTS,
} = {}) {
  let _dataSource = null;
  let _count = 0;
  let _maxProbability = 0;
  let _observationTime = null;
  let _forecastTime = null;
  let _lastUpdate = null;
  let _lastError = null;
  let _enabled = false;

  const layer = {
    id: 'aurora',
    name: 'Aurora (OVATION)',
    icon: '🌌',
    source: 'NOAA SWPC',
    updateInterval: 180000, // 3 min; feed refreshes every few minutes

    init(viewer) {
      _dataSource = new Cesium.CustomDataSource('aurora');
      _dataSource.show = false;
      viewer.dataSources.add(_dataSource);
      _count = 0;
      _maxProbability = 0;
      _observationTime = null;
      _forecastTime = null;
      _lastUpdate = null;
      _lastError = null;
      _enabled = false;
      console.log('[Data:Aurora] Initialized');
    },

    enable() {
      _enabled = true;
      // Static point field between polls — no continuous-render hold needed.
      if (_dataSource) _dataSource.show = true;
    },

    disable() {
      _enabled = false;
      if (_dataSource) _dataSource.show = false;
    },

    async update(viewer, { signal } = {}) {
      try {
        const response = await fetch(API_URL, signal ? { signal } : undefined);
        if (!response.ok) {
          _lastError = `SWPC HTTP ${response.status}`;
          console.warn(`[Data:Aurora] API returned ${response.status}`);
          return false;
        }

        const parsed = parseOvation(await response.json());
        if (!parsed) {
          _lastError = 'Malformed OVATION response';
          return false;
        }

        const cohort = selectAuroraCohort(parsed.coordinates, { threshold, limit });

        _dataSource.entities.removeAll();
        let maxProbability = 0;
        for (let i = 0; i < cohort.length; i++) {
          const { lon, lat, probability } = cohort[i];
          if (probability > maxProbability) maxProbability = probability;
          const style = auroraStyle(probability);
          _dataSource.entities.add({
            id: `aurora:${i}`,
            position: Cesium.Cartesian3.fromDegrees(lon, lat),
            point: {
              pixelSize: style.pixelSize,
              color: Cesium.Color.fromBytes(
                style.r, style.g, style.b, Math.round(style.alpha * 255),
              ),
              heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
              // Shrink/fade with distance so the night side isn't a wall of dots.
              scaleByDistance: new Cesium.NearFarScalar(2.0e6, 1.3, 2.0e7, 0.5),
              translucencyByDistance: new Cesium.NearFarScalar(2.0e6, 1.0, 2.5e7, 0.35),
            },
            properties: { probability },
          });
        }

        _count = cohort.length;
        _maxProbability = maxProbability;
        _observationTime = parsed.observationTime;
        _forecastTime = parsed.forecastTime;
        _lastUpdate = Date.now();
        _lastError = null;
        console.log(
          `[Data:Aurora] Updated: ${_count} cells (max ${_maxProbability}% prob)`,
        );
        return true;
      } catch (e) {
        if (isAbortError(e)) return false; // superseded poll; not an error
        console.warn('[Data:Aurora] Fetch error:', e);
        _lastError = 'SWPC network error';
        return false;
      }
    },

    destroy(viewer) {
      _enabled = false;
      if (_dataSource) {
        viewer.dataSources.remove(_dataSource, true);
        _dataSource = null;
      }
      _count = 0;
      _maxProbability = 0;
      _observationTime = null;
      _forecastTime = null;
      _lastUpdate = null;
      _lastError = null;
    },

    getStats() {
      return {
        count: _count,
        lastUpdate: _lastUpdate,
        error: _lastError,
        // Extra context (ignored by the generic feed-state label):
        maxProbability: _maxProbability,
        observationTime: _observationTime,
        forecastTime: _forecastTime,
      };
    },
  };

  return layer;
}

const auroraLayer = createAuroraLayer();

export default auroraLayer;
