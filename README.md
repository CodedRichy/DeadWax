# Deadwax

A desktop turntable that renders **your** copy of what's playing — worn exactly as much as you've actually played it.

Prototype stage. This repo currently contains the platter renderer only, not the app.

## What's here

| file | what it is |
|---|---|
| `deadwax-platter.html` | The whole prototype. Single-file WebGL2 platter + interactive tonearm. Open it in a browser. |
| `shot.js` | Playwright capture across wear / density / light / spin states |
| `test-interact.js` | Drives real pointer events to verify the arm drags and seeks |
| `0*.png` | Reference captures |

## Running it

Just open `deadwax-platter.html`. No build, no dependencies.

For screenshots:

```bash
npm i -D playwright
npx playwright install chromium
node shot.js
node test-interact.js
```

## What the renderer does

One fullscreen quad, one fragment shader. No geometry, no Three.js.

- **Real RIAA dimensions** — 301.6 mm disc (never a true 12"), 7.26 mm hole, label 100 mm, music band 120.7–292.1 mm dia
- **Groove bands are the album** — variable-pitch cutting means loud passages force wider spacing, so the visible banding is the song structure. Band width is track length.
- **Wear is per-track play count**, mapped to radial position — grooves you've worn reflect softly, tracks you've never reached stay mirror-sharp. Gloss loss only, never grime. Normalised against your own maximum on a log curve.
- **Anisotropic specular** with the tangent following the groove circle, so reflections smear into arcs the way real vinyl does
- **Retroreflective iridescence** at grazing incidence only, banded radially
- **Rotation cues that are physically real** — warp (no record is flat), off-centre pressing (~0.7 mm), a hairline scratch, dust. Concentric grooves can't show rotation on their own.

## Interaction

- **Drag the tonearm** to seek. Readout names the track, position and play count.
- Arm lifts while carried, drops when released.
- **Cue lever** raises and pauses.
- Drag the background to move the light; scroll to zoom.

Every gesture maps to a real Windows SMTC call (`TryChangePlaybackPositionAsync`, `TryPauseAsync`, `TryPlayAsync`), so none of it is a mockup that can't be built.

## The deck

The camera is a real perspective camera — per-pixel ray against the record plane,
not a squashed ellipse. Orbit it and the record reads as a solid object.

- **Plinth** with start/stop, 33/45 with a green pilot, pitch fader and centre
  detent, red strobe lamp, power switch, dust-cover hinge sockets, badge plate
- **Strobe dots** on the platter rim, four rows, lit only by the red lamp.
  Technics kept the strobe long after it was functionally obsolete because DJs
  touched the dots to nudge speed — the vestigial detail is the culture.
- **Arm base furniture** — every piece is a solid standing on the deck (bottom
  ellipse, side quad, top ellipse), depth-sorted painter's algorithm so nothing
  punches through the pillar when the camera swings behind it. Gimbal pillar,
  knurled anti-skate dial, cue lever whose paddle throws when you cue, arm rest
  with a fork clip.

## Known issues

- Tonearm is still stylised — the S-bend and headshell need work
- Track band edges are softer than real pressings
- Platter mat barely reads
- Label is canvas-drawn placeholder art
- No plinth feet — the deck is a flat plane with no side thickness, so they'd
  have nothing to attach to
- Widget mode not built: same renderer, camera pulls in and the plinth is hidden.
  At 180px the full deck is illegible clutter.

## Status

The product thesis is narrower than it started. **Longplay** (iOS/Mac) already ships the play-count-sized album wall and a "Negligence" sort — it's the incumbent. What's left as genuinely novel is wear-as-texture on a photoreal record, and Windows, which no competitor serves.

Next step is to make the record good enough to post, then post it. Visual products validate visually.
