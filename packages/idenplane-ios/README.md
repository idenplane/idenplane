# AuthMe iOS SDK

Native Swift SDK for the [AuthMe](https://github.com/Islamawad132/Authme) Identity and Access Management server.

Implements the **OAuth 2.0 Authorization Code flow with PKCE** (RFC 7636) using `ASWebAuthenticationSession`. Tokens are stored securely in the iOS Keychain and optional Face ID / Touch ID gating is built in.

## Requirements

| Requirement | Version |
|-------------|---------|
| Swift       | 5.9+    |
| iOS         | 15.0+   |
| macOS       | 12.0+   |
| Xcode       | 15.0+   |

## Installation

### Swift Package Manager

Add the package to your `Package.swift` dependencies:

```swift
dependencies: [
    .package(
        url: "https://github.com/Islamawad132/Authme",
        from: "1.0.0"
    )
]
```

Or in Xcode: **File › Add Package Dependencies…** and paste the repository URL.

Add `AuthMe` to your target:

```swift
.target(
    name: "MyApp",
    dependencies: [
        .product(name: "AuthMe", package: "Authme")
    ]
)
```

## Setup

### 1. Register a redirect URI

In your AuthMe admin console, register your app's custom URL scheme as a redirect URI. For example:

```
com.example.myapp://callback
```

### 2. Configure URL scheme (for custom scheme redirects)

In `Info.plist`:

```xml
<key>CFBundleURLTypes</key>
<array>
  <dict>
    <key>CFBundleURLSchemes</key>
    <array>
      <string>com.example.myapp</string>
    </array>
  </dict>
</array>
```

### 3. Create the client

```swift
import AuthMe

let authMe = AuthMeClient(
    serverUrl: URL(string: "https://auth.example.com")!,
    realm: "my-realm",
    clientId: "my-mobile-app",
    redirectUri: "com.example.myapp://callback"
)
```

Or using the full `AuthConfig`:

```swift
let config = AuthConfig(
    serverUrl: URL(string: "https://auth.example.com")!,
    realm: "my-realm",
    clientId: "my-mobile-app",
    redirectUri: "com.example.myapp://callback",
    scopes: ["openid", "profile", "email"],
    autoRefresh: true,
    refreshBuffer: 30
)
let authMe = AuthMeClient(config: config)
```

## Login flow

```swift
// In a SwiftUI view:
Button("Sign in") {
    Task {
        do {
            try await authMe.login()
            print("Logged in!")
        } catch {
            print("Login error: \(error.localizedDescription)")
        }
    }
}
```

`login()` opens an `ASWebAuthenticationSession` (Safari-based in-app browser) that navigates to the AuthMe authorization endpoint. When the user completes authentication, the browser redirects back to your app, and the SDK automatically exchanges the authorization code for tokens.

## Checking authentication state

```swift
if authMe.isAuthenticated {
    print("User is logged in")
}
```

## Accessing the access token

```swift
if let token = authMe.getAccessToken() {
    // Attach to API requests
    var request = URLRequest(url: apiURL)
    request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
}
```

## Fetching user info

```swift
do {
    let user = try await authMe.getUserInfo()
    print("Hello, \(user.name ?? user.preferredUsername ?? "unknown")")
    print("Email: \(user.email ?? "n/a")")
} catch {
    print("Failed to fetch user info: \(error)")
}
```

## Token refresh

Token refresh happens automatically in the background when `autoRefresh: true` (the default).

To refresh manually:

```swift
do {
    try await authMe.refreshToken()
} catch AuthMeError.noRefreshToken {
    // Prompt user to log in again
} catch {
    print("Refresh failed: \(error)")
}
```

## Biometric authentication

Require Face ID or Touch ID before granting access to the token:

```swift
do {
    let token = try await authMe.getAccessToken(
        biometricReason: "Authenticate to access your account"
    )
    // token is only returned after successful biometric verification
} catch AuthMeError.biometricAuthFailed(let reason) {
    print("Biometric failed: \(reason)")
}
```

### Checking availability

```swift
let biometric = BiometricAuth()
switch biometric.biometryType {
case .faceID:   print("Face ID available")
case .touchID:  print("Touch ID available")
case .opticID:  print("Optic ID available")
case .none:     print("No biometrics — passcode only")
}
```

## Logout

```swift
await authMe.logout()
// Tokens are cleared from Keychain and the server session is terminated.
```

## Error handling

All errors are typed as `AuthMeError`:

```swift
do {
    try await authMe.login()
} catch AuthMeError.stateMismatch {
    // Possible CSRF — abort
} catch AuthMeError.serverError(let message) {
    print("Server returned: \(message)")
} catch AuthMeError.networkError(let underlying) {
    print("Network: \(underlying)")
} catch {
    print("Unknown error: \(error)")
}
```

| Error | Description |
|-------|-------------|
| `notAuthenticated` | No valid session exists |
| `tokenExpired` | Access token has expired |
| `noRefreshToken` | No refresh token in storage |
| `stateMismatch` | OAuth state parameter mismatch (possible CSRF) |
| `pkceVerifierMissing` | PKCE verifier not found in storage |
| `networkError` | Underlying URLSession / transport error |
| `serverError` | Non-2xx response from AuthMe server |
| `biometricAuthFailed` | Face ID / Touch ID / passcode authentication failed |
| `discoveryFailed` | Could not fetch the OIDC discovery document |
| `callbackError` | Error received in the authorization callback URL |

## Thread safety

`AuthMeClient` is annotated `@MainActor`. All public methods must be called from the main actor. The SDK internally uses `async/await` for network and biometric operations.

## Complete SwiftUI example

```swift
import SwiftUI
import AuthMe

@MainActor
class AuthViewModel: ObservableObject {
    let client = AuthMeClient(
        serverUrl: URL(string: "https://auth.example.com")!,
        realm: "demo",
        clientId: "swiftui-app",
        redirectUri: "com.example.swiftui://callback"
    )

    @Published var user: User?
    @Published var errorMessage: String?

    func login() {
        Task {
            do {
                try await client.login()
                user = try await client.getUserInfo()
            } catch {
                errorMessage = error.localizedDescription
            }
        }
    }

    func logout() {
        Task {
            await client.logout()
            user = nil
        }
    }
}

struct ContentView: View {
    @StateObject private var vm = AuthViewModel()

    var body: some View {
        VStack(spacing: 20) {
            if let user = vm.user {
                Text("Welcome, \(user.name ?? "User")!")
                Button("Logout", action: vm.logout)
            } else {
                Button("Sign in with AuthMe", action: vm.login)
            }
            if let error = vm.errorMessage {
                Text(error).foregroundColor(.red)
            }
        }
        .padding()
    }
}
```

## License

MIT — see the root [LICENSE](../../LICENSE) file.
