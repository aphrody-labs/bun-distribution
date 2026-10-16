package com.aphrody.android;

import java.lang.foreign.Arena;
import java.lang.foreign.FunctionDescriptor;
import java.lang.foreign.Linker;
import java.lang.foreign.SymbolLookup;
import java.lang.foreign.ValueLayout;
import java.nio.file.Path;

public final class ForeignSmoke {
    public static void main(String[] args) throws Throwable {
        Path library = Path.of(args.length == 0
                ? "target/rust/debug/android_native.dll" : args[0]).toAbsolutePath();
        try (Arena arena = Arena.ofConfined()) {
            var symbols = SymbolLookup.libraryLookup(library, arena);
            var add = Linker.nativeLinker().downcallHandle(
                    symbols.find("android_add").orElseThrow(),
                    FunctionDescriptor.of(ValueLayout.JAVA_INT,
                            ValueLayout.JAVA_INT, ValueLayout.JAVA_INT));
            int answer = (int) add.invokeExact(20, 22);
            int saturated = (int) add.invokeExact(Integer.MAX_VALUE, 1);
            if (answer != 42 || saturated != Integer.MAX_VALUE) {
                throw new AssertionError("Java FFM addition failed");
            }
            System.out.println("JAVA_RUST_FFM_PASS 20+22=42");
        }
    }
}
