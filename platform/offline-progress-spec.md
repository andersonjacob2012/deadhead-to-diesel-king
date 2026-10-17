# Spec: server-time offline progress, daily contracts, save fallback (rev 2, Dev Lead's answers applied)

Branch `platform/offline-progress` (from main 427cb6b). Platform code: `platform/save-store.js` -> `DKSave.clock`.
Game code: thin touchpoints in `index.html` only, none in DKMap, the route canvas or the main loop.

## 1. Problem
Offline earnings and daily contracts trust the device clock (`Date.now()`):
- Setting the clock forward pays up to 8h and skips contract days.
- Setting it back gives negative elapsed time and rewinds `S.last`.
Once a Supabase project exists we have a cheap trusted clock (`server_now` RPC). Use it when reachable, and never make the game worse when it isn't.

## 2. Dev Lead's answers -> rules
| # | Answer | Applied as |
|---|---|---|
| 1 | No 2h cap. Keep 8h on client time; clamp negative/rolled-back to 0; server time when reachable. Stricter cap only once accounts/IAP ship, as config | `away()` = device elapsed clamped to [0, 8h]. 0 while `meta.behind` (rollback). `DK_CONFIG.offlineDeviceCapH` (unset = off) is the future stricter cap. The old 2h device cap and the unverified budget were removed. |
| 2 | Top-up shown in the existing "While you were away" popup | `offVerify` merges into `S.pendingAway`. That is shown by `showAway()` on Start, or right away (after any open modal) if the game is already started. |
| 3 | Split offline payout into its own function | `offPay(away, top)`: the payout body moved out of `load()` unchanged; `top=1` skips the 90s tick sim (analytic part only). |
| 4 | Overpayment: ignore, no clawback | Top-up only when server elapsed exceeds what was paid by more than 60s. Never subtracts. |
| 5 | No streak day on unconfirmed time beyond +1; defer if server unreachable, never break | `firm()` is false only when cloud is configured but not reached. While not firm, there is no streak break and a claim beyond sd+1 is stored as `S.ct.sdp`. On verify it settles, then the gap check runs on server time. |
| 6 | No server time for hot-load timers | The loop, ticks, timers and `S.last` stay on `Date.now()`. Only `dayKey`/`dayNum` defaults and the boot top-up use `DKSave.clock`. |
| 7 | Contract day = player's local midnight | `dayKey`/`dayNum` keep local-date math, applied to `DKSave.clock.now()`. That is server ms when verified, otherwise the device clock. |
| 8 | Merge order: save layer first, then this | PR #1 (save layer) merged as 427cb6b; this PR is on top of it. |

## 3. Clock API (`DKSave.clock`)
- `state()`: one of `'none'` (no cloud config), `'unverified'` (config, server not reached), `'verified'`.
- `now()`: server anchor + `performance.now()` delta, else `Date.now()`.
- `firm()`: `!cloud || verified`.
- `rollback()`: device clock is more than 5 min behind the high-water mark `meta.maxNow`.
  - A clock more than 7 days behind (`DK_CONFIG.rollbackAcceptDays`) is accepted as the new clock, so a fixed wrongly-future clock doesn't freeze progress.
- `away(S.last, capS)`: `{secs, source:'device', reason}`; 0 on rollback or negative.
- `stamp(S)`: the value for `S.last` (device time; never rewinds while rolled back). Sets `S.lastSrv` when verified.
- `onVerify(fn)`: fires once with server ms on the first anchor (the `server_now` RPC at load, or the `put_save` response).

## 4. Boot flow
1. `load()`: `offPay(clock.away(S.last, 8h).secs)` (same numbers as main). Remember `_offRef={last, srv:S.lastSrv, paid, perf}`.
2. `clock.sync()` on window load (cloud only), then `onVerify(offVerify)`:
   - If the save was last stamped on a verified session (`srv >= last-60s`), compute server elapsed `v = min(serverAtBoot - srv, 8h)`.
     - If `v > paid + 60`, call `offPay(v - paid, 1)`. The extra appears in the "While you were away" popup.
   - Settle the deferred streak day (`sdp`), then break the streak if the server-time gap is > 1 day.
   - Save.
3. No config means no verify, so behaviour equals main except for two things:
   - the rollback/negative clamp (and `S.last` not rewinding while rolled back);
   - `S.lastSrv` is stored when verified (never, without config).

## 5. Save fallback
An inline shim right after `<script src="platform/save-store.js">` defines a localStorage-only `DKSave` with the same API (read/write/clear/sync/status) and a device-time `clock` (state 'none', firm, `away` clamped). It is only used if the script fails to load.

## 6. Tests (in `npm test`)
- Unit (`platform/tests/unit.js`) covers:
  - none/firm/8h cap/negative;
  - rollback: 0 payout, no rewind;
  - far rollback accepted;
  - config cap;
  - anchor/onVerify-once/late subscriber/lastSrv.
- Headless (`platform/tests/offline.js`) covers:
  - shim with save-store.js blocked;
  - new game; old save;
  - 1h away identical to the merge base (seeded RNG, frozen clock);
  - 8h cap; rollback; negative;
  - midnight roll; streak +1; gap break without config;
  - unreachable: no break, defer, +1 still awarded, settle on verify;
  - server top-up into the popup; no clawback.

## 7. Open points for Dev Lead
- The 7-day "accept far rollback" threshold, and the 60s top-up dead-band.
- If the top-up arrives after the popup was already collected, a second "While you were away" popup shows the extra. It could be merged or toasted instead.
- There is still no offline calc on resume-from-background (unchanged from main).
- A top-up needs `S.lastSrv`, so the first verified session after this ships pays device time only.
