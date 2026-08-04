package com.idenplane.example.quickstart

import android.content.Intent
import android.os.Bundle
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.MutableState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.fragment.app.FragmentActivity
import com.idenplane.sdk.AuthConfig
import com.idenplane.sdk.BiometricAuth
import com.idenplane.sdk.IdenplaneClient
import com.idenplane.sdk.User
import com.idenplane.sdk.collectAuthStateAsState
import kotlinx.coroutines.launch

/**
 * Placeholder realm — this app won't authenticate against anything until you point it at a
 * real Idenplane server and register this redirectUri in that realm's client config.
 */
private val CONFIG = AuthConfig(
    serverUrl = "https://auth.example.com",
    realm = "my-realm",
    clientId = "quickstart-android",
    redirectUri = "com.idenplane.example.quickstart://callback",
)

class MainActivity : FragmentActivity() {

    private val authMe by lazy { IdenplaneClient(applicationContext, CONFIG) }
    private val pendingRedirect = mutableStateOf<Intent?>(null)

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent {
            MaterialTheme {
                QuickstartApp(authMe, pendingRedirect)
            }
        }
    }

    // Chrome Custom Tabs redirects back into this Activity via the intent-filter in
    // AndroidManifest.xml — launchMode="singleTop" means that arrives here, not onCreate.
    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        pendingRedirect.value = intent
    }

    override fun onDestroy() {
        super.onDestroy()
        authMe.destroy()
    }
}

@Composable
private fun QuickstartApp(authMe: IdenplaneClient, pendingRedirect: MutableState<Intent?>) {
    val activity = LocalContext.current as FragmentActivity
    val scope = rememberCoroutineScope()
    val isAuthenticated by authMe.collectAuthStateAsState()
    var user by remember { mutableStateOf<User?>(null) }
    var status by remember { mutableStateOf<String?>(null) }

    LaunchedEffect(pendingRedirect.value) {
        val redirect = pendingRedirect.value ?: return@LaunchedEffect
        pendingRedirect.value = null
        runCatching { authMe.handleRedirectIntent(redirect) }
            .onFailure { status = "Login failed: ${it.message}" }
    }

    LaunchedEffect(isAuthenticated) {
        user = if (isAuthenticated) {
            runCatching { authMe.getUserInfo() }
                .onFailure { status = "Couldn't load profile: ${it.message}" }
                .getOrNull()
        } else {
            null
        }
    }

    Surface(modifier = Modifier.fillMaxSize()) {
        Box(modifier = Modifier.fillMaxSize().padding(24.dp), contentAlignment = Alignment.Center) {
            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                Text("Idenplane Quickstart", style = MaterialTheme.typography.headlineSmall)
                Spacer(modifier = Modifier.height(24.dp))

                if (isAuthenticated) {
                    Text("Signed in as ${user?.preferredUsername ?: user?.sub ?: "…"}")
                    Spacer(modifier = Modifier.height(16.dp))
                    Button(onClick = {
                        scope.launch {
                            runCatching { BiometricAuth(activity).authenticate(title = "Confirm it's you") }
                                .onSuccess { status = "Biometric check passed" }
                                .onFailure { status = "Biometric check failed: ${it.message}" }
                        }
                    }) { Text("Verify with biometrics") }
                    Spacer(modifier = Modifier.height(8.dp))
                    Button(onClick = {
                        scope.launch {
                            // Passing the activity also clears the browser-side session via a
                            // Custom Tab (blank response, dismissed manually) — a no-argument
                            // logout() only revokes the refresh token, silently.
                            authMe.logout(activity)
                        }
                    }) { Text("Sign out") }
                } else {
                    Button(onClick = {
                        scope.launch {
                            runCatching { authMe.login(activity) }
                                .onFailure { status = "Couldn't start login: ${it.message}" }
                        }
                    }) { Text("Sign in") }
                }

                status?.let {
                    Spacer(modifier = Modifier.height(16.dp))
                    Text(it, color = MaterialTheme.colorScheme.error)
                }
            }
        }
    }
}
