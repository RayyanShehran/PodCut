# PodCut status

## Implemented

- Premiere UXP manifest v5 targeting Premiere Pro 26.5+
- Resend-inspired monochrome panel using Segoe UI/system sans and Consolas fallbacks
- One bounded content scroller with responsive layouts from 280px through wide floating panels
- Active sequence metadata, presets, collapsible advanced settings, review decisions, and a collapsed Developer section
- Recipe and sequence snapshots, review invalidation, obsolete-callback guards, duplicate-operation prevention, and teardown cleanup
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

- Reload the redesigned panel and confirm mouse-wheel/scrollbar behavior in docked, floating, narrow, and short layouts.
- Repeat analysis after reopening the panel and after Stop waiting / timeout recovery.
- Validate the reported 5m11s, 29-clip sequence and compare review timestamps with the real audio.
- Exercise empty, offline, nested, multicam, and unusual sequences.

Browser screenshots and Playwright checks cover layout and interaction logic; they do not prove Premiere's UXP renderer matches Chromium.

## Not implemented

- Timeline editing. Apply to Timeline intentionally remains disabled.
- Transcription or filler-word detection.
- AI services or provider secrets.

## Known host/API constraints

- PodCut requires Premiere Pro 26.5+ for `uxp.host.applicationPath` and UXP Developer Tool 2.2+.
- Stop waiting and timeout stop PodCut's listener/polling only; they do not cancel Premiere's host render.
- The DOM can clone sequences and remove selected track items, but linked-item and ripple semantics must be proven before timeline edits are enabled.
