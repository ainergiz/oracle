#!/usr/bin/env npx tsx
/**
 * Test script for NotebookLM slide generation
 *
 * Usage:
 *   # Create new notebook with source upload:
 *   npx tsx scripts/test-notebooklm-create.ts
 *
 *   # Test with existing notebook (isolates slide generation):
 *   NOTEBOOK_URL="https://notebooklm.google.com/notebook/..." npx tsx scripts/test-notebooklm-create.ts
 *
 *   # Batch mode: generate 4 slide decks for different audiences:
 *   NOTEBOOK_URL="..." BATCH=1 npx tsx scripts/test-notebooklm-create.ts
 */

import path from 'node:path';
import { runNotebookLMBrowserMode } from '../src/notebooklm-browser/index.js';

async function main() {
  const existingNotebookUrl = process.env.NOTEBOOK_URL;
  const batchMode = process.env.BATCH === '1';

  const logger = (msg: string) => {
    const timestamp = new Date().toISOString().slice(11, 19);
    console.log(`[${timestamp}] ${msg}`);
  };

  if (existingNotebookUrl && batchMode) {
    // Batch mode: generate slides for 4 different audiences
    console.log('🔬 BATCH MODE: Generating slides for 4 audiences...\n');
    console.log(`📓 Notebook URL: ${existingNotebookUrl}\n`);
    console.log('📋 Audiences: technical, customer, executive, beginner\n');

    try {
      const result = await runNotebookLMBrowserMode({
        mode: 'existing',
        notebookUrl: existingNotebookUrl,
        artifactType: 'slides',
        options: {
          slides: {
            batchAudiences: ['technical', 'customer', 'executive', 'beginner'],
            format: 'detailed',
            length: 'default',
          },
        },
        config: {
          manualLogin: true,
          keepBrowser: true,
          hideWindow: false,
          debug: true,
          cookieSync: true,
          allowCookieErrors: true,
        },
        log: logger,
      });

      console.log('\n✅ Result:');
      console.log(JSON.stringify(result, null, 2));

      if (result.error) {
        console.log('\n❌ Error:', result.error);
      } else if (result.artifacts && result.artifacts.length > 0) {
        console.log(`\n📄 Downloaded ${result.artifacts.length} artifacts:`);
        for (const a of result.artifacts) {
          console.log(`   - ${a.path}`);
        }
      }
    } catch (error) {
      console.error('\n❌ Failed:', error);
    }
  } else if (existingNotebookUrl) {
    // Test mode: existing notebook (skips source upload, tests slide generation only)
    console.log('🔬 Testing slide generation with EXISTING notebook...\n');
    console.log(`📓 Notebook URL: ${existingNotebookUrl}\n`);
    console.log('💡 Tip: Set BATCH=1 to test batch mode with 4 audiences\n');

    try {
      const result = await runNotebookLMBrowserMode({
        mode: 'existing',
        notebookUrl: existingNotebookUrl,
        artifactType: 'slides',
        options: {
          slides: {
            audience: 'technical',
            format: 'detailed',
            length: 'default',
          },
        },
        config: {
          manualLogin: true,
          keepBrowser: true,
          hideWindow: false,
          debug: true,
          cookieSync: true,
          allowCookieErrors: true,
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
  } else if (batchMode) {
    // Create new notebook + batch mode
    console.log('🚀 BATCH MODE: Creating new notebook + generating 4 slide decks...\n');
    console.log('📋 Audiences: technical, customer, executive, beginner\n');

    const sourceFile = path.resolve(import.meta.dirname, 'test-source.md');
    console.log(`📄 Source file: ${sourceFile}\n`);

    try {
      const result = await runNotebookLMBrowserMode({
        mode: 'createNew',
        artifactType: 'slides',
        sourceFiles: [sourceFile],
        options: {
          slides: {
            batchAudiences: ['technical', 'customer', 'executive', 'beginner'],
            format: 'detailed',
            length: 'default',
          },
        },
        config: {
          manualLogin: true,
          keepBrowser: true,
          hideWindow: false,
          debug: true,
          cookieSync: true,
          allowCookieErrors: true,
        },
        log: logger,
      });

      console.log('\n✅ Result:');
      console.log(JSON.stringify(result, null, 2));

      if (result.error) {
        console.log('\n❌ Error:', result.error);
      } else if (result.artifacts && result.artifacts.length > 0) {
        console.log(`\n📄 Downloaded ${result.artifacts.length} artifacts:`);
        for (const a of result.artifacts) {
          console.log(`   - ${a.path}`);
        }
      }
    } catch (error) {
      console.error('\n❌ Failed:', error);
    }
  } else {
    // Default mode: create new notebook with source upload (single slide)
    console.log('🚀 Testing NotebookLM Create New Notebook with Source Upload...\n');
    console.log('💡 Tip: Set BATCH=1 to generate 4 slide decks for different audiences\n');

    const sourceFile = path.resolve(import.meta.dirname, 'test-source.md');
    console.log(`📄 Source file: ${sourceFile}\n`);

    try {
      const result = await runNotebookLMBrowserMode({
        mode: 'createNew',
        artifactType: 'slides',
        sourceFiles: [sourceFile],
        options: {
          slides: {
            audience: 'technical',
            format: 'detailed',
            length: 'default',
          },
        },
        config: {
          manualLogin: true,
          keepBrowser: true,
          hideWindow: false,
          debug: true,
          cookieSync: true,
          allowCookieErrors: true,
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
}

main();
