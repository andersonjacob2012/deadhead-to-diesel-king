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
if (existsSync(join(root, 'map'))) cpSync(join(root, 'map'), join(out, 'map'), { recursive: true, filter: s => !SKIP.test(s.slice(root.length + 1)) });
cpSync(join(root, 'platform'), join(out, 'platform'), { recursive: true, filter: s => !/supabase|build-www/.test(s) });
const L = join(root, 'node_modules', 'leaflet', 'dist');
if (!existsSync(L)) throw new Error('run npm install first (leaflet is vendored from node_modules)');
cpSync(L, join(out, 'vendor', 'leaflet'), { recursive: true, filter: s => !/\.map$|leaflet-src/.test(s) });
let html = readFileSync(join(root, 'index.html'), 'utf8');
const n0 = html.length;
html = html.replace(/<link rel="stylesheet" href="https:\/\/unpkg\.com\/leaflet@1\.9\.4\/dist\/leaflet\.css"[^>]*>/, '<link rel="stylesheet" href="vendor/leaflet/leaflet.css">')
           .replace(/<script src="https:\/\/unpkg\.com\/leaflet@1\.9\.4\/dist\/leaflet\.js"[^>]*><\/script>/, '<script src="vendor/leaflet/leaflet.js"></script>');
if (html.includes('unpkg.com/leaflet')) console.warn('WARN: Leaflet CDN tag not rewritten (index.html changed?)');
// Optional runtime config (Supabase URL + anon key). Never put the service_role key here.
const cfg = join(root, 'platform', 'config.local.js');
if (existsSync(cfg)) { cpSync(cfg, join(out, 'platform', 'config.js')); html = html.replace('<script src="platform/save-store.js', '<script src="platform/config.js"></script><script src="platform/save-store.js'); }
writeFileSync(join(out, 'index.html'), html);
console.log(`www/ built (${n0} -> ${html.length} bytes index.html, leaflet vendored)`);
