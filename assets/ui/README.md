# assets/ui: Diesel King UI kit (integration notes for the Dev Lead)

Nothing here touches the game code. Load the kit with `<link rel="stylesheet" href="assets/ui/ui-kit.css">`. All its classes start with `dk-` and won't collide with existing classes. The CSS uses paths relative to `assets/ui/`.

## File map
| Path | What |
|---|---|
| ui-kit.css | tokens and classes: .dk-bg .dk-plate .dk-panel .dk-frame .dk-h(.--chrome) .dk-sub .dk-btn(--primary/--secondary/--danger) .dk-chip(--good/--bad) .dk-ico .dk-modal-scrim .dk-modal(__head/__body/__foot) .dk-truck-card(.is-active) .dk-banner(--levelup) .dk-badge(.is-locked) .dk-shine, plus the keyframes dk-banner, dk-pop and dk-shine |
| style-guide.md / style-guide.html | rules and the visual sheet |
| mockup-fleet.html | 390x844 sample screen (stats header, fleet cards, level-up banner, nav) |
| fonts/Rye-Regular.woff2 (+ OFL) | display font |
| icons.svg | sprite of 62 `<symbol id="i-NAME">` |
| icons/NAME.svg | the same icons as standalone files (24px, stroke = currentColor) |
| map/truck-{ironcrest,bannerline,highvale}[-active].svg | 40px top-down map markers; -active adds a gold ring and a crown |
| badges/*.svg | 128px medallions (bronze, silver, gold, diamond) |
| banners/level-up.svg, achievement.svg, banner-frame.svg, modal-header.svg | banners (banner-frame and achievement have an empty slot for HTML text) |
| frames/panel-frame.svg | 9-slice frame (slice 24) |
| textures/navy-noise.webp (7 KB), navy-tile.svg, diamond-plate.svg | tiling backgrounds |
| trucks/truck-{make}.webp (640x360) and -thumb.webp (256x144) | painted portraits on navy |
| source/ | build scripts (build_icons.py, build_art.py, contact_sheet.py) and Rye TTF |
| preview/ | contact sheets and the mockup PNGs (review only, don't ship) |

## Icons
Inline the sprite once (fetch it and insert it at the top of body, or paste it in). Then:
```html
<svg class="dk-ico"><use href="#i-cash"/></svg>
```
They inherit `color`. For a one-off you can also use `<img src="assets/ui/icons/cash.svg">`, but that version can't be recolored.

### Emoji to replace with icons
| Emoji in index.html | Icon |
|---|---|
| 💰 / `$` coin in cash pill | i-cash / i-coin |
| ⛽ | i-fuel |
| 🛣 / miles | i-miles |
| ⭐ ★ (rating, XP) | i-star / i-xp |
| LVL ring | i-level, or the crown in the mockup HUD |
| ⚖ (scale) | i-scale |
| 📍 Routes | i-lanes (or i-route) |
| 📊 | i-stats |
| ⚙ | i-settings |
| 🛒 Store | i-shop |
| 🚚 🚛 Fleet | i-fleet / i-semi |
| 🏠 Home | i-home |
| 🔥 Hot | i-hot |
| 📜 Contracts | i-contracts |
| 📋 Load Board | i-loadboard |
| ✅ | i-check |
| 🔁 🔄 | i-repeat / i-refresh |
| 🤖 autopilot | i-autopilot |
| 🔧 | i-repair |
| 🏢 | i-company |
| 🎁 | i-gift |
| 🔒 | i-lock |
| 💨 | i-speed |
| 😴 | i-sleep |
| 🎲 | i-dice |
| ⏱ ⏳ 🕐 | i-timer / i-hourglass / i-clock |
| 💡 | i-tip |
| 🌙 | i-night |
| ⚠ | i-warning |
| 🗺 🧭 | i-map / i-compass |
| 📦 ❄️ 🪵 (trailer types) | i-box / i-reefer / i-flatbed |
| ✕ | i-close |
| 👤 | i-user |
| 🏆 | i-trophy |
| 📣 | i-megaphone |
| 🚔 | i-police |
| 🔊 🔇 | i-sound-on / i-sound-off |
| 🛰 | i-satellite |
| 🏭 | i-factory |
| 📥 | i-inbox |
| 🚫 | i-ban |
| 🧹 | i-clean |
| 🔍 | i-search |
| 🛡 | i-shield |
| ⚡ | i-bolt |
| 🎉 | i-celebrate |
| 👉 👍 👋 😏 | i-point / i-thumbs / i-wave / i-smirk |
Bonus: i-crown.

## Map markers (Leaflet)
```js
const icon = (make,active)=>L.icon({iconUrl:`assets/ui/map/truck-${make}${active?'-active':''}.svg`,iconSize:[36,36],iconAnchor:[18,18]});
// rotate toward the heading with a CSS transform on the marker element if needed (the truck points north)
```
Use 32–40px. The markers are flat and include their own dark halo, so they read on both the dark and satellite basemaps.

## Truck portraits
For cards and the fleet list: `<img src="assets/ui/trucks/truck-ironcrest-thumb.webp">` inside `.dk-truck-card` (112px wide, 16:9, `object-fit:cover`, `background:#0b1220`). Use the 640px versions for detail or shop views. The make comes from the rig's brand: ironcrest, bannerline or highvale.

## Banners
```html
<div class="dk-banner dk-banner--levelup">Level 12</div>        <!-- art-only, the text is hidden; you can add a .dk-chip below it with the level -->
<div class="dk-banner">Hammer Lane Hero</div>                    <!-- banner-frame.svg with dynamic Rye text -->
```
Add the element, then remove it on `animationend` (2.6s). For achievements, show the badge SVG next to the banner.

## Badges
`<img class="dk-badge" src="assets/ui/badges/miles-10k.svg">`. Add `.is-locked` to gray it out. Files: first-load, miles-1k/10k/100k/1m, fleet-5/25/100, cash-100k/1m/100m/1b, contract-bronze/silver/gold/diamond, safety-5star, scale-clean.

## Modal
```html
<div class="dk-modal-scrim"><div class="dk-modal"><div class="dk-modal__head">Welcome back, boss!</div><div class="dk-modal__body">…</div><div class="dk-modal__foot"><button class="dk-btn dk-btn--primary">Collect</button></div></div></div>
```

## Sizes
Icons 18–28px, chips 30px tall, buttons at least 44px tall, badges 56–72px in lists (128 native), banners up to 360px wide on phone, markers 32–40px.
