# Project Ledger

An iPhone and Mac app (plus a web app) for a three-partner LLC that flips houses and builds new homes. It tracks what each property costs against its budget, who paid what, what the LLC owes each partner, which bills are due, and where every receipt is.

- **Fast capture.** Scan a receipt (edge detection and text reading on the phone), import a PDF, pick a photo, say it out loud, or type it. Check the suggested vendor, date, invoice # and total, then post. Or save a draft and finish it later.
- **Budgets that add up.** Each project has a budget per category. For each category it shows paid, unpaid billed and committed-not-billed amounts. Projected spend is paid + unpaid billed + committed not billed. One receipt or bill can be split across categories, and the split must match the total.
- **Commitments.** A contractor agreement plus approved change orders. When the contractor invoices against it, that amount moves from "not billed" to "billed", so projected spend isn't counted twice.
- **Partner balances from real transactions.** A personal payment counts once as a project cost and once as money the LLC owes that partner. Reimbursements (partial, or covering several expenses) lower what's owed. Contributions are tracked on their own. Nothing assumes equal shares.
- **Shared, safe records.** Each partner has a login. Records and documents are visible only to members of the LLC workspace, and the database enforces this. Posted records are never deleted: voids need a reason, and every create, approve and void is logged. You can require a second partner to approve bills, change orders and reimbursement requests.
- **CSV exports** by project, partner, vendor and date range. Each row has the transaction ID and attachment file names. The totals match the app.
- **Sale and profit split.** Cost basis by purchase, closing, rehab and holding; an expected sale price (ARV) and a forecast with "what if it sells late or for less" sliders; record the sale price, selling costs and loan payoff; then see who gets what (capital back first, then profit by the split you set per project or for the LLC) and record distributions.
- **Keep up each week.** A receipt inbox (share a PDF or photo into the app, file it later), card and bank statement import with suggested matches, a weekly review where partners claim items, a 30-day cash plan with scheduled contractor draws, recurring cost templates, materials left over per house, and reports.

## What's in the repo

| Path | What |
|---|---|
| `ios/ProjectLedger/` | SwiftUI app for iPhone, iPad and Mac (iOS 17+, macOS 14+ through Mac Catalyst). Tabs: Home, Projects, Activity, Partners, plus the Add button |
| `ios/LedgerCore/` | Swift package with all the balance math, rules, CSV export and the receipt and voice readers, plus its tests |
| `ios/project.yml` | XcodeGen spec that generates `ProjectLedger.xcodeproj` |
| `supabase/migrations/` | Postgres schema, rules (triggers), row-level security, the private file bucket, live updates |
| `supabase/tests/` | The six spec workflows plus review, void, audit, access and concurrency tests |
| `supabase/seed.sql` | Local sample data: three partners, one outsider, two properties |
| `web/` | Web app (React) on the same Supabase backend, with Docker and Proxmox hosting files. See [`web/README.md`](web/README.md) |
| `supabase/functions/parse-expense/` | Optional server-side reader for "Say it" (uses Claude). Without it, the app reads speech on the phone |

Money is stored as integer cents everywhere.

## 1. Run the demo (no backend needed)

