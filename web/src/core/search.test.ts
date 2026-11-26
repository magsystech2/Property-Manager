import { describe, it, expect } from 'vitest'
import { Ledger, amountMatches, emptyFilter, searchTerms } from './ledger'
import { demoSnapshot } from './demoData'

describe('search', () => {
  it('reads amounts in the forms people type', () => {
    const [a, b, c, d] = searchTerms('412.5 $1,250 412 tile')
    expect(a.cents).toBe(41250)
    expect(b.cents).toBe(125000)
    expect(c).toMatchObject({ cents: 41200, wholeDollars: true })
    expect(d.cents).toBeNull()
    expect(amountMatches(41250, a)).toBe(true)
    expect(amountMatches(-41250, a)).toBe(true)
    expect(amountMatches(41299, c)).toBe(true)
    expect(amountMatches(41300, c)).toBe(false)
  })

  it('finds records by notes, reference and amount, with every word required', () => {
    const s = demoSnapshot()
    const e = s.expenses[0]
    e.notes = 'Rent deducted for renovation work'
    e.reference = 'CHK-9917'
    const l = new Ledger(s)
    const find = (text: string) => l.search({ ...emptyFilter(), text }).map((x) => x.ref.id)
    expect(find('renovation')).toContain(e.id)
    expect(find('chk-9917')).toContain(e.id)
    expect(find(`rent ${(e.total_cents / 100).toFixed(2)}`)).toContain(e.id)
    expect(find('renovation zzznotthere')).not.toContain(e.id)
  })
})
