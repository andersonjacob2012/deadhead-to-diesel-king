# Spec: server-time offline progress and daily contracts
*Platform Engineer · Sat Oct 17, 2026 (America/Chicago) · status: DRAFT for Dev Lead review*
*Line numbers are `main` @ 8b5c372. Dev Lead's working tree is shifted by about +1 to +11 below L538.*

## 1. Problem
All of these read `Date.now()` from the device:
- offline progress (`load()` L522)
- daily contracts (`dayKey()`/`dayNum()` L422–423, `ctCheck()` L436, streak in `ctClaim()` L448)
- hot-load timers (`S.hot.next`, `l.exp`, L267–270)

Two exploits follow:
- **Forward jump:** set the clock ahead → up to 8 h of earnings (`OFF_CAP`, L523), new contracts and a streak increment each "day".
- **Rollback loop:** set the clock back. `away` goes negative, so there's no payout, but `save()` then writes the earlier `S.last`. Restoring the real time pays 8 h again, repeatable on demand.

## 2. Goals / non-goals
- **Goals:**
  - Online players: offline payout is based on **server-verified elapsed time** (up to 8 h, unchanged).
  - Offline players still get progress, under a **stricter device-clock cap** that can't be farmed.
  - Rollback never pays out and never rewinds `S.last`.
  - Contracts and streaks advance by trusted days only.
