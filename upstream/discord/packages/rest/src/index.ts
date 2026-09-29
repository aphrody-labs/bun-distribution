import { shouldUseGlobalFetchAndWebSocket } from '@discordjs/util';
import { setDefaultStrategy } from './environment.js';
import { globalFetch } from './strategies/globalFetch.js';
import { makeRequest } from './strategies/undiciRequest.js';

setDefaultStrategy(shouldUseGlobalFetchAndWebSocket() ? globalFetch : makeRequest);

export * from './shared.js';
