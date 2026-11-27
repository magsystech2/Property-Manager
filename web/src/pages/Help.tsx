import { Link, useNavigate, useParams } from 'react-router-dom'
import { useStore } from '../store'
import { Icon, PageHead, Section } from '../ui/common'
import { TutorialPlayer } from '../ui/Tutorials'

/** A short how-to: what it's for, its steps, a tip, and a button to the page it's about. */
type Guide = {
  id: string
  title: string
  subtitle: string
  icon: string
  tint: string
  intro: string
  steps: string[]
  tip?: string
  to?: string
  toTitle?: string
}

export const guides: Guide[] = [
  {
    id: 'basics', title: 'Getting around', subtitle: 'What each part of the app is for', icon: 'home', tint: '#0f9488',
    intro: 'Project Ledger keeps the books for our properties in one place: what each project costs, who paid what, which bills are due, and where every receipt is. Everyone sees the same numbers.',
    steps: [
      'Overview is your home page. It shows what you have put in, what the LLC owes you, what needs your attention, and bills due soon.',
      'Projects lists each property. Open one to see its budget, spending, sale and files.',
      'Partners shows who paid what, each partner’s share, and money partners borrowed.',
      'Activity is every receipt, bill and payment, newest first, with search and filters.',
      'The Add button (the + in the middle of the bottom bar on a phone) is how you enter anything new.',
      'On a phone, More holds the bookkeeping pages: weekly review, inbox, statements, cash plan, reports and this Help page.',
    ],
    tip: 'Every number in the app comes from recorded receipts, bills and payments. Click a number to see the records behind it.',
    to: '/', toTitle: 'Go to Overview',
  },
  {
    id: 'projects', title: 'Projects', subtitle: 'Budget, spending and files for each property', icon: 'folder', tint: '#4f46e5',
    intro: 'Each property is a project. Its page has tabs along the top for the different views.',
    steps: [
      'Overview: what has been spent, what is still owed on bills, and who paid what on this project.',
      'Budget: the approved budget by category (plumbing, roofing and so on), and how much of each is used. Click a category’s budget amount to change it.',
      'Forecast: the expected sale price (ARV), target sale date, and projected profit.',
      'Sale and split: the sale, the cash it brought in, and what each partner gets. See the guide “Sale and profit split”.',
      'Materials, Activity, Vendors and Files: leftover materials, every record for this project, who we paid, and the documents attached.',
    ],
    tip: 'When you press Add while a project is open, the new entry starts on that project. You can still change it in the form.',
    to: '/projects', toTitle: 'Go to Projects',
  },
  {
    id: 'add', title: 'Add expenses and bills', subtitle: 'Receipts already paid, bills still owed', icon: 'receipt', tint: '#ea580c',
    intro: 'An expense is something already paid, with a receipt. A bill is an invoice the LLC still owes. Both belong to a project and a category.',
    steps: [
      'Press Add. Choose Scan receipt to take a photo, Add expense to type it in, Say it to describe it in a sentence, or Add bill for an invoice.',
      'Fill in the amount, vendor, project and category. Attach the receipt or invoice if you have it.',
      'Under Who paid, pick LLC account if it came out of the LLC’s bank account, or Me (or another partner) if it was paid from personal money. Personal payments are added to what the LLC owes that partner.',
      'If the app warns “Possible duplicate”, check it: it means the same vendor and invoice number, or the same amount within 3 days, is already there.',
      'When a bill is paid, open it and press Record payment. A bill can be paid in parts.',
    ],
    tip: 'Have a pile of receipts in a spreadsheet? Use Bulk upload under More tools to add them all at once.',
  },
  {
    id: 'settle', title: 'Who paid what', subtitle: 'Each partner’s money in, share and balance', icon: 'users', tint: '#2563eb',
    intro: 'The “Who paid what” table on the Partners page (and on each project) shows how much money each partner has put in and how that compares with their share.',
    steps: [
      'Into LLC account: money a partner deposited into the LLC (a contribution).',
      'Paid personally: project costs a partner paid with their own card or cash.',
      'Paid back to them: what the LLC has already reimbursed that partner.',
      'Total put in = into the LLC account + paid personally − paid back.',
      'Share of costs is the partner’s split (equal thirds unless we set otherwise) of the total spent. Over / under compares what they put in with that share: a plus means they have covered more than their share, a minus means less.',
      'LLC owes (on each partner’s page) is what the LLC still has to pay back for costs that partner paid personally. Use Reimburse a partner under Add when it is paid back.',
    ],
    tip: 'Pick a project from the menu at the top right of the table to see the numbers for just that property.',
    to: '/partners', toTitle: 'Go to Partners',
  },
  {
    id: 'borrowed', title: 'Borrowed money', subtitle: 'Personal loans partners took', icon: 'bank', tint: '#7c3aed',
    intro: 'When a partner borrows money personally (from family, friends or a bank) to fund their part, record it under Borrowed money on the Partners page or the project page.',
    steps: [
      'Press + Add loan. Enter the partner, the lender, the project it was used for, the date borrowed, the amount and the yearly interest rate.',
      'The table shows interest built up so far, interest paid, principal paid back, what is owed now, and the interest per month.',
      'Click the partner’s name to record an interest or principal payment.',
      'Click a lender, project, date, amount or rate to change it right in the table.',
    ],
    tip: 'Loans are for reference only. The money is already counted as that partner’s contribution or personal payment, and interest on a personal loan is that partner’s own cost. Loans never change anyone’s balance or payout.',
    to: '/partners', toTitle: 'Go to Partners',
  },
  {
    id: 'fix', title: 'Fix a mistake', subtitle: 'Click a value to change it', icon: 'sign', tint: '#db2777',
    intro: 'Many values can be changed by clicking them. When you hover over one, it says “Click to edit”.',
    steps: [
      'Budgets and borrowed-money rows: click the value, type the new one, and press Enter. Press Esc to cancel.',
      'Receipts and bills: open the record and click the amount, date, vendor, project or category. The original is voided with a note saying what changed, and a corrected copy is posted with the same documents. Nothing is ever silently overwritten.',
      'Notes on a record can be edited at any time.',
      'To remove a record entirely, open it and press Void…, then give a reason. Voided records stay in the list, marked Void with the reason, so the history is never lost.',
    ],
    tip: 'Not sure something is right? Don’t change it: flag it with Needs review so the others can check.',
    to: '/activity', toTitle: 'Go to Activity',
  },
  {
    id: 'review', title: 'Needs review flags', subtitle: 'Mark entries to double-check', icon: 'alert', tint: '#d97706',
    intro: 'A Needs review flag puts a record on a shared list, with a note on what to check. Entries we weren’t sure about when moving over the old spreadsheets were flagged this way too.',
    steps: [
      'Open the receipt or bill and press Needs review. Write what looks wrong, for example “Is this Chamberlayne or Willway?”.',
      'Everyone sees the count next to Needs review in the menu, and on the Overview under Needs attention.',
      'On the Needs review page, open each record, fix it if needed (see “Fix a mistake”), then press Mark reviewed and say what you found.',
      'Changed your mind? Reviewed flags can be reopened.',
    ],
    to: '/needs-review', toTitle: 'Go to Needs review',
  },
  {
    id: 'sale', title: 'Sale and profit split', subtitle: 'Who gets what when a property sells', icon: 'chart', tint: '#16a34a',
    intro: 'The Sale and split tab on each project works out what each partner gets back from a sale.',
    steps: [
      'Press Record the sale. Enter the sale price, selling costs and any loan paid off at closing.',
      'Cash from the sale shows what the LLC can pay out now: net proceeds, minus the loan payoff, bills still to pay, and what has already been paid out.',
      'Who gets what: each partner first gets back the capital they put in. Then the profit, or the loss, is shared by the split.',
      'If no split is set, the profit or loss is divided exactly in equal thirds, shown as “equal share”. Any leftover cent goes to one partner, so the total always adds up.',
      'To use a different split for one project, press Change split. The LLC default split is on the Partners page.',
      'When money is actually paid out to a partner, press + Record one under Distributions.',
    ],
    tip: 'Before a sale, the same tab shows the estimated profit, using the expected sale price from the Forecast tab.',
    to: '/projects', toTitle: 'Go to Projects',
  },
  {
    id: 'search', title: 'Search', subtitle: 'Find any receipt, bill or payment', icon: 'search', tint: '#0891b2',
    intro: 'Search looks through every record: vendor, description, notes, reference or check number, and amount.',
    steps: [
      'Type in the Search records box at the top of any page (on a phone, tap the magnifying glass) and press Enter.',
      'Type an amount the way you would write it: 412.50, $1,250 or 412. A whole number like 412 finds anything from $412.00 to $412.99.',
      'Use several words to narrow it down. Every word must match, for example “tile 412”.',
      'On the results page, filter by project, vendor, partner, category, status or date.',
    ],
    tip: 'Projects and vendors whose name matches show at the top of the results, so you can jump straight to them.',
    to: '/activity', toTitle: 'Go to Activity',
  },
  {
    id: 'books', title: 'Weekly bookkeeping', subtitle: 'Approve, match and file each week', icon: 'check', tint: '#475569',
    intro: 'A few minutes a week keeps the books complete. The Finance pages help with that.',
    steps: [
      'Weekly review: bills due in the next 7 days, bills waiting for approval, and charges with no receipt. Press “I’ll take it” to claim a missing receipt.',
      'Receipt inbox: drop receipts or invoices here when you are busy, and file them into proper records later.',
      'Statements: upload a card or bank statement (CSV) and match each charge to a receipt. Charges with no match show up as missing receipts.',
      'Cash plan: what the LLC account must cover in the next 30 days, and whether it will run short.',
      'Reports and Export CSV: totals by project, category and partner, and a file for the accountant.',
    ],
    to: '/review', toTitle: 'Go to Weekly review',
  },
]

