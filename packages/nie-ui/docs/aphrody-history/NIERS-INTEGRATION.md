# Intégration niers

`niers` consomme Aphrody Web sans recopier son moteur : les paquets métier Inazuma
restent dans `niers`, tandis que `@aphrody/bxc` fournit le navigateur TypeScript
et le binaire standalone fournit le CLI natif.

Pour Aphrody Web v0.9.7, la release GitHub est source-only tant que les assets CI ne
sont pas publiés. Le paquet npm effectivement consommable reste donc 0.9.6 ;
le binaire Windows local est produit par `bun run build:win` et vérifié par
`aphrody web --version`.

Ne jamais versionner cookies, profils CDP, bases SQLite, dumps ou credentials
de l'installation native. La configuration utilisateur est écrite sous
`%APPDATA%\\bxc` et les données sous `%USERPROFILE%\\.bxc`.
