// Copies the static game into www/ for Capacitor. No bundler: the game is plain HTML/JS.
// - vendors Leaflet from node_modules (no unpkg CDN dependency inside the app)
// - skips art source/preview/mockup folders (not needed at runtime)
import { cpSync, mkdirSync, rmSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = join(dirname(fileURLToPath(import.meta.url)), '..'), out = join(root, 'www');
rmSync(out, { recursive: true, force: true }); mkdirSync(out, { recursive: true });
const SKIP = /(^|\/)(source|preview|options|legacy)(\/|$)|mockup|style-guide|demo\.html$|README\.md$|\.py$/;
for (const f of ['routes.js', 'manifest.webmanifest']) cpSync(join(root, f), join(out, f));
cpSync(join(root, 'assets'), join(out, 'assets'), { recursive: true, filter: s => !SKIP.test(s.slice(root.length + 1)) });
// Custom vector map (Art Director): GeoJSON/TopoJSON layers loaded by relative path
if (existsSync(join(root, 'map'))) cpSync(join(root, 'map'), join(out, 'map'), { recursive: true, filter: s => !SKIP.test(s.slice(root.length + 1)) && !/^map\/build(\/|$)/.test(s.slice(root.length + 1)) });
cpSync(join(root, 'platform'), join(out, 'platform'), { recursive: true, filter: s => !/supabase|build-www/.test(s) });
const L = join(root, 'node_modules', 'leaflet', 'dist');
if (!existsSync(L)) throw new Error('run npm install first (leaflet is vendored from node_modules)');
cpSync(L, join(out, 'vendor', 'leaflet'), { recursive: true, filter: s => !/\.map$|leaflet-src/.test(s) });
let html = readFileSync(join(root, 'index.html'), 'utf8');
const n0 = html.length;
html = html.replace(/<link rel="stylesheet" href="https:\/\/unpkg\.com\/leaflet@1\.9\.4\/dist\/leaflet\.css"[^>]*>/, '<link rel="stylesheet" href="vendor/leaflet/leaflet.css">')
           .replace(/<script src="https:\/\/unpkg\.com\/leaflet@1\.9\.4\/dist\/leaflet\.js"[^>]*><\/script>/, '<script src="vendor/leaflet/leaflet.js"></script>');
if (html.includes('unpkg.com/leaflet')) console.warn('WARN: Leaflet CDN tag not rewritten (index.html changed?)');
// The app never loads AdSense (native ads = AdMob + UMP): drop the web-only AdSense verification tag from the app copy.
html = html.replace(/<script\b[^>]*pagead2\.googlesyndication\.com\/pagead\/js\/adsbygoogle\.js[^>]*><\/script>\s*/g, '');
if (/<script\b[^>]*pagead2\.googlesyndication\.com/.test(html)) console.warn('WARN: AdSense tag not stripped from www/index.html');
// Optional runtime config (Supabase URL + anon key). Never put the service_role key here.
const cfg = join(root, 'platform', 'config.local.js');
if (existsSync(cfg)) { cpSync(cfg, join(out, 'platform', 'config.js')); html = html.replace('<script src="platform/save-store.js', '<script src="platform/config.js"></script><script src="platform/save-store.js'); }
writeFileSync(join(out, 'index.html'), html);
// Build hash for the app (index.html shows it from version.json, offline too since it ships in www/): a deploy commit already carries the
// stamped file (tools/deploy-commit.sh); from a plain source checkout, stamp the checked-out commit; a dirty tree gets no hash (vX.Y.Z only).
{ const vf = join(root, 'version.json'); let vj = {}; try { vj = JSON.parse(readFileSync(vf, 'utf8')) } catch (e) {}
  const ver = (html.match(/const VERSION='([0-9.]+)'/) || [])[1] || '';
  if (!/^[0-9a-f]{40}$/.test(vj.sha || '') || vj.version !== ver) {
    vj = { version: ver, build: '', sha: '' };
    try { const { execSync } = await import('node:child_process'); const g = c => execSync('git ' + c, { cwd: root }).toString().trim();
      if (!g('status --porcelain --untracked-files=no')) { const sha = g('rev-parse HEAD'); vj = { version: ver, build: sha.slice(0, 7), sha } } } catch (e) {}
  }
  writeFileSync(join(out, 'version.json'), JSON.stringify(vj) + '\n'); console.log('version.json', JSON.stringify(vj)) }
console.log(`www/ built (${n0} -> ${html.length} bytes index.html, leaflet vendored)`);
