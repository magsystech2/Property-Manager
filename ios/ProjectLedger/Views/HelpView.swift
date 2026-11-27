import SwiftUI
import LedgerCore

/// Step-by-step guides, words to know, and a way to report an issue. Same guides as the web app's Help page,
/// worded for the iPhone and Mac app.
struct HelpGuide: Identifiable, Hashable {
    let id: String
    let title: String
    let subtitle: String
    let icon: String
    let tint: Color
    let intro: String
    let steps: [String]
    var tip: String? = nil
    var route: Route? = nil
    var routeTitle: String? = nil

    static func == (a: HelpGuide, b: HelpGuide) -> Bool { a.id == b.id }
    func hash(into h: inout Hasher) { h.combine(id) }

    static let all: [HelpGuide] = [
        HelpGuide(id: "basics", title: "Getting around", subtitle: "What each part of the app is for", icon: "house", tint: .teal,
                  intro: "Project Ledger keeps the books for our properties in one place: what each project costs, who paid what, which bills are due, and where every receipt is. Everyone sees the same numbers.",
                  steps: ["Home shows what needs attention, the key totals, bills due soon and what the LLC owes each partner.",
                          "Projects lists each property. Open one to see its spending, who paid what, budget, sale and files.",
                          "Activity is every receipt, bill and payment, newest first, with search and filters.",
                          "Partners shows who paid what, each partner's share, and money partners borrowed.",
                          "The + button in the middle of the tab bar is how you add anything new.",
                          "Under Keep up on Home: weekly review, receipt inbox, statements, cash plan, reports, needs review, issues and this Help."],
                  tip: "Every number comes from recorded receipts, bills and payments. Tap a number to see the records behind it."),
        HelpGuide(id: "projects", title: "Projects", subtitle: "Spending, budget and files for each property", icon: "building.2", tint: .indigo,
                  intro: "Each property is a project. Its screen has sections along the top for the different views.",
                  steps: ["Overview: spending against budget first, then who paid what and borrowed money on this project.",
                          "Budget: the approved budget by category and how much of each is used. Tap Edit budget to change it.",
                          "Activity, Vendors and Files: every record for this project, who we paid, and the documents attached.",
                          "More (top right): sale and profit split, materials, commitments and export."],
                  tip: "When you tap + while a project is open, the new entry starts on that project. You can still change it in the form."),
        HelpGuide(id: "add", title: "Add expenses and bills", subtitle: "Receipts already paid, bills still owed", icon: "doc.text", tint: .orange,
                  intro: "An expense is something already paid, with a receipt. A bill is an invoice the LLC still owes. Both belong to a project and a category.",
                  steps: ["Tap +. Choose Scan to photograph a receipt, Say it to describe it out loud, Receipt to type it in, or Bill for an invoice.",
                          "Fill in the amount, vendor, project and category. Attach the receipt or invoice if you have it.",
                          "Under Who paid, pick LLC account if it came out of the LLC's bank account, or Me (or another partner) if it was paid with personal money. Personal payments are added to what the LLC owes that partner.",
                          "If the app warns about a possible duplicate, check it: the same vendor and invoice number, or the same amount within 3 days, is already there.",
                          "When a bill is paid, open it and tap Record payment. A bill can be paid in parts."]),
        HelpGuide(id: "settle", title: "Who paid what", subtitle: "Each partner's money in, share and balance", icon: "person.3", tint: .blue,
                  intro: "\"Who put in what\" on the Partners screen (and on each project) shows how much each partner has put in and how that compares with their share.",
                  steps: ["Contributed: money a partner deposited into the LLC account.",
                          "Paid personally: project costs a partner paid with their own card or cash.",
                          "Reimbursed: what the LLC has already paid that partner back.",
                          "Put in = contributed + paid personally − reimbursed.",
                          "Share of spending is the partner's split (equal thirds unless set otherwise) of the total spent. A plus means they covered more than their share, a minus means less.",
                          "LLC owes (on each partner's screen) is what the LLC still has to pay back. Use Reimburse a partner when it's paid."]),
        HelpGuide(id: "borrowed", title: "Borrowed money", subtitle: "Personal loans partners took", icon: "banknote", tint: .purple,
                  intro: "When a partner borrows money personally (from family, friends or a bank) to fund their part, record it under Borrowed money on the Partners screen or the project.",
                  steps: ["Tap Add loan. Enter the partner, the lender, what it was used for, the date borrowed, the amount and the yearly interest rate.",
                          "Each loan shows interest built up so far, interest paid, principal paid back, what's owed now and the interest per month.",
                          "Tap a loan to change it or to record an interest or principal payment."],
                  tip: "Loans are for reference only. The money is already counted as that partner's contribution or personal payment, so loans never change anyone's balance or payout."),
        HelpGuide(id: "fix", title: "Fix a mistake", subtitle: "Correct a receipt or bill", icon: "pencil", tint: .pink,
                  intro: "Posted money is never silently overwritten. A correction keeps the history.",
                  steps: ["Open the receipt or bill and tap Correct amount, date, vendor or category.",
                          "Change what's wrong and tap Save correction. The original is voided with a note saying what changed, and a corrected copy is posted with the same documents.",
                          "Notes on a receipt or bill can be edited at any time.",
                          "To remove a record entirely, open it and tap Void, then give a reason. Voided records stay in the list, marked Void with the reason."],
                  tip: "Not sure something is right? Don't change it: tap Mark as needs review so the others can check."),
        HelpGuide(id: "review", title: "Needs review flags", subtitle: "Mark entries to double-check", icon: "exclamationmark.triangle", tint: .orange,
                  intro: "A needs review flag puts a record on a shared list, with a note on what to check.",
                  steps: ["Open the receipt or bill and tap Mark as needs review. Write what looks wrong.",
                          "Everyone sees a Review now banner on Home and on the project while entries are flagged.",
                          "On the Needs review screen, open each record, correct it if needed, then tap Mark reviewed and say what you found.",
                          "Changed your mind? Reviewed flags can be reopened."],
                  route: .needsReview, routeTitle: "Go to Needs review"),
        HelpGuide(id: "sale", title: "Sale and profit split", subtitle: "Who gets what when a property sells", icon: "chart.pie", tint: .green,
                  intro: "Sale and profit split (on a project's More menu) works out what each partner gets back from a sale.",
                  steps: ["Record the sale: sale price, selling costs and any loan paid off at closing.",
                          "Cash from the sale shows what the LLC can pay out now.",
                          "Each partner first gets back the capital they put in. Then the profit, or the loss, is shared by the split.",
                          "If no split is set, the profit or loss is divided exactly in equal thirds. Any leftover cent goes to one partner, so the total always adds up.",
                          "To use a different split, tap Change split. The LLC default split is on the Partners screen.",
                          "When money is paid out to a partner, record a distribution."]),
        HelpGuide(id: "search", title: "Search", subtitle: "Find any receipt, bill or payment", icon: "magnifyingglass", tint: .cyan,
                  intro: "Search looks through every record: vendor, description, notes, reference or check number, attached file names and amount.",
                  steps: ["Open Activity and pull down to show the search field.",
                          "Type an amount the way you'd write it: 412.50, $1,250 or 412. A whole number like 412 finds anything from $412.00 to $412.99.",
                          "Use several words to narrow it down. Every word must match, for example \"tile 412\".",
                          "Tap the filter button to filter by project, vendor, partner, category, status or date."],
                  tip: "Properties and vendors whose name matches show at the top, so you can jump straight to them."),
        HelpGuide(id: "books", title: "Weekly bookkeeping", subtitle: "Approve, match and file each week", icon: "checklist", tint: .gray,
                  intro: "A few minutes a week keeps the books complete. The Keep up section on Home has the tools.",
                  steps: ["Weekly review: bills due in the next 7 days, bills waiting for approval, and charges with no receipt.",
                          "Receipt inbox: drop receipts or invoices here when you're busy (or share them from Mail or Photos), and file them later.",
                          "Statements: import a card or bank statement and match each charge to a receipt.",
                          "Cash plan: what the LLC account must cover in the next 30 days, and whether it will run short.",
                          "Reports and Export CSV: totals by project, category and partner, and a file for the accountant."],
                  route: .review, routeTitle: "Go to Weekly review"),
    ]

