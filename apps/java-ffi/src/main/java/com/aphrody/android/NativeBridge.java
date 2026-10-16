package com.aphrody.android;

public final class NativeBridge {
    static {
        System.loadLibrary("android_native");
    }

    private NativeBridge() {}

    public static native int add(int left, int right);
}