- **Non-goals:** perfect anti-cheat (it's a single-player idle game), and taking away cash already shown to the player (no clawback from the cash balance).

## 3. Design

### 3.1 Clock sources (platform layer, prototype on branch `platform/save-sync`, `platform/save-store.js` → `DKSave.clock`)
| API | Meaning |
|---|---|
| `DKSave.clock.sync()` | Calls the Supabase RPC **`server_now()`** (already in `platform/supabase/schema.sql`; this is the "server_time" RPC) and anchors `{serverAt, performance.now()}` for the session. It also anchors from every `put_save` response (`server_now` field). Without cloud config it's a no-op that resolves `false`. |
| `DKSave.clock.now()` | `serverAt + (performance.now() − perfAtAnchor)` when anchored (monotonic, immune to device clock edits mid-session), else `Date.now()`. |
| `DKSave.clock.verified()` | True once anchored this session. |
| `DKSave.clock.rollback()` | True while the device clock is >5 min behind the highest time ever seen (`dk.save.meta.maxNow`, already implemented). |
| `DKSave.clock.away(S.last, S.lastSrv, S.offU)` | Returns `{secs, source, reason}`: **server** = `min(now−S.lastSrv, 8h)`; **device** = `min(now−S.last, 2h, 8h−S.offU)`; **none** on rollback. |

### 3.2 New save fields (backward compatible; missing means 0)
- `S.lastSrv`: last **server-verified** timestamp (ms). Set to `clock.now()` on each `save()` while `verified()`.
- `S.offU`: seconds of **unverified** (device-clock) offline time paid since `S.lastSrv`. Resets to 0 when a verified payout happens.
- `S.ctDaySrv`: the last contract day key derived from verified time.

### 3.3 Boot flow
`load()` is synchronous and the rest of the boot script needs `S` immediately. Making boot async (L543 onward) is a big change, so the design is **pay now, top up later**:

1. `load()` (sync) pays offline progress using `clock.away()`. On a cold boot this is almost always the `device` source: **cap 2 h**, charged against the 8 h unverified budget `S.offU`.
2. In parallel, `DKSave.clock.sync()` runs (≤1.5 s timeout; normally ~100–300 ms).
3. If it anchors and `S.lastSrv` exists:
   - `verifiedSecs = min(serverNow − S.lastSrv, 8h)`.
   - `alreadyPaid` = what step 1 paid (kept in a transient `window._offPaid`).
   - If `verifiedSecs > alreadyPaid + 60`: **top-up** by running the same analytic offline payout for the difference and adding it to `S.pendingAway` (the "while you were away" toast shows the total).
   - If `verifiedSecs < alreadyPaid` (the device clock was ahead): **no clawback from cash**. Record `S.offDebt += alreadyPaid − verifiedSecs`; the next payouts are reduced by the debt first.
   - Then `S.offU = 0` and `S.lastSrv = serverNow`.
4. If it doesn't anchor (offline): keep the device result. `S.offU` accumulates, so repeated clock-forward boots while offline share **one 8 h budget in total** until the next server check.

### 3.4 Rollback
- If `clock.rollback()` is true: the offline payout is **0**.
- `save()` writes `S.last = max(S.last, clock.now())`, so `S.last` never moves backwards.
- Show one gentle toast: "Your device clock looks off — offline earnings paused until it's corrected."
- When the device clock passes `maxNow` again, normal rules resume. The time spent "behind" was never paid, so nothing is lost or gained.

### 3.5 Daily contracts (L422–448)
- `dayKey()`/`dayNum()` default to `DKSave.clock.now()` instead of `Date.now()`. They still use device-local date math, so a timezone change can shift a player by a few hours (accepted).
- `ctCheck()`:
  - **Verified:** refresh when `dayKey(now) > S.ct.day` (unchanged), and set `S.ctDaySrv`.
  - **Unverified:** allow a refresh only if the new day is **≤ S.ctDaySrv + 1**. A device jump can grant at most one extra day until verified, which blocks the many-days-forward farming.
  - **Rollback:** never refresh. `k > S.ct.day` already blocks going backwards.
- Streak (`ctClaim()` L448): uses `dayNum(now)`, unchanged otherwise. Because the refresh is gated, the streak can't be pumped by moving the clock.
- Hot loads (`S.hot.next`, `l.exp`, L267–270, and `hotUpkeep()` called in `load()`): switch to `clock.now()` for consistency. Low priority, since hot loads only matter for the active session.

### 3.6 Server side (already in the schema)
- `put_save` stamps `updated_at = now()` and flags `client_clock_ahead`/`last_in_future`/`earned_spike`.
- Optional later: `put_save` could also reject `S.lastSrv` values in the future.

## 4. Touchpoints in `index.html` (Dev Lead owns these) with proposed diffs
All changes are guarded with `window.DKSave&&DKSave.clock`, so they also work on `main` without the platform layer.

**T1. Time helper, near L259 (new line, after `let S;`)**
```js
const NOW=()=>window.DKSave&&DKSave.clock?DKSave.clock.now():Date.now();
```

**T2. `save()` L524: never rewind `S.last`; stamp verified time**
```diff
-const save=()=>{S.last=Date.now();localStorage.setItem('idletruck',JSON.stringify(S))};
+const save=()=>{const n=NOW();S.last=Math.max(S.last||0,n);if(window.DKSave&&DKSave.clock.verified())S.lastSrv=n;DKSave.write(S)};
```
(On `main` without the platform branch, keep `localStorage.setItem(...)` instead of `DKSave.write`.)

**T3. Offline calc at the end of `load()` L522: pick the elapsed time from the clock**
```diff
- const away=Math.min((Date.now()-S.last)/1000,OFF_CAP);if(away>10){
+ const AW=window.DKSave?DKSave.clock.away(S.last,S.lastSrv||0,S.offU||0):{secs:Math.min((Date.now()-S.last)/1000,OFF_CAP),source:'device'};
+ let away=AW.secs;if(S.offDebt>0){const d=Math.min(S.offDebt,away);S.offDebt-=d;away-=d}
+ if(AW.source=='device')S.offU=(S.offU||0)+away;else S.offU=0;window._offPaid=away;window._offSrc=AW.source;
+ if(AW.reason=='clock_rollback')window._clockWarn=1;
+ if(away>10){
```
The payout body stays as it is. Recommended refactor: extract the existing payout body (the `sim`/`rest` block) into `function payOffline(secs)`, so the top-up in T4 reuses it without duplicating the math.

**T4. After `load();` at L543: async verify and top-up (new block)**
```js
if(window.DKSave)DKSave.clock.sync().then(ok=>{if(!ok)return;const now=DKSave.clock.now();
 if(S.lastSrv){const v=Math.min((now-S.lastSrv)/1000,OFF_CAP),paid=window._offPaid||0;
  if(window._offSrc=='device'){if(v>paid+60)payOfflineTopUp(v-paid);else if(v<paid)S.offDebt=(S.offDebt||0)+(paid-v)}}
 S.offU=0;S.lastSrv=now;S.ctDaySrv=dayKey(now);ctCheck();save()});
```
`payOfflineTopUp(secs)` is the rest-only analytic part of `payOffline` (no 90 s `tick()` sim). It adds to `S.cash`/`S.earned`/`S.xp`/`S.pendingAway`.

**T5. `dayKey`/`dayNum` L422–423: default argument**
```diff
-const dayKey=(ms=Date.now())=>{...
+const dayKey=(ms=NOW())=>{...
-const dayNum=(ms=Date.now())=>{...
+const dayNum=(ms=NOW())=>{...
```
(`NOW` must be defined before L422; T1 at ~L259 satisfies that.)

**T6. `ctCheck()` L436: gate unverified day jumps**
```diff
-function ctCheck(){if(!S.ct)return;const k=dayKey();if(!S.ct.day||k>S.ct.day){
+function ctCheck(){if(!S.ct)return;const k=dayKey(),V=!window.DKSave||DKSave.clock.verified();
+ if(window.DKSave&&DKSave.clock.rollback())return;
+ if(!V&&S.ctDaySrv&&dayNum(NOW())-dayNumFromKey(S.ctDaySrv)>1)return;
+ if(V)S.ctDaySrv=k;
+ if(!S.ct.day||k>S.ct.day){
```
This needs a tiny `dayNumFromKey(k)` helper (yyyymmdd → day number).

**T7. Hot loads L267–270 and `hotUpkeep`: `Date.now()` → `NOW()`** (optional, consistency).

**T8. Rollback toast:** after boot, `if(window._clockWarn)toast('⏰ Your device clock looks off, so offline earnings are paused until it\'s corrected.',4000)`.

Without cloud config, `verified()` is always false. Web-only players therefore get the **2 h device cap** (plus the shared 8 h budget) instead of today's 8 h. That's a gameplay change, see Q1.

## 5. Test plan
- Unit tests (done on the branch, `platform/tests/unit.js`): device cap 2 h, shared 8 h budget, server elapsed wins when anchored, 8 h cap, rollback → 0.
- Once T2–T6 land:
  - Headless: seed a save with `S.last` −5 h → device payout ≈2 h. With a mocked `server_now` → top-up to 5 h.
  - Forward the clock +3 days offline → only 1 contract refresh.
  - Rollback −1 day → 0 payout, `S.last` unchanged, toast shown.
  - The existing smoke and legacy-save tests still pass.

## 6. Open questions for Dev Lead
1. **Device-only cap:** is 2 h (vs today's 8 h) acceptable when there's no server check? Alternatives are 4 h, or "8 h with no cloud configured, 2 h once accounts ship".
2. **Top-up UX:** fold it into the existing `S.pendingAway` "while you were away" popup (an updated total after ~0.3 s), or show a separate "+$X verified" toast?
3. **Refactor OK?** Can I extract the offline payout block in `load()` into `payOffline(secs)` / `payOfflineTopUp(secs)`? It touches the densest line in the file (L522).
4. **Debt vs ignore:** when the device clock was ahead, should we keep `S.offDebt` (reduce future payouts) or just ignore it (simpler, slightly farmable once per 8 h)?
5. **Contracts:** is "max +1 day while unverified" the right rule, and should the streak require a verified day to count?
6. **Hot loads:** move to `NOW()` too, or leave on `Date.now()` since they only affect the active session?
7. **Timezone:** keep device-local midnight for the contract day (current behavior), or use one fixed game timezone (e.g. US Central) for everyone?
8. **Merge order:** land the platform branch's `DKSave` 5-line wiring first (or the standalone Reset fix), then these touchpoints in one Dev Lead PR?
