use aphrody_nie_emu::{AdapterStatus, BackendKind, Capability, Platform, REGISTRY};

#[test]
fn ds_uses_the_linked_dust_runtime_and_retains_melonds_as_reference() {
    let rust = REGISTRY.find("dust").unwrap();
    assert_eq!(rust.platform, Platform::Ds);
    assert_eq!(rust.kind, BackendKind::NativeRust);
    assert!(rust.supports(Capability::Execute));

    let native = REGISTRY.find("melonds").unwrap();
    assert_eq!(native.platform, Platform::Ds);
    assert_eq!(native.kind, BackendKind::ReferenceOnly);
    assert_eq!(
        REGISTRY.adapter(Platform::Ds, Capability::Execute).unwrap().status,
        AdapterStatus::Available
    );
}

#[test]
fn three_ds_has_a_native_candidate() {
    let backend = REGISTRY.find("azahar").unwrap();
    assert_eq!(backend.platform, Platform::ThreeDs);
    assert_eq!(backend.kind, BackendKind::DynamicLibrary);
    assert!(backend.supports(Capability::Execute));
    assert_eq!(
        REGISTRY.adapter(Platform::ThreeDs, Capability::Execute).unwrap().status,
        AdapterStatus::ReferenceOnly
    );
}

#[test]
fn wii_has_a_rust_candidate_and_a_native_reference() {
    let rust = REGISTRY.find("gecko-wii").unwrap();
    assert_eq!(rust.platform, Platform::Wii);
    assert_eq!(rust.kind, BackendKind::NativeRust);
    assert!(rust.supports(Capability::Homebrew));

    let native = REGISTRY.find("dolphin").unwrap();
    assert_eq!(native.platform, Platform::Wii);
    assert_eq!(native.kind, BackendKind::DynamicLibrary);
    assert_eq!(
        REGISTRY.adapter(Platform::Wii, Capability::Execute).unwrap().status,
        AdapterStatus::ReferenceOnly
    );
}

#[test]
fn switch_candidate_is_not_claimed_as_integrated() {
    let backend = REGISTRY.find("nxemu").unwrap();
    assert_eq!(backend.platform, Platform::Switch);
    assert_eq!(backend.kind, BackendKind::ReferenceOnly);
    assert!(backend.supports(Capability::Execute));
    assert!(!backend.is_runtime());
    assert_eq!(
        REGISTRY.adapter(Platform::Switch, Capability::Execute).unwrap().status,
        AdapterStatus::ReferenceOnly
    );
}

#[test]
fn steam_is_a_compatibility_surface_not_a_console_emulator() {
    let backend = REGISTRY.find("proton").unwrap();
    assert_eq!(backend.platform, Platform::Steam);
    assert_eq!(backend.kind, BackendKind::ReferenceOnly);
    assert!(backend.supports(Capability::Launch));
    assert!(!backend.supports(Capability::Execute));
    assert!(REGISTRY.select(Platform::Steam, Capability::Execute).is_none());
    assert_eq!(
        REGISTRY.adapter(Platform::Steam, Capability::Execute).unwrap().status,
        AdapterStatus::Unavailable
    );
}
