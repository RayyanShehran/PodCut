# PodCut status

## Completed

- Premiere UXP manifest v5 targeting Premiere Pro 25.6+
- Compact persistent panel UI and development demo review
- Recipe toggles, conditional settings, presets, Custom detection, and validation
- Active sequence metadata, track, and clip inspection through documented Premiere APIs
- Host-independent range, padding, duration, preset, and decision logic tests
- Dependency-free build and manifest checks

## Partially implemented

- Analysis workflow: sequence inventory is real; audio-content analysis is not implemented
- Edit decisions: data model and silence-range conversion exist; no detector feeds them yet
- Non-destructive editing: safe workflow is defined, but timeline mutation remains disabled

## Mocked

- **Preview Demo Review** counts, durations, and detected-edit rows only; all are labelled `DEMO DATA`

## Requires Premiere validation

- UXP manifest loading and panel lifecycle
- Narrow-panel HTML/CSS rendering and focus behavior
- Active project, sequence, track, and clip reads against real projects
- Error behavior for empty, offline, nested, multicam, and unusual sequences

## Planned

- Audio reference/export and silence detector
- Per-decision review controls
- Clone active sequence, rename it with a `— PodCut` suffix where the DOM permits, then apply reviewed edits in an undoable transaction
- Word-level transcript provider boundary and context-aware filler-word decisions
- Host integration tests performed manually in Premiere

## Known host/API constraints

- Premiere UXP requires Premiere Pro 25.6+ and UXP Developer Tool 2.2+.
- The DOM can clone sequences and remove selected track items, but PodCut must first build and validate linked-item/ripple semantics before enabling safe automatic cuts.
- A distributable extension must not contain transcription-provider secrets.
