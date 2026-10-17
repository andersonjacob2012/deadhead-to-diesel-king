# map-rigs: top-down articulated rig sprites

Tractor and trailer are drawn and rotated separately; light effects are separate layers on top. Everything here is hand-built SVG made by `../source/build_rigs.py`, about 1–4 KB per file. **All sprites point UP: heading 0 = north, rotated clockwise in degrees.**

## Files
| File | Purpose |
|---|---|
| tractor-{ironcrest,bannerline,highvale}.svg | tractor, viewBox 0 0 40 96: long hood, chrome grille and bumper, fenders with steer tires, cab with drop visor, stacks, sleeper, fifth wheel, 4 dual drive tire blocks |
| trailer-53.svg / trailer-53-plain.svg | 53' dry van, viewBox 0 0 40 190 (with or without the crown roof stencil) |
| tractor-chicken.svg / trailer-chicken.svg + chicken.js | **chicken lights**: rows of glowing marker dots (tractor 52, trailer 55). chicken.js exposes `window.DK_CHICKEN.tractor/.trailer` as SVG strings; the game bakes them into cached **blob-URL `<img>`s** (see Chicken lights) |
| legacy/ | old gold-glow + crown `-selected` variants and trailer-halo.svg, superseded |
| far-{make}.svg / far-{make}-selected.svg | 28px single-piece chip for zoomed-out views (rotatable; selected = thin chrome ring, no yellow halo) |
| tractor-lights.svg | headlight bloom + amber visor, cab and fender markers (viewBox -30 -90 100 190) |
| tractor-beams.svg | two warm headlight cones (same viewBox as tractor-lights; the yellow halo was removed) |
| trailer-lights.svg | amber side clearance + red tail lights (viewBox -10 -10 60 210) |
| rigs.json | all viewBoxes, pivots, transform origins, layer order, opacities, zoom scale table and the kinematics formula |
| rigs.css | ready-made layer classes and light toggles |
| demo.html | articulation demo: Night, Lights off, Reduced FX, Selected, Make, Size, Follow path/kinematic and Curve normal/tight toggles, plus a chicken-light palette picker |

## Pivots (SVG units, shared scale)
- Tractor kingpin / fifth wheel: **(20,80)**. Front bumper (20,1), steer axle (20,18.5). Front to kingpin = **79u**.
- Trailer kingpin: **(20,12)**. Rear axle center: **(20,166)**. Kingpin to rear axle = **154u**.
- Light layers use the same units; their kingpin is still at (20,80) for the tractor and (20,12) for the trailer, only the viewBox is bigger.
- Scale: px per unit `u = tractorPx/96`, and the same `u` is used for every layer.

## Zoom table (Leaflet)
| Zoom | Draw | Size |
|---|---|---|
| ≤ 6 | far chip | 28px |
| 7–8 | rig | tractor 30px (trailer 59px) |
| 9–10 | rig | tractor 40px (trailer 79px) |
| ≥ 11 | rig | tractor 52px (trailer 103px) |
At zoom 7–8 or with big fleets, you can skip the light layers and just use tractor + trailer.

