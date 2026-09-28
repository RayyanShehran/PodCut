# PodCut

PodCut is a controllable auto-editing assistant for Adobe Premiere Pro. Editors choose each operation PodCut may perform, review proposed edits, and retain the original media.

## Current capabilities

- Persistent Premiere UXP panel for Premiere Pro 26.5+
- Active project/sequence detection with duration, track, and clip inventory
- Independent Cut Silence, Remove Filler Words, and Remove Long Pauses recipe controls
- Data-driven Natural Podcast, Tight Podcast, YouTube Fast-Paced, and Custom presets
- Real PCM silence detection and long-pause derivation
- Temporary Premiere sequence-audio export and 16-bit PCM WAV decoding
- Export diagnostics plus measured decode and analysis progress
- Reviewable edit decisions with filters, bulk enable/disable, Locate playhead navigation, and updated duration estimates
- Validated recipe and disclosure preferences stored locally; Reset settings is under Developer
- Generated PCM development input for exercising the real detector without Premiere
- Analysis and review remain available; public Apply is temporarily disabled pending property-preservation and audio-freshness verification

PodCut can acquire sequence audio from Premiere for analysis and review. Apply remains gated: existing-track-item cloning preserved native gain in both tested retained sections, but lost the duplicated pair's A/V link relationship. No faithful replacement service is integrated. Tested gain changes now invalidate review through track events; metadata alone still cannot establish audio freshness, and broader event coverage remains unverified. PodCut does **not** transcribe speech or detect filler words. Generated test audio remains available as synthetic input to the real detector; its results are not canned or mocked.

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

- Windows with Node.js 20 or later (the build and unit tests need no npm packages; browser UI tests use the listed Playwright dev dependency)
- Adobe Premiere Pro 26.5 or later
- Adobe UXP Developer Tool 2.2 or later

## Build and test

Run from the repository root:

```powershell
node scripts/check.mjs
node --test
npm run test:ui
node scripts/build.mjs
```

The external 36-second WAV fixture is optional. To run its otherwise-skipped test, set `PODCUT_FIXTURE_WAV` to `C:\Projects\PodCut-TestMedia\Fixtures\podcut-internal-pauses.wav` before `node --test test/fixture.test.js`.

The Playwright check captures narrow and wide panel screenshots and verifies scrolling, stacking, and overflow. The build creates `dist/`, the folder to load in UXP Developer Tool.

## Load locally

1. Install Premiere Pro 26.5+ and UXP Developer Tool 2.2+ from Creative Cloud.
2. Start Premiere and open a project and sequence.
3. Start UXP Developer Tool as administrator and enable Developer Mode when prompted.
4. Add a plugin, choose `dist/manifest.json`, then click **Load**.
5. In Premiere, open **Window → UXP Plugins → PodCut**.

If a floating PodCut panel is hard to find, use **Window → UXP Plugins → PodCut** to reopen it. The pale floating title bar and red close button belong to Premiere; PodCut cannot style or replace them. For a stable location, drag the **PodCut panel tab** into a Premiere dock until the docking target appears, then select **Window → Workspaces → Save as New Workspace**. Do not drag the outer Windows title bar when docking. Closing the panel does not mean a Premiere audio export was cancelled; use PodCut's explicit **Stop waiting** control only when you want to stop its wait.

PodCut rechecks the active sequence when shown and when Refresh is used. Project/sequence switches and active-track INFO_CHANGED events invalidate review, including the tested native gain adjustment and its Undo/Redo. Changes during analysis prevent its late result from restoring review. Reanalyze after any edit: master/mixer, external media and all effect-change coverage are not established by this event test. Locate moves only the playhead to a proposal's start; it is unavailable for generated audio or stale results. Internal preflight also checks the analysis revision; public Apply remains disabled.

## Constrained editing workflow and limits

Public Apply is temporarily disabled for every layout. The existing development service accepts one online, ordinary source file represented by one matching linked V1/A1 clip pair, starting at sequence time zero, at an integer frame rate and normal forward speed. Other tracks may exist only if empty. Occupied extra tracks, captions, transitions, extra effects, keyframes, muted/disabled clips, nested or multicam media, and speed changes are refused before creating output. Native Audio Gain and modified static settings on Premiere's built-in Motion/Opacity/Volume-type effects are not distinguished from defaults. Consequently, "unmodified clips only" is not an enforced safeguard. No clip-property preservation guarantee is currently made.

