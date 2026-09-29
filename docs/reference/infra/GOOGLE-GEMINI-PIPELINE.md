# Pipeline Google/Gemini Aphrody

Ce manifeste est l'autorité d'intégration :
`config/google-gemini-pipeline.json`.

Le flux de production est :

`home-agent/agy -> aphrody-kernel MCP -> provider runtime -> BXC/Web ou OAuth`

Les implémentations restent propriétaires de leur domaine :

- Python expose le client Web et la normalisation des sessions.
- Rust expose le runtime provider, le kernel et le transport MCP.
- `@aphrody/google` expose la façade Bun canonique (Vertex ADC + Gemini Web); BXC reste le transport Web spécialisé
- `aphrody.google` expose la façade Python canonique (runtime, Vertex, Gemini Web et Spark)
- `aphrody-google` expose le contrat Rust consommé par MCP et le backend agy
- `aphrody/packages/doc-ai` est un adaptateur Vertex ADC enregistré dans le manifeste, sans gestion de secret ni projet concurrent
  Google Search, Gemini Web, CDP et outils Web.
- Aphrody OS fournit l'orchestration kernel, les permissions et le home-agent.
- `aphrody-infra` fournit uniquement le contrat, le routage d'environnement et
  les contrôles de déploiement.

Chaque hôte résout `APHRODY_HOME` vers sa racine privée locale. Les cookies ne
sont ni synchronisés ni transmis par le pipeline. OAuth utilise le magasin
de credentials natif de la plateforme. Toute absence ou expiration de session
échoue fermement et déclenche le chemin de réauthentification local.

## Portes de production

1. `APHRODY_HOME` et les sous-répertoires `cookies`, `vendor`, `bin` existent.
2. Les permissions sont propriétaire seul.
3. Le kernel MCP est joignable localement.
4. BXC annonce ses capacités sans exposer de secret.
5. Les adaptateurs Python/Rust/Bun utilisent le manifeste et la même racine.
- Le binaire unique `aphrody-google` est l’autorité runtime. `status`, `env` et `doctor` exposent uniquement le contrat non secret; Bun et uv/Python restent des façades clientes.
