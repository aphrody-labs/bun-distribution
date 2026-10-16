//! procps (Linux): uutils procps from `vendor/uutils/procps`.

crate::uu_result_applets! {
uucore_procps: [
    "free" => uu_free,
    "hugetop" => uu_hugetop,
    "pgrep" => uu_pgrep,
    "pidof" => uu_pidof,
    "pidwait" => uu_pidwait,
    "pkill" => uu_pkill,
    "pmap" => uu_pmap,
    "ps" => uu_ps,
    "pwdx" => uu_pwdx,
    "skill" => uu_skill,
    "slabtop" => uu_slabtop,
    "snice" => uu_snice,
    "sysctl" => uu_sysctl,
    "tload" => uu_tload,
    "top" => uu_top,
    "vmstat" => uu_vmstat,
    "w" => uu_w,
    "watch" => uu_watch,
]
}
