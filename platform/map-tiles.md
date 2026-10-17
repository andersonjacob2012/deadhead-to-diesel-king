# Map tiles: licensing, cost and recommendation
*Platform Engineer · Sat Oct 17, 2026 (America/Chicago)*

> **Update Oct 17, 2026: RESOLVED.** Esri is gone from the game. `main` (214460f / 325b593) replaced the Esri tiles with Art Director's self-hosted custom basemap in `/map/` (DKMap: one shared canvas, our own Census / Natural Earth layers plus interstates rebuilt from `routes.js`, OSM credit kept, maxZoom 13). No third-party tile provider, API key or per-tile bill. The research below is kept for reference (e.g. if we ever want street-level detail beyond `/map/`).

## TL;DR
- **The current basemap is not cleared for a commercial app.** `index.html` L545 loads the legacy Esri *World Dark Gray Base* raster tile service with no key. That is a **legacy Esri service, retired in mature support since July 2021 and scheduled to be turned off in December 2029**. Esri's commercial terms require **authenticated tokens from an ArcGIS Location Platform subscription on every request**.
- Esri on the per-tile model would cost **~$1.2k/mo at 1k players** with our tile usage, because our follow-cam is extremely tile-hungry (measured below).
- **Recommendation: self-host a US Protomaps (OpenStreetMap) vector basemap as one PMTiles file on Cloudflare R2.** Render it in Leaflet with `protomaps-leaflet` using a custom navy/gold "dark" style.
  - Cost: **~$0 at 1k players, ~$5–10/mo at 10k, ~$90–150/mo at 100k**.
  - No per-tile vendor bill and no API key in the client.
  - Attribution is "© OpenStreetMap" plus "Protomaps".
