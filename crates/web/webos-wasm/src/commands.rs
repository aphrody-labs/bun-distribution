// SPDX-License-Identifier: Apache-2.0
//! Shell commands of the WebOS terminal that reach the Rust capability crates: binary triage,
//! printable strings, patch application, document search and language detection, all on the
//! shared file system.

use std::rc::Rc;

use aphrody_shell_vfs::{Vfs, path as vpath};
use aphrody_shell_web::{
    local::{LocalShell, ShellCommand},
    opfs::SharedOpfsVfs,
};

use crate::{apply_patch_json, rag, rpc, triage_json};

const STRINGS_MIN: usize = 4;
const STRINGS_LIMIT: usize = 200;
const SEARCH_LIMIT: usize = 10;

fn read_arg(
    fs: &mut SharedOpfsVfs,
    shell: &LocalShell,
    args: &[String],
) -> Result<Vec<u8>, String> {
    let name = args.first().ok_or("missing file operand")?;
    let path = vpath::resolve(shell.cwd(), name.as_bytes()).map_err(|e| e.to_string())?;
    fs.read(&path).map_err(|e| format!("{name}: {e}"))
}

struct Triage(SharedOpfsVfs);

impl ShellCommand for Triage {
    fn run(&self, shell: &mut LocalShell, args: &[String], _: &[u8]) -> Result<Vec<u8>, String> {
        let bytes = read_arg(&mut self.0.clone(), shell, args)?;
        Ok(format!("{}\n", triage_json(&bytes)?).into_bytes())
    }
}

struct Strings(SharedOpfsVfs);

impl ShellCommand for Strings {
    fn run(&self, shell: &mut LocalShell, args: &[String], _: &[u8]) -> Result<Vec<u8>, String> {
        let bytes = read_arg(&mut self.0.clone(), shell, args)?;
        let min = args.get(1).and_then(|s| s.parse().ok()).unwrap_or(STRINGS_MIN);
        let mut out = String::new();
        for s in aphrody_re::extract_strings(&bytes, min, STRINGS_LIMIT) {
            out.push_str(&serde_json::to_value(&s).map_err(|e| e.to_string())?.to_string());
            out.push('\n');
        }
        Ok(out.into_bytes())
    }
}

/// `apply-patch` reads a `*** Begin Patch` document from standard input.
struct ApplyPatch(SharedOpfsVfs);

impl ShellCommand for ApplyPatch {
    fn run(&self, shell: &mut LocalShell, _: &[String], stdin: &[u8]) -> Result<Vec<u8>, String> {
        let patch = std::str::from_utf8(stdin).map_err(|e| e.to_string())?;
        Ok(format!("{}\n", apply_patch_json(&self.0, patch, shell.cwd())?).into_bytes())
    }
}

struct Search(SharedOpfsVfs);

impl ShellCommand for Search {
    fn run(&self, _: &mut LocalShell, args: &[String], _: &[u8]) -> Result<Vec<u8>, String> {
        if args.is_empty() {
            return Err("usage: search WORDS...".into());
        }
        let hits = rag::search(&mut self.0.clone(), rpc::HOME, &args.join(" "), SEARCH_LIMIT);
        let mut out = String::new();
        for hit in hits["results"].as_array().into_iter().flatten() {
            out.push_str(&format!(
                "{}:{}-{}  {:.2}\n",
                hit["path"].as_str().unwrap_or_default(),
                hit["start_line"],
                hit["end_line"],
                hit["score"].as_f64().unwrap_or(0.0)
            ));
        }
        Ok(out.into_bytes())
    }
}

/// `detect-lang [FILE]` names the language of a file, or of standard input without operand.
struct DetectLang(SharedOpfsVfs);

impl ShellCommand for DetectLang {
    fn run(
        &self,
        shell: &mut LocalShell,
        args: &[String],
        stdin: &[u8],
    ) -> Result<Vec<u8>, String> {
        let bytes = if args.is_empty() {
            stdin.to_vec()
        } else {
            read_arg(&mut self.0.clone(), shell, args)?
        };
        Ok(format!(
            "{}
",
            crate::detect_language_json(&String::from_utf8_lossy(&bytes))?
        )
        .into_bytes())
    }
}

/// Add `triage`, `strings`, `apply-patch`, `search` and `detect-lang` to a shell working on `fs`.
pub(crate) fn register(shell: &mut LocalShell, fs: &SharedOpfsVfs) {
    shell.register_command("triage", Rc::new(Triage(fs.clone())));
    shell.register_command("strings", Rc::new(Strings(fs.clone())));
    shell.register_command("apply-patch", Rc::new(ApplyPatch(fs.clone())));
    shell.register_command("search", Rc::new(Search(fs.clone())));
    shell.register_command("detect-lang", Rc::new(DetectLang(fs.clone())));
}
