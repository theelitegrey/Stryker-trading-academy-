pluginManagement {
    repositories { google(); mavenCentral(); gradlePluginPortal() }
    // Some Google Maven mirrors carry the artifacts but not the plugin-marker POMs; resolve by module.
    resolutionStrategy {
        eachPlugin {
            when (requested.id.id) {
                "com.google.gms.google-services" -> useModule("com.google.gms:google-services:${requested.version}")
                "com.android.application" -> useModule("com.android.tools.build:gradle:${requested.version}")
            }
        }
    }
}
dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories { google(); mavenCentral() }
}
rootProject.name = "TradeZoro"
include(":app")
