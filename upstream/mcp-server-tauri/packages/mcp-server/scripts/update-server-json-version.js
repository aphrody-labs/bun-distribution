#!/usr/bin/env node
/* eslint-disable */

import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const version = process.argv[2];

if (!version) {
  console.error('Usage: node update-server-json-version.js <version>');
  process.exit(1);
}

const serverJsonPath = join(__dirname, '..', 'server.json');

try {
  const data = JSON.parse(readFileSync(serverJsonPath, 'utf8'));

  data.version = version;

  if (data.packages && data.packages.length > 0) {
    data.packages[0].version = version;
  }

  writeFileSync(serverJsonPath, JSON.stringify(data, null, 2) + '\n');

  console.log(`Updated server.json to version ${version}`);
} catch (error) {
  console.error(`Failed to update server.json: ${error.message}`);
  process.exit(1);
}