    static let glossary: [(String, String)] = [
        ("LLC account", "The LLC's own bank account. Money paid from it is not owed to anyone."),
        ("Contribution", "Money a partner put into the LLC account."),
        ("Paid personally", "A project cost a partner paid with their own money. The LLC owes it back."),
        ("Reimbursement", "The LLC paying a partner back for something they paid personally."),
        ("Expense", "Something already paid, usually with a receipt."),
        ("Bill", "An invoice the LLC still owes. It's unpaid until a payment is recorded."),
        ("Commitment", "A signed contract or agreed quote that hasn't been billed yet."),
        ("Capital back", "At a sale, each partner first gets back what they put in, before profit is shared."),
        ("Distribution", "Money actually paid out to a partner from a sale."),
        ("Void", "A cancelled record. It stays in the list, marked Void, with the reason."),
    ]
}

struct HelpView: View {
    @Environment(AppModel.self) private var app
    var body: some View {
        List {
            Section {
                ForEach(HelpGuide.all) { g in
                    NavigationLink { HelpGuideView(guide: g) } label: {
                        HStack(spacing: 12) {
                            GuideIcon(guide: g)
                            VStack(alignment: .leading) {
                                Text(g.title).font(.headline)
                                Text(g.subtitle).font(.caption).foregroundStyle(.secondary)
                            }
                        }
                        .frame(minHeight: 44)
                    }
                }
            } header: { Text("How to") }
            Section("Words to know") {
                ForEach(HelpGuide.glossary, id: \.0) { word, meaning in
                    VStack(alignment: .leading, spacing: 2) {
                        Text(word).font(.headline)
                        Text(meaning).font(.subheadline).foregroundStyle(.secondary)
                    }
                }
            }
            Section {
                Button { app.sheet = .report(ref: nil, error: nil, page: "Help") } label: {
                    Label("Report an issue", systemImage: "exclamationmark.bubble").frame(minHeight: 44)
                }
                NavigationLink(value: Route.issues) { Label("Reported issues", systemImage: "list.bullet").frame(minHeight: 44) }
            } header: {
                Text("Get in touch")
            } footer: {
                Text("Reports go on the shared Issues list, so every partner can see them and they can be fixed.")
            }
        }
        .navigationTitle("Help")
    }
}

