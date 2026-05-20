// swift-tools-version: 5.9
// The swift-tools-version declares the minimum version of Swift required to build this package.

import PackageDescription

let package = Package(
    name: "AuthMe",
    platforms: [
        .iOS(.v15),
        .macOS(.v12),
    ],
    products: [
        .library(
            name: "AuthMe",
            targets: ["AuthMe"]
        ),
    ],
    dependencies: [],
    targets: [
        .target(
            name: "AuthMe",
            dependencies: [],
            path: "Sources/AuthMe",
            swiftSettings: [
                .enableExperimentalFeature("StrictConcurrency"),
            ]
        ),
        .testTarget(
            name: "AuthMeTests",
            dependencies: ["AuthMe"],
            path: "Tests/AuthMeTests"
        ),
    ]
)
