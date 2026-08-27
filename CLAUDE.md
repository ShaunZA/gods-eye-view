# CLAUDE.md — God's Eye View (ShaunZA fork)

Guidance for Claude Code when working in this repo. Read this first every session.

## What this is

A fork of [`bilawalsidhu/gods-eye-view`](https://github.com/bilawalsidhu/gods-eye-view) — a
browser-based "spy-satellite" simulator: a photorealistic 3D globe (CesiumJS) showing **live**
public signals — aircraft (ADS-B / OpenSky), ships (AIS), satellites, earthquakes, traffic, and
public cameras — with hands-free voice control via a realtime AI agent.

This fork exists to **containerize the app (Docker) and add community features** on top of the
author's v1, while he builds v2. The author's repo is the `upstream` remote; ours is `origin`.

- **Stack:** Vanilla JS (ES modules, no framework), Vite, CesiumJS. Node `>=24.14`.
- **No framework, no TypeScript.** Plain `.js` modules; tests are `.test.mjs`.
- **`src/` is large and mostly a monolith** (`src/ui.js` alone is ~450KB). Data adapters live
  in `src/data/`, annotations in `src/annotations/`, voice in `src/voice/`, overlays in
  `src/overlays/`, scenes in `src/scenes/`.

## ⭐ The golden rule of this fork: stay mergeable with upstream

The whole point is to **pull in the author's future updates without pain**. Merge conflicts only
happen in files that BOTH we and the author edit. So:

1. **Add features as NEW files, not by editing his files.** A new module in `src/` that we import
   from one small hook point will never conflict. Rewriting `src/ui.js` will conflict with almost
   every upstream update. Prefer new files + minimal, surgical touch-points.
2. **When you must edit an upstream file, keep the edit tiny and localized** (one clearly-marked
   block), so a future merge conflict is trivial to resolve.
3. **Never run `gh repo sync` on this fork.** It fast-forwards only, and with our own commits it
   either fails or (with `--force`) deletes our work. Use the merge flow below instead.
4. **Our own additions so far (safe, all new files except one):**
   `Dockerfile`, `docker-compose.yml`, `.github/workflows/auto-sync.yml`, and a small
   `allowedHosts` tweak in `vite.config.js` (the one upstream-file edit — keep an eye on it at
   merge time).

## Pulling in upstream updates (when the author ships changes)

Run the helper, which fetches upstream and merges it into `main`:

```bash
./scripts/update-from-upstream.sh
```

If it reports conflicts, they'll only be in files we both edited (likely just `vite.config.js`).
Resolve them, keeping BOTH our change and the author's intent, then:

```bash
git add -A && git commit    # completes the merge
npm install && npm test     # sanity check
git push origin main
```

Ask Claude to help resolve conflicts — that's a good use of a session.

## How we add features: ONE FEATURE PER SESSION

Keep each session tightly scoped to a single feature so history stays clean and reviewable:

1. **Start a feature branch:** `git checkout -b feat/<short-name>` off an up-to-date `main`.
2. **Build it as new files** where possible (see golden rule). Wire it in with the smallest
   possible change to existing code.
3. **Add a `.test.mjs`** next to new logic (see Testing) and run `npm test`.
4. **Update `docs/` or README** only if user-facing.
5. **Commit, push the branch, merge to `main`** (or open a PR on the fork), then delete the branch.
6. **One feature = one session = one focused set of commits.** Don't scope-creep.

## Running the app

```bash
npm install
cp .env.example .env     # then fill in API keys (see below)
npm run dev              # Vite dev server
```

Docker (this fork's addition):

```bash
docker compose up --build
```

### Required API keys (in `.env`)
`GOOGLE_MAPS_API_KEY`, `CESIUM_ION_TOKEN`, `OPENAI_API_KEY` (voice/realtime), OpenSky
(`OPENSKY_CLIENT_ID` / `OPENSKY_CLIENT_SECRET`) for aircraft, `AISSTREAM_API_KEY` for ships.
See `.env.example` and `DATA_SOURCES.md`. **Never commit `.env` or real keys.**

## Testing

Custom runner, not Jest/Vitest:

```bash
npm test                 # runs scripts/run-unit-tests.mjs over *.test.mjs
npm run test:track       # tracking regression suite
```

Put new tests in a `*.test.mjs` file beside the code it covers.

## Conventions

- Match the surrounding file's style; this is plain ES-module JS, no TS, no framework.
- Keep new code in its own module and export a small, clear API.
- Don't reformat or "tidy" upstream files — it manufactures merge conflicts.
- Data-source layers should keep their source + freshness state visible (partial / delayed /
  simulated / unavailable), per the project's design philosophy.

## Remotes (already configured)

- `origin`   → `https://github.com/ShaunZA/gods-eye-view.git` (our fork — push here)
- `upstream` → `https://github.com/bilawalsidhu/gods-eye-view.git` (author — fetch only, never push)
