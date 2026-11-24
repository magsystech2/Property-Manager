import { describe, expect, it } from 'vitest'
import { Ledger } from './ledger'
import { demoSnapshot } from './demoData'
import { parseCSV, parseDay, readImport, templateCSV } from './bulkImport'
import { Days } from './money'

const today = Days.today
const l = new Ledger(demoSnapshot(today), today)
const me = l.s.members[0].user_id

describe('bulk upload', () => {
  it('reads quoted CSV with commas, quotes and line breaks', () => {
    const t = parseCSV('﻿a,b,c\r\n"x, y","he said ""hi""","line1\nline2"\r\n\r\n1,2,3')
    expect(t).toEqual([['a', 'b', 'c'], ['x, y', 'he said "hi"', 'line1\nline2'], ['1', '2', '3']])
    expect(parseCSV('a;b\n1;2')).toEqual([['a', 'b'], ['1', '2']])
    expect(parseCSV('a\tb\n1\t2')).toEqual([['a', 'b'], ['1', '2']])
  })

  it('reads US and ISO dates and rejects impossible ones', () => {
    expect(parseDay('2026-11-20')).toBe('2026-11-20')
    expect(parseDay('11/20/2026')).toBe('2026-11-20')
    expect(parseDay('1/5/26')).toBe('2026-01-05')
    expect(parseDay('2/30/2026')).toBeNull()
    expect(parseDay('soon')).toBeNull()
  })

  it('the downloaded template imports cleanly as is', () => {
    const { rows, missingColumns } = readImport(parseCSV(templateCSV(l)), l, me)
    expect(missingColumns).toEqual([])
    expect(rows).toHaveLength(2)
    expect(rows.every((r) => r.errors.length === 0 && r.draft)).toBe(true)
    expect(rows[0].draft!.kind).toBe('receipt')
    expect(rows[0].draft!.payer).toBe('me')
    expect(rows[1].draft!.kind).toBe('bill')
    expect(rows[1].draft!.invoice_number).toBe('ABC-1010')
    expect(rows[1].draft!.due_date).not.toBeNull()
  })

  it('maps names, flags problems per row, and spots duplicates', () => {
    const p = l.s.projects[0].nickname
    const partnerB = l.s.members[1]
    const csv = [
      'Type,Date,Property,Vendor,Category,Total,Tax,Description,Paid By,Method,Reference,Invoice #,Due Date',
      `receipt,11/20/2026,${p},Brand New Supply,Materials,"$1,234.50",10,Tile,${partnerB.display_name},Zelle,,,`,
      `receipt,2026-11-20,Nowhere,Home Depot,Materials,50,,,,,,,`,
      `bill,2026-11-20,${p},ABC Plumbing,Plumbing,-5,,,,,,X1,`,
      `receipt,2026-11-21,${p},Lowes,Materials,25,,,LLC,card,,,`,
      `receipt,2026-11-21,${p},Lowes,Materials,25,,,LLC,card,,,`,
      `receipt,someday,${p},Lowes,Nope,abc,,,Stranger,bitcoin,,,`,
    ].join('\n')
    const { rows } = readImport(parseCSV(csv), l, me)
    const [ok, badProject, badBill, first, dup, bad] = rows
    expect(ok.errors).toEqual([])
    expect(ok.draft!.total_text).toBe('1234.50')
    expect(ok.draft!.payer).toBe(partnerB.user_id)
    expect(ok.draft!.payment_method).toBe('zelle')
    expect(ok.draft!.new_vendor_name).toBe('Brand New Supply')
    expect(ok.warnings.join(' ')).toContain('New vendor')
    expect(ok.line).toBe(2)
    expect(badProject.errors.join(' ')).toContain('No project named')
    expect(badBill.errors.join(' ')).toContain('must be positive')
    expect(first.duplicate).toBe(false)
    expect(first.draft!.payer).toBe('llc')
    expect(dup.duplicate).toBe(true)
    expect(dup.warnings.join(' ')).toContain('row 5')
    expect(bad.errors.length).toBe(5) // date, category, amount, partner, method
    expect(bad.draft).toBeNull()
  })

  it('reports missing required columns', () => {
    expect(readImport(parseCSV('date,amount\n2026-11-20,5'), l, me).missingColumns).toEqual(['project', 'vendor'])
  })
})