## Trailer placement: path-following (preferred)
Put the tractor kingpin **and** the trailer rear axle **on the route polyline**. Use straight-line (Euclidean) distance, because the rig is rigid, but search backwards along the route, so on tight curves the trailer cuts the corner like a real one and its tail stays on the road.
```js
// pts: [{x,y,cum}] route in LAYER PIXELS at the current zoom, cum = cumulative arc length.
// Returns the point on the polyline at straight-line distance L behind arc position s, or null if the route start is reached first.
function pointAtArc(pts,s){let lo=0,hi=pts.length-1;while(hi-lo>1){const m=(lo+hi)>>1;if(pts[m].cum<=s)lo=m;else hi=m}
  const a=pts[lo],b=pts[hi],f=(s-a.cum)/((b.cum-a.cum)||1);return{x:a.x+(b.x-a.x)*f,y:a.y+(b.y-a.y)*f,i:lo}}
function pointAtDistanceBehind(pts,s,L){
  const P0=pointAtArc(pts,s);let ex=P0.x,ey=P0.y;            // walk back from s, segment by segment
  for(let j=P0.i;j>=0;j--){const B=pts[j];
    if(Math.hypot(B.x-P0.x,B.y-P0.y)>=L){                    // the circle |X-P0|=L crosses segment B→(ex,ey)
      const dx=ex-B.x,dy=ey-B.y,fx=B.x-P0.x,fy=B.y-P0.y,a=dx*dx+dy*dy,b=2*(fx*dx+fy*dy),c=fx*fx+fy*fy-L*L;
      // f(t)=|B+tD-P0|²-L²: f(0)≥0 (B is outside the circle), f(1)<0 (the segment end is inside), so the crossing is the
      // SMALLER root (-b-√disc)/2a, the one toward B, i.e. farther back along the route. The +√ root lies past t=1 and
      // would clamp to the segment end, snapping the trailer to a vertex at the wrong distance on sparse routes.
      const t=Math.min(1,Math.max(0,a?(-b-Math.sqrt(Math.max(0,b*b-4*a*c)))/(2*a):0));   // same as pab() in index.html
      return{x:B.x+dx*t,y:B.y+dy*t,s:B.cum+Math.hypot(dx,dy)*t}}
    ex=B.x;ey=B.y}
  return null}                                               // fall back to follow() below
// per frame (u = tractorPx/96):
const F=pointAtArc(pts,sFront);                      // tractor front axle on path
const K=pointAtDistanceBehind(pts,sFront,79*u)  ?? follow(Kprev,F,79*u);    // kingpin
const A=pointAtDistanceBehind(pts,K.s,154*u)    ?? follow(Aprev,K,154*u);   // trailer rear axle
tractorHeading=bearing(K,F); trailerHeading=bearing(A,K);
```
**Leaflet:** build `pts` once per route per zoom: `p=map.latLngToLayerPoint(ll)` for each lat/lng, with `cum` accumulated in px. Rebuild on `zoomend`, or precompute `cum` in meters with `map.distance()` and convert L from px to meters (`L_m = L_px * metersPerPixel`). Then the truck's progress (`sFront`, from game miles) indexes straight into the same table. When the truck is at the very start of a route (null result) or off-route, use the kinematic `follow()`.

## Kinematics fallback (copy from demo.html)
```js
const follow=(prev,lead,d)=>{const dx=lead[0]-prev[0],dy=lead[1]-prev[1],n=Math.hypot(dx,dy)||1;return[lead[0]-dx/n*d,lead[1]-dy/n*d]};
const bearing=(a,b)=>Math.atan2(b[0]-a[0],-(b[1]-a[1]))*180/Math.PI;  // 0 = north, clockwise, screen px
// each frame: F = route point at the tractor's front (layer px)
K = follow(K, F, 79*u);      // kingpin
A = follow(A, K, 154*u);     // trailer rear axle
tractorHeading = bearing(K, F);  trailerHeading = bearing(A, K);
// every layer: transform = `translate(${K.x}px,${K.y}px) rotate(${heading}deg)`, transform-origin = its kingpin (rigs.css does this)
```
Seed K and A on the route behind F the first time, or after a teleport or zoom change, so the trailer doesn't swing in from nowhere. Work in layer pixels (`map.latLngToLayerPoint`) and re-seed on `zoomend`.

