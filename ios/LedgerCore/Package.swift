// swift-tools-version:5.9
import PackageDescription

// Pure-Swift ledger logic shared by the app (live and demo mode) and the CSV export.
let package = Package(
    name: "LedgerCore",
    platforms: [.iOS(.v17), .macOS(.v14)],
    products: [.library(name: "LedgerCore", targets: ["LedgerCore"])],
    targets: [
        .target(name: "LedgerCore"),
        .testTarget(name: "LedgerCoreTests", dependencies: ["LedgerCore"]),
    ]
)
