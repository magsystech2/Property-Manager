// LIVE MODE: shared data in your Supabase project, same tables and rules as the iPhone app.
// Access is enforced by the database (row-level security + triggers), so the app can't bypass it.
import { createClient, type SupabaseClient, type RealtimeChannel } from '@supabase/supabase-js'
import { Rules } from '../core/rules'
import { emptySnapshot, kindTable, type Snapshot, type Workspace, type EntryRef, type Attachment, type Expense, type Bill } from '../core/models'
import type { Backend, NewRecord, StatusChange, AllocationInput } from './types'
import { BackendError } from './types'

const pick = <T extends object>(o: T, keys: (keyof T)[]) => Object.fromEntries(keys.filter((k) => o[k] !== undefined).map((k) => [k, o[k]]))

export class SupabaseBackend implements Backend {
  readonly isDemo = false
  readonly client: SupabaseClient
  private uid: string | null = null
  private email: string | null = null
  private channels: RealtimeChannel[] = []

  constructor(url: string, anonKey: string) {
    this.client = createClient(url, anonKey, { auth: { persistSession: true, autoRefreshToken: true, storageKey: 'ledger.auth' } })
  }

  userId() { return this.uid }
  userEmail() { return this.email }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async wrap(body: () => PromiseLike<{ data: any; error: any }>): Promise<any> {
    let res: { data: any; error: any }
    try {
      res = await body()
    } catch (e) {
      throw mapError(e)
    }
    if (res.error) throw mapError(res.error)
    return res.data
  }

  // Auth
  async restoreSession() {
    const { data } = await this.client.auth.getSession()
    this.uid = data.session?.user.id ?? null
    this.email = data.session?.user.email ?? null
    return !!data.session
  }
  async signIn(email: string, password: string) {
    const data = await this.wrap(() => this.client.auth.signInWithPassword({ email, password }))
    this.uid = data.user?.id ?? null
    this.email = data.user?.email ?? null
  }
  async signUp(email: string, password: string) {
    const data = await this.wrap(() => this.client.auth.signUp({ email, password }))
    if (!data.session) {
      throw new BackendError('Account created. Check your email to confirm it, then sign in. (Or turn off "Confirm email" in Supabase for your team.)')
    }
    this.uid = data.user?.id ?? null
    this.email = data.user?.email ?? null
  }
  async signOut() {
    for (const c of this.channels) await this.client.removeChannel(c)
    this.channels = []
    await this.client.auth.signOut()
    this.uid = null
    this.email = null
  }

  // Workspace
  async myWorkspaces() {
    return this.wrap(() => this.client.from('workspaces').select('id,name,require_review')) as Promise<Workspace[]>
  }
  async acceptInvites(displayName: string) {
    const ids = await this.wrap(() => this.client.rpc('accept_invites', { p_display_name: displayName }))
    return Array.isArray(ids) ? ids.length : 0
  }
  async createWorkspace(name: string, displayName: string) {
    return this.wrap(() => this.client.rpc('create_workspace', { p_name: name, p_display_name: displayName })) as Promise<string>
  }

  async load(ws: string): Promise<Snapshot> {
    const rows = async (table: string, columns = '*') => {
      const data = await this.wrap(() => this.client.from(table).select(columns).eq('workspace_id', ws).limit(10000))
      return (data ?? []) as any[]
    }
    const wsRows = await this.wrap(() => this.client.from('workspaces').select('id,name,require_review').eq('id', ws))
    const workspace = (wsRows as Workspace[])[0]
    if (!workspace) throw new BackendError("You don't have access to this workspace.")
    const s = emptySnapshot(workspace)
    const [members, categories, projects, budgets, vendors, commitments, changeOrders, bills, expenses, allocations, payments,
      reimbursements, items, contributions, proceeds, attachments] = await Promise.all([
      rows('workspace_members'), rows('budget_categories'), rows('projects'), rows('project_budgets'), rows('vendors'),
      rows('commitments'), rows('change_orders'), rows('bills'), rows('expenses'), rows('allocations'), rows('bill_payments'),
      rows('reimbursements'), rows('reimbursement_items'), rows('contributions'), rows('sale_proceeds'), rows('attachments'),
    ])
    const invites = await rows('invites').catch(() => [])
    const audit = await this.wrap(() => this.client.from('audit_log').select('id,workspace_id,table_name,record_id,action,actor,at,reason')
      .eq('workspace_id', ws).order('id', { ascending: false }).limit(1000))
    Object.assign(s, {
      members, categories, projects, budgets, vendors, commitments, change_orders: changeOrders, bills, expenses, allocations,
      payments, reimbursements, reimbursement_items: items, contributions, proceeds, attachments, invites, audit,
    })
    return s
  }