## Leaflet integration
- **Option A, recommended:** one `L.marker` per truck at the kingpin lat/lng with `L.divIcon({className:'', iconSize:[0,0], html: rigHTML})`, where rigHTML is a `.dk-rig` div containing the layers (`.dk-rig__ring`, the `<img>` sprites and lights, and two chicken `<img>`s whose `src` is a cached blob URL; see Chicken lights). Then each frame set only their `style.transform` (the tractor transform for ring, tractor, tractor-chicken, tractor-beams and tractor-lights; the trailer transform for trailer, trailer-chicken and trailer-lights) (the marker's own translate handles position). Set `--u` on `.dk-rig` from the zoom table.
- **Option B, many trucks:** create a custom pane (`map.createPane('rigs')`, zIndex 650) and position the `.dk-rig` containers yourself with `translate3d` from `latLngToLayerPoint`. This means fewer Leaflet objects and less layout work.
- **Layer order inside a rig:** ring (selected only) → trailer → trailer-chicken → trailer-lights → tractor-beams → tractor → tractor-chicken → tractor-lights. Selected rigs get `zIndexOffset` +1000 like today.
- **Rotation:** the tractor layers (ring, tractor, tractor-chicken, tractor-lights, tractor-beams) use the tractor heading. The trailer layers (trailer, trailer-chicken, trailer-lights) use the trailer heading. All of them rotate around the shared kingpin.
- **Click target:** put pointer events on the tractor and trailer images only; the light layers are `pointer-events:none`.
- **devicePixelRatio:** the sprites are vector, so no @2x files are needed. Round translates to 0.5px. Don't apply CSS `filter` to the moving layers; the glows are radial gradients built into the SVGs, the same approach as the cop light sprite.
- **Performance:** only update trucks inside `map.getBounds()`. Throttle to about 30 fps when more than 20 rigs are visible. Use `will-change:transform` (already set). Swap to the far chips at zoom 6 or lower.

## Lights
| State | Class | markers/tails | beams | chicken lights |
|---|---|---|---|---|
| Day (default) | none | 0.6 | 0.3 | 0.55 |
| Night | `.dk-rig--night` | 1.0 | 0.9 | 1.0 |
| Selected | `.dk-rig--selected` | as above | as above | 1.0 + 1.6s gentle pulse, plus a thin 1.5px ring in the chicken color over a dark ground shadow (`.dk-rig__ring`). No yellow glow. |
| Off | `.dk-rig--lights-off` | hidden | hidden | hidden |
| Reduced effects | `.dk-rig--reduced`, `body.lowfx`, or `prefers-reduced-motion` | 0.6 | hidden | static (no chase or pulse) |
**Beams have no `mix-blend-mode`** (it is off: `screen` forced extra compositing on every moving rig); they are plain opacity layers.
Headlight beams, the amber cab, visor and clearance markers, and the red tails are unchanged. There is no `feGaussianBlur`: the beams are radial gradients, and each chicken dot is 4 stacked circles (2 soft bloom circles, a core and a white hot-spot).

## Chicken lights
- **Rendered as `<img>`, not inline SVG (performance).** Inline `<svg>` layers were re-rasterised every frame while rigs moved: about 20 fps (60 → 20 at 4× CPU throttle with 25 rigs). As `<img>` they stay composited. Build each image once per part + palette from the chicken.js string and cache the URL:
```js
const CKU={};
function ckURL(part,id,color){const k=part+','+id;if(CKU[k])return CKU[k];let v=DK_CHICKEN[part];   // part: 'tractor'|'trailer'
  if(id=='chase')v=v.replace(/(<svg[^>]*>)/,'$1<style>.ck{color:hsl(calc(var(--i)*37) 100% 62%);animation:c 1.4s linear infinite;animation-delay:calc(var(--i)*-.07s)}@keyframes c{0%,100%{opacity:1}50%{opacity:.25}}</style>');
  else v=v.replace(/color="[^"]*"/,`color="${color}"`);              // color = the palette's --dk-chicken value
  return CKU[k]=URL.createObjectURL(new Blob([v],{type:'image/svg+xml'}))}
// <img class="dk-rig__tchick" src="${ckURL('tractor',pal,col)}"> and <img class="dk-rig__lchick" src="${ckURL('trailer',pal,col)}">
```
- Because CSS can't reach inside an `<img>`, the **color and the chase animation are baked into the SVG string** (color via the root `color="…"` attribute, which the dots read through `currentColor`; chase via an embedded `<style>`). Changing palette = swap the `src`. Palettes, pulse (opacity on the `<img>` itself) and chase all still work. For a static chase under reduced effects, build a second URL without the animation rule (the game keys its cache on part, palette, reduced and still).
- Same viewBox and pivots as its sprite. The dots outline the bumper, drop visor, cab sides, fuel tanks, sleeper sides, and sleeper top and rear edges on the tractor, and the front top edge, both sides and the rear on the trailer.
- Color: `--dk-chicken` (default `#ffb020`) is kept as the source of truth for the palette color: read it with `getComputedStyle` from an element carrying the palette class (or use `rigs.json → chicken.palettes[].color`) and bake it into the blob. Setting the variable alone no longer recolors a rig; rebuild/swap the `src`.
- Preset classes on `.dk-rig`: `dk-ck--amber` (default), `dk-ck--red`, `dk-ck--blue`, `dk-ck--green`, `dk-ck--purple`, `dk-ck--white`, `dk-ck--chase` (multicolor by dot index with an animated chase, using `animation-delay: calc(var(--i)*-.07s)`, embedded in the blob SVG; static under reduced effects). The classes still set `--dk-chicken` (used by the selected ring and for color lookup).
- **Future unlocks:** the palettes are meant as cosmetic unlocks (paid or watch-an-ad). The list is data-driven in `rigs.json → chicken.palettes` (`id`, `class`, `color`, `unlock`). Only amber is marked `default` and the rest `future`, so the game can build the picker and lock state straight from that array, store `S.chicken = 'blue'` and apply `dk-ck--${S.chicken}`. To add a palette, add one CSS line and one JSON entry.

Preview: `../preview/sheet-map-rigs.png`
