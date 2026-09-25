# PodCut

PodCut is a controllable auto-editing assistant for Adobe Premiere Pro. Editors choose each operation PodCut may perform, review proposed edits, and retain the original media.

## Current foundation

- Persistent Premiere UXP panel for Premiere Pro 25.6+
- Active project/sequence detection with duration, track, and clip inventory
- Independent Cut Silence, Remove Filler Words, and Remove Long Pauses recipe controls
- Data-driven Natural Podcast, Tight Podcast, YouTube Fast-Paced, and Custom presets
- Validation, range merging, padding, and edit-decision utilities
- Analysis/review workflow with an explicitly labelled demo preview
- Apply action intentionally disabled until real detections can be reviewed

PodCut does **not** yet analyze waveforms, transcribe speech, detect filler words, or modify a timeline. The demo review is mock data and is labelled in the UI.

## Requirements

- Windows with Node.js 20 or later (no npm packages are required)
- Adobe Premiere Pro 25.6 or later
- Adobe UXP Developer Tool 2.2 or later

## Build and test

Run from the repository root:

```powershell
node scripts/check.mjs
node --test
node scripts/build.mjs
```

The build creates `dist/`, the folder to load in UXP Developer Tool. `npm run check`, `npm test`, and `npm run build` are equivalent when npm is working.

## Load locally

1. Install Premiere Pro 25.6+ and UXP Developer Tool 2.2+ from Creative Cloud.
2. Start Premiere and open a project and sequence.
3. Start UXP Developer Tool as administrator and enable Developer Mode when prompted.
4. Add a plugin, choose `dist/manifest.json`, then click **Load**.
5. In Premiere, open **Window → UXP Plugins → PodCut**.

If Developer Mode must be enabled manually on Windows, create `%CommonProgramFiles%\Adobe\UXP\Developer\settings.json` with `{ "developer": true }`, then restart UXP Developer Tool.

## Architecture

- `src/core.js` — presets, recipe validation, time formatting, and edit-decision logic; runs without Premiere.
- `src/premiere.js` — thin verified Premiere DOM adapter for active-sequence inspection.
- `src/main.js` — panel state and interactions.
- `src/styles.css` — compact Adobe-style panel presentation.
- `test/core.test.js` — host-independent logic checks.
- `scripts/` — dependency-free validation and production build.

Analysis remains separate from timeline operations: audio/transcript input → detected ranges → decisions → review → Premiere actions. A future transcript provider should return word-level timestamps without placing API secrets in the extension. Use an authenticated service if a provider requires a secret.

## Host integration and limitations

The adapter uses documented Premiere UXP 25.6 APIs: `Project.getActiveProject()`, `project.getActiveSequence()`, sequence duration/track access, and track-item enumeration. Premiere also exposes sequence clone actions, undoable project transactions, and remove-item actions, but applying time-range edits safely requires mapping detections to linked audio/video track items. That work is intentionally not guessed or enabled in this build.

This machine did not have Premiere Pro or UXP Developer Tool installed, so loading, layout, and DOM behavior still require validation in the host. See [docs/STATUS.md](docs/STATUS.md).

## Roadmap

1. Validate the panel and DOM adapter in Premiere Pro 25.6+.
2. Add local audio extraction/reference and real silence detection.
3. Generate reviewable, per-edit decisions and safely apply them to a cloned sequence in one undoable transaction.
4. Add a provider-independent word-timestamp transcription boundary for context-aware filler-word detection.
5. Add multicam, speaker switching, captions, punch-ins, highlights, and clip generation only as validated needs emerge.
