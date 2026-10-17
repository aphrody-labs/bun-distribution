import ghidra.app.script.GhidraScript;

public class SmokeSummary extends GhidraScript {
    @Override
    public void run() {
        println("SMOKE_NAME=" + currentProgram.getName());
        println("SMOKE_LANGUAGE=" + currentProgram.getLanguageID());
        println("SMOKE_FUNCTIONS=" + currentProgram.getFunctionManager().getFunctionCount());
        println("SMOKE_INSTRUCTIONS=" + currentProgram.getListing().getNumInstructions());
    }
}