private struct GuideIcon: View {
    let guide: HelpGuide
    var body: some View {
        Image(systemName: guide.icon).font(.body.weight(.semibold)).foregroundStyle(.white)
            .frame(width: 32, height: 32).background(guide.tint, in: RoundedRectangle(cornerRadius: 8))
            .accessibilityHidden(true)
    }
}

struct HelpGuideView: View {
    let guide: HelpGuide
    var body: some View {
        let next = HelpGuide.all.firstIndex(of: guide).flatMap { $0 + 1 < HelpGuide.all.count ? HelpGuide.all[$0 + 1] : nil }
        List {
            Section {
                HStack(spacing: 12) { GuideIcon(guide: guide); Text(guide.title).font(.title2.bold()) }
                Text(guide.intro)
            }
            Section("Steps") {
                ForEach(Array(guide.steps.enumerated()), id: \.offset) { i, step in
                    HStack(alignment: .firstTextBaseline, spacing: 12) {
                        Text("\(i + 1)").font(.headline.monospacedDigit()).foregroundStyle(.white)
                            .frame(width: 26, height: 26).background(guide.tint, in: Circle())
                        Text(step)
                    }
                    .padding(.vertical, 2)
                }
            }
            if let tip = guide.tip {
                Section { Label(tip, systemImage: "lightbulb").font(.subheadline) } header: { Text("Tip") }
            }
            if let r = guide.route, let t = guide.routeTitle {
                Section { NavigationLink(value: r) { Text(t).bold() } }
            }
            if let next {
                Section("Next guide") { NavigationLink { HelpGuideView(guide: next) } label: { Label(next.title, systemImage: next.icon) } }
            }
        }
        .navigationTitle(guide.title)
        .navigationBarTitleDisplayMode(.inline)
    }
}
