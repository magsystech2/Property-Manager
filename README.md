# Flip Tracker

An iPhone app for the three LLC partners to track spending on house flips and new builds.

- **Snap a receipt or bill.** The app reads vendor, date, amount and invoice # from the photo and pre-fills the expense. The photo is kept with it.
- **Say it.** "Spent 1,280 at Home Depot on drywall for Oak Street, paid with my card" becomes a pre-filled expense.
- **Your login is your name.** Every expense is saved under the partner who is signed in. Everyone sees everyone's spending.
- **Properties:** budget vs actual, spending by category, projected profit.
- **Partners:** what each partner paid from their own money vs an equal share.
- **Contractor invoices:** invoiced vs paid (payments match by invoice #), overdue flags.

## How it's built

| Part | Tech |
|---|---|
| iOS app (`ios/`) | SwiftUI, iOS 17+, project generated with XcodeGen |
| Sign-in | Firebase Auth (email + password) |
| Shared data | Cloud Firestore (`properties`, `expenses`, `invoices`, `members`) |
| Receipt photos | Firebase Storage (`receipts/<uid>/…`) |
| Reading photos and speech | Firebase Cloud Functions (`firebase/functions`) calling Claude. The API key stays on the server. |
| Speech to text | Apple Speech framework, on the phone |

Access is limited to the emails listed in the Firestore document `config/partners`. Firestore rules make sure an expense is always recorded under the signed-in partner and only that partner can edit or delete it.

## One-time setup

1. **Firebase project.** At <https://console.firebase.google.com> create a project, then:
   - Upgrade to the **Blaze** (pay as you go) plan. Cloud Functions and Storage need it; at 3 users the cost is normally $0–1/month.
   - Authentication → Sign-in method → enable **Email/Password**.
   - Create a **Firestore** database and a **Storage** bucket (production mode).
   - Project settings → Add app → iOS, bundle ID `com.fliptracker.app`. Download `GoogleService-Info.plist` into `ios/` (it is git-ignored).
2. **Partner list.** In Firestore create the document `config/partners` with a field `emails` (array) holding the three partners' emails in lowercase.
3. **Claude API key.** Get a key at <https://console.anthropic.com>, then:
   ```sh
   cd firebase
   npm install -g firebase-tools && firebase login
   firebase use --add            # pick your project
   firebase functions:secrets:set ANTHROPIC_API_KEY
   (cd functions && npm install)
   firebase deploy               # rules + functions
   ```
4. **Build the app** (Mac with Xcode 16+):
   ```sh
   brew install xcodegen
   cd ios && xcodegen generate && open FlipTracker.xcodeproj
   ```
   Pick your Apple developer team under Signing, then run on a simulator or your iPhone.
5. **Get it onto the partners' phones** with TestFlight (needs an Apple Developer account, $99/year).

## Cost of reading receipts and speech

Each photo or voice entry is one Claude request at low effort, roughly a cent or two. Requests use server-side refusal fallbacks so an occasional declined read is retried on another model automatically.
