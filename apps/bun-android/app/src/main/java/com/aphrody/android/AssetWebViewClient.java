package com.aphrody.android;

import android.net.Uri;
import android.view.ViewGroup;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import androidx.webkit.WebViewAssetLoader;
import java.io.ByteArrayInputStream;
import java.util.Collections;
import java.util.function.Predicate;

/** Local asset client with explicit renderer recovery. */
public final class AssetWebViewClient extends WebViewClient {
    private final WebViewAssetLoader loader;
    private final Predicate<Uri> allowed;
    private final Runnable onRendererGone;

    public AssetWebViewClient(WebViewAssetLoader loader, Predicate<Uri> allowed, Runnable onRendererGone) {
        this.loader = loader;
        this.allowed = allowed;
        this.onRendererGone = onRendererGone;
    }

    @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
        return !allowed.test(request.getUrl());
    }

    @Override public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
        if (allowed.test(request.getUrl())) {
            WebResourceResponse response = loader.shouldInterceptRequest(request.getUrl());
            if (response != null) return response;
        }
        return new WebResourceResponse("text/plain", "UTF-8", 403, "Forbidden",
                Collections.emptyMap(), new ByteArrayInputStream(new byte[0]));
    }

    @Override public boolean onRenderProcessGone(WebView view, RenderProcessGoneDetail detail) {
        if (view.getParent() instanceof ViewGroup parent) parent.removeView(view);
        // Compose releases and destroys this instance after the screen changes.
        onRendererGone.run();
        return true;
    }
}
