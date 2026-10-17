/* Deadhead to Diesel King — save-store layer (platform/save-sync).
 * Classic script, no build step. Must load BEFORE the main game <script>.
 *
 *   DKSave.read()      -> raw JSON string | null   (sync; used by load())
 *   DKSave.write(S)    -> writes local now, schedules a cloud push (sync; used by save())
 *   DKSave.clear()     -> wipes the local save (used by "Reset save")
 *   DKSave.status()    -> {backend, cloud, dirty, rev, baseRev, savedAt, device, rollback, bytes}
 *   DKSave.sync()      -> Promise: pull/push/conflict round-trip with the cloud (no-op when inert)
 *   DKSave.resolve(localMeta, remoteMeta) -> pure conflict decision (exported for tests)
 *
 * Storage keys (backward compatible):
 *   'idletruck'     the game save, byte-for-byte the same JSON the game always wrote (unchanged key/format)
 *   'dk.save.meta'  sidecar metadata {rev, baseRev, savedAt, maxNow, device, dirty, uid}
 *
 * The cloud adapter is INERT unless window.DK_CONFIG = {supabaseUrl, supabaseAnonKey} is set AND the
 * supabase-js client is present (window.supabase.createClient). With neither, behaviour is identical
 * to the original localStorage-only game.
 */
