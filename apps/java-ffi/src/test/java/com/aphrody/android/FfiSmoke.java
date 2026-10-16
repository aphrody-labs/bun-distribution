package com.aphrody.android;

public final class FfiSmoke {
    public static void main(String[] args) {
        if (NativeBridge.add(20, 22) != 42) {
            throw new AssertionError("JNI sum failed");
        }
        if (NativeBridge.add(Integer.MAX_VALUE, 1) != Integer.MAX_VALUE) {
            throw new AssertionError("JNI saturation failed");
        }
        System.out.println("JAVA_RUST_FFI_PASS 20+22=42");
    }
}
