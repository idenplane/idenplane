package com.idenplane.sdk

import android.content.Context
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.State
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.remember

/**
 * Optional Jetpack Compose integration. These APIs are compiled against the Compose runtime
 * but it is a `compileOnly` dependency of this module — apps that don't use Compose are not
 * forced to pull it in transitively. Apps that do call these functions must add their own
 * `androidx.compose.runtime:runtime` dependency (or the Compose BOM).
 */

/**
 * Creates and remembers an [IdenplaneClient] scoped to the composition, calling [IdenplaneClient.destroy]
 * when it leaves the composition.
 */
@Composable
fun rememberIdenplaneClient(context: Context, config: AuthConfig): IdenplaneClient {
    val client = remember(context, config) { IdenplaneClient(context, config) }
    DisposableEffect(client) {
        onDispose { client.destroy() }
    }
    return client
}

/**
 * Collects [IdenplaneClient.authState] as Compose [State], so a composable recomposes when
 * login/logout/refresh changes the authentication state — see [IdenplaneClient.authState] for
 * what this does and does not react to.
 */
@Composable
fun IdenplaneClient.collectAuthStateAsState(): State<Boolean> =
    authState.collectAsState()