Requires a Mac with Xcode 15.3 or later and [XcodeGen](https://github.com/yonaskolb/XcodeGen) (`brew install xcodegen`).

```sh
cd ios
xcodegen generate
open ProjectLedger.xcodeproj
```

Pick an iPhone simulator, your phone, or **My Mac (Mac Catalyst)** and press Run. On the welcome screen, tap **Try the demo**. A purple **DEMO MODE** bar stays on screen. The demo has sample data for three partners and two properties, kept on that phone only. Tap the name in the bar to act as a different partner (useful for testing approvals), or reset the sample data.

To install on your own iPhone, set your Apple ID team under *Signing & Capabilities* and change the bundle ID if Xcode asks.

### On the Mac

The Mac app is the same code as the iPhone app (Mac Catalyst), so every screen and number matches. Choose **My Mac (Mac Catalyst)** as the run destination, or build from Terminal:

```sh
xcodebuild -project ProjectLedger.xcodeproj -scheme ProjectLedger -destination 'platform=macOS,variant=Mac Catalyst' build
```

Scanning with the camera is iPhone only; on the Mac, import a PDF or photo instead, or in Finder right-click a PDF and choose **Open With → Project Ledger** to drop it in the receipt inbox. The Mac app keeps its sign-in in a private file under `~/Library/Application Support/ProjectLedger/` because a locally signed build can't use the keychain without a developer team.

## 2. Set up live sync (all three partners, same data)

1. Create a free project at [supabase.com](https://supabase.com).
2. Apply the database. Either:
   - **SQL editor:** paste and run each file in `supabase/migrations/` in order (`…01_schema`, `…02_rules`, `…03_storage_realtime`, `…04_member_access`, `…05_inbox_statements_planning`, `…06_sale_distributions_materials_templates`), or
   - **CLI:** `supabase link --project-ref <ref>` and then `supabase db push`.
   Don't run `seed.sql` on the hosted project. It's for local testing only.
3. **Authentication → Providers → Email:** keep it on. For a three-person team you can turn off "Confirm email", or leave it on and have each partner confirm by email first.
4. **Project Settings → API:** copy the Project URL and the `anon` `public` key. Then either:
   - put them in `ios/ProjectLedger/App/AppConfig.swift` (`defaultSupabaseURL`, `defaultSupabaseAnonKey`) before building, so partners don't type anything, or
   - enter them in the app: Welcome → **Live sync settings**.
   The anon key is meant to ship in apps. Row-level security decides what each signed-in user can see.
5. Optional, for smarter "Say it" reading: `supabase secrets set ANTHROPIC_API_KEY=…` and then `supabase functions deploy parse-expense`.

## 3. Invite partners

1. The first partner taps **Sign in to our LLC → Create account**, then **Create LLC workspace**. They become the owner, and the default budget categories are added.
2. Owner: **Partners → Settings → Invite partners**. Enter each partner's email.
3. Each partner installs the app, creates an account with that exact email, enters their name and taps **Join my invitation**.
4. The owner can change roles, turn on **Require a second partner to approve**, and edit categories in the same screen.
5. To take away a partner's access (say a partner leaves), the owner taps that partner's role → **Remove access…**. The database stops them seeing or adding any record or file right away. Their past entries and balances stay, so the LLC still shows what it owes them. **Restore** gives access back.

## Web app

`web/` is the same ledger in a browser, for partners on Windows or an Android phone. It uses the same Supabase project, so data and access rules are shared with the iPhone and Mac app, and it has its own demo mode. Both apps have the same features and use the same rules (`ios/LedgerCore` and `web/src/core` are kept in step, with matching tests). To try it: `cd web && npm install && npm run dev`. To host it on Proxmox with private HTTPS through Tailscale, see [`web/README.md`](web/README.md).

## 4. Test the workflows

**Database (rules and access):** needs a local Postgres 15+.

```sh
supabase/run_local_tests.sh            # 6 spec workflows + review, voids, audit, roles, outsider access
supabase/tests/concurrency.sh          # two partners pay the same $1,000 bill at once: only one $600 payment gets in
```

**Ledger math and CSV:** `cd ios/LedgerCore && swift test`

**In the app** (live sync, two phones or a phone and a simulator signed in as different partners):

| # | Do this | Expect |
|---|---|---|
| 1 | Partner A: Add → Scan Receipt, $350 materials, *Who paid: Me* | Project paid costs +$350. Partners → A: LLC owes +$350 |
| 2 | Partners → A → Reimburse, $200, Already paid | Project still shows $350 paid. A's balance is $150 |
| 3 | Project → More → Add commitment, $10,000. Add bill for this contract, $4,000. Record payment, $1,500 | Overview: Paid $1,500, Unpaid billed $2,500, Committed not billed $6,000, Projected $10,000 |
| 4 | Partner B: Activity → swipe a payment → Attach | The document appears on the record. Totals don't change |
| 5 | Partner B's phone pulls to refresh, or just waits | Same records. A user from a different LLC sees none of them, and can't open their files |
| 6 | Partners → Export CSV (or a project's More → Export CSV) | The totals section and the TOTAL row match the app's numbers |

## Notes and limits

- Payments are recorded after they happen outside the app. No bank connections, and no money moves.
- Receipts and bills entered offline are kept on the phone and marked "Waiting to sync" until they upload. Other records (payments, reimbursements) need a connection when you save them.
- Each list loads up to 10,000 rows per table. Add paging before it grows past that.
- **Share into the app:** in Mail, Files or Photos, share a PDF or photo to Project Ledger (or use "Open in"). It lands in the receipt inbox for anyone to file.
- Statement import reads the CSV your bank or card site exports. Rows already imported are skipped, so overlapping downloads are safe.
- Project documents that aren't one transaction (permits, plans, closing papers) go on the project's **Files** tab. Vendor documents (contracts, W-9s, insurance certificates) go on the vendor's page. Neither changes any totals.
- Profit splits and distributions are tracked; tax accounting is not.
