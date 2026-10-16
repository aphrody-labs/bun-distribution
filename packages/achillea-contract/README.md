# `@rosegriffon/achillea-contract`

Exporte le contrat Achilléa **hors de TypeScript**. Lit les sources de
`@rosegriffon/achillea-types` et produit, dans `generated/` :

| Fichier                 | Cible                        | Usage                                          |
| ----------------------- | ---------------------------- | ---------------------------------------------- |
| `achillea.schema.json`  | JSON Schema 2020-12          | Pivot vers tout générateur (Go, C#, Dart, …)   |
| `achillea.rs`           | Rust + `serde`               | Client de jeu ou service Rust                  |
| `Achillea.swift`        | Swift `Codable`              | App iOS native                                 |
| `Achillea.kt`           | Kotlin `kotlinx.serialization` | App Android native                            |

C'est la pièce qui rend la frontière réelle : le jour où une cible quitte
TypeScript, les 159 formes du domaine ne sont pas réécrites à la main.

## Commandes

```bash
bun --filter @rosegriffon/achillea-contract generate   # écrit generated/
bun --filter @rosegriffon/achillea-contract check      # échoue si generated/ est périmé (CI)
bun --filter @rosegriffon/achillea-contract test
```

`check` tourne en CI : modifier `@rosegriffon/achillea-types` sans régénérer
casse le build, ce qui empêche le contrat exporté de dériver en silence.

## Chaîne

```
packages/achillea-types/src/**.ts
        │  extract.ts  (AST TypeScript, pas de type-checker)
        ▼
      IR  (ir.ts — interfaces, enums, alias, types structurels)
        │
        ├─ emit-json-schema.ts ─► achillea.schema.json
        ├─ emit-rust.ts        ─► achillea.rs
        ├─ emit-swift.ts       ─► Achillea.swift
        └─ emit-kotlin.ts      ─► Achillea.kt
```

L'extraction est **syntaxique par choix**. Le paquet de contrat est contraint
(`interface`, `type`, `enum`, zéro dépendance), donc l'AST suffit, et toute
construction exotique introduite par mégarde lève une `ContractExtractionError`
localisée au lieu d'être aplatie en `unknown` dans le Rust généré.

Ajouter un langage = ajouter un émetteur qui ne connaît que l'IR.

## Conventions de traduction

| TypeScript                 | JSON Schema                       | Rust                          | Swift             | Kotlin              |
| -------------------------- | --------------------------------- | ----------------------------- | ----------------- | ------------------- |
| `interface`                | `object` + `required`             | `struct`                      | `struct: Codable` | `data class`        |
| `enum` (chaînes)           | `enum` de valeurs                 | `enum` + `serde(rename)`      | `enum: String`    | `enum class`        |
| `enum` (nombres)           | `enum` de valeurs                 | `enum` + `serde_repr`         | `enum: Int`       | `enum class`        |
| `champ?`                   | absent de `required`              | `Option<T>` + `skip_serializing_if` | `T?`        | `T? = null`         |
| `Date`                     | `string` / `date-time`            | `Timestamp` (alias `String`)  | `String`          | `String`            |
| `Record<string, T>`        | `additionalProperties`            | `HashMap<String, T>`          | `[String: T]`     | `Map<String, T>`    |
| `A & { … }`                | propriétés fusionnées             | `serde(flatten)`              | champs aplatis    | champs aplatis      |
| `extends`                  | propriétés fusionnées             | champs aplatis                | champs aplatis    | champs aplatis      |

Les noms de champs sont convertis en `snake_case` (Rust) / `camelCase`
(Swift, Kotlin) avec un `rename` explicite dès que le nom du fil diffère — les
mots réservés (`type`, `ref`, …) sont échappés.

### `number` et entiers

TypeScript n'a qu'un `number`, qui est un double : l'émission par défaut est
donc `f64` / `Double`. Pour forcer un entier sur une cible native, annoter le
champ dans `@rosegriffon/achillea-types` :

```ts
export interface Exemple {
	/** Nombre de participants. @integer */
	participantsNumber: number;
}
```

Pas de devinette sur le nom du champ : l'intention est déclarée, ou elle ne
l'est pas.

## Consommer le Rust généré

```toml
# Cargo.toml
[dependencies]
serde = { version = "1", features = ["derive"] }
serde_json = "1"
serde_repr = "0.1"
```

```rust
// Basculer les horodatages sur chrono : redéfinir le seul alias `Timestamp`.
use achillea::{LeaderboardPage, StageType};

let page: LeaderboardPage = serde_json::from_str(&body)?;
assert_eq!(tournament.tournament_type, StageType::SingleElimination);
```

Le fichier généré est vérifié par `cargo check` : il compile sans avertissement
bloquant.

## Autres langages

Le JSON Schema alimente `quicktype` pour les cibles non émises ici :

```bash
quicktype --src-lang schema --lang go   generated/achillea.schema.json -o achillea.go
quicktype --src-lang schema --lang dart generated/achillea.schema.json -o achillea.dart
```
