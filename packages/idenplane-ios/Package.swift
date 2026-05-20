// swift-tools-version: 5.9
// The swift-tools-version declares the minimum version of Swift required to build this package.

import PackageDescription

let package = Package(
    name: "Idenplane",
    platforms: [
        .iOS(.v15),
        .macOS(.v12),
    ],
    products: [
        .library(
            name: "Idenplane",
            targets: ["Idenplane"]
        ),
    ],
    dependencies: [],
    targets: [
        .target(
            name: "Idenplane",
            dependencies: [],
            path: "Sources/Idenplane",
            swiftSettings: [
                .enableExperimentalFeature("StrictConcurrency"),
            ]
        ),
        .testTarget(
            name: "IdenplaneTests",
            dependencies: ["Idenplane"],
            path: "Tests/IdenplaneTests"
        ),
    ]
)
