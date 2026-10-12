# Material 3

Monorepo de composants, tokens, thèmes, icônes et outils Material Design 3.

Les packages sont regroupés directement sous `packages/*`. Les intégrations
restent découplées du modèle de composants. `m3-bun` fournit les commandes
Bun pour développer, tester, servir et empaqueter les applications M3.

## Layout

```text
packages/*  packages M3
scripts/    vérifications du workspace
docs/       documentation de conception
```

## Development

```powershell
bun install
bun run list
bun test
```
