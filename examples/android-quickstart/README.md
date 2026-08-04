# Idenplane Android Quickstart

A minimal Jetpack Compose app demonstrating the [Idenplane Android SDK](../../packages/idenplane-android): sign in, view the signed-in user's profile, a biometric-gated action, and sign out.

## Before you run this

`MainActivity.kt` has a placeholder `AuthConfig` pointing at `https://auth.example.com` — it won't authenticate against anything until you:

1. Point `serverUrl` / `realm` / `clientId` at a real Idenplane realm.
2. Register `com.idenplane.example.quickstart://callback` as an allowed redirect URI for that client.

## Why this depends on the SDK via a composite build

The Idenplane Android SDK isn't published to Maven Central yet (see [#1325](https://github.com/idenplane/idenplane/issues/1325)), so `settings.gradle.kts` here uses `includeBuild("../../packages/idenplane-android")` with a dependency substitution instead of a real `com.idenplane:idenplane-android` coordinate. Once the SDK is published, drop the `includeBuild` block and the `exclude` in `app/build.gradle.kts`, and this becomes a normal dependency.

The `exclude(group = "androidx.compose.ui", module = "ui-test-manifest")` in `app/build.gradle.kts` is also a composite-build-only workaround: unlike a real published AAR, a composite/project dependency exposes the SDK's *debug* variant dependencies too (including its test-only `ui-test-manifest`), which collides with this app's own manifest merge. A real Maven Central artifact doesn't have this problem — the published release POM has no test dependencies in it at all.

## What's verified, and what isn't

`./gradlew :app:assembleDebug` and `:app:assembleRelease` both succeed — the composite build resolves, and every screen compiles against the real SDK API.

What's **not** verified: nobody has run this app on a device or emulator. There is no Android emulator in the environment this was built in (`adb devices` returns empty), so the actual login flow (Chrome Custom Tab launch → redirect → token exchange), the biometric prompt, and general UI behavior have not been exercised end-to-end. Treat this as a real, compiling reference implementation — not as proof the flow works against a live server.

## Running it

```bash
./gradlew :app:installDebug
```

(requires a connected device or emulator, and a real Idenplane realm configured as above).
