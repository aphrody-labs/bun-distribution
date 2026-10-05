<!-- Generated from source by @aphrody/workspace. Do not edit. -->
# Source reference: infra-rust

Line documentation excerpts only; this is not an exhaustive API or compilation result.

## Source: crates/infra/git/src/lib.rs

SHA-256: `117f7c1b658a7e0da7433cc83c119da0a7122ebd8030bd9a31e39591dfee48fa`

### Documentation excerpt — source lines 2–6

```rust
//! Native Git and GitHub primitives shared by every Aphrody repository.
//!
//! Local repository inspection is implemented with `gix`, without spawning a
//! system `git` process. GitHub REST and GraphQL calls are implemented with
//! `octocrab`; credentials are read only at runtime and are never serialized.
```

### Documentation excerpt — source lines 47–47

```rust
/// Errors emitted by the unified Git/GitHub surface.
```

### Documentation excerpt — source lines 50–50

```rust
    /// A native `gix` operation failed.
```

### Documentation excerpt — source lines 53–53

```rust
    /// A GitHub API request failed before an HTTP response was received.
```

### Documentation excerpt — source lines 56–56

```rust
    /// GitHub returned an unsuccessful HTTP response.
```

### Documentation excerpt — source lines 59–59

```rust
        /// HTTP status code.
```

### Documentation excerpt — source lines 61–61

```rust
        /// Response body, kept for actionable diagnostics.
```

### Documentation excerpt — source lines 64–64

```rust
    /// The repository identifier or remote URL is not a GitHub repository.
```

### Documentation excerpt — source lines 67–67

```rust
    /// JSON input could not be decoded.
```

### Documentation excerpt — source lines 70–70

```rust
    /// A filesystem operation failed.
```

### Documentation excerpt — source lines 73–73

```rust
        /// Human-readable operation name.
```

### Documentation excerpt — source lines 75–75

```rust
        /// Affected path.
```

### Documentation excerpt — source lines 77–77

```rust
        /// Original I/O error.
```

### Documentation excerpt — source lines 80–80

```rust
    /// Refused to overwrite a file that Aphrody does not own.
```

### Documentation excerpt — source lines 83–83

```rust
    /// A local workflow path traverses a symbolic link or escapes its repository.
```

## Source: crates/infra/infra/src/lib.rs

SHA-256: `46c302afe32da9ed371821d0af14034280b108302c642a696167a9c473514e7b`

### Documentation excerpt — source lines 2–6

```rust
//! Unified Aphrody Infrastructure Library.
//!
//! Provides core domain models, observability, lifecycle management,
//! cross-catalog validation, pipeline orchestration, remote SSH operations,
//! Git ecosystem automation, Mullvad VPN/proxy control, and embedded HTTP API.
```
