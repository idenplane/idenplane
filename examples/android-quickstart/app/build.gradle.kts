plugins {
    id("com.android.application") version "8.2.2"
    id("org.jetbrains.kotlin.android") version "1.9.22"
}

android {
    namespace = "com.idenplane.example.quickstart"
    compileSdk = 34

    defaultConfig {
        applicationId = "com.idenplane.example.quickstart"
        minSdk = 24
        targetSdk = 34
        versionCode = 1
        versionName = "1.0"
    }

    buildTypes {
        release {
            isMinifyEnabled = false
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }

    buildFeatures {
        compose = true
    }

    // Kept in lockstep with packages/idenplane-android/build.gradle.kts's own
    // composeOptions — see the comment there for why 1.5.10 (not a newer release).
    composeOptions {
        kotlinCompilerExtensionVersion = "1.5.10"
    }
}

dependencies {
    // Composite-build (project) dependencies expose the SDK's *debug* variant deps too, unlike
    // a real published AAR (verified separately: the release POM has none of this) — that debug
    // variant includes androidx.compose.ui:ui-test-manifest (needed for the SDK's own Compose
    // unit tests), whose bundled manifest declares the same androidx.activity.ComponentActivity
    // as the SDK's own debug-only test manifest, with a conflicting `exported` value. Excluded
    // here since this app never needs it; this exclusion becomes unnecessary once the SDK is
    // published and this dependency switches to a normal Maven Central coordinate.
    implementation("com.idenplane:idenplane-android:1.0.0") {
        exclude(group = "androidx.compose.ui", module = "ui-test-manifest")
    }

    implementation(platform("androidx.compose:compose-bom:2024.02.00"))
    implementation("androidx.compose.runtime:runtime")
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.activity:activity-compose:1.8.2")
    implementation("androidx.core:core-ktx:1.12.0")
    // FragmentActivity — required directly since IdenplaneClient.login()/BiometricAuth take one,
    // and androidx.fragment isn't exposed by the SDK's own `implementation` dependency on it.
    implementation("androidx.fragment:fragment-ktx:1.6.2")
}
