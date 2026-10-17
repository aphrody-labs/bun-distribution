import ghidra.app.decompiler.DecompInterface;
import ghidra.app.decompiler.DecompileResults;
import ghidra.app.script.GhidraScript;
import ghidra.program.model.listing.Function;

public class SmokeNativeExports extends GhidraScript {
    @Override
    public void run() throws Exception {
        DecompInterface decompiler = new DecompInterface();
        decompiler.openProgram(currentProgram);
        int found = 0;
        for (Function function : currentProgram.getFunctionManager().getFunctions(true)) {
            if (function.getName().equals("android_add") || function.getName().equals("Java_com_aphrody_android_NativeBridge_add")) {
                found++;
                println("NATIVE_EXPORT=" + function.getName() + " ADDRESS=" + function.getEntryPoint());
                DecompileResults result = decompiler.decompileFunction(function, 20, monitor);
                if (!result.decompileCompleted()) {
                    throw new Exception("Native export decompilation failed: " + result.getErrorMessage());
                }
                println("NATIVE_DECOMPILE=" + result.getDecompiledFunction().getC());
            }
        }
        decompiler.dispose();
        if (found != 2) {
            throw new Exception("Expected two native exports, found " + found);
        }
        println("NATIVE_EXPORTS_PASS");
    }
}
