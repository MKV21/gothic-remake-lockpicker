# Image Pin Detection Spec

Status: Draft, waiting for representative image samples.

## Goal

Add a browser-local image detector that can take a Gothic 1 Remake lock
screenshot or smartphone photo and set the existing solver state automatically:

- number of gates, 4-7
- initial/start pin per detected gate, 1-7

The detector writes directly into the current solver UI. Users correct mistakes
with the existing gate count and pin controls; there is no separate review or
confirmation screen.

## Non-Goals

- Detect target pins.
- Detect link relationships.
- Detect or suggest chest names.
- Upload, store, or submit images to the server.
- Save images in localStorage or the database.
- Require per-image manual calibration.

## User Flow

1. User opens the image import control near the gate count controls.
2. User selects an image or takes a camera photo on mobile.
3. The browser decodes the image locally.
4. The detector estimates gate count and start pins.
5. The app applies the result directly:
   - `state.gateCount = detectedGateCount`
   - `state.cards[i].startPin = detectedPin - 1`
   - `state.cards[i].currentPin = detectedPin - 1`
6. Existing solver cards re-render and database matching starts from the detected
   gate count and start pins.
7. User corrects any wrong values in the normal solver UI.

## UI Requirements

- Add a compact image import section in the setup area, close to the gate count.
- Use a file input with `accept="image/*"`.
- On mobile, allow camera capture with `capture="environment"` where supported.
- Show a short status after detection:
  - success: detected gate count and pin list
  - partial: which gates could not be confidently detected
  - failure: why no usable lock was detected
- Keep images local to the browser session only.
- Do not add another pin-editing UI; the existing solver is the correction UI.

## Detection Strategy

The first implementation should use deterministic computer-vision heuristics in
Canvas/ImageData, not a machine-learning model.

Pipeline:

1. Normalize image.
   - Decode into an offscreen canvas.
   - Respect browser-applied image orientation.
   - Downscale to a fixed maximum size for predictable performance.
   - Build grayscale and contrast-enhanced buffers.
2. Find candidate hole rows.
   - Detect dark circular or elliptical blobs with edge contrast.
   - Prefer rows containing roughly seven evenly spaced candidates.
   - Estimate each row as a 2D line segment from hole 1 to hole 7.
3. Estimate gate count.
   - Cluster stable seven-hole rows.
   - Accept only 4-7 rows.
   - Sort rows by in-game gate order.
4. Detect pin position per gate.
   - Search near each row for the brightest/metallic pin blob.
   - Project the blob center onto the row segment from hole 1 to hole 7.
   - Convert projection into nearest pin number 1-7.
5. Score confidence.
   - Row confidence: seven-hole regularity, contrast, row spacing.
   - Pin confidence: blob contrast, distance to row, projection inside row.
   - Overall result should expose confidence per gate.

Initial behavior:

- Apply high-confidence pins.
- Leave low-confidence gates unchanged or unset.
- Show status so the user knows which gates need manual correction.

## Sample Dataset Needed

Use a small checked-in fixture dataset only if screenshots are safe to publish.
If images contain anything personal or copyrighted beyond game UI, keep them out
of the public repository and use a private/manual test folder instead.

Preferred sample naming:

```text
g6_3-4-2-6-1-5.png
g5_1-7-4-2-3.jpg
```

Minimum useful set:

- 10-20 in-game screenshots.
- 10-20 smartphone photos if phone capture should be supported in the first
  release.
- Coverage for 4, 5, 6, and 7 gate locks.
- Different brightness levels, crops, and viewing angles.

For every sample, record:

- gate count
- start pins, ordered by solver gate order
- whether it is a screenshot or camera photo
- any notable issue, for example motion blur, bad crop, or low light

## Acceptance Criteria

MVP:

- Image selection works on desktop and mobile browser.
- No image data leaves the browser.
- Correctly detects gate count and all start pins for a representative set of
  clean screenshots.
- Applies detected values to the existing solver state.
- Existing manual solver controls remain the correction path.
- Unit tests cover pin projection from row geometry to pin number.
- Fixture tests cover the initial sample set once images are available.

Follow-up:

- Improve camera-photo support after evaluating the first real photo set.
- Add optional debug overlay for development builds if detector tuning needs it.
- Consider ML only if deterministic heuristics cannot reach acceptable accuracy
  on real samples.

## Open Questions

- Should uncertain pins be left unchanged, set to `null`, or set as best-effort?
  Current recommendation: leave unchanged when confidence is low and show a
  status message.
- Should users be able to paste screenshots from clipboard in addition to file
  selection?
- Can game screenshots be committed as public test fixtures, or should the sample
  set stay private?
