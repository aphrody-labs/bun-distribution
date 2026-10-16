package com.aphrody.android;

/** Embedded Bun runtime packaged as {@code libbun.so} in the APK. */
public final class BunRuntime {
    public static final int NOT_LOADED = -127;
    public static final int NO_ENTRY = -126;
    private static final boolean AVAILABLE = loadRuntime();

    static {
        System.loadLibrary("android_native");
    }

    private BunRuntime() {}

    private static boolean loadRuntime() {
        try {
            System.loadLibrary("bun");
            return true;
        } catch (UnsatisfiedLinkError error) {
            return false;
        }
    }

    /** Whether {@code libbun.so} was found in the application's native library directory. */
    public static boolean isAvailable() {
        return AVAILABLE;
    }

    /** Run a script path with the embedded runtime and return its exit code. */
    public static int run(String script) {
        return AVAILABLE ? nativeRun(script) : NOT_LOADED;
    }

    private static native int nativeRun(String script);
}
