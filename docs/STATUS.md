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
- On September 26, Premiere 26.5 imported `podcut-internal-pauses.mov` as one linked 36-second video/audio clip. PodCut exported a 48 kHz stereo 16-bit WAV in 1.54 seconds and reviewed the two inserted internal pauses: padded silence removal `10.250–11.800s` and long-pause removal `22.550–25.450s`. The unchanged 36-second source sequence had one video and one audio item throughout analysis.
- On a disposable sequence clone, Premiere's documented overwrite-clone, source-in trim, and move actions produced matching V1/A1 retained ranges: `[0, 10.266667]` from source `[0, 10.266667]`, then `[10.266667, 34.466667]` from source `[11.8, 36]`. Both streams ended at 34.466667 seconds, while the original sequence remained 36 seconds. The proposed 10.250-second boundary snapped to the next 30 fps frame. The successful copy and untouched original are saved in `C:\Projects\PodCut-TestMedia\Fixtures\PodCut Fixture Proof.prproj` (outside Git).
- This is **not yet a safe Apply implementation**: the proof required separate transactions. One Premiere Undo moved only the second audio item back to 22.066667 seconds while video stayed at 10.266667 seconds; Redo restored A/V alignment. A second disposable copy tested a grouped trim/move transaction; Premiere returned `Invalid parameter` yet changed the video in-point, leaving audio unchanged. That failed copy was deleted. A single atomic, undo-safe operation and partial-failure recovery are unproven, so Apply remains disabled.

### September 26 transaction isolation (Premiere 26.5)

All checks below used additional disposable sequence copies in the fixture proof project; the original `podcut-internal-pauses` sequence (GUID `b1befdc7-5c2f-4862-aa40-871a0b199002`) remained untouched. These new copies were not saved over the proof project.

- A single `executeTransaction` containing video and audio `createCloneTrackItemAction` calls returned `true`. On copy `6233d670-108c-4694-b226-91114c20ea0e`, both tracks had `[0, 10.266667]` (source `[0, 10.266667]`) and `[10.266667, 46.266667]` (source `[0, 36]`). Both `CompoundAction.addAction` calls returned `true`.
- A grouped `createSetInPointAction(11.8)` and `createSetStartAction(10.266667)` for each second item returned `true`, but the `createSetStartAction` calls did **not** restore the timeline start: both second items ended at `[22.066667, 46.266667]` from source `[11.8, 36]`. A following grouped pair of `createMoveAction(-11.8)` calls returned `true` and put both at `[10.266667, 34.466667]` with matching source `[11.8, 36]`. These are separate Undo steps, not one atomic cut.
- Minimal failure reproduction on copy `c62583d6-5af7-4ede-8d42-34679a49a432`: starting from V1 `[0, 10.266667]` and `[10.266667, 46.266667]`, `executeTransaction` added `secondVideo.createSetInPointAction(11.8)` successfully, then **constructing** `secondVideo.createMoveAction(-11.8)` threw `Error: Invalid parameter` before `addAction` for the move could run. The first action nevertheless executed. After the exception, V1 was `[0, 10.266667]` and `[22.066667, 46.266667]` (source `[11.8, 36]`); A1 was still `[0, 36]`. Thus the prior four-action failure occurred at the move-action constructor, not in the audio action or an async callback. The likely validity issue is that a -11.8-second move is invalid against the item's **pre-trim** start of 10.266667 seconds; the API validates actions before deferred earlier actions change the item. The validation rationale is inferred, not documented by Adobe.
- `lockedAccess` and transaction callbacks were synchronous; item/time reads were completed before entering them. The grouped clone and grouped move tests show that corresponding A/V actions can share a transaction when their inputs are valid. The failed transaction proves the host does not guarantee rollback when action construction throws after an earlier action was added. Any future implementation must construct/validate **every** action before adding the first one and still verify the result; that alone does not solve the deferred trim/move dependency or provide a one-step Undo.
- A different documented path succeeded for one cut on a fresh candidate copy `cfca8f65-bc38-4ecb-8ae9-6cdec422a553`: `ClipProjectItem.createSubClipAction` prepared source `[11.8,36]` in a prior transaction. One subsequent sequence transaction preconstructed and added V1/A1 `createSetOutPointAction(10.266667)` plus one `SequenceEditor.createOverwriteItemAction(subclip, 10.266667, 0, 0)`. It returned `true` and yielded two adjacent items on each track, ending at 34.466667 seconds. The second track-item in/out is `[0,24.2]` relative to the subclip; the subclip was constructed from source `[11.8,36]`. The original still had one 36-second item per track. After opening the candidate in Premiere, one native Ctrl+Z restored exactly one `[0,36]` V1 item and one `[0,36]` A1 item. One native Edit > Redo restored the same two-item A/V candidate and 34.466667-second end. This proves a coherent **sequence-edit** Undo step for this fixture; subclip preparation and candidate cloning have separate Undo history, and playback was not yet audibly checked. Apply remains disabled.
- Both reviewed cuts were tested on another candidate copy `3f51ae26-e48a-41c7-bee0-24cedf186e09` with precreated subclips. At 30 fps the starts `10.250` and `22.550` snap forward to frames 308 (`10.266667`) and 677 (`22.566667`); the ends `11.800` and `25.450` snap to frames 354 (`11.8`) and 764 (`25.466667`). One sequence transaction shortened the original V/A pair to frame 308 and overwrote the retained subclips `[11.8,22.566667]` and `[25.466667,36]` at destination frames 308 and 631. Premiere returned `true`; V1 and A1 each had adjacent spans `[0,10.266667]`, `[10.266667,21.033333]`, and `[21.033333,31.566667]`. The end is frame 947/30 = **31.566667 seconds**, matching the quantized plan rather than subtracting raw detector decimals. Original V1/A1 remained one `[0,36]` item. One native Ctrl+Z restored the candidate to one `[0,36]` V1/A1 pair; one native Ctrl+Shift+Z restored the same three-item pairs. No gap or overlap appeared in the item boundaries. This does not yet prove playback sync, trimmed source in-points, or robust failure handling.
- A trimmed-in source layout was then staged on copy `6271bc9c-4a87-4b70-8627-47581876799c`: one V1/A1 item at timeline `[0,31]` from source `[5,36]`. A source `[16.8,36]` subclip plus one grouped V1/A1 out-point and overwrite transaction produced adjacent V1/A1 spans `[0,10.266667]` from source `[5,15.266667]` and `[10.266667,29.466667]` from the subclip (relative source `[0,19.2]`). Premiere returned `true`. One native Undo restored one `[0,31]` item per track with source `[5,36]`; Redo restored the two-item 29.466667-second result. This confirms the source-offset arithmetic on one trimmed-in 30 fps case, not arbitrary trims or non-unit speed.

