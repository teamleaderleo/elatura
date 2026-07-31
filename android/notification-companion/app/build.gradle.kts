plugins {
    id("com.android.application")
}

val elaturaBuildSha = System.getenv("GITHUB_SHA")?.takeIf(String::isNotBlank) ?: "local"
val elaturaBuildRunId = System.getenv("GITHUB_RUN_ID")?.takeIf(String::isNotBlank) ?: "local"
val elaturaBuildRunNumber = System.getenv("GITHUB_RUN_NUMBER")
    ?.toIntOrNull()
    ?.coerceAtLeast(1)
    ?: 1
val elaturaSigningMode = System.getenv("ELATURA_SIGNING_MODE")
    ?.trim()
    ?.take(64)
    ?.takeIf(String::isNotEmpty)
    ?: "local-debug"

android {
    namespace = "dev.elatura.notificationcompanion"
    compileSdk = 36

    defaultConfig {
        applicationId = "dev.elatura.notificationcompanion"
        minSdk = 28
        targetSdk = 36
        versionCode = elaturaBuildRunNumber
        versionName = "0.1.0-dev.$elaturaBuildRunNumber"
        buildConfigField("String", "ELATURA_BUILD_SHA", "\"$elaturaBuildSha\"")
        buildConfigField("String", "ELATURA_BUILD_RUN_ID", "\"$elaturaBuildRunId\"")
        buildConfigField("String", "ELATURA_SIGNING_MODE", "\"$elaturaSigningMode\"")
    }

    buildFeatures {
        buildConfig = true
    }

    buildTypes {
        release {
            isMinifyEnabled = true
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro",
            )
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    testOptions {
        unitTests.isIncludeAndroidResources = false
    }
}

dependencies {
    testImplementation("junit:junit:4.13.2")
}
