// swift-tools-version: 5.9
import PackageDescription

// DO NOT MODIFY THIS FILE - managed by Capacitor CLI commands
let package = Package(
    name: "CapApp-SPM",
    platforms: [.iOS(.v15)],
    products: [
        .library(
            name: "CapApp-SPM",
            targets: ["CapApp-SPM"])
    ],
    dependencies: [
        .package(url: "https://github.com/ionic-team/capacitor-swift-pm.git", exact: "8.5.0"),
        .package(name: "CapacitorCommunitySqlite", path: "../../../node_modules/@capacitor-community/sqlite"),
        .package(name: "CapacitorBarcodeScanner", path: "../../../node_modules/@capacitor/barcode-scanner"),
        .package(name: "CapacitorClipboard", path: "../../../node_modules/@capacitor/clipboard"),
        .package(name: "CapacitorGeolocation", path: "../../../node_modules/@capacitor/geolocation"),
        .package(name: "CapacitorSplashScreen", path: "../../../node_modules/@capacitor/splash-screen")
    ],
    targets: [
        .target(
            name: "CapApp-SPM",
            dependencies: [
                .product(name: "Capacitor", package: "capacitor-swift-pm"),
                .product(name: "Cordova", package: "capacitor-swift-pm"),
                .product(name: "CapacitorCommunitySqlite", package: "CapacitorCommunitySqlite"),
                .product(name: "CapacitorBarcodeScanner", package: "CapacitorBarcodeScanner"),
                .product(name: "CapacitorClipboard", package: "CapacitorClipboard"),
                .product(name: "CapacitorGeolocation", package: "CapacitorGeolocation"),
                .product(name: "CapacitorSplashScreen", package: "CapacitorSplashScreen")
            ]
        )
    ]
)
