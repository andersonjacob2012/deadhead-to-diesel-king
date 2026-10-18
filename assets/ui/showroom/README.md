# Chicken-light showroom (picker demo)

A big, parked, lights-on **top-down** view of your rig in a dark parking stall outside the shop, with a chicken-light color picker.
It's built for players who can't make out the rig art on the moving map.

**Status:** approved by Jacob (Oct 17, 2026) and wired into the game: Fleet header **Chicken Lights** button, the truck stats card (opens on that truck's make) and Settings all open it as a full-screen sheet (`openShowroom()` / `closeShowroom()` in index.html; showroom.css/js are lazy-loaded on first open).
The demo files (`demo.html`, `demo.js`, `preview/`) were not shipped; they live in the art working copy only.

Game wiring: `current` = `ckCur()` (S.chicken), `onApply` = `setChicken(id)` (re-skins map rigs), `gated` = `!CK_ALL_FREE` (false on web: no locks/ads/$2.99), `onUnlock` = `ckAdUnlock(id)` (stub until the ad SDK: saves `S.ckProg`/`S.ckOwn` per the spec), `onBuyAll` = `ckBuyAll()` (only passed when gated), costs = rigs.json `chicken.palettes[].cost`. Make chips are preview only (a truck's make is fixed at purchase). Regression: `/workspace/pw/reg-showroom.js`.

| File | What |
|---|---|
| `demo.html` | Demo page. Links `../ui-kit.css`, `../map-rigs/rigs.css`, `showroom.css`; loads `../map-rigs/chicken.js`, `showroom.js`, `demo.js`. |
| `showroom.css` | All showroom styles, prefixed `dk-sr`. Uses the ui-kit tokens and `dk-panel` / `dk-btn` / `dk-modal`, with Rye for display text and Inter for body text. |
| `showroom.js` | Reusable component, `window.DKShowroom.mount(el, opts)`. No game globals. |
| `demo.js` | Demo wiring only: fake 3 s rewarded ad, localStorage, URL params. Throw away on integration. |
| `preview/` | 390x844 PNGs (amber Apply, blue locked, chase frame), a desktop 1440x900 shot, `sheet-showroom.png`. |

## Rig art
The showroom uses the same **map-rig SVGs** as the map: `tractor-{make}.svg`, `trailer-53.svg`, the beam and marker layers, and `DK_CHICKEN` from `chicken.js`.
That way the paint and light positions match the moving map exactly. The view is plain top-down, nose up (the map-sprite orientation), parked nose-in at the shop wall. There is no 3D, perspective or tilt. Pointing up fills the portrait 390x844 stage better than laying the rig horizontal. JS sizes `--u` so the whole rig fits the stage height: about 1.4 px per unit at 390x844 (3.4x the map size) and about 1.9 on desktop.
The painted `trucks/truck-*.webp` art has its lights baked in and can't be recolored, so it's only used for the make-chip thumbnails.

Night glow (cheap and static): headlight beams with a flat headlight pool and a wash on the wall, marker lights, and full-strength chicken layers with a small static `drop-shadow` halo and a slow opacity "breathe". The pavement gets a flat radial-gradient color pool (a static rainbow for chase), plus a box-shadow contact shadow, worn gold stall stripes, a wheel stop, and the neon "DIESEL KING" sign on the wall strip. No blur filters, masks, 3D transforms or animated backgrounds.

## Mount
```js
const sr = DKShowroom.mount(document.getElementById('showroom'), {
  rigsBase: 'assets/ui/map-rigs/',          // tractor/trailer/light SVGs
  trucksBase: 'assets/ui/trucks/',          // make-chip thumbnails (optional)
  palettes: rigs.chicken.palettes,          // [{id, class, color, unlock, cost?}]
  costs: DK_CFG.ckCost,                     // ads per color when a palette has no `cost` (missing -> 2)
  current: S.chicken || 'amber',            // CURRENT PALETTE (equipped)
  unlocked: S.ckOwn,                        // UNLOCKED SET; palettes with unlock:'default' (amber) are always owned
  progress: S.ckProg,                       // ads already watched per color, e.g. {chase:1}
  gated: GATED(),                           // false = every color free, no locks/ad UI (web today, fail-open)
  make: 'ironcrest', makes: ['ironcrest','bannerline','highvale'], makeNames: MAKEN,  // optional make switcher
  onApply(id) { setChicken(id); },          // equip an owned color
  async onUnlock(id, info) {                // info = {cost, progress}
    return Ads.showRewarded('chicken_unlock', { id });   // MUST resolve {status:'rewarded'|'dismissed'|'no_fill'|...}
  },
  onBuyAll() { /* Light Bar Bundle IAP */ }, buyAllPrice: '$2.99',  // optional; the button only shows if provided
  onClose() { /* close sheet */ },          // optional; shows the back button
  onMake(make) {},                          // optional
});
```

### Callback contract
- **Tapping a swatch only previews it.** Nothing is saved. Locked colors preview too.
- **Owned color:** the button reads **Apply**. Tapping it calls `onApply(id)`. Once equipped it reads **✓ Equipped** and is disabled.
- **Locked color:** the button reads **Unlock · Watch N ads**, or **Watch K more ads (p/c)** once there's progress. Tapping it calls `onUnlock(id, {cost, progress})` and shows a busy spinner until it resolves.
  - `{status:'rewarded'}`: the showroom does `progress[id]++`.
    - If progress reaches the cost, or you return `{status:'rewarded', unlocked:true}`, it adds the color to the unlocked set, **auto-applies it** (calls `onApply`) and toasts "X unlocked and equipped!".
    - Otherwise it toasts "Ad n of m done".
  - `dismissed`: no change, silent.
  - Anything else: toasts "No ad available right now".
  - The game stays the source of truth. Persist `S.ckProg` / `S.ckOwn` yourself inside `onUnlock`, or after it resolves, using the same rule. Then call `sr.setUnlocked()` / `sr.setProgress()` if they differ.

### Instance API
`sr.current`, `sr.previewing`, `sr.unlocked`, `sr.progress` (getters);
`sr.preview(id)`, `sr.setCurrent(id)`, `sr.setUnlocked(ids)`, `sr.setProgress(obj)`, `sr.setGated(bool)`, `sr.setMake(make)`, `sr.refresh()` (call it after toggling `body.lowfx`), `sr.destroy()`.

### Game mapping (per business/ad-unlock-spec.md)
| Showroom | Game |
|---|---|
| `current` / `onApply` | `S.chicken` / `setChicken(id)` |
| `unlocked` | `S.ckOwn` (plus `ent('adFree')` / `ent('lightBar')`: pass all ids, or `gated:false`) |
| `progress` | `S.ckProg` |
| `gated` | `GATED() && !CK_ALL_FREE()`. On web today this is `false`, so every color is free and there's no lock UI |
| `onUnlock` | `Ads.showRewarded('chicken_unlock', …)` |
| `costs` | the `cost` field on rigs.json palettes (fallback 2) |

## Ad costs: where they came from
`business/ad-unlock-spec.md` §2 (`DK_CFG.ckCost`) and §5, plus `business/monetization-plan.md` R8 / §5a:
**amber free; red, blue, green, white = 1 ad; purple = 2; chase = 3; future palettes default to 2.**
Progress is saved, and the color auto-equips when complete. "Get all colors · $2.99" is the Light Bar Bundle.
rigs.json now carries `cost` per palette (amber 0, red/blue/green/white 1, purple 2, chase 3); the game reads it from there.

## Motion / low-FX
- Chase animates the lights (inside the chicken SVG) and the swatch dot. The pavement pool is static.
- `prefers-reduced-motion: reduce` **or** `body.lowfx` → `dk-sr--still`. All animation stops, chase becomes a static rainbow, and the beam flicker and breathe effects are off.
- `body.lowfx` also removes the chicken halos (`filter`) and the contact-shadow blur. The rig-layer rules in rigs.css also hide the beams under lowfx and reduced motion.

## Layout
Mobile-first, sized for 390x844 (no scroll there). The stage is `clamp(300px, 100svh - 408px, 560px)`, so taller phones get a bigger rig. At ≥860px it switches to a two-column layout: stage left, 400px panel right.
The rig scale follows the stage size through a ResizeObserver. Swatches are a keyboard radiogroup (arrow keys).

## Demo URL params
`?view=blue` preview a color · `cur=green` equipped · `own=red,blue` owned · `make=highvale` · `free` ungated · `lowfx` · `fresh` ignore saved state · `nosave`.
The ad is faked: a 3 s modal with "Close early" (counts as dismissed). State lives in localStorage `dk-showroom-demo`.
