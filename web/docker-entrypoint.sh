#!/bin/sh
# Writes /config.js from SUPABASE_URL and SUPABASE_ANON_KEY when the container starts.
# Both are public values (the anon key is meant to ship in apps; row-level security protects the data).
set -eu
esc() { printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g'; }
cat > /usr/share/nginx/html/config.js <<JS
window.__LEDGER_CONFIG__ = { supabaseUrl: "$(esc "${SUPABASE_URL:-}")", supabaseAnonKey: "$(esc "${SUPABASE_ANON_KEY:-}")" };
JS
if [ -z "${SUPABASE_URL:-}" ]; then
  echo "ledger: SUPABASE_URL is not set. The app will offer demo mode, or partners can enter the settings in the browser."
fi
