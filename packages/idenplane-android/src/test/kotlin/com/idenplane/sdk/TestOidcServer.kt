package com.idenplane.sdk

import okhttp3.mockwebserver.Dispatcher
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okhttp3.mockwebserver.RecordedRequest

/**
 * A minimal real HTTP server (via [MockWebServer]) serving OIDC discovery, token, userinfo, and
 * end-session endpoints, so [IdenplaneClient] tests exercise its actual HTTP/JSON handling
 * rather than a mock of it. Response status/body for the token and userinfo endpoints are
 * mutable so a test can simulate error responses.
 *
 * (`com.sun.net.httpserver.HttpServer`, used for the same purpose in the plain-JVM Java SDK
 * modules, isn't resolvable from Android's unit-test compilation classpath.)
 */
class TestOidcServer(val realm: String = "test-realm") : AutoCloseable {

    private val server = MockWebServer()
    val baseUrl: String

    @Volatile var tokenStatus: Int = 200
    @Volatile var tokenBody: String =
        """{"access_token":"at-1","token_type":"Bearer","expires_in":300}"""

    @Volatile var userInfoStatus: Int = 200
    @Volatile var userInfoBody: String = """{"sub":"user-1"}"""

    @Volatile var discoveryHitCount: Int = 0
        private set
    val tokenRequestBodies = mutableListOf<String>()
    var lastUserInfoAuthHeader: String? = null
        private set

    init {
        val prefix = "/realms/$realm"
        server.dispatcher = object : Dispatcher() {
            override fun dispatch(request: RecordedRequest): MockResponse {
                val path = request.path.orEmpty().substringBefore('?')
                return when (path) {
                    "$prefix/.well-known/openid-configuration" -> {
                        discoveryHitCount++
                        jsonResponse(200, discoveryJson(prefix))
                    }
                    "$prefix/protocol/openid-connect/token" -> {
                        tokenRequestBodies.add(request.body.readUtf8())
                        jsonResponse(tokenStatus, tokenBody)
                    }
                    "$prefix/protocol/openid-connect/userinfo" -> {
                        lastUserInfoAuthHeader = request.getHeader("Authorization")
                        jsonResponse(userInfoStatus, userInfoBody)
                    }
                    "$prefix/protocol/openid-connect/logout" -> jsonResponse(200, "")
                    else -> MockResponse().setResponseCode(404)
                }
            }
        }
        server.start()
        baseUrl = server.url("/").toString().trimEnd('/')
    }

    private fun discoveryJson(prefix: String): String {
        val issuer = "$baseUrl$prefix"
        return """
            {
              "issuer": "$issuer",
              "authorization_endpoint": "$issuer/protocol/openid-connect/auth",
              "token_endpoint": "$issuer/protocol/openid-connect/token",
              "userinfo_endpoint": "$issuer/protocol/openid-connect/userinfo",
              "jwks_uri": "$issuer/protocol/openid-connect/certs",
              "end_session_endpoint": "$issuer/protocol/openid-connect/logout"
            }
        """.trimIndent()
    }

    private fun jsonResponse(status: Int, body: String): MockResponse =
        MockResponse()
            .setResponseCode(status)
            .setHeader("Content-Type", "application/json")
            .setBody(body)

    override fun close() {
        server.shutdown()
    }
}
