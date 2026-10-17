# Spec: server-time offline progress, daily contracts, save fallback (rev 3: resume + top-up toast)

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
| 2 | Top-up shown in the existing "While you were away" popup; (rev 3) a late top-up after the popup was collected is a toast, never a second popup | `offGrant(…,ver=1)`. Before Start the top-up merges into `S.pendingAway` (shown at Start). Once started it shows a toast "✅ +$X verified away earnings". |
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
  - boot server top-up after Start → toast; no clawback;
  - resume, using a held rAF and the frozen clock's fastForward:
    - a 20s hide pays nothing;
    - the hide save still runs;
    - 10 min suspended → the gap since the last tick, as a toast;
    - rapid hide/show → 40s + 40s, no double pay;
    - throttled 2 min then suspended 5 min → only 5 min;
    - 30h → 8h popup;
    - clock set back while hidden → 0;
    - before Start → merged into the popup;
    - server-verified resume with the device clock set back → verified toast.

## 7. Offline progress on resume (rev 3)
Phones and the Capacitor WebView suspend `requestAnimationFrame` (and so the loop) when hidden, or throttle it.
- **Last tick.** One line in the loop, `OFFR.t=Date.now()`, records the last tick. Nothing else touches the loop body.
- **Hide.** `offResume` is a `visibilitychange` listener. On hidden it stores the hide time (wall clock and `performance.now()`). The existing `save` listeners for `visibilitychange`/`pagehide` are unchanged.
- **Show** (visible after more than 30s hidden):
  - Hidden time is the longer of the wall-clock and monotonic measurements, because the wall clock may have been moved.
  - It pays `DKSave.clock.away(OFFR.t, 8h)`: the gap since the LAST TICK, not since the hide, with the same 8h cap and the same rollback/negative clamp (the clock is re-checked).
  - Ticks that ran while throttled are therefore not paid twice.
  - `OFFR.t` is then set to now, so rapid hide/show (no frame in between) can't pay the same span twice.
  - The gap must be more than 30s too.
- **Server verify.** If the session was verified, the server time at the last tick is `clock.at(lastT)` from the old anchor. `clock.sync()` re-anchors. If server elapsed (≤ 8h) exceeds the device payout by more than 60s, a top-up is paid with the verified toast. Overpay is ignored.
- **UX:**
  - Gap under 15 min (`OFF_POP`): toast "🌙 +$X while away (N min)" (4s; replaces the previous toast, so no stacking).
  - Gap of 15 min or more: the "While you were away" popup (after any open modal).
  - Before Start: merged into the popup shown at Start.
- `offGrant(s, top, big, ver)` wraps `offPay` and handles the presentation.
- **Known shortfall:** a loop throttled to about 1 frame/s still caps `dt` at 0.5s per frame, so those throttled seconds are under-paid. This is conservative and can't double-pay.

## 8. Open points for Dev Lead
- Confirm the resume UX: toast under 15 min, popup at 15 min and over; 30s for both the hide floor and the minimum paid gap.
- The throttled-loop under-pay (dt clamp 0.5s per frame), described above.
- The 60s top-up dead-band.
- A top-up needs `S.lastSrv` (boot) or a verified session (resume), so the first verified session after shipping pays device time only.
- (Resolved) The 7-day corrected-clock rule stays. Late top-ups use a toast. Resume progress is added.
