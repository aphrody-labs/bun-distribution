// SPDX-License-Identifier: Apache-2.0
//! Ghidra headless adapter (`GHIDRA_INSTALL_DIR`): imports the payload, runs auto-analysis and exports
//! the function list and decompiled C through an embedded post-script. Architecture-agnostic, so it is
//! the path for ARM/MIPS/PPC/firmware inputs the built-in x86 lifter does not cover.

use super::contract::{Stage, StageReport, StageStatus};
use super::registry::{AdapterInfo, AdapterKind, AdapterStatus, Ctx, Options, StageAdapter, list_files, report};
use super::util::{run_cmd, tail};
use std::path::PathBuf;
use std::time::Duration;

const SCRIPT_NAME: &str = "BunReExport.java";

const SCRIPT: &str = r#"import ghidra.app.script.GhidraScript;
import ghidra.app.decompiler.DecompInterface;
import ghidra.app.decompiler.DecompileResults;
import ghidra.program.model.listing.Function;
import java.io.File;
import java.io.PrintWriter;

public class BunReExport extends GhidraScript {
    @Override
    public void run() throws Exception {
        String[] args = getScriptArgs();
        File out = new File(args[0]);
        out.mkdirs();
        DecompInterface di = new DecompInterface();
        di.openProgram(currentProgram);
        try (PrintWriter fn = new PrintWriter(new File(out, "functions.jsonl"));
             PrintWriter c = new PrintWriter(new File(out, "decompiled.c"))) {
            for (Function f : currentProgram.getFunctionManager().getFunctions(true)) {
                fn.println("{\"name\":\"" + f.getName() + "\",\"entry\":\"" + f.getEntryPoint()
                    + "\",\"size\":" + f.getBody().getNumAddresses() + "}");
                DecompileResults r = di.decompileFunction(f, 60, monitor);
                if (r.decompileCompleted()) {
                    c.println(r.getDecompiledFunction().getC());
                }
            }
        }
    }
}
"#;

/// Ghidra headless adapter for one stage (`Analyze` runs it, `Decompile` publishes its C export).
pub struct Ghidra {
    /// Stage served.
    pub stage: Stage,
}

fn launcher() -> Result<PathBuf, String> {
    let dir = std::env::var_os("GHIDRA_INSTALL_DIR").ok_or("GHIDRA_INSTALL_DIR is not set")?;
    let dir = PathBuf::from(dir);
    if !dir.is_dir() {
        return Err(format!("GHIDRA_INSTALL_DIR points to missing directory {}", dir.display()));
    }
    let name = if cfg!(windows) { "analyzeHeadless.bat" } else { "analyzeHeadless" };
    let p = dir.join("support").join(name);
    if p.is_file() { Ok(p) } else { Err(format!("{} not found", p.display())) }
}

impl StageAdapter for Ghidra {
    fn id(&self) -> &str {
        if self.stage == Stage::Analyze { "ghidra-headless" } else { "ghidra-headless-decompile" }
    }

    fn stage(&self) -> Stage {
        self.stage
    }

    fn info(&self, opts: &Options) -> AdapterInfo {
        let (status, reason) = match launcher() {
            Err(r) => (AdapterStatus::Unavailable, Some(r)),
            Ok(_) if opts.external => (AdapterStatus::Ready, None),
            Ok(_) => (AdapterStatus::Registered, Some("installed; enable with --external".to_string())),
        };
        AdapterInfo {
            id: self.id().to_string(),
            stage: self.stage,
            kind: AdapterKind::Env,
            owner: "GHIDRA_INSTALL_DIR".to_string(),
            handles: vec!["*".to_string()],
            status,
            reason,
        }
    }

    fn applies(&self, _ctx: &Ctx) -> bool {
        true
    }

    fn run(&self, ctx: &mut Ctx) -> StageReport {
        let id = self.id();
        if self.stage == Stage::Decompile {
            return match &ctx.ghidra_out {
                Some(d) if d.join("decompiled.c").is_file() => {
                    let mut r = report(self.stage, id, StageStatus::Ok, "decompiled C exported by Ghidra");
                    r.artifacts = list_files(d, "c");
                    r
                }
                _ => report(self.stage, id, StageStatus::Skipped, "Ghidra analysis produced no export"),
            };
        }
        let launcher = match launcher() {
            Ok(l) => l,
            Err(e) => return report(self.stage, id, StageStatus::Unavailable, e),
        };
        let Some(input) = ctx.effective_path() else {
            return report(self.stage, id, StageStatus::Skipped, "no input available");
        };
        let work = ctx.dir("analyze").join("ghidra");
        let scripts = work.join("scripts");
        let out = work.join("export");
        let proj = work.join("project");
        for d in [&scripts, &out, &proj] {
            if let Err(e) = std::fs::create_dir_all(d) {
                return report(self.stage, id, StageStatus::Failed, e.to_string());
            }
        }
        if let Err(e) = std::fs::write(scripts.join(SCRIPT_NAME), SCRIPT) {
            return report(self.stage, id, StageStatus::Failed, e.to_string());
        }
        let args: Vec<String> = [
            proj.display().to_string(),
            "bunre".into(),
            "-import".into(),
            input.display().to_string(),
            "-overwrite".into(),
            "-analysisTimeoutPerFile".into(),
            "600".into(),
            "-scriptPath".into(),
            scripts.display().to_string(),
            "-postScript".into(),
            SCRIPT_NAME.into(),
            out.display().to_string(),
            "-deleteProject".into(),
        ]
        .into();
        match run_cmd(&launcher, &args, Some(&work), &[], Duration::from_secs(ctx.opts.timeout_secs)) {
            Err(e) => report(self.stage, id, StageStatus::Failed, e),
            Ok(r) => {
                let exported = out.join("decompiled.c").is_file();
                let status = if r.ok() && exported { StageStatus::Ok } else { StageStatus::Failed };
                if exported {
                    ctx.ghidra_out = Some(out.clone());
                }
                let mut rep = report(
                    self.stage,
                    id,
                    status,
                    if r.timed_out { "timed out".to_string() } else { format!("exit {:?}: {}", r.code, tail(&r.stdout, 300)) },
                );
                rep.artifacts = list_files(&out, "export");
                rep
            }
        }
    }
}