- **Interim** (until that's built): Stadia Maps "Alidade Smooth Dark" raster tiles on a paid plan ($20–80/mo at 1k players). It's a near drop-in for Leaflet: a URL change plus an API key/domain allowlist.
- **Fix regardless of provider: the follow-cam tile churn** (§3). It's the biggest cost driver.

## 1. How the map is used today (code facts)
- **Leaflet 1.9.4**: `L.map('map',{minZoom:3,maxZoom:17,zoomSnap:.2,preferCanvas:true})` with a single raster `L.tileLayer` (Esri URL above, `maxNativeZoom:16`). The tiles are tinted with a CSS filter class `.navy{filter:sepia(1) hue-rotate(185deg) saturate(2.4) brightness(.66) contrast(1.24)}`.
- Attribution is kept, styled dark: "Basemap © Esri, HERE, Garmin, © OpenStreetMap contributors" + "Routes: OSRM / © OSM".
- **Zoom usage:**
  - Home view fits the continental US (z≈4 on phones).
  - Tapping a city flies to ≥z7.
  - Following a truck sets ≥z8–9. Rigs are drawn at z7+ and get bigger at z12–15 (`RIG_ZPX`).
  - Booking a load fits the route bounds.
- **Follow-cam:** while following, the map is re-centered on the truck every frame (`map._rawPanBy` + `moveend` every 0.5 s). Trucks move at **120 mi of game road per real second** (`HR=0.5` s per game hour, 60 mph). The map therefore scrolls through tiles continuously.

### Measured tile requests (headless Chromium, tiles stubbed locally, Esri never contacted)
| Scenario | Unique tiles |
|---|---|
| Phone 390×844 @3x, home view 20 s | 10 |
| Phone, home 10 s + follow a truck at z9 for 60 s | 112 (≈100/min following) |
| Phone, home 10 s + follow at z13 for 30 s | 711 (≈1,400/min at close zoom) |
| Desktop 1440×900, home + follow z9 60 s | 272 (≈240/min) |

Script: `/workspace/platform-scratch/tiles.js`.

**Working estimate:**
- A typical 10-minute session is a few minutes following at z8–10 plus some close-zoom watching ≈ **~800 raster tiles**. The range is 150 (home only) to 5,000+ (long close-zoom follows).
- At ~12 sessions per monthly player, that's **~10k raster tiles per monthly player** (plausible range 3k–30k). The browser HTTP cache removes some repeats between sessions; the estimate doesn't count that.
- Vector tiles are 512 px and cover ~4× the area of a 256 px raster tile, so the same usage is **~2.5k vector tile requests per player-month**.

| Monthly players | Raster tiles/mo | Vector tile requests/mo |
|---|---|---|
| 1,000 | ~10 M | ~2.5 M |
| 10,000 | ~100 M | ~25 M |
| 100,000 | ~1 B | ~250 M |

## 2. Options

### Esri (current)
- The the legacy Esri *World Dark Gray Base* tile service service is on Esri's legacy basemap retirement list, slated for **December 2029**. The replacement is the "Dark Gray Canvas" vector basemap through the Basemap Styles service.
- Commercial/revenue apps are allowed **only** with ArcGIS Location Platform tokens on every request, plus mandatory "Powered by Esri" and data attribution.
- The replacement styles endpoint needs a token with the `premium:user:basemaps` privilege.
- Pricing:
  - **Tile model:** 2M basemap tiles/mo free, then **$0.15 per 1,000 tiles**.
  - **Session model:** 1,000 sessions free, then **$4 per 1,000 sessions**. It requires the vector Basemap Styles service, e.g. via esri-leaflet-vector/MapLibre.
- Cost at our usage:
  - Tile model: 1k players ≈ (10M−2M)×$0.15/1k ≈ **$1,200/mo**; 10k ≈ **$14.7k/mo**; 100k ≈ **$150k/mo**.
  - Session model (~12 sessions/player): 1k ≈ **$44/mo**; 10k ≈ **$476/mo**; 100k ≈ **$4.8k/mo**.
- Verdict: not viable per-tile. Session pricing works but locks us to Esri and a key in the client.

### Stadia Maps
- The free plan (200k credits) is **non-commercial only**.
- Paid plans (1 credit per raster or vector tile; hard-capped unless overage is opted in):
  - Starter: $20/mo, 1M credits, +$0.03/1k
  - Standard: $80/mo, 7.5M credits, +$0.02/1k
  - Professional: $250/mo, 25M credits, +$0.015/1k
- The **Alidade Smooth Dark** style is available on all plans and matches our muted marker-heavy map.
- Raster costs: 1k players (10M) ≈ $80 + 2.5M×$0.02/1k ≈ **$130/mo**; 10k (100M) ≈ $250 + 75M×$0.015/1k ≈ **$1,375/mo**; 100k ≈ **~$15k/mo** (custom).
- Vector tiles (~¼ the requests) ≈ **$20–80**, **~$250–350**, **~$3.6k/mo** respectively.
- Verdict: good interim. Easy Leaflet drop-in, domain-based auth for web, API key for apps.

### MapTiler Cloud
- The free plan is **non-commercial** (commercial R&D only).
- Flex is **$30/mo**: 25k map sessions + 500k requests, automatic overage with an optional spending cap.
- Sessions only count when using MapTiler SDK JS or the MapTiler Leaflet plugin. Otherwise every tile is a request, and 500k requests is about 50 players.
- **Caveat:** the pricing table lists "Export for videos & games: contact us for commercial use". We'd need written confirmation that an ad/IAP game is covered by Flex.
- Verdict: possible with sessions (1k players × 12 = 12k sessions fits Flex), but the licensing ambiguity for games makes it a weaker pick.

### Self-hosted Protomaps / PMTiles (recommended)
- Protomaps Basemap is OpenStreetMap-derived vector tiles, distributed as an ODbL Produced Work (OSM attribution required). The daily planet build (z0–15) is **129.4 GiB**.
- Extract the US: `pmtiles extract https://build.protomaps.com/20261017.pmtiles us.pmtiles --region=us.geojson --maxzoom=15`. A US+Mexico z0–15 extract was ~17 GB, so **US-only z0–15 ≈ 10–15 GB**.
- Each zoom level roughly doubles the size. Estimates: z0–14 ≈ 6–7 GB, z0–13 ≈ 3–4 GB, z0–12 ≈ 1.5–2 GB, z0–10 ≈ ~0.4 GB, z0–8 ≈ ~0.1 GB.
- Vector tiles overzoom cleanly, so **z0–14 data is enough** for our z17 max (tiles past the data zoom are rendered from z14 data).
- **GitHub Pages won't work:**
  - Published sites are limited to **1 GB**, files over **100 MiB** are blocked (warning at 50 MiB), and bandwidth has a **100 GB/month soft limit**.
  - Only a ~z0–8 archive would fit, which is too blurry for our z12–15 rig zoom.
  - Pages bandwidth would also be blown at ~10k players.
- **Cloudflare R2 works** (S3-compatible, PMTiles reads via HTTP range requests):
  - Free tier: 10 GB-month storage, 1M Class A, **10M Class B (reads)** per month, **zero egress fees**.
  - Beyond that: $0.015/GB-mo storage and $0.36 per million Class B reads.
  - Storage for a 7–12 GB file ≈ **$0–0.03/mo**.
  - Reads: 1k players (2.5M) ≈ **$0**; 10k (25M) ≈ **~$5**; 100k (250M) ≈ **~$86**.
  - A Cloudflare Worker / custom domain cache in front (the documented Protomaps pattern) cuts reads further. Workers Paid is $5/mo if the free 100k/day is exceeded.
- Rendering:
  - `protomaps-leaflet` adds a vector layer to our existing Leaflet map (`flavor:"dark"`, custom colors, `maxDataZoom`). It's the smallest change: one layer replaces the `L.tileLayer`.
  - Alternative: MapLibre GL via a Leaflet bridge. Smoother, but a bigger change.
  - Test canvas vector rendering on low-end phones; Dev Lead's perf work matters here.
- Ops: re-extract a few times a year (roads barely change). No vendor account beyond Cloudflare (free). No secret in the client.

### OSM's own tile server (not an option)
- The OSMF Tile Usage Policy forbids heavy or commercial app use without permission. It requires a valid identifying User-Agent and no bulk or offline prefetching.

## 3. Cost lever that applies to every option: tame the follow-cam (Dev Lead's code)
- Cap the follow zoom to ≤ z11 while the truck is moving at >1× speed, or pan the map in steps (re-center only when the truck nears the edge) instead of every frame.
- Leave `keepBuffer` at its default and add `updateWhenZooming:false`.
- Expected effect: roughly **3–10× fewer tiles** at close zoom.

## 4. Attribution requirements
- **OSM (ODbL):** show "© OpenStreetMap" (or "© OpenStreetMap contributors") visibly near the map, normally bottom-right, **linked to https://www.openstreetmap.org/copyright**. It can collapse on small screens but must stay discoverable. Redistributed derivative databases must be ODbL. Rendered tiles are a Produced Work, so attribution only.
- **Protomaps:** keep "Protomaps © OpenStreetMap" (the layer adds it by default).
- **Esri** (if kept): "Powered by Esri" plus data sources; it cannot be removed.
- **Stadia/MapTiler:** "© Stadia Maps © OpenMapTiles © OpenStreetMap" / "© MapTiler © OpenStreetMap contributors".
- Keep the existing "Routes: OSRM / © OSM" line. Our routes in `routes.js` came from the OSRM public demo server, which is for light/non-commercial use only. Precomputed once, so fine, but don't call it at runtime. Also list OSM in the app's About/Credits screen and in the store listing's open-source credits.

## 5. Matching dark style (navy/gold UI)
The UI tokens (`assets/ui/ui-kit.css`) are navy `#0b1220`, surface `#141f35`, line `#2a3b5e`, steel `#46587a`, iron navy `#1d2c4f`, chrome `#9fb0c9`, gold `#ffd84d`/`#b8942a`, and blue `#7cc4ff`. Today's look is Esri dark gray pushed to navy by a CSS filter. Proposed Protomaps "dark" overrides (no CSS filter needed, which also saves GPU work on phones):

| Layer | Color | Note |
|---|---|---|
| background / earth | `#0e1729` | slightly lighter than the UI navy so the HUD reads as floating |
| water / ocean | `#070d18` | darker than land, like the current look |
| parks / landcover | `#111d33` | barely visible |
| state boundaries | `#2a3b5e` dashed | helps the "US trucking map" feel |
| minor roads | `#16223a` | hidden below z9 |
| major roads | `#1d2c4f` | |
| **interstates / highways** | `#46587a`, and **`#b8942a` at 35–50% opacity from z6** | subtle gold arteries tie into the gold UI and our route lines |
| city labels | `#9fb0c9`, halo `#0b1220` | |
| state/region labels | `#46587a` uppercase, letter-spaced | |
| POIs / buildings | off, or buildings `#141f35` at z14+ | keeps the map quiet under the rigs |

Interim Stadia choice: **Alidade Smooth Dark**, keeping the `.navy` filter softened (e.g. `hue-rotate(185deg) saturate(1.6) brightness(.8)`) so it matches the current look.

## 6. Plan
1. **Now (web, before any monetization):** prototype `protomaps-leaflet` with an R2-hosted `us-z14.pmtiles` on the platform branch, plus the style above. The perf test on a low-end Android is a Dev Lead review gate.
2. If perf isn't acceptable, use **Stadia Alidade Smooth Dark raster** (Starter/Standard plan).
3. **Before the store launch:** remove the legacy Esri URL. Esri's legacy endpoint keeps working today, but it isn't licensed for our commercial use without a Location Platform token.
4. **Sign-ups needed (Jacob):** a Cloudflare account (free; R2 needs a card on file even for the free tier, so confirm before entering payment details), or Stadia (paid) for the interim.

## Sources
- Esri legacy basemap retirement: https://www.esri.com/arcgis-blog/products/arcgis-living-atlas/announcements/sunsetting-legacy-basemaps
- Esri basemap life cycle (World Dark Gray Base mature support since Jul 2021): https://support.esri.com/en-us/products/arcgis-location-services/arcgis-basemaps-life-cycle
- Esri licensing & attribution (commercial apps require tokens on all requests): https://location.arcgis.com/help/licensing-and-attribution/
- Esri dark-gray style (token with premium:user:basemaps): https://developers.arcgis.com/rest/basemap-styles/arcgis-darkgray-style-get/
- Esri static basemap tiles (Location Platform account required): https://developers.arcgis.com/rest/static-basemap-tiles/
- Esri pricing (2M tiles free, $0.15/1k; sessions $4/1k): https://developers.arcgis.com/pricing/ , https://location.arcgis.com/pricing/ , https://www.esri.com/arcgis-blog/products/platform/announcements/basemap-sessions
- Stadia pricing / free tier non-commercial: https://stadiamaps.com/pricing/ , https://docs.stadiamaps.com/limits
- Stadia Alidade Smooth Dark: https://docs.stadiamaps.com/map-styles/alidade-smooth-dark/
- MapTiler pricing / terms / sessions: https://www.maptiler.com/cloud/pricing/ , https://www.maptiler.com/terms/cloud/ , https://docs.maptiler.com/guides/account/sessions-vs-requests/
- Protomaps builds (planet 129.4 GiB, 2026-10-17): https://maps.protomaps.com/builds/
- Protomaps downloads (ODbL, zoom doubling): https://docs.protomaps.com/basemaps/downloads/
- pmtiles extract CLI: https://docs.protomaps.com/pmtiles/cli ; US+Mexico z15 ≈ 17 GB: https://github.com/protomaps/go-pmtiles/issues/68
- Protomaps for Leaflet / flavors: https://docs.protomaps.com/basemaps/leaflet , https://docs.protomaps.com/basemaps/flavors
- GitHub Pages limits: https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits ; large files: https://docs.github.com/en/repositories/working-with-files/managing-large-files/about-large-files-on-github
- Cloudflare R2 pricing: https://developers.cloudflare.com/r2/pricing/
- OSM attribution guidelines: https://osmfoundation.org/wiki/Licence/Attribution_Guidelines ; copyright: https://www.openstreetmap.org/copyright ; tile usage policy: https://operations.osmfoundation.org/policies/tiles/
