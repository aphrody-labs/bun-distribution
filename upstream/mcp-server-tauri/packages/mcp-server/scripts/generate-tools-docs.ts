#!/usr/bin/env node

/**
 * Script to generate tool documentation from the tools registry. This ensures the README
 * is always up-to-date with the actual tool definitions
 */

import { getToolsByCategory, getToolCount } from '../src/tools-registry.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const currentFilePath = fileURLToPath(import.meta.url),
      currentDirPath = path.dirname(currentFilePath);

function generateToolsMarkdown(): string {
   const toolsByCategory = getToolsByCategory(),
         totalCount = getToolCount();

   let markdown: string;

   markdown = `## Available Tools

The MCP server exposes ${totalCount} tools organized into categories:
`;

   // Generate documentation for each category
   for (const [ category, tools ] of Object.entries(toolsByCategory)) {
      markdown += `
### ${category}
`;

      for (const tool of tools) {
         markdown += `
   * \`${tool.name}\` - ${tool.description}`;
      }

      markdown += '\n';
   }

   return markdown;
}

function updateReadme(): void {
   const rootReadmePath = path.join(currentDirPath, '../../../README.md');

   // eslint-disable-next-line no-sync
   const readmeContent = fs.readFileSync(rootReadmePath, 'utf-8');

   // Find the section to replace (between ## Available Tools and ## Architecture)
   const startMarker = '## Available Tools',
         endMarker = '## Architecture',
         startIndex = readmeContent.indexOf(startMarker),
         endIndex = readmeContent.indexOf(endMarker);

   if (startIndex === -1 || endIndex === -1) {
      throw new Error('Could not find the Available Tools section in README.md');
   }

   // Generate new content
   const newToolsSection = generateToolsMarkdown();

   // Replace the section
   const updatedContent =
      readmeContent.substring(0, startIndex) +
      newToolsSection +
      '\n' +
      readmeContent.substring(endIndex);

   // Write back to file
   // eslint-disable-next-line no-sync
   fs.writeFileSync(rootReadmePath, updatedContent);

   console.log(`[SUCCESS] Updated README.md with ${getToolCount()} tools`);
}

// Run the script
updateReadme();
