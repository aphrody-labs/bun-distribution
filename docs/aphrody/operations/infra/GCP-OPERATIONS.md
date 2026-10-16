# Google Cloud runtime

Le projet canonique est `aphrody`. L'authentification est ADC-first : ADC
natif impersonant `aphrody-bot`, identité attachée au runtime, puis Secret Manager pour les secrets
applicatifs nommés. Aucune clé JSON n'est exportée dans Git, `.env`, image ou
unité systemd.

Variables communes : `GOOGLE_CLOUD_PROJECT`, `GCLOUD_PROJECT`,
`CLOUDSDK_CORE_PROJECT`, `GOOGLE_CLOUD_LOCATION`, `GOOGLE_CLOUD_REGION`,
`GOOGLE_GENAI_USE_VERTEXAI=true`, `APHRODY_HOME`.

Python, Rust, Bun/BXC et Aphrody OS héritent du même environnement. Le
kernel/MCP expose les capacités, pas les valeurs de credentials. Les clés API
restent désactivées par défaut; les intégrations utilisent ADC/Vertex AI.

Le poste Windows utilise un ADC de type `impersonated_service_account` et la
configuration gcloud `auth/impersonate_service_account`. Aucune clé privée de
service account n'est générée.
