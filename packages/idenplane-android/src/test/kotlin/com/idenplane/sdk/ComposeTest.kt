package com.idenplane.sdk

import android.content.Context
import android.content.pm.ActivityInfo
import androidx.activity.ComponentActivity
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.State
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.remember
import androidx.compose.ui.test.junit4.createComposeRule
import kotlinx.coroutines.test.runTest
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TestRule
import org.junit.runner.Description
import org.junit.runner.RunWith
import org.junit.runners.model.Statement
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.Shadows.shadowOf

/**
 * Exercises the Compose helpers in [Compose.kt] against a real [IdenplaneClient] (backed by a
 * real [TestOidcServer]) via Robolectric's Compose UI testing support — this is genuine
 * composition/recomposition behavior, not a mock of it.
 */
@RunWith(RobolectricTestRunner::class)
class ComposeTest {

    // createComposeRule() launches androidx.activity.ComponentActivity via
    // ActivityScenarioRule as part of the *rule's own* before(), which JUnit runs before any
    // @Before method — so registering the activity in @Before is too late. Robolectric also
    // resolves that launch intent against the *runtime* application package (a synthetic
    // "org.robolectric.default" for a library module with no applicationId of its own) rather
    // than this module's manifest package ("com.idenplane.sdk"), a mismatch tracked at
    // https://github.com/robolectric/robolectric/pull/4736. This outer rule (lower order runs
    // first) registers the activity under the runtime package before composeTestRule starts.
    @get:Rule(order = 0)
    val activityRegistrationRule = TestRule { base, _ ->
        object : Statement() {
            override fun evaluate() {
                val app = RuntimeEnvironment.getApplication()
                val activityInfo = ActivityInfo().apply {
                    name = ComponentActivity::class.java.name
                    packageName = app.packageName
                    applicationInfo = app.applicationInfo
                }
                shadowOf(app.packageManager).addOrUpdateActivity(activityInfo)
                base.evaluate()
            }
        }
    }

    @get:Rule(order = 1)
    val composeTestRule = createComposeRule()

    private lateinit var server: TestOidcServer
    private val context: Context get() = RuntimeEnvironment.getApplication()

    @Before
    fun setUp() {
        server = TestOidcServer()
    }

    @After
    fun tearDown() {
        server.close()
    }

    private fun config() = AuthConfig(
        serverUrl = server.baseUrl,
        realm = server.realm,
        clientId = "compose-test-client",
        redirectUri = "com.example.app://callback",
        autoRefresh = false,
    )

    /**
     * [rememberIdenplaneClient] calls the public two-arg [IdenplaneClient] constructor, which
     * builds a real AndroidKeyStore-backed [TokenStorage] — unavailable under Robolectric (see
     * [IdenplaneClientTest]). This composable wraps that same constructor to verify its
     * `remember` memoization without needing a real Keystore.
     */
    @Composable
    private fun rememberTestClient(config: AuthConfig): IdenplaneClient {
        val client = remember(context, config) {
            IdenplaneClient(context, config, TokenStorage(context.getSharedPreferences("compose-remember-test", Context.MODE_PRIVATE)))
        }
        DisposableEffect(client) {
            onDispose { client.destroy() }
        }
        return client
    }

    @Test
    fun `rememberIdenplaneClient-style memoization returns the same instance across recompositions with the same config`() {
        // setContent can only be called once per test, so a second composition pass of the same
        // content is forced by mutating a MutableState read inside it, rather than a second
        // setContent call (which composeTestRule disallows outright).
        val trigger = mutableIntStateOf(0)
        val seen = mutableListOf<IdenplaneClient>()

        composeTestRule.setContent {
            trigger.intValue
            seen += rememberTestClient(config())
        }
        composeTestRule.waitForIdle()
        composeTestRule.runOnUiThread { trigger.intValue++ }
        composeTestRule.waitForIdle()

        assertEquals("expected a second recomposition to actually happen", 2, seen.size)
        assertSame("remember(context, config) must not rebuild the client for an equal config", seen[0], seen[1])
    }

    @Test
    fun `collectAuthStateAsState reflects the client's current authState`() {
        val storage = TokenStorage(context.getSharedPreferences("compose-initial-state-test", Context.MODE_PRIVATE))
        val client = IdenplaneClient(context, config(), storage)
        lateinit var state: State<Boolean>

        composeTestRule.setContent {
            state = client.collectAuthStateAsState()
        }
        composeTestRule.waitForIdle()

        assertFalse(state.value)
    }

    @Test
    fun `collectAuthStateAsState recomposes when authState changes`() = runTest {
        val storage = TokenStorage(context.getSharedPreferences("compose-test-prefs", Context.MODE_PRIVATE))
        storage.authState = "expected-state"
        storage.pkceVerifier = "verifier-123"
        server.tokenBody = """{"access_token":"at-new","token_type":"Bearer","expires_in":300}"""
        val client = IdenplaneClient(context, config(), storage)
        lateinit var state: State<Boolean>

        composeTestRule.setContent {
            state = client.collectAuthStateAsState()
        }
        composeTestRule.waitForIdle()
        assertFalse(state.value)

        val intent = android.content.Intent().apply {
            data = android.net.Uri.parse("com.example.app://callback?code=auth-code-1&state=expected-state")
        }
        client.handleRedirectIntent(intent)
        composeTestRule.waitForIdle()

        assertTrue(state.value)
    }
}
