package com.aphrody.android

import android.annotation.SuppressLint
import android.net.Uri
import android.webkit.WebView
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.viewinterop.AndroidView
import androidx.compose.ui.unit.dp
import androidx.webkit.WebViewAssetLoader

private const val ASSET_HOST = "appassets.androidplatform.net"
private const val START_URL = "https://$ASSET_HOST/assets/index.html"

internal fun isAllowedAssetUrl(url: Uri): Boolean =
    url.scheme == "https" && url.host == ASSET_HOST && url.userInfo == null &&
        (url.port == -1 || url.port == 443) && url.path?.startsWith("/assets/") == true &&
        url.path?.split('/')?.none { it == ".." || it == "." } == true

@SuppressLint("SetJavaScriptEnabled") // Only workspace-built assets are exposed, without a JS/native bridge.
@Composable
fun BunContent(modifier: Modifier = Modifier) {
    var rendererLost by remember { mutableStateOf(false) }
    if (rendererLost) {
        Column(modifier.padding(20.dp)) {
            Text("Le contenu Bun a été interrompu.")
            Button(onClick = { rendererLost = false }) { Text("Recharger") }
        }
        return
    }
    AndroidView(
        modifier = modifier,
        factory = { context ->
            val loader = WebViewAssetLoader.Builder()
                .addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(context))
                .build()
            WebView(context).apply {
                settings.javaScriptEnabled = true
                settings.allowFileAccess = false
                settings.allowContentAccess = false
                settings.mixedContentMode = android.webkit.WebSettings.MIXED_CONTENT_NEVER_ALLOW
                webViewClient = AssetWebViewClient(loader, ::isAllowedAssetUrl) { rendererLost = true }
                loadUrl(START_URL)
            }
        },
        onRelease = { web ->
            web.stopLoading()
            web.destroy()
        },
    )
}
