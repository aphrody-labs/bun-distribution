package com.aphrody.android

import androidx.lifecycle.SavedStateHandle
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Test

class GalleryViewModelTest {
    @Test
    fun userSettingsSurviveNewViewModel() {
        val handle = SavedStateHandle()
        val first = GalleryViewModel(handle)
        first.update { it.copy(destination = Destination.SETTINGS, themeMode = ThemeMode.DARK, dynamicColor = false, name = "Yoyo") }
        val recreated = GalleryViewModel(handle).state.value
        assertEquals(Destination.SETTINGS, recreated.destination)
        assertEquals(ThemeMode.DARK, recreated.themeMode)
        assertEquals("Yoyo", recreated.name)
        assertFalse(recreated.dynamicColor)
    }
}
