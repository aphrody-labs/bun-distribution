//! diffutils: `diff` (unified) and `cmp`, on `similar`.

use std::ffi::OsString;

pub const APPLETS: &[(&str, super::Main)] = &[("diff", diff), ("cmp", cmp)];

fn operands(args: &[OsString]) -> (Vec<String>, Vec<OsString>) {
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

fn read(name: &str, path: &OsString) -> Result<Vec<u8>, i32> {
    if path == "-" {
        let mut buf = Vec::new();
        std::io::Read::read_to_end(&mut std::io::stdin(), &mut buf).map(|_| buf)
    } else {
        std::fs::read(path)
    }
    .map_err(|err| {
        eprintln!("{name}: {}: {err}", path.to_string_lossy());
        2
    })
}

fn diff(args: Vec<OsString>) -> i32 {
    let (flags, files) = operands(&args);
    let [a, b] = files.as_slice() else {
        eprintln!("diff: usage: diff [-u] [-q] FILE1 FILE2");
        return 2;
    };
    let (Ok(left), Ok(right)) = (read("diff", a), read("diff", b)) else {
        return 2;
    };
    if left == right {
        return 0;
    }
    if flags.iter().any(|f| f == "-q" || f == "--brief") {
        println!("Files {} and {} differ", a.to_string_lossy(), b.to_string_lossy());
        return 1;
    }
    let (left, right) = (String::from_utf8_lossy(&left), String::from_utf8_lossy(&right));
    let diff = similar::TextDiff::from_lines(left.as_ref(), right.as_ref());
    print!(
        "{}",
        diff.unified_diff()
            .context_radius(3)
            .header(&a.to_string_lossy(), &b.to_string_lossy())
    );
    1
}

fn cmp(args: Vec<OsString>) -> i32 {
    let (flags, files) = operands(&args);
    let silent = flags.iter().any(|f| f == "-s" || f == "--silent" || f == "--quiet");
    let [a, b] = files.as_slice() else {
        eprintln!("cmp: usage: cmp [-s] FILE1 FILE2");
        return 2;
    };
    let (Ok(left), Ok(right)) = (read("cmp", a), read("cmp", b)) else {
        return 2;
    };
    let mut line = 1usize;
    for (index, (x, y)) in left.iter().zip(&right).enumerate() {
        if x != y {
            if !silent {
                println!(
                    "{} {} differ: byte {}, line {line}",
                    a.to_string_lossy(),
                    b.to_string_lossy(),
                    index + 1
                );
            }
            return 1;
        }
        line += usize::from(*x == b'\n');
    }
    if left.len() != right.len() {
        if !silent {
            let short = if left.len() < right.len() { a } else { b };
            eprintln!("cmp: EOF on {}", short.to_string_lossy());
        }
        return 1;
    }
    0
}
