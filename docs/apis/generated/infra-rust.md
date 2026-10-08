<!-- Generated from source by @aphrody/workspace. Do not edit. -->
# Source reference: infra-rust

Line documentation excerpts only; this is not an exhaustive API or compilation result.

## Source: crates/infra/git/src/lib.rs

SHA-256: `74d541aad16d15afbac0fa9c87309ae85cd48299aa8e11d043835516f29906be`

### Documentation excerpt — source lines 2–6

```rust
//! Native Git and GitHub primitives shared by every Aphrody repository.
//!
//! Local repository inspection is implemented with `gix`, without spawning a
//! system `git` process. GitHub REST and GraphQL calls are implemented with
//! `octocrab`; credentials are read only at runtime and are never serialized.
```

### Documentation excerpt — source lines 49–49

```rust
/// Errors emitted by the unified Git/GitHub surface.
```

### Documentation excerpt — source lines 52–52

```rust
    /// A native `gix` operation failed.
```

### Documentation excerpt — source lines 55–55

```rust
    /// A GitHub API request failed before an HTTP response was received.
```

### Documentation excerpt — source lines 58–58

```rust
    /// GitHub returned an unsuccessful HTTP response.
```

### Documentation excerpt — source lines 61–61

```rust
        /// HTTP status code.
```

### Documentation excerpt — source lines 63–63

```rust
        /// Response body, kept for actionable diagnostics.
```

### Documentation excerpt — source lines 66–66

```rust
    /// The repository identifier or remote URL is not a GitHub repository.
```

### Documentation excerpt — source lines 69–69

```rust
    /// JSON input could not be decoded.
```

### Documentation excerpt — source lines 72–72

```rust
    /// A filesystem operation failed.
```

### Documentation excerpt — source lines 75–75

```rust
        /// Human-readable operation name.
```

### Documentation excerpt — source lines 77–77

```rust
        /// Affected path.
```

### Documentation excerpt — source lines 79–79

```rust
        /// Original I/O error.
```

### Documentation excerpt — source lines 82–82

```rust
    /// Refused to overwrite a file that Aphrody does not own.
```

### Documentation excerpt — source lines 85–85

```rust
    /// A local workflow path traverses a symbolic link or escapes its repository.
```

## Source: crates/infra/infra/src/lib.rs

SHA-256: `2e0435b98699ad68d7fd48fa92f9df2ef8b3787ca4588fc3bf69effd48a33590`

### Documentation excerpt — source lines 2–6

```rust
//! Unified Aphrody Infrastructure Library.
//!
//! Provides core domain models, observability, lifecycle management,
//! cross-catalog validation, pipeline orchestration, remote SSH operations,
//! Git ecosystem automation, Mullvad VPN/proxy control, and embedded HTTP API.
```
