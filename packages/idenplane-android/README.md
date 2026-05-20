# AuthMe Android SDK

Native Kotlin SDK for the [AuthMe](https://github.com/Islamawad132/Authme) Identity and Access Management server.

Implements the **OAuth 2.0 Authorization Code flow with PKCE** (RFC 7636) using Chrome Custom Tabs. Tokens are stored securely with `EncryptedSharedPreferences` (AES-256-GCM) and optional biometric gating via `BiometricPrompt` is built in.

## Requirements

| Requirement      | Version      |
|------------------|--------------|
| Kotlin           | 1.9+         |
| Android minSdk   | 24 (Android 7.0) |
| Android targetSdk| 34 (Android 14)  |
| AGP              | 8.x          |

## Installation

### Gradle (Kotlin DSL)

Add JitPack to your project-level `settings.gradle.kts`:

```kotlin
dependencyResolutionManagement {
    repositories {
        google()
        mavenCentral()
        maven { url = uri("https://jitpack.io") }
    }
}
```

Add the dependency to your app or library module `build.gradle.kts`:

```kotlin
dependencies {
    implementation("com.github.Islamawad132:Authme:1.0.0")
}
```

### Required permissions in AndroidManifest.xml

```xml
<uses-permission android:name="android.permission.INTERNET" />
```

## Setup

### 1. Register a redirect URI

In your AuthMe admin console, register a custom scheme redirect URI for your app:

```
com.example.myapp://callback
```

### 2. Add an intent filter to your Activity

In `AndroidManifest.xml`, register the Activity that will handle the OAuth callback:

```xml
<activity
    android:name=".MainActivity"
    android:launchMode="singleTop"
    android:exported="true">

    <intent-filter>
        <action android:name="android.intent.action.VIEW" />
        <category android:name="android.intent.category.DEFAULT" />
        <category android:name="android.intent.category.BROWSABLE" />
        <data
            android:scheme="com.example.myapp"
            android:host="callback" />
    </intent-filter>
</activity>
```

### 3. Create the client

```kotlin
import com.authme.sdk.AuthConfig
import com.authme.sdk.AuthMeClient

val authMe = AuthMeClient(
    context     = applicationContext,
    serverUrl   = "https://auth.example.com",
    realm       = "my-realm",
    clientId    = "my-android-app",
    redirectUri = "com.example.myapp://callback"
)
```

Or using `AuthConfig`:

```kotlin
val config = AuthConfig(
    serverUrl    = "https://auth.example.com",
    realm        = "my-realm",
    clientId     = "my-android-app",
    redirectUri  = "com.example.myapp://callback",
    scopes       = listOf("openid", "profile", "email"),
    autoRefresh  = true,
    refreshBuffer = 30
)
val authMe = AuthMeClient(applicationContext, config)
```

## Login flow

```kotlin
// In your Activity or Fragment:
binding.signInButton.setOnClickListener {
    lifecycleScope.launch {
        try {
            authMe.login(this@MainActivity)
            // Browser opens — wait for the redirect callback
        } catch (e: AuthMeException) {
            showError(e.message)
        }
    }
}
```

### Handle the redirect callback

In your `Activity`, override `onNewIntent` (and optionally `onResume`):

```kotlin
override fun onNewIntent(intent: Intent?) {
    super.onNewIntent(intent)
    handleAuthCallback(intent)
}

override fun onResume() {
    super.onResume()
    handleAuthCallback(intent)
}

private fun handleAuthCallback(intent: Intent?) {
    lifecycleScope.launch {
        try {
            val handled = authMe.handleRedirectIntent(intent)
            if (handled) {
                // Login successful — navigate to home screen
                navigateToHome()
            }
        } catch (e: AuthMeException.StateMismatch) {
            showError("Security error: state mismatch")
        } catch (e: AuthMeException.CallbackError) {
            showError("Login failed: ${e.message}")
        }
    }
}
```

## Checking authentication state

```kotlin
if (authMe.isAuthenticated) {
    println("User is logged in")
}
```

## Accessing the access token

```kotlin
val token = authMe.getAccessToken()
if (token != null) {
    // Attach to API requests
    val request = Request.Builder()
        .url(apiUrl)
        .header("Authorization", "Bearer $token")
        .build()
}
```

## Fetching user info

```kotlin
lifecycleScope.launch {
    try {
        val user = authMe.getUserInfo()
        println("Hello, ${user.name ?: user.preferredUsername ?: "User"}")
        println("Email: ${user.email}")
    } catch (e: AuthMeException.NotAuthenticated) {
        redirectToLogin()
    }
}
```

## Token refresh

Token refresh runs automatically in the background when `autoRefresh = true` (default).

To refresh manually:

```kotlin
lifecycleScope.launch {
    try {
        authMe.refreshToken()
    } catch (e: AuthMeException.NoRefreshToken) {
        // Prompt user to log in again
        redirectToLogin()
    } catch (e: AuthMeException) {
        showError("Refresh failed: ${e.message}")
    }
}
```

## Biometric authentication

Require fingerprint, face, or device credentials before accessing the token:

```kotlin
lifecycleScope.launch {
    try {
        val token = authMe.getAccessToken(
            activity = this@MainActivity,
            title    = "Verify your identity"
        )
        // token is non-null only after successful biometric auth
        useToken(token)
    } catch (e: AuthMeException.BiometricAuthFailed) {
        showError("Biometric failed: ${e.message}")
    }
}
```

### Standalone biometric prompt

```kotlin
val biometric = BiometricAuth(activity)

if (biometric.isBiometricAvailable) {
    lifecycleScope.launch {
        try {
            biometric.authenticate(
                title       = "Confirm identity",
                subtitle    = "Access your secure data",
                description = "Use your fingerprint or face to continue"
            )
            // Proceed with sensitive operation
        } catch (e: AuthMeException.BiometricAuthFailed) {
            showError(e.message)
        }
    }
}
```

## Logout

```kotlin
lifecycleScope.launch {
    authMe.logout()
    // Tokens are cleared; server session is terminated
    redirectToLogin()
}
```

## Lifecycle management

Cancel background auto-refresh jobs when the client is no longer needed:

```kotlin
override fun onDestroy() {
    super.onDestroy()
    authMe.destroy()
}
```

## Error handling

All SDK errors are subclasses of `AuthMeException`:

```kotlin
try {
    authMe.login(activity)
} catch (e: AuthMeException.StateMismatch) {
    // Possible CSRF — abort and clear state
} catch (e: AuthMeException.ServerError) {
    showError("Server: ${e.message}")
} catch (e: AuthMeException.NetworkError) {
    showError("Network: ${e.message}")
} catch (e: AuthMeException) {
    showError(e.message)
}
```

| Exception | Description |
|-----------|-------------|
| `NotAuthenticated` | No valid session exists |
| `TokenExpired` | Access token has expired |
| `NoRefreshToken` | No refresh token in storage |
| `StateMismatch` | OAuth state parameter mismatch (possible CSRF) |
| `PkceVerifierMissing` | PKCE verifier missing from storage |
| `NetworkError` | HTTP / IO error |
| `ServerError` | Non-2xx response from the AuthMe server |
| `CallbackError` | Error present in the redirect callback URI |
| `DiscoveryFailed` | OIDC discovery document fetch failed |
| `BiometricAuthFailed` | Biometric / device credential authentication failed |
| `LoginCancelled` | User cancelled the login flow |

## Complete ViewModel example

```kotlin
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.authme.sdk.AuthMeClient
import com.authme.sdk.AuthMeException
import com.authme.sdk.User
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch

class AuthViewModel(private val authMe: AuthMeClient) : ViewModel() {

    private val _user = MutableStateFlow<User?>(null)
    val user: StateFlow<User?> = _user

    private val _error = MutableStateFlow<String?>(null)
    val error: StateFlow<String?> = _error

    fun login(activity: androidx.fragment.app.FragmentActivity) {
        viewModelScope.launch {
            runCatching { authMe.login(activity) }
                .onFailure { _error.value = it.message }
        }
    }

    fun handleCallback(intent: android.content.Intent?) {
        viewModelScope.launch {
            runCatching {
                val handled = authMe.handleRedirectIntent(intent)
                if (handled) {
                    _user.value = authMe.getUserInfo()
                }
            }.onFailure { _error.value = it.message }
        }
    }

    fun logout() {
        viewModelScope.launch {
            authMe.logout()
            _user.value = null
        }
    }
}
```

## License

MIT — see the root [LICENSE](../../LICENSE) file.
