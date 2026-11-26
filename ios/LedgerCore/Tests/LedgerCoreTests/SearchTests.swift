import XCTest
@testable import LedgerCore

/// Mirrors web/src/core/search.test.ts.
final class SearchTests: XCTestCase {
    func testReadsAmountsInTheFormsPeopleType() {
        let t = SearchTerm.parse("412.5 $1,250 412 tile")
        XCTAssertEqual(t[0].cents, 41_250)
        XCTAssertEqual(t[1].cents, 125_000)
        XCTAssertEqual(t[2].cents, 41_200); XCTAssertTrue(t[2].wholeDollars)
        XCTAssertNil(t[3].cents)
        XCTAssertTrue(t[0].matches(amount: 41_250))
        XCTAssertTrue(t[0].matches(amount: -41_250))
        XCTAssertTrue(t[2].matches(amount: 41_299))
        XCTAssertFalse(t[2].matches(amount: 41_300))
    }

    func testFindsByNotesReferenceAndAmountWithEveryWordRequired() {
        var s = DemoData.snapshot(today: "2026-11-20")
        s.expenses[0].notes = "Rent deducted for renovation work"
        s.expenses[0].reference = "CHK-9917"
        let e = s.expenses[0]
        let l = Ledger(s, today: "2026-11-20")
        func find(_ text: String) -> [UUID] { var f = Ledger.Filter(); f.text = text; return l.search(f).map(\.id) }
        XCTAssertTrue(find("renovation").contains(e.id))
        XCTAssertTrue(find("chk-9917").contains(e.id))
        XCTAssertTrue(find("rent \(String(format: "%.2f", Double(e.totalCents) / 100))").contains(e.id))
        XCTAssertFalse(find("renovation zzznotthere").contains(e.id))
    }
}
