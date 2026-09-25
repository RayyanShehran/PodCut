# PodCut status

## Implemented

- Premiere UXP manifest v5 targeting Premiere Pro 26.5+
- Resend-inspired monochrome panel using Segoe UI/system sans and Consolas fallbacks
- One bounded content scroller with responsive layouts from 280px through wide floating panels
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

The original timeout came from relying on the completion-event wait path alone. The current workflow also polls the unique output, requires the export promise to resolve true, parses a complete WAV, and verifies its duration before analysis or deletion.

## Still requires Premiere validation

- Repeat analysis after reopening the panel and after Stop waiting / timeout recovery.
- Validate the reported 5m11s, 29-clip sequence and compare review timestamps with the real audio.
- Check Locate at several known sequence times, generated-audio refusal, and stale-result refusal in Premiere.
- Check Alt+Tab, minimize/restore, dock/undock, a second monitor if available, and close/reopen during export.
- Check a long review list, disclosures, and saved settings in a docked panel.
- Exercise empty, offline, nested, multicam, and unusual sequences.

Browser screenshots and Playwright checks cover layout and interaction logic; they do not prove Premiere's UXP renderer matches Chromium.

On September 26, UDT reported a successful reload from `dist/`. The actual Premiere floating panel displayed the dark styling, outlined controls, visible refresh symbol, compact footer, and one scrollable content area. Mouse-wheel scrolling moved the panel content; the title bar and red X were outside the plugin canvas. Closing with that X and reopening via Window > UXP Plugins > PodCut returned visible content. A host-observed select spacing issue was reduced by resetting form-control margins. These checks were at the minimum floating size with no active sequence; they do not prove the review UI, Locate, or job continuity in the real host. A subsequent attempt to open the recent Test project left Premiere showing “Not Responding” before analysis, so no timeline validation was possible in that session. The final label-contrast CSS adjustment was built and browser-tested but could not be manually reloaded after UDT input geometry failed.

The floating-window recovery cause remains undetermined: the host owns the title bar, and the menu reopen worked, but Alt+Tab/offscreen behavior was not reproduced. The normal recovery path and docking/workspace instructions are in README. Adobe documents unreliable Premiere panel hide/destroy callbacks, so PodCut no longer cancels its wait in those hooks; an explicit Stop waiting remains separate from host export cancellation.

## Not implemented

- Timeline editing. Apply to Timeline intentionally remains disabled.
- Transcription or filler-word detection.
- AI services or provider secrets.

## Known host/API constraints

- PodCut requires Premiere Pro 26.5+ for `uxp.host.applicationPath` and UXP Developer Tool 2.2+.
- Stop waiting and timeout stop PodCut's listener/polling only; they do not cancel Premiere's host render.
- The DOM can clone sequences and remove selected track items, but linked-item and ripple semantics must be proven before timeline edits are enabled.
