# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

PodCut is an Adobe Premiere Pro (26.5+) UXP panel plugin that detects silence/long pauses in sequence audio and proposes reviewable cuts. It does no transcription or filler-word detection. There is no bundler or transpiler: plain browser JS, plus Node 20+ for tooling. The only npm dependency is Playwright, used for UI tests.

## Commands

```powershell
node scripts/check.mjs          # manifest/index.html references + safety-gate assertions (npm run check)
node --test                     # all unit tests in test/ (npm test)
node --test test/core.test.js   # single test file
node --test --test-name-pattern="presets" test/core.test.js   # single test
npm run test:ui                 # Playwright: loads index.html via file:// at 4 panel sizes, checks layout/overflow
node scripts/build.mjs          # writes dist/ (load dist/manifest.json in UXP Developer Tool)
```

Several tests skip unless an env var points at external host-proof data or media outside the repo: `PODCUT_FIXTURE_WAV`, `PODCUT_MOVING_FIXTURE` (+ `PODCUT_FFMPEG`, `PODCUT_NASA_SOURCE`), `PODCUT_ASSISTED_PROOF`, `PODCUT_ASSISTED_PANEL_PROOF`, `PODCUT_MULTI_CUT_PROOF`, `PODCUT_TRACK_CLONE_PROOF`. Test media lives in `C:\Projects\PodCut-TestMedia\` and is never committed.

The build copies `manifest.json`, `index.html` and `src/` into `dist/`, and replaces `src/build-info.js` with a content hash ("Build xxxxxxxxxxxx") that the panel displays. Running from source shows "Source preview".

## Architecture

**Module pattern:** each `src/*.js` file is a UMD-style IIFE. In Node it is loaded with `require` and exports via `module.exports`. In the panel it attaches a global (`PodCutAudio`, `PodCutCore`, `PodCutPremiere`, `PodCutApply`, `PodCutAssisted`, `PodCutAssistedState`). `index.html` loads them with ordered `<script>` tags, and `main.js` reads the globals. A new source file must be added to `index.html`, and to the list in `scripts/check.mjs` if it is required. `assisted.js` exports a factory `(base, api, service, scope)` rather than an API object.

**Pipeline:** Premiere sequence-audio export (temp 48 kHz/16-bit WAV) → `audio.js` decode + RMS/dBFS silence detection → `core.js` recipe/presets → edit decisions → panel review → frame-aligned plan → guarded Premiere actions. Analysis has no host dependencies and is tested with generated PCM. Only `premiere.js` touches the UXP Premiere DOM.

- `audio.js`: WAV decode and linear-time 20 ms-frame silence detection.
- `core.js`: presets, recipe validation, decisions, frame planning (`planSimpleEdit`, `planConsecutiveEdit`), assisted scope checks.
- `premiere.js`: thin host adapter for sequence inspection, export, track events, cloning and candidate creation.
- `apply.js`: staged candidate-creation service with failure labeling (`PodCut FAILED <op-id>`).
- `assisted.js` / `assisted-state.js`: the experimental "assisted draft" path (track-item clones that keep native gain; the user links A/V manually) and its persisted/reload state.
- `main.js`: all panel state, UI wiring and freshness invalidation (project/sequence switches, track INFO_CHANGED events, re-rendered PCM checks at action boundaries).

## Safety gates (enforced by `scripts/check.mjs`)

These literal lines must stay unchanged unless the user explicitly authorizes a release-gate change. `check.mjs` (and `scripts/build-host-panel-fixture.mjs`) match the exact text:

- `src/apply.js`: `const MUTATION_ENABLED = false;` keeps automatic Apply locked at the service level.
- `src/main.js`: `const PUBLIC_APPLY_ENABLED = false;` keeps automatic Apply locked in the panel.
- `src/core.js`: `const MAX_ASSISTED_CUTS = 1;` keeps multi-cut assisted creation gated.

The source sequence is never overwritten. Outputs are separate sequences, and full-workflow Undo is not atomic. Detector thresholds and padding defaults have deliberately not been made more aggressive.

## Docs and evidence

`docs/STATUS.md` is a reverse-chronological log of host-validation evidence: what was proven in Premiere, what the user reported as PASS, and what is still unverified. `README.md` states the user-facing capabilities and limits in the same careful terms. When behavior or validation status changes, update both. Keep claims exact, and never describe unverified host behavior as working.

`scripts/build-host-panel-fixture.mjs` produces a non-shipping test build in a temp directory. It unlocks the panel gate only for one specific disposable fixture project. `scripts/assisted-proof.js` is a development-only wrapper that requires a disposable `.prproj` scope.
