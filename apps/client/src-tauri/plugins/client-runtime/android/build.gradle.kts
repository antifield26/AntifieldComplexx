// 可重现的原生插件配置；仅允许 Android 26 及以上。
import org.jetbrains.kotlin.gradle.dsl.JvmTarget

plugins {
    id("com.android.library")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "app.antifieldcomplexx.runtime"
    compileSdk = 36
    defaultConfig {
        minSdk = 26
        consumerProguardFiles("consumer-rules.pro")
        val fixedAiOrigin = System.getenv("VITE_AI_ORIGIN") ?: "https://ai.example.com"
        buildConfigField("String", "AI_ORIGIN", "\"" + fixedAiOrigin.replace("\\", "\\\\").replace("\"", "\\\"") + "\"")
        val fixedAccessOrigin = System.getenv("VITE_ACCESS_ORIGIN") ?: ""
        buildConfigField("String", "ACCESS_ORIGIN", "\"" + fixedAccessOrigin.replace("\\", "\\\\").replace("\"", "\\\"") + "\"")
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_1_8
        targetCompatibility = JavaVersion.VERSION_1_8
    }
    buildFeatures { buildConfig = true }
}

kotlin { compilerOptions { jvmTarget = JvmTarget.JVM_1_8 } }

dependencies {
    implementation(project(":tauri-android"))
    implementation("androidx.appcompat:appcompat:1.7.1")
    implementation("androidx.activity:activity-ktx:1.10.1")
}
