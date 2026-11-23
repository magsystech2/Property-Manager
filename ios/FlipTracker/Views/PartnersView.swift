import SwiftUI

struct PartnersView: View {
    @Environment(DataStore.self) private var store

    var body: some View {
        NavigationStack {
            let balances = store.partnerBalances()
            let totalPersonal = balances.reduce(0) { $0 + $1.paid }
            List {
                Section {
                    ForEach(balances) { b in
                        VStack(alignment: .leading, spacing: 6) {
                            HStack {
                                Text(b.member.name).font(.headline)
                                Spacer()
                                Text(b.paid.money0).font(.headline.monospacedDigit())
                            }
                            ProgressView(value: totalPersonal > 0 ? b.paid / totalPersonal : 0)
                            Text(balanceText(b)).font(.caption)
                                .foregroundStyle(abs(b.difference) < 1 ? Color.secondary : b.difference > 0 ? .green : .orange)
                        }
                        .padding(.vertical, 4)
                    }
                } header: {
                    Text("Paid from their own money")
                } footer: {
                    Text("Counts paid expenses only. Equal share = \(store.members.isEmpty ? "-" : (totalPersonal / Double(store.members.count)).money0) each.")
                }
                Section {
                    LabeledContent("Paid by partners", value: totalPersonal.money0)
                    LabeledContent("Paid from LLC account", value: store.llcPaidTotal.money0)
                    LabeledContent("Unpaid bills", value: store.unpaidTotal().money0)
                    LabeledContent("All spending", value: store.expenses.reduce(0) { $0 + $1.amount }.money0).bold()
                }
                Section("This month by partner") {
                    let start = Calendar.current.dateInterval(of: .month, for: .now)?.start ?? .now
                    ForEach(store.members) { m in
                        let amt = store.expenses.filter { $0.createdByUid == m.id && $0.date >= start }.reduce(0) { $0 + $1.amount }
                        LabeledContent(m.name, value: amt.money0)
                    }
                }
            }
            .navigationTitle("Partners")
        }
    }

    private func balanceText(_ b: DataStore.PartnerBalance) -> String {
        if abs(b.difference) < 1 { return "Even with an equal share" }
        return b.difference > 0
            ? "\(b.difference.money0) more than an equal share (owed back)"
            : "\((-b.difference).money0) less than an equal share"
    }
}
