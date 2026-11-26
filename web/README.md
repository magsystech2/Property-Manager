# Project Ledger for the web

The same ledger as the iPhone app, in a browser. It talks to the same Supabase project with the same tables and row-level security, so all three partners see the same live data whichever app they use. It has Home, Projects, Activity, Partners, Vendors, CSV export, drafts, "Say it", receipt and PDF uploads, approvals, and a demo mode that needs no backend.

The balance math, rules, CSV columns and demo numbers are ported from `ios/LedgerCore`, so both apps agree to the cent (`npm test` checks the spec workflows).

## Run it on your computer

Requires Node 22 or later.

```sh
cd web
npm install
npm run dev        # http://localhost:5173
npm test           # ledger math and rules
npm run build      # production files in dist/
```

Click **Try the demo** to use sample data kept in that browser only. The purple bar lets you act as a different partner (useful for approvals) or reset the sample data.

## Bulk upload

**Bulk upload** (sidebar, or Add → Bulk upload) adds many receipts and bills from a spreadsheet. Download the template, fill it in with Excel, Numbers or Google Sheets, save it as CSV and choose it. Each row is checked like the Add form: unknown projects, categories, partners or bad dates are marked so you can fix them in the file, new vendors are created, and rows that match an entry already in the books (or an earlier row) are left unchecked. Nothing is saved until you press Import.

## Planning, sale and reporting

- **Receipt inbox:** drop receipt photos and contractor PDFs in from any device; any partner files them later as a receipt or bill. Forwarding by email needs a mail service and a domain.
- **Statements:** import a card or bank CSV, match charges to receipts, split one store trip across properties, and clear the **Missing receipts** list.
- **Weekly review** with "I'll take it" claims, **Cash needed** for the next 14/30/60 days, and a **Forecast** tab per project with delay and price what-ifs.
- **Cost basis and profit** on each project's overview (purchase, closing, rehab, holding; ARV; projected or actual profit).
- **Sale and split** tab: record the sale from the closing statement, set the profit split (LLC default or per project), see who gets what (capital back first, then profit), and record distributions. LLC-wide contributions come back at the LLC's first sale.
- **Materials** tab: bought, used, returned and leftover, with leftover value.
- **Recurring and templates:** "Add again" and "Save as template" on any receipt or bill; repeating costs show on Home when due.
- **Reports:** project P&L, partner activity and spend by project, budget vs actual.
- New receipts remember who paid and how, per partner. Search covers descriptions and notes.

## Connect to Supabase

Use the same Supabase project as the iPhone app (see the root README, section 2). The web app needs the Project URL and the `anon` `public` key from **Project Settings → API**. Either:

- set `SUPABASE_URL` and `SUPABASE_ANON_KEY` for the container (below), so partners don't type anything, or
- enter them in the app: Welcome → **Live sync settings**.

In Supabase, **Authentication → URL Configuration**: set the Site URL to the web address you use (for example `https://ledger.your-tailnet.ts.net`) and add it to Redirect URLs. This only matters for the confirmation email link; sign-in itself is email and password.

## Host it on Proxmox

The app is static files served by nginx in a Docker container. `deploy/` holds:

| File | What |
|---|---|
| `proxmox-create-lxc.sh` | Run on the Proxmox host. Creates a Debian 12 LXC (1 core, 1 GB RAM, 8 GB disk), installs Docker, clones this repo, and starts the app |
| `docker-compose.yml` | The app on port 8080, plus optional `tailscale`, `tunnel` (Cloudflare) and `caddy` profiles for HTTPS |
| `.env.example` | Supabase settings and the HTTPS options |
| `tailscale-serve.json` | Tells Tailscale to serve the app over HTTPS |

### 1. Create the container

On the Proxmox host shell:

```sh
curl -fsSLO https://raw.githubusercontent.com/magsystech2/property-manager/main/web/deploy/proxmox-create-lxc.sh
bash proxmox-create-lxc.sh
```

Variables you can set first: `CTID`, `STORAGE` (default `local-lvm`), `BRIDGE` (default `vmbr0`), `BRANCH` (default `main`). When it finishes it prints the address, for example `http://192.168.1.50:8080`. That works on your home network right away, in demo mode. The address comes from your router (DHCP), so add a DHCP reservation for the container if you want it to stay the same.

### 2. Reach it from anywhere

**Tailscale (recommended, no domain needed).** Private: only devices signed in to your tailnet can open it.

1. Create a free account at tailscale.com. In the admin console, **DNS**: turn on MagicDNS and HTTPS certificates.
2. **Settings → Keys**: generate an auth key.
3. In the container (`pct enter <CTID>`), edit `/opt/project-ledger/web/deploy/.env`: set `TS_AUTHKEY`, `SUPABASE_URL` and `SUPABASE_ANON_KEY`.
4. `cd /opt/project-ledger/web/deploy && docker compose --profile tailscale up -d --build`
5. Each partner installs Tailscale on their phone and laptop, signs in (invite them from the admin console), and opens `https://ledger.<your-tailnet>.ts.net`.

**Tailscale Funnel (public link, no domain, no app for partners).** Same setup as above, plus:

1. Admin console → **Access controls**: allow Funnel for the server. Add this to the policy file (or click **Enable Funnel** if the console offers it):
   ```json
   "nodeAttrs": [{ "target": ["autogroup:member"], "attr": ["funnel"] }]
   ```
2. In `.env`, set `TS_SERVE_FILE=tailscale-funnel.json`, then `docker compose --profile tailscale up -d`.
3. In Supabase, **Authentication → URL Configuration**: set the Site URL to `https://ledger.<your-tailnet>.ts.net` and add it to Redirect URLs, so confirmation emails link back to the app.

Anyone with the link reaches the sign-in page, but only invited partners with an account get past it; the database's row-level security still applies to every request.

**Cloudflare Tunnel (public link, needs a domain, about $10 a year).** In Cloudflare Zero Trust → Networks → Tunnels, create a tunnel, add a public hostname pointing to `http://ledger-web:80`, put the token in `.env` as `TUNNEL_TOKEN`, then `docker compose --profile tunnel up -d --build`. Nothing is opened on your router.

**Caddy (public link, needs a domain and port forwarding).** Point a DNS record at your public IP, forward ports 80 and 443 to the container, set `LEDGER_DOMAIN`, then `docker compose --profile caddy up -d --build`.

Use HTTPS for daily use: browsers only allow the microphone for "Say it" and the camera button on secure pages.

### Update to a new version

```sh
pct enter <CTID>
cd /opt/project-ledger && git pull
cd web/deploy && docker compose --profile tailscale up -d --build
```

The image build runs the tests first, so a broken version won't replace the running one.

## Notes

- Supabase settings are read at runtime from `/config.js`, which the container writes from its environment. Settings saved in the browser override it.
- Files go to the same private `attachments` bucket as the iPhone app and open with links that expire after an hour.
- These features need migrations `…05`, `…06` and `…07` (notes on receipts and bills) in `supabase/migrations/`. Without them the app still loads; the new pages are just empty and notes aren't saved.
