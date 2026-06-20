// Headless decompile dump — fully automatic, no GUI.
// Decompiles every function and writes C to decomp.c; also dumps defined strings.
import ghidra.app.script.GhidraScript;
import ghidra.app.decompiler.DecompInterface;
import ghidra.app.decompiler.DecompileResults;
import ghidra.program.model.listing.Function;
import ghidra.program.model.listing.Data;
import ghidra.program.model.listing.DataIterator;
import java.io.PrintWriter;

public class DumpDecomp extends GhidraScript {
    public void run() throws Exception {
        String out = System.getProperty("user.dir");
        PrintWriter c = new PrintWriter(getScriptArgs().length > 0 ? getScriptArgs()[0] : "decomp.c");
        DecompInterface di = new DecompInterface();
        di.openProgram(currentProgram);
        int n = 0;
        for (Function f : currentProgram.getFunctionManager().getFunctions(true)) {
            if (monitor.isCancelled()) break;
            DecompileResults r = di.decompileFunction(f, 45, monitor);
            if (r != null && r.decompileCompleted()) {
                c.println("// ==== " + f.getName() + " @ " + f.getEntryPoint() + " ====");
                c.println(r.getDecompiledFunction().getC());
                n++;
            }
        }
        c.close();
        println("DumpDecomp: decompiled " + n + " functions");
    }
}