(function () {
  'use strict';
  var KEY = 'idletruck', META = 'dk.save.meta', ROLLBACK_SLACK = 5 * 60 * 1000;
  var PUSH_DEBOUNCE = 30 * 1000;

  // ---------- LocalStore: localStorage, same key/format as before ----------
  var LocalStore = {
    name: 'local',
    get: function (k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set: function (k, v) { try { localStorage.setItem(k, v); return true; } catch (e) { console.warn('[DKSave] local write failed', e); return false; } },
    del: function (k) { try { localStorage.removeItem(k); } catch (e) {} }
  };

  function rndId() { return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4); }
  function readMeta() {
    var m = null; try { m = JSON.parse(LocalStore.get(META)); } catch (e) {}
    if (!m || typeof m !== 'object') m = {};
    if (!m.device) m.device = rndId();
    m.rev = m.rev | 0; m.baseRev = m.baseRev | 0; m.maxNow = +m.maxNow || 0; m.savedAt = +m.savedAt || 0;
    return m;
  }
  var meta = readMeta(), suspended = false, lastBytes = 0, pushTimer = null, cloud = null;

  // Clock-rollback detection: device clock went backwards past the largest "now" we have ever seen.
  function checkClock(now) {
    var back = meta.maxNow && now < meta.maxNow - ROLLBACK_SLACK;
    if (back && !meta.behind) meta.rollback = (meta.rollback | 0) + 1;   // count each rollback event once
    meta.behind = !!back;
    if (now > meta.maxNow) meta.maxNow = now;
    return !!back;
  }
  checkClock(Date.now());

  function writeMeta() { LocalStore.set(META, JSON.stringify(meta)); }

  // ---------- conflict resolution (pure) ----------
  // local: {rev, baseRev, dirty, savedAt}; remote: {rev, savedAt} | null
  // Returns 'none' | 'push' | 'pull' | 'conflict'
  function resolve(local, remote) {
    if (!remote) return local && (local.dirty || local.rev > 0) ? 'push' : 'none';
    var lb = local.baseRev | 0, rr = remote.rev | 0;
    if (rr === lb) return local.dirty ? 'push' : 'none';   // cloud unchanged since our last sync
    if (rr > lb && !local.dirty) return 'pull';             // only the cloud moved
    if (rr < lb) return 'push';                              // cloud is behind what we already saw (restore/rollback)
    return 'conflict';                                       // both moved: ask the player (UI shows both summaries)
  }

  // Short summary used by the conflict prompt ("Phone: $1.2M, 6 trucks, 2h ago" vs "This device: ...")
  function summarize(raw) {
    try { var s = typeof raw === 'string' ? JSON.parse(raw) : raw;
      return { company: s.company, cash: Math.round(s.cash || 0), earned: Math.round(s.earned || 0), xp: Math.round(s.xp || 0), trucks: (s.trucks || []).length, last: s.last };
    } catch (e) { return null; }
  }

  // ---------- CloudStore: Supabase adapter, inert without config ----------
  function makeSupabaseCloud(cfg) {
    if (!cfg || !cfg.supabaseUrl || !cfg.supabaseAnonKey) return null;
    if (!window.supabase || typeof window.supabase.createClient !== 'function') { console.info('[DKSave] supabase-js not loaded; cloud disabled'); return null; }
    var sb = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, { auth: { persistSession: true, autoRefreshToken: true } });
    return {
      name: 'supabase', client: sb,
      // Guest play: anonymous session, later upgraded via linkIdentity()/updateUser({email}) — same user id, same save row.
      ensureSession: function () {
        return sb.auth.getSession().then(function (r) {
          if (r.data && r.data.session) return r.data.session;
          return sb.auth.signInAnonymously().then(function (a) { if (a.error) throw a.error; return a.data.session; });
        });
      },
      head: function () { // remote meta only (cheap)
        return sb.from('saves').select('rev, client_saved_at, updated_at').maybeSingle().then(function (r) {
          if (r.error) throw r.error; return r.data ? { rev: r.data.rev, savedAt: Date.parse(r.data.client_saved_at) || 0, serverAt: r.data.updated_at } : null;
        });
      },
      pull: function () {
        return sb.from('saves').select('rev, data, client_saved_at').maybeSingle().then(function (r) {
          if (r.error) throw r.error; return r.data;
        });
      },
      // Optimistic concurrency: server only accepts if base_rev matches; returns {ok, rev, server_now, flags}
      push: function (raw, baseRev, savedAt) {
        return sb.rpc('put_save', { p_data: JSON.parse(raw), p_base_rev: baseRev, p_client_saved_at: new Date(savedAt).toISOString(), p_device: meta.device, p_schema: 4 })
          .then(function (r) { if (r.error) throw r.error; return r.data; });
      }
    };
  }
  cloud = makeSupabaseCloud(window.DK_CONFIG);

  // ---------- public API ----------
  function read() { lastBytes = (LocalStore.get(KEY) || '').length; return LocalStore.get(KEY); }

  function write(S) {
    if (suspended) return false;              // e.g. while replacing the save with a cloud copy before reload
    var now = Date.now(); checkClock(now);
    var raw = JSON.stringify(S);
    if (!LocalStore.set(KEY, raw)) return false;
    lastBytes = raw.length;
    meta.rev++; meta.savedAt = now; meta.dirty = true; writeMeta();
    if (cloud && !pushTimer) pushTimer = setTimeout(function () { pushTimer = null; sync(); }, PUSH_DEBOUNCE);
    return true;
  }

  function clear() {
    suspended = true;                          // caller reloads next; don't let pagehide save() resurrect the old run
    LocalStore.del(KEY);
    // Keep device id + clock high-water mark; cloud copy is handled by the caller (Reset = new run, pushed on next save).
    meta.rev = 0; meta.dirty = true; meta.savedAt = 0; writeMeta();
  }

  // Replace the local save with a cloud copy and reload so load() runs migrations + offline progress normally.
  function adopt(raw, rev) {
    suspended = true;                          // stop pagehide/visibilitychange save() from clobbering it
    LocalStore.set(KEY, typeof raw === 'string' ? raw : JSON.stringify(raw));
    meta.baseRev = rev; meta.dirty = false; writeMeta();
    location.reload();
  }

  var syncing = null;
  function sync(opts) {
    if (!cloud) return Promise.resolve({ action: 'inert' });
    if (syncing) return syncing;
    opts = opts || {};
    syncing = cloud.ensureSession().then(function () { return cloud.head(); }).then(function (remote) {
      var action = resolve(meta, remote);
      if (action === 'push') {
        var raw = LocalStore.get(KEY); if (!raw) return { action: 'none' };
        return cloud.push(raw, meta.baseRev, meta.savedAt || Date.now()).then(function (res) {
          if (res && res.server_now) anchor(res.server_now);
          if (res && res.ok) { meta.baseRev = res.rev; meta.dirty = false; writeMeta(); return { action: 'push', rev: res.rev, flags: res.flags }; }
          return { action: 'conflict', remote: remote };   // someone pushed in between
        });
      }
      if (action === 'pull') return cloud.pull().then(function (row) { if (row) adopt(row.data, row.rev); return { action: 'pull', rev: row && row.rev }; });
      if (action === 'conflict') {
        var handler = opts.onConflict || DKSave.onConflict;
        return cloud.pull().then(function (row) {
          var ls = summarize(LocalStore.get(KEY)), rs = summarize(row && row.data);
          // New device / fresh install that never synced and hasn't earned anything yet: just take the cloud save.
          if (meta.baseRev === 0 && rs && (!ls || !ls.earned)) { adopt(row.data, row.rev); return { action: 'pull', auto: true }; }
          var choice = handler ? handler({ local: ls, remote: rs, localSavedAt: meta.savedAt, remoteSavedAt: remote.savedAt }) : null;
          return Promise.resolve(choice).then(function (c) {
            if (c === 'remote') { adopt(row.data, row.rev); return { action: 'pull' }; }
            if (c === 'local') { meta.baseRev = row.rev; writeMeta(); syncing = null; return sync(opts); }
            return { action: 'conflict', pending: true };
          });
        });
      }
      return { action: 'none' };
    }).catch(function (e) { console.warn('[DKSave] sync failed (offline?)', e && e.message); return { action: 'error', error: String(e && e.message || e) }; })
      .then(function (r) { syncing = null; return r; });
    return syncing;
  }

  function status() {
    return { backend: LocalStore.name, cloud: cloud ? cloud.name : 'inert', dirty: !!meta.dirty, rev: meta.rev, baseRev: meta.baseRev,
      savedAt: meta.savedAt, device: meta.device, rollback: meta.rollback | 0, bytes: lastBytes };
  }

  // ---------- Trusted clock (prototype; not wired into game code yet, see offline-progress spec) ----------
  // Server-anchored "now": serverAt + monotonic time since the anchor was taken this session.
  // Falls back to the device clock (untrusted) when there is no anchor (offline / cloud inert).
  var OFF_CAP_S = 8 * 3600, DEVICE_CAP_S = 2 * 3600, sess = null;  // sess = {at: server ms, perf: performance.now()}
  function perfNow() { return (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now(); }
  function anchor(serverIso) {
    var at = typeof serverIso === 'number' ? serverIso : Date.parse(serverIso);
    if (!isFinite(at)) return;
    sess = { at: at, perf: perfNow() };
    meta.lastServerAt = Math.max(meta.lastServerAt || 0, at); writeMeta();
  }
  var clock = {
    now: function () { return sess ? sess.at + (perfNow() - sess.perf) : Date.now(); },
    verified: function () { return !!sess; },
    rollback: function () { return !!meta.behind; },
    // Fetch server time (cheap RPC). Resolves to true when anchored. No-op without cloud.
    sync: function () {
      if (!cloud) return Promise.resolve(false);
      return cloud.client.rpc('server_now').then(function (r) { if (r.error) throw r.error; anchor(r.data); return true; })
        .catch(function () { return false; });
    },
    // Offline seconds to pay out for a save last stamped at lastMs (S.last), given the game's lastSrv (server-verified ms or 0).
    // Returns {secs, source:'server'|'device'|'none', reason}
    away: function (lastMs, lastSrvMs, unverifiedUsedS) {
      var now = clock.now();
      if (meta.behind) return { secs: 0, source: 'none', reason: 'clock_rollback' };
      if (sess && lastSrvMs) {
        return { secs: Math.max(0, Math.min((now - lastSrvMs) / 1000, OFF_CAP_S)), source: 'server', reason: 'verified' };
      }
      var budget = Math.max(0, OFF_CAP_S - (unverifiedUsedS || 0));      // unverified payouts since last server check share one 8h budget
      var secs = Math.max(0, Math.min((now - lastMs) / 1000, DEVICE_CAP_S, budget));
      return { secs: secs, source: 'device', reason: budget <= 0 ? 'budget_exhausted' : 'unverified' };
    },
    _anchor: anchor, OFF_CAP_S: OFF_CAP_S, DEVICE_CAP_S: DEVICE_CAP_S
  };

  var DKSave = window.DKSave = {
    KEY: KEY, read: read, write: write, clear: clear, sync: sync, status: status, resolve: resolve, summarize: summarize,
    clock: clock,
    onConflict: null, // set by UI: ({local, remote, localSavedAt, remoteSavedAt}) => 'local' | 'remote' | Promise thereof
    _adopt: adopt
  };

  // Sync on boot (after the game has loaded) and when the app goes to background.
  if (cloud) {
    addEventListener('load', function () { setTimeout(sync, 1500); });
    addEventListener('visibilitychange', function () { if (document.visibilityState === 'hidden' && meta.dirty) sync(); });
  }
})();
