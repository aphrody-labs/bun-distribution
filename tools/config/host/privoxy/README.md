# Privoxy & WireGuard Mullvad HTTP Bridge

Ce répertoire centralise la configuration hôte Privoxy pour l'infrastructure Aphrody.

## Architecture

- **Rôle** : Fournir un pont HTTP local (`127.0.0.1:8119`) vers le proxy SOCKS5 Mullvad (`10.8.0.1:1080`) actif via WireGuard (`wg0`).
- **Consommateurs** : `shenron-bot` (`SHENRON_MEDIA_PROXIES`), crawlers et micro-services nécessitant un egress VPN anonymisé.
- **Fichiers** :
  - `shenron-media.conf` : Configuration Privoxy installée en `/etc/privoxy/config`.
  - `shenron-media-proxy.env.example` : Modèle d'environnement local pour les bots/services.
  - `tools/config/host/systemd/shenron/privoxy.service.d/shenron-media.conf` : Drop-in systemd assurant l'ordre de démarrage après `wg-quick@wg0.service`.
  - `deploy/install-media-vpn-proxy.sh` d'[aphrody-labs/shenron](https://github.com/aphrody-labs/shenron) : script d'installation et de validation, qui lit les fichiers de ce répertoire.