The original timeout came from relying on the completion-event wait path alone. The current workflow also polls the unique output, requires the export promise to resolve true, parses a complete WAV, and verifies its duration before analysis or deletion.

## Controlled fixture derived from real interview footage

- CC0 source: [Wikimedia Commons, Entrevista (Parte 1).webm](https://commons.wikimedia.org/wiki/File:Entrevista_(Parte_1).webm); unchanged local source: `C:\Projects\PodCut-TestMedia\Wikimedia\Entrevista (Parte 1).webm`.
- Rebuild with `powershell -File scripts/make-internal-pause-fixture.ps1` from the repository. Its defaults use FFmpeg at `C:\Projects\PodCut-TestMedia\Tools\ffmpeg-9.0.2\ffmpeg.exe`; all paths can be overridden with `-Ffmpeg`, `-Source`, and `-Output`. It also extracts a same-name `.wav` beside the MOV for `PODCUT_FIXTURE_WAV=... node --test test/fixture.test.js`. The media and FFmpeg binary are intentionally outside Git. The downloaded FFmpeg archive SHA-256 matched the publisher checksum: `4705843CCAAF54257C16AD90F3E952ECE33C17DF964ECF7BFDBB0F49C7171077`.
- Source has 1920×1080 VP9 at 30 fps and 44.1 kHz stereo Vorbis. The script uses source `[4,14]`, `[20,30]`, and `[36,46]` seconds. Output mapping is source `[4,14]` → output `[0,10]`; held frame plus silent stereo `[10,12]`; source `[20,30]` → `[12,22]`; held frame plus silence `[22,26]`; source `[36,46]` → `[26,36]`. Both audio and video are shifted together.
- Output: `C:\Projects\PodCut-TestMedia\Fixtures\podcut-internal-pauses.mov`, 36.000-second 1280×720 H.264 30 fps (1080 frames) plus 48 kHz stereo 16-bit PCM, also 36.000 seconds. The 20 ms detector found raw qualifying ranges `[10,12]` and `[22,26]` under unchanged Natural, Balanced, and Tight thresholds. Premiere's padded review boundaries above need not equal the raw silence boundaries.
- This controlled fixture proves pipeline timing, **not** natural-pause detection quality. Its interview audio was decoded, but audible speech quality was not personally listening-checked; visual footage shows an interview before and after the inserted holds.

## Still requires Premiere validation

- The unmodified interview remains a regression case: its extracted WAV produced no qualifying internal pause, which can be correct. Its audible speech quality has not been listening-checked. Cinestudy's larger 17:31 source remained unavailable from Google Drive; no recording from the user is needed for the controlled fixture.
- A single atomic, undo-safe internal cut, partial-failure recovery, and multiple cuts are not proven. Do not connect Apply until those are demonstrated on disposable sequences, including source mapping and sync after each cut and near the end.
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
- [SequenceEditor](https://developer.adobe.com/premiere-pro/uxp/ppro-reference/classes/sequenceeditor) has no documented razor/split action; `createRemoveItemsAction` removes whole selected items, not time intervals. [Sequence.createCloneAction](https://developer.adobe.com/premiere-pro/uxp/ppro-reference/classes/sequence) and [Project.lockedAccess / executeTransaction](https://developer.adobe.com/premiere-pro/uxp/ppro-reference/classes/project) worked in Premiere 26.5, but track-item overwrite cloning handled video and audio separately. `createSetInPointAction` shifted the second item's sequence start; `createMoveAction` restored its timeline position while retaining the new source in-point.
- The exact product blocker is transaction safety, not missing test footage: separate video/audio operations can be undone into a desynchronized state, and a four-action grouped transaction returned failure after partially changing video. No documented rollback guarantee or linked-pair cut primitive was found. Do not equate this successful disposable retained-segment experiment with a safe general Apply feature.
