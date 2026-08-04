pluginManagement {
    repositories {
        google()
        mavenCentral()
        gradlePluginPortal()
    }
}

dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        google()
        mavenCentral()
    }
}

// idenplane-android isn't published to Maven Central yet (see #1325), so this quickstart
// depends on it as a composite build against local source instead of a real artifact
// coordinate. Once it's published, drop this block and add a normal Maven Central
// dependency in app/build.gradle.kts.
includeBuild("../../packages/idenplane-android") {
    dependencySubstitution {
        substitute(module("com.idenplane:idenplane-android")).using(project(":"))
    }
}

rootProject.name = "android-quickstart"
include(":app")
