//! binutils writers: `strip` and `objcopy` (ELF, through `object::build::elf`) and `ar r|q|d`
//! (GNU archives, through `object` for reading and `ar` for writing).

use std::ffi::OsString;
use std::path::{Path, PathBuf};

use object::read::archive::ArchiveFile;

crate::applets! {
    "strip" => strip,
    "objcopy" => objcopy,
    "ar" => ar,
}

#[derive(Default)]
struct Edit {
    strip_debug: bool,
    strip_all: bool,
    remove: Vec<Vec<u8>>,
}

fn is_debug(name: &[u8]) -> bool {
    name.starts_with(b".debug") || name.starts_with(b".zdebug") || name.starts_with(b".gnu.debug")
}

fn rewrite(edit: &Edit, data: &[u8]) -> Result<Vec<u8>, String> {
    let mut builder = object::build::elf::Builder::read(data).map_err(|e| e.to_string())?;
    for section in builder.sections.iter_mut() {
        let name = section.name.as_slice();
        if (edit.strip_debug || edit.strip_all) && is_debug(name)
            || edit.strip_all && (name == b".symtab" || name == b".strtab")
            || edit.remove.iter().any(|r| r.as_slice() == name)
        {
            section.delete = true;
        }
    }
    if edit.strip_all {
        for symbol in builder.symbols.iter_mut() {
            symbol.delete = true;
        }
    }
    builder.delete_orphans();
    let mut out = Vec::new();
    builder.write(&mut out).map_err(|e| e.to_string())?;
    Ok(out)
}

fn apply(tool: &str, edit: &Edit, input: &Path, output: &Path) -> i32 {
    let result = std::fs::read(input)
        .map_err(|e| e.to_string())
        .and_then(|data| rewrite(edit, &data))
        .and_then(|bytes| std::fs::write(output, bytes).map_err(|e| e.to_string()));
    match result {
        Ok(()) => 0,
        Err(err) => {
            eprintln!("{tool}: {}: {err}", input.display());
            1
        }
    }
}

fn strip(args: Vec<OsString>) -> i32 {
    let mut edit = Edit { strip_all: true, ..Edit::default() };
    let mut output: Option<PathBuf> = None;
    let mut files = Vec::new();
    let mut iter = args.into_iter().skip(1);
    while let Some(arg) = iter.next() {
        match arg.to_str() {
            Some("-g" | "-S" | "-d" | "--strip-debug") => {
                edit.strip_debug = true;
                edit.strip_all = false;
            }
            Some("-s" | "--strip-all") => edit.strip_all = true,
            Some("-o") => output = iter.next().map(PathBuf::from),
            Some("-R") => edit.remove.extend(iter.next().map(|n| n.to_string_lossy().into_owned().into_bytes())),
            _ => files.push(PathBuf::from(arg)),
        }
    }
    if output.is_some() && files.len() != 1 {
        eprintln!("strip: -o needs exactly one input");
        return 2;
    }
    let mut code = 0;
    for file in &files {
        code |= apply("strip", &edit, file, output.as_deref().unwrap_or(file));
    }
    code
}

fn objcopy(args: Vec<OsString>) -> i32 {
    let mut edit = Edit::default();
    let mut files = Vec::new();
    let mut iter = args.into_iter().skip(1);
    while let Some(arg) = iter.next() {
        let text = arg.to_string_lossy().into_owned();
        match text.as_str() {
            "-g" | "--strip-debug" => edit.strip_debug = true,
            "-S" | "--strip-all" => edit.strip_all = true,
            "-R" | "--remove-section" => {
                edit.remove.extend(iter.next().map(|n| n.to_string_lossy().into_owned().into_bytes()));
            }
            _ if text.starts_with("--remove-section=") => {
                edit.remove.push(text["--remove-section=".len()..].as_bytes().to_vec());
            }
            _ if text.starts_with('-') => {
                eprintln!("objcopy: unsupported option {text}");
                return 2;
            }
            _ => files.push(PathBuf::from(arg)),
        }
    }
    match files.as_slice() {
        [input] => apply("objcopy", &edit, input, input),
        [input, output] => apply("objcopy", &edit, input, output),
        _ => {
            eprintln!("objcopy: usage: objcopy [-g|-S|-R SECTION]... IN [OUT]");
            2
        }
    }
}

/// Existing members of `archive` as (name, bytes); empty when the file does not exist.
fn members(archive: &Path) -> Result<Vec<(Vec<u8>, Vec<u8>)>, String> {
    let data = match std::fs::read(archive) {
        Ok(data) => data,
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(err) => return Err(err.to_string()),
    };
    let parsed = ArchiveFile::parse(&*data).map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for member in parsed.members() {
        let member = member.map_err(|e| e.to_string())?;
        let bytes = member.data(&*data).map_err(|e| e.to_string())?;
        out.push((member.name().to_vec(), bytes.to_vec()));
    }
    Ok(out)
}

fn write_archive(archive: &Path, entries: &[(Vec<u8>, Vec<u8>)]) -> Result<(), String> {
    let names: Vec<Vec<u8>> = entries.iter().map(|(n, _)| n.clone()).collect();
    let file = std::fs::File::create(archive).map_err(|e| e.to_string())?;
    let mut builder = ar::GnuBuilder::new(file, names);
    for (name, bytes) in entries {
        let header = ar::Header::new(name.clone(), bytes.len() as u64);
        builder.append(&header, bytes.as_slice()).map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// `ar t|p` reads; `ar r|q|d` writes. Returns `None` for read operations.
pub fn ar_write(op: &str, archive: &Path, operands: &[OsString]) -> Option<i32> {
    let op = op.trim_start_matches('-');
    let mode = op.chars().find(|c| matches!(c, 'r' | 'q' | 'd'))?;
    let result = (|| {
        let mut entries = members(archive)?;
        for operand in operands {
            let path = Path::new(operand);
            let name = path
                .file_name()
                .map(|n| n.to_string_lossy().into_owned().into_bytes())
                .unwrap_or_default();
            match mode {
                'd' => entries.retain(|(n, _)| *n != name),
                _ => {
                    let bytes = std::fs::read(path).map_err(|e| format!("{}: {e}", path.display()))?;
                    match entries.iter_mut().find(|(n, _)| *n == name) {
                        Some(entry) if mode == 'r' => entry.1 = bytes,
                        _ => entries.push((name, bytes)),
                    }
                }
            }
        }
        write_archive(archive, &entries)
    })();
    Some(match result {
        Ok(()) => 0,
        Err(err) => {
            eprintln!("ar: {}: {err}", archive.display());
            1
        }
    })
}

fn ar(args: Vec<OsString>) -> i32 {
    if let (Some(op), Some(archive)) = (args.get(1).and_then(|a| a.to_str()), args.get(2))
        && let Some(code) = ar_write(op, Path::new(archive), &args[3..])
    {
        return code;
    }
    super::binutils::ar_read(args)
}
