# Published Material consumer

This native application consumes the exact published Material Git revision.
It has a separate workspace and lockfile. Direct token/component dependencies
and libm3 share their Rust types; the application's root patch also unifies
transitive registry dependencies with that token owner.

Use the qualified native Cargo owner from the configured Bun checkout:

```powershell
bun "$env:APHRODY_BUN_CHECKOUT/scripts/aphrody/build/rust/cargo-serial.ts" --msvc run --locked --manifest-path examples/published-consumer/Cargo.toml
```

The application emits the generated primary color and shared state-layer
opacity. It does not create a window or qualify desktop rendering.
