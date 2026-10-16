package com.aphrody.android

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.SystemBarStyle
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.runtime.SideEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        setContent {
            val model: GalleryViewModel = viewModel()
            val state by model.state.collectAsStateWithLifecycle()
            val nativeAnswer = remember { NativeBridge.add(20, 22) }
            val dark = when (state.themeMode) {
                ThemeMode.SYSTEM -> isSystemInDarkTheme()
                ThemeMode.LIGHT -> false
                ThemeMode.DARK -> true
            }
            SideEffect {
                val transparent = android.graphics.Color.TRANSPARENT
                val bars = if (dark) SystemBarStyle.dark(transparent)
                    else SystemBarStyle.light(transparent, transparent)
                enableEdgeToEdge(statusBarStyle = bars, navigationBarStyle = bars)
            }
            AphrodyTheme(state.themeMode, state.dynamicColor) {
                GalleryApp(state, nativeAnswer, model::update)
            }
        }
    }
}
