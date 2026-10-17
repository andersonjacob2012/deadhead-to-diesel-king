// Copy to platform/config.local.js (git-ignored) and fill in from Supabase > Project Settings > API.
// The anon/publishable key is SAFE to ship in the app (RLS protects data). NEVER put the service_role/secret key here.
window.DK_CONFIG = {
  supabaseUrl: 'https://YOUR-PROJECT-REF.supabase.co',
  supabaseAnonKey: 'YOUR-ANON-OR-PUBLISHABLE-KEY'
};
