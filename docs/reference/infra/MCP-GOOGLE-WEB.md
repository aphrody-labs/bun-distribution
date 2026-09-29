# MCP Google / Cloud / Web

La configuration locale vérifiée est `${APHRODY_HOME}/config/mcp.json` et le
profil Gemini est `${USERPROFILE}/.gemini/config/mcp_config.json`.

Serveurs raccordés :

- `aphrody-mcp` : kernel Rust et routage Google Cloud;
- `bxc-mcp` : recherche Google, Gemini Web et navigateur BXC;
- `chrome-devtools` : inspection CDP, DOM, réseau et performance;
- `google-drive` : endpoint MCP officiel Google Drive;
- plugins `chrome-devtools-plugin` et `modern-web-guidance-plugin`.

Le catalogue reproductible est `config/mcp-google-web.json`. Les credentials
restent dans OAuth/ADC natif; aucun secret n'est écrit dans cette configuration.
