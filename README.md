# PodCut

PodCut is a controllable auto-editing assistant for Adobe Premiere Pro. Editors choose each operation PodCut may perform, review proposed edits, and retain the original media.

## Current capabilities

- Persistent Premiere UXP panel for Premiere Pro 26.5+
- Active project/sequence detection with duration, track, and clip inventory
- Independent Cut Silence, Remove Filler Words, and Remove Long Pauses recipe controls
- Data-driven Natural Podcast, Tight Podcast, YouTube Fast-Paced, and Custom presets
- Real PCM silence detection and long-pause derivation
- Temporary Premiere sequence-audio export and 16-bit PCM WAV decoding
- Reviewable edit decisions with padding, timing, enable/disable controls, and duration estimates
- Generated PCM development input for exercising the real detector without Premiere
- Apply action intentionally disabled until Premiere timeline integration is validated

PodCut can acquire sequence audio from Premiere for analysis, but the host export path still requires real-project validation. It does **not** transcribe speech, detect filler words, or modify a timeline. Generated test audio remains available as synthetic input to the real detector; its results are not canned or mocked.

## Silence analysis

The dependency-free detector accepts planar PCM channels plus a sample rate. It scans 20 ms frames in linear time, combines every channel using RMS, converts the result to dBFS, and joins consecutive silent frames into ranges. Short ranges remain observable but do not become cuts.

The Edit Recipe controls real behavior:

- **Minimum silence** determines which detected ranges may become cuts.
- **Padding before speech** preserves time before the next spoken section.
- **Padding after speech** preserves time after the previous spoken section.
- **Natural / Balanced / Tight** use explicit silence thresholds of `-42 / -38 / -34 dBFS`.
- **Pause threshold** identifies long pauses from the same detection pass.
- **Leave natural pause** controls how much of a long pause remains.

When Cut Silence and Remove Long Pauses are both enabled, long ranges become long-pause decisions and shorter qualifying ranges become silence decisions. This prevents duplicate overlapping proposals.

## Requirements

- Windows with Node.js 20 or later (no npm packages are required)
- Adobe Premiere Pro 26.5 or later
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

1. Install Premiere Pro 26.5+ and UXP Developer Tool 2.2+ from Creative Cloud.
2. Start Premiere and open a project and sequence.
3. Start UXP Developer Tool as administrator and enable Developer Mode when prompted.
4. Add a plugin, choose `dist/manifest.json`, then click **Load**.
5. In Premiere, open **Window → UXP Plugins → PodCut**.

If Developer Mode must be enabled manually on Windows, create `%CommonProgramFiles%\Adobe\UXP\Developer\settings.json` with `{ "developer": true }`, then restart UXP Developer Tool.

## Architecture

- `src/audio.js` — host-independent PCM validation and RMS/dBFS silence detection.
- `src/core.js` — presets, recipe validation, analysis orchestration, and edit-decision logic.
- `src/premiere.js` — thin verified Premiere DOM adapter for active-sequence inspection.
- `src/main.js` — panel state and interactions.
- `src/styles.css` — compact Adobe-style panel presentation.
- `test/` — generated-audio detector, range, settings, and decision checks.
- `scripts/` — dependency-free validation and production build.

Analysis remains separate from timeline operations: PCM input → detected ranges → decisions → review → Premiere actions. No audio fixtures or tests are copied into `dist/`. A future transcript provider should return word-level timestamps without placing API secrets in the extension. Use an authenticated service if a provider requires a secret.

## Host integration and limitations

The adapter uses documented Premiere UXP APIs for active-sequence inspection and immediate sequence export. Audio is rendered to the plugin's temporary folder using Premiere's bundled 48 kHz/16-bit WAV preset, decoded, analyzed, and removed. The current preset lookup targets Premiere's Windows installation layout and still needs host validation. Applying time-range edits safely requires mapping detections to linked audio/video track items, so timeline mutation remains disabled.

The panel, lifecycle, layout, and active-sequence reads have been validated in Premiere Pro 26.5. See [docs/STATUS.md](docs/STATUS.md).

## Roadmap

1. Validate Premiere sequence audio export and PCM analysis against real projects.
2. Calibrate thresholds only if measured results require it.
3. Safely apply reviewed decisions to a cloned sequence in one undoable transaction.
4. Add a provider-independent word-timestamp transcription boundary for context-aware filler-word detection.
