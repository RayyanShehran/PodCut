# PodCut status

## Implemented

- Premiere UXP manifest v5 targeting Premiere Pro 26.5+
- Resend-inspired monochrome panel using Segoe UI/system sans and Consolas fallbacks
- One native panel scroller with content-sized settings and responsive narrow-width stacking
- Active sequence metadata, presets, collapsible advanced settings, review decisions, and a collapsed Developer section
- Validated local recipe/preset/disclosure persistence and Reset settings
- Project/sequence/recipe snapshots, metadata revalidation, obsolete-callback guards, and duplicate-operation prevention
- Review filters, filtered bulk toggles, enabled totals, and playhead-only Locate navigation
- Honest Preparing → Exporting audio → Decoding → Analyzing → Ready progress
- Temporary sequence WAV export using Premiere's in-app `IMMEDIATELY` export path
- Export promise/event/output diagnostics, complete WAV parsing, and duration validation
- Export locking before asynchronous preparation and explicit stop/timeout recovery
- Dependency-free 16-bit PCM decoding and 20ms RMS/dBFS silence detection
- Silence and long-pause decisions with padding, enable/disable state, and duration estimates
- Generated PCM development analysis connected to the same review UI
- Timeline mutation remains disabled with accurate review-only wording

## Host validation completed

- Premiere Pro 26.5.0 / UXP 9.3.0 loaded the panel and read the active sequence.
- A 35-second, two-clip test sequence exported to WAV and reached `Sequence audio analysis complete` / `Ready 100%`.
- The bundled 48kHz 16-bit WAV preset and plugin temporary output worked without Adobe Media Encoder.
- The timeline remained unchanged and Apply to Timeline stayed disabled.
- The 35.20-second controlled sequence has an approximately 20-second empty lead-in. A repeat Premiere run completed in about two seconds and proposed one silence decision, `00:00:00.000 → 00:00:19.650`; the timeline was not changed.
- Switching from that completed review to a different project immediately cleared the old review. Activating the other sequence refreshed the panel to `5m11s · 3V / 3A · 29 clips` without a manual refresh.

The original timeout came from relying on the completion-event wait path alone. The current workflow also polls the unique output, requires the export promise to resolve true, parses a complete WAV, and verifies its duration before analysis or deletion.

## Still requires Premiere validation

- Real speech with internal pauses has not been tested. On September 26, Cinestudy's official [Podcast/Documentary project](https://cinestudy.org/2026/02/20/edit-this-podcast-documentary/) linked [Renfest 2025 HOST SEGMENTS.mp4](https://drive.google.com/file/d/1yNEXV00DG2dpxdjkZnVxtE5LceVYChhY/view?usp=sharing) (17:31, 6.71 GB, 3840×2160), but Google Drive showed “number of allowed playbacks has been exceeded” and its normal Download action returned an HTTP error. No footage or Premiere test project was downloaded/created. Do not infer its channel count, sample rate, frame rate, or audible content from Drive metadata. The separate 10-second opener is too short for the requested 1–3-minute speech test.
- Repeat analysis after reopening the panel and after Stop waiting / timeout recovery.
- Relink the 13 missing source clips in the 5m11s, 29-clip project, then analyze it and compare review timestamps with its real audio. Premiere requested media from `C:\Users\rayya\Downloads`; matching files were not found in Downloads or OneDrive. No analysis was run against offline media.
- Check Locate at several known sequence times, generated-audio refusal, and stale-result refusal in Premiere.
- Check Alt+Tab, minimize/restore, dock/undock, a second monitor if available, and close/reopen during export.
- Check a long review list, disclosures, and saved settings in a docked panel.
- Exercise empty, offline, nested, multicam, and unusual sequences.

Browser screenshots and Playwright checks cover 280×400, 320×520, 420×700, and 900×700 layout and interaction logic; they do not prove Premiere's UXP renderer matches Chromium.

On September 26, the loaded stylesheet and built source matched the repository. Before the compact-layout change, live UXP measurements at the floating panel's 260×420 content viewport showed a fixed 51px footer, a flex-growing 253px inner scroller, 20px section margins, 42px setting rows, and 16px sequence-card padding. Advanced and Developer were expanded by saved settings, not occupying space while collapsed. After rebuilding and reloading in UDT, the same viewport showed one native `#app` scroller, a 32px preset control, stacked narrow setting rows, and an in-flow action area after the form. A real mouse wheel moved the content immediately; both disclosures collapsed without leftover space; the outlined Analyze button was reachable. Closing the floating panel and reopening through Window > UXP Plugins > PodCut restored visible content, the Custom recipe, collapsed disclosures, and scroll position. Alt+Tab away and back did not blank it. These observations were made with no active sequence. Attempts to resize the floating window did not change its dimensions, so matching before/after captures at 280×400, 320×520, 420×700, and a wider Premiere size remain pending. The manifest's minimum height was lowered from 420px to 400px to permit the requested smallest test, but this final manifest change was not reloaded in Premiere. Opening the recent Test project left Premiere showing “Not Responding”; no docked, minimize/restore, active-sequence, or job-continuity check was completed in that session.

The reported floating-window recovery failure remains unconfirmed: the host owns the title bar, menu reopen worked, and no blank DOM appeared. Offscreen and docked behavior were not reproduced. The normal recovery path and docking/workspace instructions are in README. Adobe documents unreliable Premiere panel hide/destroy callbacks, so PodCut no longer cancels its wait in those hooks; an explicit Stop waiting remains separate from host export cancellation. A later Premiere session did open the Test and Xentra projects successfully, but the earlier narrow-window size and lifecycle checks were not repeated.

## Not implemented

- Timeline editing. Apply to Timeline intentionally remains disabled.
- Transcription or filler-word detection.
- AI services or provider secrets.

## Known host/API constraints

- PodCut requires Premiere Pro 26.5+ for `uxp.host.applicationPath` and UXP Developer Tool 2.2+.
- Stop waiting and timeout stop PodCut's listener/polling only; they do not cancel Premiere's host render.
- The DOM can clone sequences and remove selected track items, but linked-item and ripple semantics must be proven before timeline edits are enabled.
- Adobe documents sequence clone actions, track-item clone/insert actions, source-relative in/out actions, and undoable `lockedAccess`/`executeTransaction` callbacks. It does not document a razor/split action in `SequenceEditor`, nor a linked-pair query on `AudioClipTrackItem`/`VideoClipTrackItem`. Retained-segment reconstruction and synchronization remain an unproven design, not an implemented editing workflow. No mutation was attempted while the speech fixture was unavailable.
