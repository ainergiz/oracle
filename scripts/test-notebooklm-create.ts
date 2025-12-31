#!/usr/bin/env npx tsx
/**
 * Test script for NotebookLM "Create New Notebook" functionality
 * Run with: npx tsx scripts/test-notebooklm-create.ts
 */

import path from 'node:path';
import { runNotebookLMBrowserMode } from '../src/notebooklm-browser/index.js';

async function main() {
  console.log('🚀 Testing NotebookLM Create New Notebook with Source Upload...\n');

  const logger = (msg: string) => {
    const timestamp = new Date().toISOString().slice(11, 19);
    console.log(`[${timestamp}] ${msg}`);
  };

  // Use the test source file
  const sourceFile = path.resolve(import.meta.dirname, 'test-source.md');
  console.log(`📄 Source file: ${sourceFile}\n`);

  try {
    const result = await runNotebookLMBrowserMode({
      mode: 'createNew',
      artifactType: 'slides',  // We'll generate slides after creating notebook
      sourceFiles: [sourceFile],  // Upload this file as source
      options: {
        slides: {
          audience: 'technical',
          format: 'detailed',
          length: 'default',
        },
      },
      config: {
        manualLogin: true,           // Keep browser visible for login
        keepBrowser: true,           // Don't close browser after
        hideWindow: false,           // Show the browser window
        debug: true,                 // Enable debug logging
        cookieSync: true,            // Try to sync cookies from Chrome profile
        allowCookieErrors: true,     // Continue even if cookie sync fails
      },
      log: logger,
    });

    console.log('\n✅ Result:');
    console.log(JSON.stringify(result, null, 2));

    if (result.error) {
      console.log('\n❌ Error:', result.error);
    } else if (result.artifact) {
      console.log('\n📄 Artifact downloaded:', result.artifact.path);
    }

  } catch (error) {
    console.error('\n❌ Failed:', error);
  }
}

main();