  // Posting
  async postExpense(e: Expense, allocations: AllocationInput[]) {
    Rules.checkExpense(e, allocations)
    const record = pick(e, ['id', 'workspace_id', 'project_id', 'vendor_id', 'expense_date', 'description', 'total_cents', 'tax_cents',
      'is_refund', 'paid_by_user_id', 'payment_method', 'reference', 'client_id'])
    await this.wrap(() => this.client.rpc('post_with_allocations', { p_table: 'expenses', p_record: record, p_allocations: allocations }))
  }
  async postBill(b: Bill, allocations: AllocationInput[]) {
    const record = pick(b, ['id', 'workspace_id', 'project_id', 'vendor_id', 'commitment_id', 'invoice_number', 'bill_date', 'due_date',
      'description', 'total_cents', 'tax_cents', 'client_id'])
    await this.wrap(() => this.client.rpc('post_with_allocations', { p_table: 'bills', p_record: record, p_allocations: allocations }))
  }

  /** Insert that is safe to repeat: a second submission with the same client_id is ignored. */
  private insertOnce(table: string, row: object) {
    const clean = Object.fromEntries(Object.entries(row).filter(([k, v]) =>
      v !== undefined && !['status', 'created_by', 'created_at', 'voided_by', 'voided_at', 'void_reason', 'approved_by', 'approved_at'].includes(k)))
    return this.wrap(() => this.client.from(table).upsert(clean, { onConflict: 'client_id', ignoreDuplicates: true }))
  }

  async insert(rec: NewRecord) {
    switch (rec.type) {
      case 'payment': await this.insertOnce('bill_payments', rec.row); break
      case 'reimbursement': {
        // Status is meaningful for reimbursements (requested vs paid); the server overrides it when review is on.
        const { created_by: _a, created_at: _b, approved_by: _c, approved_at: _d, voided_by: _e, voided_at: _f, void_reason: _g, ...row } = rec.row
        await this.wrap(() => this.client.from('reimbursements').upsert(row, { onConflict: 'client_id', ignoreDuplicates: true }))
        if (rec.items.length) await this.wrap(() => this.client.from('reimbursement_items').upsert(rec.items, { onConflict: 'id', ignoreDuplicates: true }))
        break
      }
      case 'contribution': await this.insertOnce('contributions', rec.row); break
      case 'proceeds': await this.insertOnce('sale_proceeds', rec.row); break
      case 'commitment': await this.insertOnce('commitments', rec.row); break
      case 'changeOrder': await this.insertOnce('change_orders', rec.row); break
    }
  }

  async change(ref: EntryRef, c: StatusChange) {
    const table = kindTable[ref.kind]
    const update = c.type === 'void' ? { status: 'void', void_reason: c.reason }
      : c.type === 'approve' ? { status: ref.kind === 'reimbursement' ? 'approved' : 'posted' }
        : { status: 'paid', paid_date: c.date, payment_method: c.method, reference: c.reference }
    const rows = await this.wrap(() => this.client.from(table).update(update).eq('id', ref.id).select('id'))
    if (!rows || (rows as unknown[]).length === 0) throw new BackendError("You don't have permission to change this record.")
  }

