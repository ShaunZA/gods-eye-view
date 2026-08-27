# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A fork of [`bilawalsidhu/gods-eye-view`](https://github.com/bilawalsidhu/gods-eye-view) — a
browser-based "spy-satellite" simulator: a photorealistic 3D globe (CesiumJS) rendering **live**
public signals — aircraft (ADS-B / OpenSky), ships (AIS), satellites, earthquakes, wildfires,
traffic, and public cameras — with hands-free voice control via a realtime AI agent. Layers keep
their source + freshness state visible (nominal / loading / degraded / stale / fallback /
unavailable); modeled-not-live views are labeled as such.

This fork exists to **containerize the app (Docker) and add community features** on top of the
author's v1, while he builds v2. See "Fork strategy" — it's the most important section here.

**Stack:** Vanilla JS (ES modules, no framework, no TypeScript), Vite, CesiumJS. Node `>=24.14`.

## Commands

```bash
npm install
cp .env.example .env          # then fill in API keys (see .env.example / DATA_SOURCES.md)
npm run dev                   # Vite dev server (this also runs the API proxy backend — see below)
npm run build                 # production build (vite build)
npm run preview               # serve the built bundle
docker compose up --build     # run containerized (this fork's addition)

npm test                      # unit tests: scripts/run-unit-tests.mjs over all src/**/*.test.mjs
npm run test:track            # tracking regression suite
npm run qa:map-source-tray    # a targeted QA script (puppeteer)
```

**Running a single test file** — the runner discovers `src/**/*.test.mjs` and executes each as a
child process, so run one directly with Node:

```bash
node src/data/flights.test.mjs
```

**Tests are pinned to Node 24.** `run-unit-tests.mjs` asserts the calibrated Node-24 runtime for
allocation-budget tests (`isCalibratedAllocationRuntime`) and will throw on other majors. Match
the `engines` field. Tests use Node's built-in assertions/runner conventions, not Jest/Vitest.

## Architecture (the big picture)

Read these together to understand how a frame comes together; individual files are discoverable.

**Bootstrap — `src/main.js` (small, the wiring hub).** Creates the Cesium viewer, then constructs
and connects the big subsystems: `StyleManager` (from the ~10k-line `src/ui.js` monolith),
`DataLayerManager`, `SceneDirector`, the voice agent, annotations, the render governor, and the
scope mask. `src/ui.js` is the giant DOM/HUD/interaction monolith — treat it as legacy surface
area to wire *into*, not to rewrite.

**Data layers — `src/data/`, orchestrated by `DataLayerManager` (`src/data/manager.js`).** Each
feed (`flights.js`, `aisLiveVessels.js`, `satellites.js`, `earthquakes.js`, `cctv.js`,
`traffic.js`, `rocketLaunches.js`, `bikeshare.js`, …) is a **layer module with a lifecycle
contract** (enable / disable / update / params) that the manager drives. The manager owns
per-layer feed-state (the ON/LOADING/DEGRADED/STALE/FALLBACK/UNAVAILABLE labels), visibility
intent, and serialization. **To add a data source, write a new layer module in `src/data/` and
register it in `main.js`'s layer imports** — do not thread it through `ui.js`. Layers request
redraws through the render governor rather than forcing continuous rendering.

**`vite.config.js` is a backend, not just build config.** It installs dev-server **proxy
middlewares** (`/api/radio`, OpenSky, Overpass, GBFS bikeshare, OpenAI realtime) that inject API
keys server-side, bypass CORS, enforce opt-in rate limits, and stretch cache TTLs to protect
metered credit budgets (e.g. OpenSky's 4-credits-per-call `/states/all`). Env/API keys are read
**lazily on first request**, not at import time, because `loadEnv` populates `process.env` after
the module loads. **Any browser-side call needing a secret or a CORS bypass goes through a proxy
here.** This is also the single upstream file this fork edits (an `allowedHosts` tweak) — the #1
merge-conflict watch point.

**Render governor — `src/renderGovernor.js`.** Cesium runs on-demand, not a free-running loop.
Code calls `governorRequestRender()` to schedule a frame, or `holdContinuousRender()` /
`releaseContinuousRender()` around animations. New rendering code must cooperate with this or the
globe won't update / will burn battery.

**Scenes — `src/scenes/` (`director.js`, `recipes.js`, `scenePolicy.js`).** The `SceneDirector`
plays cinematic camera/scene "recipes" (fly-tos, tracking, cockpit views) gated by policy.

**Voice — `src/voice/` (`gevRealtime.js`, `gevActions.js`).** A realtime OpenAI agent maps spoken
commands to app actions (`gevActions`) with cost tracking (`voiceCost.js`); it drives the same
camera/scene/data APIs the UI does.

**Other subsystems:** `src/annotations/` (screen + world-space annotation rendering),
`src/overlays/` (world overlays + allocation budgeting), `src/hud.js` (HUD), `src/camera.js` /
`src/cameraVerbs.js` (camera motion vocabulary), `src/sharelink.js` (shareable view state).

---

## Fork strategy — stay mergeable with upstream ⭐

The whole point of this fork is to **pull in the author's future updates without pain**. Merge
conflicts only happen in files that BOTH we and the author edit.

1. **Add features as NEW files, not by editing his files.** A new `src/data/*.js` layer wired in
   via one line in `main.js` will never conflict. Rewriting `src/ui.js` or `vite.config.js` will
   conflict with nearly every upstream update. Prefer new modules + minimal, surgical wire-in.
2. **When you must edit an upstream file, keep the edit tiny and localized** so a future merge
   conflict is trivial. `vite.config.js` is the highest-risk file (we already edited it, and the
   author changes it often — it's the proxy backend).
3. **Never run `gh repo sync` on this fork.** It fast-forwards only; with our own commits it fails
   or, with `--force`, deletes our work. Use the merge flow below.

### Pulling in upstream updates

```bash
./scripts/update-from-upstream.sh   # fetches upstream, merges upstream/main into main
```

If it reports conflicts (most likely only `vite.config.js`), resolve keeping BOTH our change and
the author's intent, then `git add -A && git commit`, `npm install && npm test`, `git push origin main`.
The `.github/workflows/auto-sync.yml` workflow is **notify-only** — it opens an issue when upstream
is ahead; it does NOT auto-merge.

### One feature per session

Keep each session scoped to a single feature: `git checkout -b feat/<name>` off an up-to-date
`main` → build as new modules → add a `*.test.mjs` beside new logic → `npm test` → merge to `main`.
Don't scope-creep, and don't reformat/tidy upstream files (it manufactures conflicts).

## API keys (in `.env`, never committed)

`GOOGLE_MAPS_API_KEY`, `CESIUM_ION_TOKEN`, `OPENAI_API_KEY` (+ `OPENAI_REALTIME_*` for voice),
`OPENSKY_CLIENT_ID`/`OPENSKY_CLIENT_SECRET` (aircraft), `AISSTREAM_API_KEY` (ships),
`VITE_AIS_LIVE_*` (client-side AIS config). See `.env.example` and `DATA_SOURCES.md`.

## Remotes (already configured)

- `origin`   → `https://github.com/ShaunZA/gods-eye-view.git` (our fork — push here)
- `upstream` → `https://github.com/bilawalsidhu/gods-eye-view.git` (author — fetch only, never push)
