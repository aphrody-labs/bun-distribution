# MCP Google / Cloud / Web

Le catalogue de modèle est
[`tools/config/mcp-google-web.json`](../../../tools/config/mcp-google-web.json). Il décrit
les chemins et serveurs attendus pour une configuration reproductible ; il ne
prouve pas que ces fichiers existent, que les serveurs sont installés ou que
des outils MCP sont connectés dans la session en cours. Vérifier le profil et
les outils réellement exposés avant de documenter une connexion active.

Serveurs déclarés dans le modèle :

- `aphrody-mcp` : kernel Rust et routage Google Cloud;
- `bxc-mcp` : recherche Google, Gemini Web et navigateur BXC;
- `chrome-devtools` : inspection CDP, DOM, réseau et performance;
- `google-drive` : endpoint MCP officiel Google Drive;
- plugins `chrome-devtools-plugin` et `modern-web-guidance-plugin`.

Le catalogue reproductible est `tools/config/mcp-google-web.json`. Les credentials
restent dans OAuth/ADC natif; aucun secret n'est écrit dans cette configuration.
