# PodCut status

## Completed

- Premiere UXP manifest v5 targeting Premiere Pro 25.6+
- Compact persistent panel UI and generated-audio review workflow
- Recipe toggles, conditional settings, presets, Custom detection, and validation
- Active sequence metadata, track, and clip inspection through documented Premiere APIs
- Linear-time, dependency-free PCM silence detection using 20 ms RMS/dBFS frames
- Stereo/multi-channel RMS combination and explicit Natural/Balanced/Tight thresholds
- Silence and long-pause decisions with padding, enable/disable state, and duration estimates
- Generated PCM development analysis connected to the review UI
- Host-independent range, padding, duration, preset, detector, and decision tests
- Dependency-free build and manifest checks

## Partially implemented

- Analysis workflow: PCM analysis is real; Premiere audio acquisition is not connected
- Non-destructive editing: safe workflow is defined, but timeline mutation remains disabled

## Mocked

- Nothing in the silence-analysis result is mocked. The development button analyzes generated PCM rather than Premiere media.
- Filler-word results are not generated; transcription remains unavailable.

## Requires Premiere validation

- UXP manifest loading and panel lifecycle
- Narrow-panel HTML/CSS rendering and focus behavior
- Active project, sequence, track, and clip reads against real projects
- Obtaining or rendering sequence audio into the detector's planar PCM input
- Error behavior for empty, offline, nested, multicam, and unusual sequences

## Planned

- Premiere audio reference/export feeding the existing detector
- Clone active sequence, rename it with a `— PodCut` suffix where the DOM permits, then apply reviewed edits in an undoable transaction
- Word-level transcript provider boundary and context-aware filler-word decisions
- Host integration tests performed manually in Premiere

## Known host/API constraints

- Premiere UXP requires Premiere Pro 25.6+ and UXP Developer Tool 2.2+.
- The DOM can clone sequences and remove selected track items, but PodCut must first build and validate linked-item/ripple semantics before enabling safe automatic cuts.
- Silence thresholds are sensible speech-editing defaults but still need calibration against real Premiere sequence exports.
- A distributable extension must not contain transcription-provider secrets.
