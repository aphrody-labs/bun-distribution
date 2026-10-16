//! binutils: read-only object inspection on `object` and `addr2line` (gimli): `nm`, `size`,
//! `readelf`, `objdump`, `strings`, `addr2line`, `ar`. ELF, PE/COFF, Mach-O, Wasm and archives.

use std::ffi::OsString;

use object::read::archive::ArchiveFile;
use object::{Object, ObjectSection, ObjectSymbol, SymbolKind};

pub const APPLETS: &[(&str, super::Main)] = &[
    ("nm", nm),
    ("size", size),
    ("readelf", readelf),
    ("objdump", objdump),
    ("strings", strings),
    ("addr2line", addr2line),
    ("ar", ar),
];

fn split(args: &[OsString]) -> (Vec<String>, Vec<OsString>) {
    let mut flags = Vec::new();
    let mut files = Vec::new();
    for arg in args.iter().skip(1) {
        match arg.to_str() {
            Some(flag) if flag.starts_with('-') && flag.len() > 1 => flags.push(flag.to_owned()),
            _ => files.push(arg.clone()),
        }
    }
    (flags, files)
}

fn each_object(tool: &str, files: &[OsString], mut f: impl FnMut(&str, &object::File<'_>)) -> i32 {
    let mut code = 0;
    for path in files {
        let name = path.to_string_lossy();
        let data = match std::fs::read(path) {
            Ok(data) => data,
            Err(err) => {
                eprintln!("{tool}: {name}: {err}");
                code = 1;
                continue;
            }
        };
        match object::File::parse(&*data) {
            Ok(file) => f(&name, &file),
            Err(err) => {
                eprintln!("{tool}: {name}: {err}");
                code = 1;
            }
        }
    }
    code
}

fn demangle(name: &str) -> String {
    rustc_demangle::try_demangle(name).map_or_else(|_| name.to_owned(), |d| format!("{d:#}"))
}

fn nm(args: Vec<OsString>) -> i32 {
    let (flags, files) = split(&args);
    let undefined_only = flags.iter().any(|f| f == "-u");
    let demangled = flags.iter().any(|f| f == "-C");
    let many = files.len() > 1;
    each_object("nm", &files, |name, file| {
        if many {
            println!("\n{name}:");
        }
        let mut symbols: Vec<_> = file.symbols().chain(file.dynamic_symbols()).collect();
        symbols.sort_by_key(|s| s.address());
        for symbol in symbols {
            let Ok(sym) = symbol.name() else { continue };
            if sym.is_empty() || matches!(symbol.kind(), SymbolKind::File | SymbolKind::Section) {
                continue;
            }
            if undefined_only && !symbol.is_undefined() {
                continue;
            }
            let mut code = if symbol.is_undefined() {
                'U'
            } else {
                match symbol.kind() {
                    SymbolKind::Text => 't',
                    SymbolKind::Data => 'd',
                    SymbolKind::Tls => 'b',
                    _ => '?',
                }
            };
            if symbol.is_global() {
                code = code.to_ascii_uppercase();
            }
            let sym = if demangled { demangle(sym) } else { sym.to_owned() };
            if symbol.is_undefined() {
                println!("{:>16} {code} {sym}", "");
            } else {
                println!("{:016x} {code} {sym}", symbol.address());
            }
        }
    })
}

fn size(args: Vec<OsString>) -> i32 {
    let (_, files) = split(&args);
    println!("{:>10} {:>10} {:>10} {:>10} filename", "text", "data", "bss", "dec");
    each_object("size", &files, |name, file| {
        use object::SectionKind as K;
        let (mut text, mut data, mut bss) = (0u64, 0u64, 0u64);
        for section in file.sections() {
            match section.kind() {
                K::Text | K::ReadOnlyData | K::ReadOnlyString | K::ReadOnlyDataWithRel => {
                    text += section.size();
                }
                K::Data | K::Tls => data += section.size(),
                K::UninitializedData | K::UninitializedTls => bss += section.size(),
                _ => {}
            }
        }
        println!("{text:>10} {data:>10} {bss:>10} {:>10} {name}", text + data + bss);
    })
}

fn headers(name: &str, file: &object::File<'_>) {
    println!("{name}:");
    println!("  Format:       {:?}", file.format());
    println!("  Architecture: {:?}", file.architecture());
    println!("  Endianness:   {}", if file.is_little_endian() { "little" } else { "big" });
    println!("  64-bit:       {}", file.is_64());
    println!("  Kind:         {:?}", file.kind());
    println!("  Entry point:  {:#x}", file.entry());
}

fn sections(file: &object::File<'_>) {
    println!("{:>4} {:<24} {:>16} {:>10} kind", "Idx", "Name", "Address", "Size");
    for section in file.sections() {
        println!(
            "{:>4} {:<24} {:016x} {:010x} {:?}",
            section.index().0,
            section.name().unwrap_or("?"),
            section.address(),
            section.size(),
            section.kind()
        );
    }
}

fn readelf(args: Vec<OsString>) -> i32 {
    let (flags, files) = split(&args);
    let all = flags.is_empty() || flags.iter().any(|f| f == "-a");
    let want = |f: &str| all || flags.iter().any(|x| x == f);
    each_object("readelf", &files, |name, file| {
        if want("-h") {
            headers(name, file);
        }
        if want("-S") {
            sections(file);
        }
    })
}

fn objdump(args: Vec<OsString>) -> i32 {
    let (flags, files) = split(&args);
    if flags.is_empty() {
        eprintln!("objdump: usage: objdump -f|-h|-t FILE...");
        return 2;
    }
    let has = |f: &str| flags.iter().any(|x| x == f);
    each_object("objdump", &files, |name, file| {
        if has("-f") {
            headers(name, file);
        }
        if has("-h") {
            sections(file);
        }
        if has("-t") {
            for symbol in file.symbols() {
                println!(
                    "{:016x} {:?} {}",
                    symbol.address(),
                    symbol.kind(),
                    symbol.name().unwrap_or("?")
                );
            }
        }
    })
}

fn strings(args: Vec<OsString>) -> i32 {
    let (flags, files) = split(&args);
    let min = flags
        .iter()
        .find_map(|f| f.strip_prefix("-n").and_then(|n| n.parse().ok()))
        .unwrap_or(4usize);
    let mut code = 0;
    for path in &files {
        let Ok(data) = std::fs::read(path) else {
            eprintln!("strings: {}: cannot read", path.to_string_lossy());
            code = 1;
            continue;
        };
        for run in data.split(|b| !(b.is_ascii_graphic() || *b == b' ' || *b == b'\t')) {
            if run.len() >= min {
                println!("{}", String::from_utf8_lossy(run));
            }
        }
    }
    code
}

fn addr2line(args: Vec<OsString>) -> i32 {
    let mut exe: Option<OsString> = None;
    let mut functions = false;
    let mut addresses = Vec::new();
    let mut iter = args.iter().skip(1);
    while let Some(arg) = iter.next() {
        match arg.to_str() {
            Some("-e") => exe = iter.next().cloned(),
            Some("-f") => functions = true,
            Some(other) => addresses.push(other.to_owned()),
            None => {}
        }
    }
    let exe = exe.unwrap_or_else(|| "a.out".into());
    let loader = match addr2line::Loader::new(&exe) {
        Ok(loader) => loader,
        Err(err) => {
            eprintln!("addr2line: {}: {err}", exe.to_string_lossy());
            return 1;
        }
    };
    for address in addresses {
        let Ok(probe) = u64::from_str_radix(address.trim_start_matches("0x"), 16) else {
            eprintln!("addr2line: {address}: not a hex address");
            continue;
        };
        if functions {
            let name = loader.find_symbol(probe).map_or_else(|| "??".into(), demangle);
            println!("{name}");
        }
        match loader.find_location(probe) {
            Ok(Some(location)) => println!(
                "{}:{}",
                location.file.unwrap_or("??"),
                location.line.map_or_else(|| "?".into(), |l| l.to_string())
            ),
            _ => println!("??:0"),
        }
    }
    0
}

fn ar(args: Vec<OsString>) -> i32 {
    let (Some(op), Some(path)) = (args.get(1).and_then(|a| a.to_str()), args.get(2)) else {
        eprintln!("ar: usage: ar t|p ARCHIVE [MEMBER...]");
        return 2;
    };
    let data = match std::fs::read(path) {
        Ok(data) => data,
        Err(err) => {
            eprintln!("ar: {}: {err}", path.to_string_lossy());
            return 1;
        }
    };
    let archive = match ArchiveFile::parse(&*data) {
        Ok(archive) => archive,
        Err(err) => {
            eprintln!("ar: {}: {err}", path.to_string_lossy());
            return 1;
        }
    };
    let wanted: Vec<String> = args.iter().skip(3).map(|a| a.to_string_lossy().into_owned()).collect();
    for member in archive.members().flatten() {
        let name = String::from_utf8_lossy(member.name()).into_owned();
        if !wanted.is_empty() && !wanted.contains(&name) {
            continue;
        }
        match op.trim_start_matches('-') {
            "t" => println!("{name}"),
            "p" => {
                if let Ok(bytes) = member.data(&*data) {
                    use std::io::Write as _;
                    let _ = std::io::stdout().write_all(bytes);
                }
            }
            _ => {
                eprintln!("ar: only t and p are supported (read-only)");
                return 2;
            }
        }
    }
    0
}
