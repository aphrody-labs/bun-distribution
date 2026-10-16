//! util-linux (Linux): uutils util-linux from `vendor/uutils/util-linux`.

crate::uu_result_applets! {
uucore_util_linux: [
    "blockdev" => uu_blockdev,
    "cal" => uu_cal,
    "chcpu" => uu_chcpu,
    "ctrlaltdel" => uu_ctrlaltdel,
    "dmesg" => uu_dmesg,
    "fsfreeze" => uu_fsfreeze,
    "hexdump" => uu_hexdump,
    "lscpu" => uu_lscpu,
    "lsipc" => uu_lsipc,
    "lslocks" => uu_lslocks,
    "lsmem" => uu_lsmem,
    "lsns" => uu_lsns,
    "mcookie" => uu_mcookie,
    "mesg" => uu_mesg,
    "mountpoint" => uu_mountpoint,
    "nologin" => uu_nologin,
    "rename" => uu_rename,
    "renice" => uu_renice,
    "rev" => uu_rev,
    "setpgid" => uu_setpgid,
    "setsid" => uu_setsid,
    "uuidgen" => uu_uuidgen,
]
}
