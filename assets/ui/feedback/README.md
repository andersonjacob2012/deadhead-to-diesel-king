# Feedback chip + form sheet (dk- kit)

**Status:** approved by Jacob (Oct 18, 2026) and handed off to Dev Lead, who has built it on a branch. It goes to staging after v1.0.2. Changes in v1: it sends through mailto, so the screenshot toggle is hidden until the relay ships; an outline 'Copy report' button sits next to Send; the copy is reworded for email; the label and pulses are skipped under reduced motion and lowfx; and game toasts sit at z 1450 and are raised to 2000 while the form is open.
This is for Dev Lead's in-game Feedback feature: a Settings entry plus a form sheet. The floating chip is an **optional** second way into the same sheet.

## Files
| Path | What |
|---|---|
| `feedback.css` | All styles. Classes are prefixed `dk-fb`. Uses the `--dk-*` vars from `../ui-kit.css` (load that first). |
| `feedback.svg` | The speech-bubble icon (24px grid, 2px round stroke, `currentColor`). |
| `../icons.svg` → `#i-feedback` | Added to the kit sprite (67 symbols now). Source: `../source/build_icons.py`. Standalone copy: `../icons/feedback.svg`. |
| `demo.html` / `demo.css` / `demo.js` | Working demo over a real 390×844 game capture. URL params: `?state=map\|first\|pop\|sheet\|sent\|error`, `&lowfx`, `&fresh` (clears demo storage). Serve it over http so the sprite fetch works. |
| `preview/fb-map-390x844.png` | Game map with the chip showing (resting). |
| `preview/fb-first-390x844.png` | First show: the "Feedback?" label is expanded and the pulse is playing. |
| `preview/fb-button-closeup.png` | Close-up of resting, first show, the ×/long-press menu and swipe-to-hide. |
| `preview/fb-dismiss-390x844.png` | The dismiss menu open. |
| `preview/fb-sheet-open-390x844.png` | The form sheet. |
| `preview/fb-sent-390x844.png` | Sent / thanks state. |
| `preview/fb-error-390x844.png` | Send failed (inline error). |
| `preview/fb-sheet-lowfx-390x844.png` | The sheet with `body.lowfx` (no blur, no animation). |
| `preview/sheet-feedback.png` | Everything above on one sheet. |
| `source/render_previews.js`, `source/build_sheets.py` | Rebuild the previews: Playwright needs `/workspace/pw/node_modules` and the repo served on :8765; then run `python3 build_sheets.py`. |

## Placement (measured on the live game at 390×844)
| Element | Rect (x, y, w, h) / rule | z |
|---|---|---|
| HUD (2 rows) | 0–106 | 1001 |
| Toast | top 120, centred | 2000 |
| `#homehint` | left/right 12, bottom 196 (bottom edge y 648) | 1000 |
| `#spd` 1x/5x/10x | 229, 658, 149, 44 (bottom 142) | 1000 |
| `#fab` Load Board | right 12, bottom 92 (y 708–752) | 1000 |
| Leaflet credits | y 745–770 (`.leaflet-bottom{bottom:74px}`) | 800 |
| Nav | y 780–844, includes the safe-area padding | 1002 |
| **`.dk-fb` chip** | **12, 658, 44, 44**: left 12, bottom 142, so it sits on the same baseline as `#spd` | **1000** |
| `.dk-fb__x` badge | 44, 650, 20, 20 (32px hit area) | inside the chip |
| `.dk-fb-pop` menu | 12, 508, 248, 138 (opens above the chip) | 1004 |
| `.dk-fb-scrim` / `.dk-fb-sheet` | full screen / bottom sheet | 1600 / 1601 |

Why bottom-left: the bottom-right corner already has the speed pill and Load Board, and the top has the HUD and toasts. The left edge on the `#spd` row is the only free slot. It is 10px below `#homehint`, 43px above the map credits (which must stay visible) and 120px above the nav.
The sheet sits at 1600, above Settings' `#modal` (1500), so it can open from Settings. It stays below toasts (2000) and `#celebrate` (2500), so the "sent" toast still shows.

**CSS vars** (set them on `:root` to tune): `--dk-fb-left:12px`, `--dk-fb-bottom:142px`, `--dk-fb-z:1000`, `--dk-fb-sheet-z:1600`.
If the HUD or speed bar moves, change `--dk-fb-bottom` to match `#spd`'s bottom.