  // Reference data
  async saveProject(p: Parameters<Backend['saveProject']>[0]) {
    const row = pick(p, ['id', 'workspace_id', 'nickname', 'address', 'project_type', 'status', 'start_date', 'target_complete_date', 'target_sale_date', 'notes'])
    await this.wrap(() => this.client.from('projects').upsert(row, { onConflict: 'id' }))
  }
  async saveVendor(v: Parameters<Backend['saveVendor']>[0]) {
    const row = pick(v, ['id', 'workspace_id', 'name', 'kind', 'contact_name', 'phone', 'email', 'address', 'notes'])
    await this.wrap(() => this.client.from('vendors').upsert(row, { onConflict: 'id' }))
  }
  async saveBudget(b: Parameters<Backend['saveBudget']>[0]) {
    const row = pick(b, ['workspace_id', 'project_id', 'category_id', 'amount_cents'])
    await this.wrap(() => this.client.from('project_budgets').upsert(row, { onConflict: 'project_id,category_id' }))
  }
  async saveCategory(c: Parameters<Backend['saveCategory']>[0]) {
    await this.wrap(() => this.client.from('budget_categories').upsert(c, { onConflict: 'id' }))
  }
  async saveWorkspace(w: Workspace) {
    const rows = await this.wrap(() => this.client.from('workspaces').update({ name: w.name, require_review: w.require_review }).eq('id', w.id).select('id'))
    if (!rows || (rows as unknown[]).length === 0) throw new BackendError('Only an owner can change workspace settings.')
  }
  async saveMember(m: Parameters<Backend['saveMember']>[0]) {
    await this.wrap(() => this.client.from('workspace_members').update({ display_name: m.display_name, role: m.role })
      .eq('workspace_id', m.workspace_id).eq('user_id', m.user_id))
  }
  async setAccess(m: Parameters<Backend['setAccess']>[0], revoked: boolean) {
    // The database allows this only for an owner, and never for an owner or yourself; RLS turns a refusal into no rows.
    const rows = await this.wrap(() => this.client.from('workspace_members').update({ access_revoked_at: revoked ? new Date().toISOString() : null })
      .eq('workspace_id', m.workspace_id).eq('user_id', m.user_id).select('user_id'))
    if (!rows || (rows as unknown[]).length === 0) throw new BackendError('Only an owner can change who has access.')
  }
  async invite(email: string, role: string, workspace: string) {
    await this.wrap(() => this.client.from('invites').insert({ workspace_id: workspace, email: email.trim().toLowerCase(), role }))
  }
  async cancelInvite(i: Parameters<Backend['cancelInvite']>[0]) {
    await this.wrap(() => this.client.from('invites').delete().eq('id', i.id))
  }

  // Files
  async upload(file: Blob, path: string, mimeType: string) {
    const { error } = await this.client.storage.from('attachments').upload(path, file, { contentType: mimeType, upsert: false })
    if (error) {
      const msg = String((error as { message?: string }).message ?? error)
      if (/exists|duplicate|409/i.test(msg)) return // already uploaded by an earlier attempt
      throw mapError(error)
    }
  }
  async addAttachment(a: Attachment) {
    const { uploaded_by: _u, created_at: _c, ...row } = a
    await this.wrap(() => this.client.from('attachments').upsert(row, { onConflict: 'client_id', ignoreDuplicates: true }))
  }
  async fileURL(path: string) {
    const data = await this.wrap(() => this.client.storage.from('attachments').createSignedUrl(path, 3600))
    return data!.signedUrl
  }

  // Live updates: one channel per workspace; RLS limits events to rows this user can see.
  subscribe(ws: string, onChange: () => void) {
    const channel = this.client.channel(`ledger-${ws}-${Math.random().toString(36).slice(2)}`)
      .on('postgres_changes', { event: '*', schema: 'public' }, () => onChange())
      .subscribe()
    this.channels.push(channel)
    return () => {
      this.client.removeChannel(channel)
      this.channels = this.channels.filter((c) => c !== channel)
    }
  }
}

function mapError(e: unknown): Error {
  if (e instanceof Error && e.name === 'LedgerError') return e
  if (e instanceof BackendError) return e
  const msg = String((e as { message?: string })?.message ?? e)
  if (/Failed to fetch|NetworkError|Load failed/i.test(msg)) return new BackendError('No connection to the server. Check your internet and try again.', true)
  if (msg.includes('bills_invoice_uq')) return new BackendError('That invoice number from this vendor is already entered.')
  if (msg.includes('vendors_name_uq')) return new BackendError('A vendor with that name already exists.')
  if (/Change an owner to partner|Only an owner can change who has access|Restore access before/.test(msg)) return new BackendError(msg.replace(/^.*?(Change an owner|Only an owner|Restore access)/, '$1'))
  if (msg.includes('row-level security')) return new BackendError("You don't have access to do that in this workspace.")
  return new BackendError(msg)
}
