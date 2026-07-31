plugins {
    id("com.android.application")
}

val elaturaBuildSha = System.getenv("GITHUB_SHA")?.takeIf(String::isNotBlank) ?: "local"
val elaturaBuildRunId = System.getenv("GITHUB_RUN_ID")?.takeIf(String::isNotBlank) ?: "local"

android {
    namespace = "dev.elatura.notificationcompanion"
    compileSdk = 36

    defaultConfig {
        applicationId = "dev.elatura.notificationcompanion"
        minSdk = 28
        targetSdk = 36
        versionCode = 1
        versionName = "0.1.0"
        buildConfigField("String", "ELATURA_BUILD_SHA", "\"$elaturaBuildSha\"")
        buildConfigField("String", "ELATURA_BUILD_RUN_ID", "\"$elaturaBuildRunId\"")
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