**Safe area:** the chip uses `left: calc(var(--dk-fb-left) + env(safe-area-inset-left))` and `bottom: calc(var(--dk-fb-bottom) + env(safe-area-inset-bottom))`. The sheet uses `padding-bottom: max(16px, env(safe-area-inset-bottom))` and `max-height: min(92dvh, 760px)`. Note: index.html's viewport meta does **not** have `viewport-fit=cover` right now, so `env()` returns 0 in a browser. The game's nav already uses the same env() inset, so the chip behaves the same way the nav does. Adding `viewport-fit=cover` is Dev Lead's/Platform Engineer's call.
**Wide screens:** the sheet caps at 560px and centres. I didn't measure desktop layouts; the chip keeps the same left/bottom rule.

## Markup
Copy it from `demo.html`; there are three blocks: `#dkFb` (chip), `#dkFbPop` (menu) and `#dkFbSheet` (scrim + sheet).
Icons use `<svg><use href="#i-feedback"/></svg>`. **Dev Lead: add the `i-feedback` symbol to the inline sprite in index.html** (copy it from `assets/ui/icons.svg`). The form also uses `i-warning`, `i-tip`, `i-check`, `i-close`, `i-clock` and `i-ban`, which are already in the sprite.

## Show / dismiss logic (hooks for Dev Lead)
Suggested save fields: `S.fb = {playMs, never, hideUntil, pulsed, lastSent}`.
- **Count play time:** add to `S.fb.playMs` on the game tick only while `document.visibilityState==='visible'`. Count active play, not wall-clock time and not offline earnings.
- **Show** when every one of these is true:
  - `playMs >= 10*60*1000`
  - `!never`
  - `Date.now() > (hideUntil||0)`
  - the Home tab is active
  - nothing else is open
  
  Then add `.dk-fb--show` (it slides in).
- **CSS hides it automatically** while `body.sheet-open`, `.sr-open`, `.guiding` or `.dk-fb-open` is set. Also hide it in JS while `#modal`, the title screen or `#celebrate` is up.
- **First show** (`!pulsed`): add `dk-fb--expanded dk-fb--pulse`. Remove the pulse after 2.6s and the label after 6s, then set `pulsed=1`. It plays once ever.
- **× tap or long-press (550ms)** opens `.dk-fb-pop` with two choices:
  - *Hide for now*: set `hideUntil` to the next session, or now + 24h.
  - *Don't show again*: set `never=1`.
  
  Either one shows a toast that Feedback is still in ⚙ Settings.
- **Swipe left more than 48px:** add `.is-dragging` while the finger moves (follow the finger with `transform`), then `.is-leaving` and the same result as *Hide for now*.
- **Chip tap:** opens the same sheet as Settings → Feedback. Add `body.dk-fb-open` and focus the first chip. Escape, the scrim and × close it, and focus goes back to the opener.
- **After a send:** I suggest hiding the chip for 7 days (`hideUntil`). This needs a decision (see Questions).

## Form sheet states
- **Category:** radio pills `.dk-fb-chip` (Bug / Idea / Other). The checked style uses `:has(:checked)`; for older WebViews, also toggle the `.is-on` fallback class.
- **Text:** `.dk-fb-text` (min 128px, maxlength 1000) with the `.dk-fb-count` counter. The placeholder changes with the category.
- **Screenshot toggle:** `.dk-fb-row` + `.dk-fb-switch`. `.dk-fb-thumb` shows the captured image.
- **Send:** `.dk-fb-send` is disabled while the text is empty. `.is-busy` shows the spinner.
- **Error:** un-hide `.dk-fb-err` (copy: "saved, will try again when you're online").
- **Sent:** hide the form and show `.dk-fb-sent` (crown medal, "Thanks, Driver!", "Back to the road").

## Motion and accessibility
- `prefers-reduced-motion` and `body.lowfx` turn off the pulse, slide-in, spinner animation and transitions. lowfx also drops `backdrop-filter`.
- Tap targets are 44px (chip, close, chips, Send) and the × hit area is 32px.
- The chip has `aria-label="Send feedback"`. The × is a separate button labelled "Hide feedback button". The sheet is `role="dialog" aria-modal="true"` labelled by its title.
- No real brands; the only fonts are Rye (title) and Inter.

## Questions for Jacob / Dev Lead
1. **Privacy:** sending text, an optional screenshot, and the game version and device model means data leaves the phone. The Play **Data safety** form ("no data collected") and the privacy policy need updating before this ships.
2. After a send, should the chip hide for 7 days, forever, or not at all?
3. Should the chip show only on Home (my suggestion) or on every tab?
4. Is the "Feedback?" first-show label OK, including its 6s expand?
5. Is *Hide for now* = 24h OK, or should it mean this session only? (The demo uses session only.)
6. Should `viewport-fit=cover` go into index.html so the safe-area insets take effect? This also affects the existing nav.
