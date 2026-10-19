# Map pins: enamel side-profile semi (first round for Jacob's approval)
- `pin-{a,b,c}-{ironcrest,bannerline,highvale}.svg`: the truck only, facing RIGHT. viewBox 0 0 128 64 (2:1), so a 40px-wide marker is 40×20.
  - A: gold-rim pin. B: pin on a navy shield plate. C: chunky, simplified.
- `lights-{a,b,c}.svg`: the marker/chicken-light layer. It uses the same viewBox and stacks exactly on top of the pin.
  - Dots are `.ck` with `--i` set and are filled with currentColor; the soft glow is built in.
  - Set the root `color` to the palette color (amber #ffb020, red #ff3b30, blue #3da5ff, green #3dff7a, purple #b46bff, white #f4f7ff).
  - For chase, inject the existing `dk-ck--chase` style (hsl by --i). Bake the color into blob-URL `<img>`s the same way chicken.js does.
- `oos-badge.svg`: red wrench badge. For out of service: `filter:grayscale(1) brightness(.75)` on the pin, a red ring, and the badge at top-right.
- Heading: don't rotate the pin. Use the lane's east/west component to choose a side: heading 0–180° shows it as drawn (right-bound), 180–360° adds `transform:scaleX(-1)` (left-bound). Flip the pin and the lights together, and keep the badge unflipped.
- Rebuild: `source/build_pins.py`; previews come from `source/sheet.html` and `render.js` (serve the repo on :8765).

## Round 2 (long-nose conventional)
- `v2-ironcrest-black.svg` (V1) and `v2-ironcrest-cream.svg` (V2): side profile facing RIGHT, viewBox 0 0 160 64 (2.5:1), so a 40px marker is 40×16. Mirror with `scaleX(-1)` for left-bound, same as round 1.
- `v2-lights.svg`: 20 lights (cab roof, sleeper roof and side, frame, tank row, bumper ends). They use currentColor with a glow, and dots are `.ck` with `--i` for chase.
- Built by `source/build_v2.py`; the sheets come from `source/sheet-v2.html` and `render-v2.js`.

## Round 3: gloss-black long-nose (traced)
- `v3-ironcrest-black.svg`: the detailed truck for zoomed and large views, facing RIGHT. viewBox 0 0 320 160; 1 unit = 1 inch. The drawing is built front-left in source and mirrored inside the SVG, so the file faces right. 64px wide → 32px tall.
- `v3-small.svg`: the map-size version (same geometry). Thicker stacks and grille, a 1px slate outline, brighter gloss bands, and no fine detail (lugs, seams, tank straps). Brighter chrome and gloss bands, a soft built-in drop shadow, and larger lights. **Use this one at about 64px.**
- `v3-lights.svg` / `v3-lights-small.svg`: the tint layers, matching viewBox; dots are `.ck` with `--i`, in currentColor with a soft glow. Lights go on the visor/cab roof, sleeper roof, cab and sleeper side panels, tank straps, step edge, bumper end, frame and the red frame-end light. None sit on a tire. Chase works as in round 1.
- Heading: right-bound as drawn; left-bound uses `transform:scaleX(-1)` on the truck and lights together.
- Proportions come from a side photo of a real long-nose conventional ("Peterbilt 379 tractor, 2102.jpg", Wikimedia Commons, Greg Goebel, CC BY-SA 2.0). I corrected the photo's perspective (`source/rectify_ref.py`, calibrated on the 41" steer tire and the 52" tandem spread) and drew over it. Measured: bumper→grille 4.5", grille→cowl 62", cab 52", sleeper 74", steer axle 42" behind the bumper, drives at 292"/344", frame end 372".
- `preview/v3-overlay-check.png` contains that photo, so it is for internal review only and must not ship. Rebuild: `source/build_v3.py`; sheets come from `source/sheet-v3.html`, `overlay-v3.html` and `render-v3.js`. The overlay needs `/workspace/rigwork/v3ref` served at `/rigref`.

- Fix pass (Oct 19): the tandem drives moved forward so the front drive sits just behind the sleeper (axles at 237"/289"), with 24" of frame past the rear axle; overall length is 313" (was 372"). The hood is 18% longer (grille→cowl 73"). Both SVGs now face right. v3-small is brightened. `preview/v3-overlay-check.png` is from before this pass and no longer matches; it is review-only either way.

## v3 paints (recolorable)
The file names stay `v3-ironcrest-black.svg` and `v3-small.svg`; their paint is now recolorable and defaults to gloss black. Body paint uses `var(--dk-paint, …)`, `var(--dk-paint-hi, …)` (gloss bands) and `var(--dk-paint-lo, …)` (lower-body shade). Chrome, tires, glass and lights are unchanged.
- Inline `<svg>`: set the three custom properties on the svg or on a parent.
- Blob-URL `<img>` (how the game renders rigs): string-replace the fallback hexes before building the blob, and cache one blob per paint.
- The values are also in `paints.json`.

| paint | base | hi | lo |
|---|---|---|---|
| gloss-black | #101218 | #4a5263 | #05060a (small: #1b1f28 / #8a93a6 / #0b0d12) |
| ivory | #ece0bf | #fffaea | #b8a57a |
| candy-red | #d8141f | #ff6a6a | #6e0710 |
| candy-orange | #ff6a00 | #ffb36b | #8f3300 |
| candy-yellow | #ffcc12 | #fff38a | #a87a00 |
| candy-green | #22c83a | #9cff8a | #0b6a1c |
| candy-purple | #9a4cff | #d8b0ff | #4a1585 |
