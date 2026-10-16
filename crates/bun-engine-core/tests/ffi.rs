use bun_engine::ffi::{
    ABI_VERSION, BunEngineBinaryInfo, bun_engine_abi_version, bun_engine_inspect,
};

#[test]
fn ffi_rejects_null_pointers() {
    let mut output = BunEngineBinaryInfo::default();
    assert_eq!(bun_engine_abi_version(), ABI_VERSION);
    assert_eq!(
        unsafe { bun_engine_inspect(std::ptr::null(), 0, &mut output) },
        -1
    );
}

#[test]
fn ffi_projects_wasm_without_owning_input() {
    let bytes = b"\0asm\x01\0\0\0";
    let mut output = BunEngineBinaryInfo::default();
    assert_eq!(
        unsafe { bun_engine_inspect(bytes.as_ptr(), bytes.len(), &mut output) },
        0
    );
    assert_eq!(output.abi_version, ABI_VERSION);
    assert_ne!(output.format, 0);
    assert_eq!(output.bits, 32);
}
