import { setDefaultStrategy } from './environment.js';
import { globalFetch } from './strategies/globalFetch.js';

setDefaultStrategy(globalFetch);

export * from './shared.js';