const glossary: [string, string][] = [
  ['LLC account', 'The LLC’s own bank account. Money paid from it is not owed to anyone.'],
  ['Contribution', 'Money a partner put into the LLC account.'],
  ['Paid personally', 'A project cost a partner paid with their own money. The LLC owes it back.'],
  ['Reimbursement', 'The LLC paying a partner back for something they paid personally.'],
  ['Expense', 'Something already paid, usually with a receipt.'],
  ['Bill', 'An invoice the LLC still owes. It is unpaid until a payment is recorded.'],
  ['Commitment', 'A signed contract or agreed quote that hasn’t been billed yet.'],
  ['Capital back', 'At a sale, each partner first gets back what they put in, before profit is shared.'],
  ['Distribution', 'Money actually paid out to a partner from a sale.'],
  ['Void', 'A cancelled record. It stays in the list, marked Void, with the reason.'],
]

function GuideIcon({ g }: { g: Guide }) {
  return <span className="help-icon" style={{ background: g.tint }}><Icon name={g.icon} size={16} /></span>
}

export function HelpPage() {
  const app = useStore()
  return (
    <div className="stack">
      <PageHead title="Help" sub="Short animated guides to using Project Ledger. Open one to watch it." />
      <Section title="How to" footer="Each guide plays a short animation of its steps. Click a step to see it again, or press Pause to stop on it.">
        {guides.map((g) => (
          <Link key={g.id} className="item" to={`/help/${g.id}`}>
            <GuideIcon g={g} />
            <span className="grow"><div className="title">{g.title}</div><div className="subtitle">{g.subtitle}</div></span>
            <Icon name="chevron" size={14} />
          </Link>
        ))}
      </Section>
      <Section title="Words to know">
        {glossary.map(([word, meaning]) => (
          <div key={word} className="kv help-word"><span className="k bold" style={{ color: 'var(--text)' }}>{word}</span><span className="v">{meaning}</span></div>
        ))}
      </Section>
      <Section title="Get in touch" footer="Reports go on the shared Issues page, so every partner can see them and they can be fixed.">
        <button className="item" onClick={() => app.open({ type: 'report' })}>
          <span className="help-icon" style={{ background: '#dc2626' }}><Icon name="alert" size={16} /></span>
          <span className="grow"><div className="title">Report an issue</div><div className="subtitle">Something wrong with a record or the app</div></span>
          <Icon name="chevron" size={14} />
        </button>
        <Link className="item" to="/issues">
          <span className="help-icon" style={{ background: '#64748b' }}><Icon name="list" size={16} /></span>
          <span className="grow"><div className="title">Reported issues</div><div className="subtitle">What partners have reported, and what was fixed</div></span>
          <Icon name="chevron" size={14} />
        </Link>
      </Section>
    </div>
  )
}

export function GuidePage() {
  const { id } = useParams()
  const go = useNavigate()
  const g = guides.find((x) => x.id === id)
  if (!g) return <div className="stack"><PageHead title="Guide not found" back="/help" /></div>
  const i = guides.indexOf(g)
  const next = guides[i + 1]
  return (
    <div className="stack help-guide">
      <PageHead title={<span className="row" style={{ gap: 12 }}><GuideIcon g={g} />{g.title}</span>} back="/help" />
      <p className="help-intro">{g.intro}</p>
      <TutorialPlayer scene={g.id} steps={g.steps} tint={g.tint} />
      {g.tip && <div className="callout info help-tip"><strong>Tip:</strong> {g.tip}</div>}
      {g.to && <button className="btn primary help-go" onClick={() => go(g.to!)}>{g.toTitle}</button>}
      {next && (
        <Link className="card item help-next" to={`/help/${next.id}`}>
          <span className="small muted">Next guide</span>
          <GuideIcon g={next} />
          <span className="grow title">{next.title}</span>
          <Icon name="chevron" size={14} />
        </Link>
      )}
    </div>
  )
}
