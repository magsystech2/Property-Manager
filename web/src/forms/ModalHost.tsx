import { DistributionForm, MaterialForm, SaleForm, SharesForm, TemplateForm } from './SaleForms'
import { SplitLineForm, DrawForm } from './PlanningForms'
import { useStore } from '../store'
import { TransactionForm } from './TransactionForm'
import { ReportForm, ReviewFlagForm } from './ReportForm'
import { LoanForm } from './LoanForm'
import {
  AttachForm, BudgetEditor, ChangeOrderForm, CommitmentForm, ContributionForm, MarkPaidForm, PaymentForm,
  ProjectForm, ReimbursementForm, VendorForm, VoiceForm, VoidForm,
} from './OtherForms'

/** Shows whichever form is open. Any screen opens one with app.open({...}). */
export function ModalHost() {
  const app = useStore()
  const m = app.modal
  if (!m) return null
  const close = () => app.open(null)
  switch (m.type) {
    case 'transaction': return <TransactionForm key={m.draft.id} initial={m.draft} initialFiles={m.files} link={m.link} onClose={close} />
    case 'voice': return <VoiceForm onClose={close} />
    case 'payment': return <PaymentForm billId={m.billId} onClose={close} />
    case 'contribution': return <ContributionForm projectId={m.projectId} partnerId={m.partnerId} onClose={close} />
    case 'reimbursement': return <ReimbursementForm partnerId={m.partnerId} onClose={close} />
    case 'commitment': return <CommitmentForm projectId={m.projectId} onClose={close} />
    case 'changeOrder': return <ChangeOrderForm commitmentId={m.commitmentId} onClose={close} />
    case 'proceeds': return <SaleForm projectId={m.projectId} onClose={close} />
    case 'distribution': return <DistributionForm projectId={m.projectId} partnerId={m.partnerId} amountCents={m.amountCents} onClose={close} />
    case 'shares': return <SharesForm projectId={m.projectId} onClose={close} />
    case 'material': return <MaterialForm projectId={m.projectId} material={m.material} onClose={close} />
    case 'template': return <TemplateForm template={m.template} from={m.from} onClose={close} />
    case 'project': return <ProjectForm project={m.project} onClose={close} />
    case 'budget': return <BudgetEditor projectId={m.projectId} onClose={close} />
    case 'vendor': return <VendorForm vendor={m.vendor} onClose={close} />
    case 'void': return <VoidForm refx={m.ref} onClose={close} />
    case 'markPaid': return <MarkPaidForm refx={m.ref} onClose={close} />
    case 'splitLine': return <SplitLineForm line={m.line} onClose={close} />
    case 'draw': return <DrawForm commitmentId={m.commitmentId} onClose={close} />
    case 'attach': return <AttachForm target={m.target} onClose={close} />
    case 'loan': return <LoanForm loan={m.loan} projectId={m.projectId} onClose={close} />
    case 'report': return m.review && m.ref ? <ReviewFlagForm refx={m.ref} onClose={close} /> : <ReportForm refx={m.ref} error={m.error} onClose={close} />
  }
}
