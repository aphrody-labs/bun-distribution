import { PatreonCreatorClient } from "@rosegriffon/patreon-bun";

// Use your own client with configuration
declare const client: PatreonCreatorClient;

console.log("User agent used by client:", client.oauth.userAgent);