Analyze → disable any proposed cuts you want to keep → inspect the frame-aligned removal and retained durations → confirm creation of a **separate** `— PodCut` sequence. Pause removal is optional: only decisions left enabled are submitted. The source sequence is not overwritten or automatically saved. Zero enabled cuts, stale analysis, changed recipes, and unsupported layouts are refused before candidate creation. Detector thresholds and padding were not made more aggressive for release.

If an operation fails after creating a candidate, PodCut reports the partial candidate and subclip identities, labels an identifiable partial sequence `PodCut FAILED <operation-id>`, and reopens the source when appropriate. Inspect that partial output; a retry builds a fresh candidate rather than continuing it. A host crash may interrupt labeling, so do not assume every `Copy` is a verified result. Undo is **not** an atomic rollback of the full workflow: in the observed host run, the first Undo reversed output naming; candidate editing, subclip creation, and cloning have separate history entries. Do not use blind repeated Undo to clean up.

If Developer Mode must be enabled manually on Windows, create `%CommonProgramFiles%\Adobe\UXP\Developer\settings.json` with `{ "developer": true }`, then restart UXP Developer Tool.

## Architecture

- `src/audio.js` — host-independent PCM validation and RMS/dBFS silence detection.
- `src/core.js` — presets, recipe validation, analysis orchestration, and edit-decision logic.
- `src/premiere.js` — thin verified Premiere DOM adapter for active-sequence inspection.
- `src/apply.js` — guarded frame-plan-to-candidate operation stages and failure state.
- `src/main.js` — panel state and interactions.
- `src/styles.css` — compact Adobe-style panel presentation.
- `test/` — generated-audio detector, range, settings, and decision checks.
- `scripts/` — dependency-free validation and production build.

Analysis remains separate from candidate editing: PCM input → detected ranges → decisions → review → guarded Premiere actions. No audio fixtures or tests are copied into `dist/`.

## Host integration and limitations

The adapter uses Premiere UXP APIs for active-sequence inspection and immediate sequence export. Audio is rendered to the plugin's temporary folder using Premiere's bundled 48 kHz/16-bit WAV preset, validated against the sequence duration, decoded, analyzed, and removed after success. Export diagnostics record promise, completion-event, and output-file state so host failures are reported without guessing. The preset lookup and guarded candidate editing have been exercised in Premiere 26.5 on controlled footage. The user explicitly passed visual/audio playback of the continuous-video synthetic candidate; normal production-panel submission and unsupported-layout rejection also passed.

The panel, lifecycle, layout, and active-sequence reads have been validated in Premiere Pro 26.5. See [docs/STATUS.md](docs/STATUS.md).

## Release evidence and scope

The user explicitly reported **PASS** for `podcut-nasa-moving-synthetic — PodCut` in `C:\Projects\PodCut-TestMedia\Fixtures\PodCut Moving Sync Validation 2026-09-28.prproj`. The separate saved production-panel proof is `C:\Projects\PodCut-TestMedia\Fixtures\PodCut Restricted Apply Release 2026-09-28.prproj`: disabling the long-pause decision retained it and produced a 1,034-frame candidate. That playback evidence does not resolve the subsequently demonstrated gain/freshness gap; public Apply is now disabled. This is restricted silence removal, not general podcast editing. The synthetic fixture mutes speech while preserving continuous NASA video; it does not establish quality across natural speech, background noise, or complex projects. Full-workflow Undo is not one-step. See [docs/STATUS.md](docs/STATUS.md) for exact evidence and limitations.

## Multi-clip milestone: timing planner only

`planConsecutiveEdit` maps retained sequence-time intervals to chronological clip identities, trimmed media in/out ranges, and contiguous output frames. It reuses the released frame-rounding policy and rejects invalid/gapped/overlapping spans and invalid cuts. It is **not connected to Apply** and is not an eligibility or property-preservation check. The existing host service still rejects multiple pairs before mutation.

Expansion stopped at demonstrated preservation and freshness defects: in Premiere 26.5, native Audio Gain changes leave the inspected source snapshot identical and eligible. A controlled -6 dB reconstruction kept gain only on the first cloned segment; later subclip speech returned to baseline level. A gain change after analysis was accepted by metadata preflight despite changed rendered PCM and detector proposals. Track change events fired in the disposable experiment, but a comprehensive freshness implementation and a faithful reconstruction strategy remain unproved. Public Apply stays disabled; see the current status evidence. No detector/default changes were made.
