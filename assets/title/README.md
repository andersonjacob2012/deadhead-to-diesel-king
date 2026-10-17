# Deadhead to Diesel King: title and branding assets

> **PRIMARY LOGO = western slab option 1 (Rye).** The crown is tilted and sits on the G of KING. `logo-stacked.svg`, `logo-full.svg`, `emblem.svg` and `icons/*` all use the new style and are made by `source/build_slab.py`. The old Oswald versions are kept in `source/legacy/`. File names have not changed.

All art is hand-built SVG, made by `source/build.py`. Run `python3 source/build.py` and then the rsvg/cwebp commands to rebuild. The text is outlined to paths from Oswald Bold (OFL), so no font loads at runtime. There are no real truck brands, logos or grilles anywhere in these files.

## Palette (from index.html :root)
| Token | Hex | Use |
|---|---|---|
| --bg | #0b1220 | navy background, outlines |
| --surf | #141f35 | emblem disc |
| --acc | #ffd84d | gold |
| (button shadow) | #b8942a | dark gold, bevel |
| (highlight) | #fff8c4 | gold highlight, headlights |
| --tx2 / --tx3 | #9fb0c9 / #7488a6 | chrome mids |
| #46587a | | chrome shadow |
| --acc-ink | #1a1300 | text on gold buttons |
Fonts: the UI uses Inter/system-ui. The logo uses outlined Oswald Bold.

## Files
| File | Where it goes | Min size |
|---|---|---|
| logo-stacked.svg / logo-stacked@3x.png (2400w, transparent) | title screen (`#title`), replaces the 🚚👑 + h1 | 240px wide |
| logo-full.svg / logo-full@2x.png (680x175 compact, no rule or stars) | header bar, e.g. height 36-44px | 160px wide (use the emblem below that) |
| emblem.svg (navy tile, tilted crown, Rye DK) | square mark, social avatar, loading | 64px |
| icons/favicon-32.png | `<link rel=icon>` | 32 |
| icons/apple-touch-icon-180.png | iOS home screen | 180 |
| icons/icon-192.png, icon-512.png | manifest | 192/512 |
| hero-{ironcrest,bannerline,highvale}-painted.webp (1024x576, 74-82KB) | **primary** title/hero art (painted) | |
| hero-{name}-portrait.webp (585x1266, 51-60KB) | tight portrait crop centered on truck front (alt for tall screens / loading) | |
| hero-{ironcrest,bannerline,highvale}.webp (1600x900) | **flat SVG fallbacks** (low-spec / style-alt), sources in source/hero-*.svg | |
| source/hero-*-painted.jpg | original painted 1280x720 masters | |
| source/*.svg, source/hero-*.png | flat-art sources and lossless PNG | |
| title-mockup-{ironcrest,bannerline}.html + -390x844@1x/@2x.png | title screen reference | |
| preview/ | review renders only, do not ship | |

The icons use `source/icon-simple.svg`, a flat tilted crown with solid colors and no texture or shadow, kept inside the 80% maskable safe zone, so it stays crisp at 32px. The worn texture (an feTurbulence filter) is meant for display sizes only.

## Fictional truck makes (originals)
- **IRONCREST**: navy and gold flagship long-nose
- **BANNERLINE**: oxblood with chrome trim
- **HIGHVALE**: racing green with gold
They work as upgrade or shop tiers. Their badges are plain pill nameplates, and the grilles are generic vertical-bar boxes.

## HTML snippets
```html
<link rel="icon" type="image/png" sizes="32x32" href="assets/title/icons/favicon-32.png">
<link rel="apple-touch-icon" href="assets/title/icons/apple-touch-icon-180.png">
<link rel="manifest" href="manifest.webmanifest">
<meta name="theme-color" content="#0b1220">
```
manifest.webmanifest:
```json
{"name":"Deadhead to Diesel King","short_name":"Diesel King","start_url":"./","display":"standalone",
 "background_color":"#0b1220","theme_color":"#0b1220",
 "icons":[{"src":"assets/title/icons/icon-192.png","sizes":"192x192","type":"image/png"},
          {"src":"assets/title/icons/icon-512.png","sizes":"512x512","type":"image/png","purpose":"any maskable"}]}
```
Title screen: see title-mockup-ironcrest.html / title-mockup-bannerline.html. Core lines:
```html
<div id="title" style="background:#0b1220 url(assets/title/hero-ironcrest-painted.webp) 52% 100%/auto 640px no-repeat">
  <!-- plus a ::before overlay: linear-gradient(#0b1220 0 26%, rgba(11,18,32,.75) 36%, rgba(11,18,32,.2) 48%, transparent 55% 72%, rgba(11,18,32,.9) 90%, #0b1220); BANNERLINE uses 22% 100% -->
  <img src="assets/title/logo-stacked.svg" alt="Deadhead to Diesel King" style="width:min(340px,86vw)">
```
Header: `<img src="assets/title/logo-full.svg" alt="Deadhead to Diesel King" height="36">`

## Notes
- Worn texture was reduced (alpha mask `-1.2 1.3`) so the text reads cleanly at phone size.
- Brand check on the painted art: the only readable text is the fictional nameplates (IRONCREST, BANNERLINE, HIGHVALE, TRUCK STOP). The small grille-top ovals have no text. The overall body styling follows classic long-nose conventionals; the IRONCREST hood/grille shape in particular is close to a real model, so legal should take a look before any commercial use.

## Western slab logo options (pending Jacob's pick; logo-stacked.svg not replaced yet)
Built by `source/build_slab.py`. Fonts (OFL) are kept in source/. All text is outlined to paths.
- options/logo-option-1-rye.svg: Rye throughout. Crown is cocked right and sits on the G of KING.
- options/logo-option-2-ultra.svg: Rye for "DEADHEAD TO", Ultra for DIESEL / KING on two lines. Crown leans on KING.
- options/logo-option-3-alfa-sancreek.svg: Sancreek for "DEADHEAD TO", Alfa Slab One for DIESEL KING. Crown is cocked left on the D.
Each option also has a .png (1200px on navy) and an @transparent.png (2400px). Comparison: preview/logo-options-sheet.png. In the title mockup: preview/mockup-slab-{1,2,3}.png

Previews: preview/mockup-{ironcrest,bannerline}-390x844.png, preview/preview-icons-zoom.png (32px at 8x, 180, 512 with the safe-zone circle, emblem), preview/preview-logo-{stacked,full}.png, preview/preview-emblem.png
