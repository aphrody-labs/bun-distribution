//! coreutils: uutils coreutils (MIT) applets, `uumain` per crate.

use std::ffi::OsString;

macro_rules! applets {
    (all: [$($name:literal => $krate:ident,)*] unix: [$($uname:literal => $ukrate:ident,)*]) => {
        pub const APPLETS: &[(&str, super::Main)] = &[
            $(($name, |args: Vec<OsString>| $krate::uumain(args.into_iter())),)*
            $(#[cfg(unix)] ($uname, |args: Vec<OsString>| $ukrate::uumain(args.into_iter())),)*
        ];
    };
}

applets! {
all: [
    "base32" => uu_base32,
    "base64" => uu_base64,
    "basename" => uu_basename,
    "cat" => uu_cat,
    "cksum" => uu_cksum,
    "comm" => uu_comm,
    "cp" => uu_cp,
    "cut" => uu_cut,
    "date" => uu_date,
    "dd" => uu_dd,
    "df" => uu_df,
    "dirname" => uu_dirname,
    "du" => uu_du,
    "echo" => uu_echo,
    "env" => uu_env,
    "expand" => uu_expand,
    "expr" => uu_expr,
    "factor" => uu_factor,
    "false" => uu_false,
    "fmt" => uu_fmt,
    "fold" => uu_fold,
    "head" => uu_head,
    "join" => uu_join,
    "link" => uu_link,
    "ln" => uu_ln,
    "ls" => uu_ls,
    "mkdir" => uu_mkdir,
    "mktemp" => uu_mktemp,
    "mv" => uu_mv,
    "nl" => uu_nl,
    "nproc" => uu_nproc,
    "numfmt" => uu_numfmt,
    "od" => uu_od,
    "paste" => uu_paste,
    "pr" => uu_pr,
    "printenv" => uu_printenv,
    "printf" => uu_printf,
    "pwd" => uu_pwd,
    "readlink" => uu_readlink,
    "realpath" => uu_realpath,
    "rm" => uu_rm,
    "rmdir" => uu_rmdir,
    "seq" => uu_seq,
    "shred" => uu_shred,
    "shuf" => uu_shuf,
    "sleep" => uu_sleep,
    "sort" => uu_sort,
    "split" => uu_split,
    "sum" => uu_sum,
    "tac" => uu_tac,
    "tail" => uu_tail,
    "tee" => uu_tee,
    "test" => uu_test,
    "touch" => uu_touch,
    "tr" => uu_tr,
    "true" => uu_true,
    "truncate" => uu_truncate,
    "tsort" => uu_tsort,
    "uname" => uu_uname,
    "unexpand" => uu_unexpand,
    "uniq" => uu_uniq,
    "unlink" => uu_unlink,
    "wc" => uu_wc,
    "whoami" => uu_whoami,
    "yes" => uu_yes,
]
unix: [
    "chmod" => uu_chmod,
    "chown" => uu_chown,
    "chgrp" => uu_chgrp,
    "id" => uu_id,
    "install" => uu_install,
    "kill" => uu_kill,
    "mkfifo" => uu_mkfifo,
    "nohup" => uu_nohup,
    "stat" => uu_stat,
    "sync" => uu_sync,
    "timeout" => uu_timeout,
    "tty" => uu_tty,
    "uptime" => uu_uptime,
]
}
