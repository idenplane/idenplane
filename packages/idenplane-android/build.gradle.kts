import com.vanniktech.maven.publish.AndroidSingleVariantLibrary

plugins {
    id("com.android.library") version "8.2.2"
    id("org.jetbrains.kotlin.android") version "1.9.22"
    kotlin("plugin.serialization") version "1.9.22"
    // Handles Central Portal upload + GPG signing in one step, replacing the
    // raw maven-publish setup this used to have (which was actually pointed
    // at JitPack's groupId convention, com.github.<user>, not real Maven
    // Central — see the coordinates() call below for the real ones).
    // Pinned to 0.34.0: 0.35.0+ raises the plugin's minimum required AGP to
    // 8.2.2 with Gradle 8.13, and 0.36.0+ raises AGP further to 8.13 — both
    // higher than this module's AGP 8.2.2 / Gradle 8.5. 0.34.0 is the newest
    // release whose stated minimums (AGP 8.0.0, Gradle 8.5) this module
    // actually satisfies; a newer plugin version fails at configuration time
    // with an IllegalAccessError, not a clean version-mismatch message.
    id("com.vanniktech.maven.publish") version "0.34.0"
}

android {
    namespace = "com.idenplane.sdk"
    compileSdk = 34

    defaultConfig {
        minSdk = 24
        targetSdk = 34

        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
        consumerProguardFiles("consumer-rules.pro")
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro"
            )
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
        freeCompilerArgs += listOf(
            "-opt-in=kotlinx.coroutines.ExperimentalCoroutinesApi"
        )
    }

    // No android.publishing.singleVariant block here: com.vanniktech.maven.publish
    // registers the "release" component itself (see AndroidSingleVariantLibrary in
    // mavenPublishing below). Declaring singleVariant("release") in both places trips
    // AGP's "publishing DSL multiple times ... not allowed" error.
}

dependencies {
    // AndroidX Core
    implementation("androidx.core:core-ktx:1.12.0")

    // Browser — Chrome Custom Tabs for OAuth flow
    implementation("androidx.browser:browser:1.7.0")

    // Security — EncryptedSharedPreferences
    implementation("androidx.security:security-crypto:1.1.0-alpha06")

    // Biometric
    implementation("androidx.biometric:biometric:1.1.0")

    // Coroutines
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.7.3")

    // JSON serialization
    implementation("org.jetbrains.kotlinx:kotlinx-serialization-json:1.6.2")

    // Lifecycle
    implementation("androidx.lifecycle:lifecycle-runtime-ktx:2.7.0")

    // Test
    testImplementation("junit:junit:4.13.2")
    testImplementation("org.mockito.kotlin:mockito-kotlin:5.2.1")
    testImplementation("org.jetbrains.kotlinx:kotlinx-coroutines-test:1.7.3")
    // com.sun.net.httpserver.HttpServer (used for this kind of real-local-server test in the
    // plain-JVM Java SDK modules) isn't resolvable from Android's unit-test compilation
    // classpath — MockWebServer is the standard substitute for exercising real HTTP/JSON
    // handling in Android JVM unit tests.
    testImplementation("com.squareup.okhttp3:mockwebserver:4.12.0")
    // Plain JVM unit tests run against a stub android.jar whose methods throw
    // ("not mocked") rather than doing anything — Robolectric swaps in real
    // framework-class implementations (needed here for android.util.Base64).
    testImplementation("org.robolectric:robolectric:4.16.1")
    androidTestImplementation("androidx.test.ext:junit:1.1.5")
    androidTestImplementation("androidx.test.espresso:espresso-core:3.5.1")
}

// Real Maven Central publishing via the Central Portal (the old OSSRH
// Nexus host is retired). Credentials and the GPG signing key are never
// hardcoded here — the plugin reads them from Gradle properties, which
// publish-android.yml supplies as ORG_GRADLE_PROJECT_* environment
// variables sourced from repo secrets. Running `./gradlew publish` locally
// with no such properties set fails safely at the credentials step; it
// does not silently publish or fall back to anything.
//
// The com.idenplane namespace is already verified on central.sonatype.com
// (RSA 4096 signing key 00A90144FEAC6870, on keyserver.ubuntu.com — see
// #1325). No further Sonatype-side setup is needed; the only remaining gate
// on an actual publish is triggering publish-android.yml (tag push or
// workflow_dispatch), which nothing in this change does.
mavenPublishing {
    coordinates("com.idenplane", "idenplane-android", "1.0.0")

    // Explicit rather than relying on the plugin's auto-detected default for
    // com.android.library — this is the "release" component, with sources
    // and javadoc jars, matching what the old manual singleVariant() block
    // above used to declare directly.
    configure(
        AndroidSingleVariantLibrary(
            variant = "release",
            sourcesJar = true,
            publishJavadocJar = true,
        )
    )

    pom {
        name.set("Idenplane Android SDK")
        description.set("Android SDK for the Idenplane Identity and Access Management Server")
        url.set("https://github.com/idenplane/idenplane")
        licenses {
            license {
                name.set("MIT License")
                url.set("https://opensource.org/licenses/MIT")
            }
        }
        developers {
            developer {
                name.set("Idenplane")
                url.set("https://github.com/idenplane")
            }
        }
        scm {
            url.set("https://github.com/idenplane/idenplane")
            connection.set("scm:git:https://github.com/idenplane/idenplane.git")
            developerConnection.set("scm:git:ssh://git@github.com/idenplane/idenplane.git")
        }
    }

    publishToMavenCentral()
    signAllPublications()
}
