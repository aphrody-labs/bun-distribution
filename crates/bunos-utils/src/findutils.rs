//! findutils: `find` and `xargs` from uutils findutils (MIT).

use std::ffi::OsString;

crate::applets! {
    "find" => find,
    "xargs" => xargs,
}

fn strings(args: &[OsString]) -> Vec<String> {
    args.iter().map(|a| a.to_string_lossy().into_owned()).collect()
}

fn find(args: Vec<OsString>) -> i32 {
    let args = strings(&args);
    let args: Vec<&str> = args.iter().map(String::as_str).collect();
    findutils::find::find_main(&args, &findutils::find::StandardDependencies::new())
}

fn xargs(args: Vec<OsString>) -> i32 {
    let args = strings(&args);
    let args: Vec<&str> = args.iter().map(String::as_str).collect();
    findutils::xargs::xargs_main(&args)
}
