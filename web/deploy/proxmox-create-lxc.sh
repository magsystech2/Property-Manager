#!/usr/bin/env bash
# Run this on the Proxmox host (as root, in the Proxmox shell). It creates a small Debian 12 LXC
# with Docker and starts Project Ledger in it. Safe defaults; change the variables below if needed.
#
#   bash proxmox-create-lxc.sh
#
set -euo pipefail

CTID="${CTID:-$(pvesh get /cluster/nextid)}"
HOSTNAME="${HOSTNAME_LXC:-ledger}"
STORAGE="${STORAGE:-local-lvm}"          # where the container disk goes
TEMPLATE_STORAGE="${TEMPLATE_STORAGE:-local}"
BRIDGE="${BRIDGE:-vmbr0}"
DISK_GB="${DISK_GB:-8}"
MEMORY_MB="${MEMORY_MB:-1024}"
CORES="${CORES:-1}"
REPO="${REPO:-https://github.com/magsystech2/property-manager.git}"
BRANCH="${BRANCH:-main}"

echo "==> Finding the Debian 12 template"
pveam update >/dev/null
TEMPLATE="$(pveam available --section system | awk '/debian-12-standard/ {print $2}' | sort -V | tail -1)"
[ -n "$TEMPLATE" ] || { echo "No Debian 12 template found"; exit 1; }
pveam list "$TEMPLATE_STORAGE" | grep -q "$TEMPLATE" || pveam download "$TEMPLATE_STORAGE" "$TEMPLATE"

echo "==> Creating LXC $CTID ($HOSTNAME)"
pct create "$CTID" "$TEMPLATE_STORAGE:vztmpl/$TEMPLATE" \
  --hostname "$HOSTNAME" --cores "$CORES" --memory "$MEMORY_MB" --swap 512 \
  --rootfs "$STORAGE:$DISK_GB" --net0 "name=eth0,bridge=$BRIDGE,ip=dhcp" \
  --features nesting=1,keyctl=1 --unprivileged 1 --onboot 1 --start 1
sleep 8

echo "==> Installing Docker inside the container"
pct exec "$CTID" -- bash -c "apt-get update -qq && apt-get install -y -qq ca-certificates curl git >/dev/null && curl -fsSL https://get.docker.com | sh >/dev/null"

echo "==> Getting Project Ledger"
pct exec "$CTID" -- bash -c "git clone --depth 1 -b $BRANCH $REPO /opt/project-ledger && cp /opt/project-ledger/web/deploy/.env.example /opt/project-ledger/web/deploy/.env"

echo "==> Building and starting (first build takes a few minutes)"
pct exec "$CTID" -- bash -c "cd /opt/project-ledger/web/deploy && docker compose up -d --build"

IP="$(pct exec "$CTID" -- hostname -I | awk '{print $1}')"
cat <<MSG

Done. Project Ledger is running in LXC $CTID at http://$IP:8080 (demo mode until Supabase is set).

Next:
  1. pct enter $CTID
  2. nano /opt/project-ledger/web/deploy/.env     # SUPABASE_URL, SUPABASE_ANON_KEY, and TS_AUTHKEY (or TUNNEL_TOKEN / LEDGER_DOMAIN)
  3. cd /opt/project-ledger/web/deploy && docker compose --profile tailscale up -d --build    (or --profile tunnel / caddy)
MSG
