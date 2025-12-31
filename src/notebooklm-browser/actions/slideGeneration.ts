/**
 * Slide Generation for NotebookLM Browser Automation
 */

import type { ChromeClient } from '../../browser/types.js';
import type { BrowserLogger, SlideOptions, ArtifactDownloadResult } from '../types.js';
import { SLIDE_SELECTORS, SLIDE_AUDIENCE_PROMPTS, DEFAULT_CONFIG } from '../constants.js';
import { countArtifacts, waitForArtifactReady, getArtifactStatus, isArtifactLoading } from './artifactMonitor.js';
import {
  openCustomizeDialog,
  waitForDialog,
  selectRadioOption,
  selectToggleOption,
  fillDialogTextarea,
  clickGenerateButton,
} from './dialogInteraction.js';
import { downloadLatestArtifact } from './downloadHandler.js';
import { delay } from '../../browser/utils.js';

/**
 * Check if the notebook has any sources loaded
 */
async function hasNotebookSources(
  Runtime: ChromeClient['Runtime'],
  logger: BrowserLogger,
): Promise<boolean> {
  const { result } = await Runtime.evaluate({
    expression: `(() => {
      // Check for source items - these are the actual selectors used by NotebookLM
      const sourceSelectors = [
        // Primary: source containers in the source picker
        '.single-source-container',
        '.source-title',
        'source-picker .scroll-area-desktop > div',
        // Fallback selectors
        '.source-item',
        '.source-card',
        '[data-source-id]',
      ];

      for (const sel of sourceSelectors) {
        const elements = document.querySelectorAll(sel);
        if (elements.length > 0) {
          // For source-title, get the actual title text
          if (sel === '.source-title') {
            const title = elements[0].textContent?.trim();
            return { hasSources: true, count: elements.length, selector: sel, title };
          }
          return { hasSources: true, count: elements.length, selector: sel };
        }
      }

      // Check if "Select all sources" checkbox is checked (indicates sources exist)
      const selectAllCheckbox = document.querySelector('.select-checkbox-all-sources input[type="checkbox"]');
      if (selectAllCheckbox && selectAllCheckbox.checked) {
        return { hasSources: true, count: 1, selector: 'select-all-checkbox' };
      }

      // Check source-picker for any content
      const sourcePicker = document.querySelector('source-picker');
      if (sourcePicker) {
        const scrollArea = sourcePicker.querySelector('.scroll-area-desktop');
        if (scrollArea && scrollArea.children.length > 0) {
          return { hasSources: true, count: scrollArea.children.length, selector: 'source-picker-scroll' };
        }
      }

      return { hasSources: false, reason: 'no source indicators found' };
    })()`,
    returnByValue: true,
  });

  const outcome = result?.value as {
    hasSources?: boolean;
    count?: number;
    selector?: string;
    title?: string;
    reason?: string;
  } | undefined;

  if (outcome?.hasSources) {
    const titleInfo = outcome.title ? ` ("${outcome.title}")` : '';
    logger(`Found ${outcome.count} source(s) via ${outcome.selector}${titleInfo}`);
    return true;
  }

  logger(`No sources found: ${outcome?.reason}`);
  return false;
}

/**
 * Close any open dialog (upload dialog, etc.) before generating
 */
async function closeAnyOpenDialog(
  Runtime: ChromeClient['Runtime'],
  logger: BrowserLogger,
): Promise<void> {
  const { result } = await Runtime.evaluate({
    expression: `(() => {
      const dialog = document.querySelector('mat-dialog-container');
      if (!dialog || dialog.offsetParent === null) return { hasDialog: false };

      // Check if this is the upload dialog
      const dialogText = dialog.textContent?.toLowerCase() || '';
      const isUploadDialog = dialogText.includes('add sources') ||
                             dialogText.includes('upload') ||
                             dialogText.includes('insert') ||
                             dialogText.includes('copied text');

      if (isUploadDialog) {
        // Find and click close button
        const closeSelectors = [
          "button[aria-label='Close dialogue']",
          "button[aria-label='Close dialog']",
          "button[aria-label='Close']",
          "button.close-button",
          "mat-icon[fonticon='close']",
        ];

        for (const sel of closeSelectors) {
          const closeBtn = dialog.querySelector(sel);
          if (closeBtn) {
            closeBtn.closest('button')?.click() || closeBtn.click();
            return { closed: true, via: sel };
          }
        }

        // Try finding close icon
        const icons = dialog.querySelectorAll('mat-icon');
        for (const icon of icons) {
          if (icon.textContent?.trim() === 'close') {
            const btn = icon.closest('button');
            if (btn) {
              btn.click();
              return { closed: true, via: 'close-icon' };
            }
          }
        }

        // Click backdrop as last resort
        const backdrop = document.querySelector('.cdk-overlay-backdrop');
        if (backdrop) {
          backdrop.click();
          return { closed: true, via: 'backdrop' };
        }
      }

      return { hasDialog: true, isUploadDialog, dialogText: dialogText.slice(0, 100) };
    })()`,
    returnByValue: true,
  });

  const outcome = result?.value as {
    hasDialog?: boolean;
    closed?: boolean;
    via?: string;
    isUploadDialog?: boolean;
    dialogText?: string;
  } | undefined;

  if (outcome?.closed) {
    logger(`Closed existing dialog (via ${outcome.via})`);
    await delay(500); // Wait for dialog to close
  } else if (outcome?.hasDialog && outcome?.isUploadDialog) {
    logger(`Upload dialog detected but couldn't close: ${outcome.dialogText}`);
  }
}

/**
 * Generate slides with customization options
 */
export async function generateSlides(
  client: ChromeClient,
  options: SlideOptions,
  outputDir: string,
  logger: BrowserLogger,
): Promise<ArtifactDownloadResult | null> {
  const { Runtime } = client;

  // Check if notebook has sources
  const hasSources = await hasNotebookSources(Runtime, logger);
  if (!hasSources) {
    logger('Cannot generate slides: notebook has no sources');
    return null;
  }

  // Close any open dialog (like upload dialog) before proceeding
  await closeAnyOpenDialog(Runtime, logger);

  // Get initial artifact count
  const initialCount = await countArtifacts(Runtime, 'slides');
  logger(`Initial slide count: ${initialCount}`);

  // Open customization dialog
  const dialogOpened = await openCustomizeDialog(Runtime, 'slides', logger);
  if (!dialogOpened) {
    logger('Failed to open slides customization dialog');
    return null;
  }

  // Wait for CUSTOMIZE dialog to appear (not any dialog)
  const dialogReady = await waitForDialog(Runtime, 'customise', 5000) ||
                      await waitForDialog(Runtime, 'customize', 2000);
  if (!dialogReady) {
    logger('Dialog did not appear');
    return null;
  }

  // Configure options
  await configureSlideOptions(Runtime, options, logger);

  // Click Generate
  const generated = await clickGenerateButton(Runtime, logger);
  if (!generated) {
    logger('Failed to click Generate button');
    return null;
  }

  // Wait for artifact to be ready
  const ready = await waitForArtifactReady(Runtime, 'slides', initialCount, logger);
  if (!ready) {
    logger('Slide generation timed out');
    return null;
  }

  // Download the artifact
  const audience = options.audience ?? DEFAULT_CONFIG.slideAudience;
  const result = await downloadLatestArtifact(client, 'slides', outputDir, audience, logger);

  return result;
}

/**
 * Configure slide generation options in the dialog
 */
async function configureSlideOptions(
  Runtime: ChromeClient['Runtime'],
  options: SlideOptions,
  logger: BrowserLogger,
): Promise<void> {
  // Select format (detailed or presenter)
  if (options.format) {
    const formatText = options.format === 'detailed' ? 'Detailed' : 'Presenter';
    await selectRadioOption(Runtime, formatText, logger);
  }

  // Select length
  if (options.length) {
    const lengthText = options.length.charAt(0).toUpperCase() + options.length.slice(1);
    await selectToggleOption(Runtime, lengthText, logger);
  }

  // Fill custom prompt or audience prompt
  if (options.customPrompt) {
    await fillDialogTextarea(Runtime, options.customPrompt, logger);
  } else if (options.audience && options.audience !== 'technical') {
    // Use predefined audience prompt
    const audiencePrompt = SLIDE_AUDIENCE_PROMPTS[options.audience];
    await fillDialogTextarea(Runtime, audiencePrompt, logger);
  }
}

/**
 * Generate multiple slide decks for different audiences (sequential, waits for each)
 * Returns array of download results
 */
export async function generateSlidesForAudiences(
  client: ChromeClient,
  audiences: SlideOptions['audience'][],
  baseOptions: Omit<SlideOptions, 'audience'>,
  outputDir: string,
  logger: BrowserLogger,
): Promise<ArtifactDownloadResult[]> {
  const results: ArtifactDownloadResult[] = [];

  for (const audience of audiences) {
    logger(`\nGenerating slides for audience: ${audience}`);

    const options: SlideOptions = {
      ...baseOptions,
      audience,
    };

    const result = await generateSlides(client, options, outputDir, logger);
    if (result) {
      results.push(result);
    }
  }

  logger(`\nGenerated ${results.length}/${audiences.length} slide decks`);
  return results;
}

/**
 * Trigger a single slide generation without waiting
 * Used for batch generation where we trigger all then wait
 */
async function triggerSlideGeneration(
  Runtime: ChromeClient['Runtime'],
  options: SlideOptions,
  logger: BrowserLogger,
): Promise<boolean> {
  // Open customization dialog
  const dialogOpened = await openCustomizeDialog(Runtime, 'slides', logger);
  if (!dialogOpened) {
    logger('Failed to open slides customization dialog');
    return false;
  }

  // Wait for CUSTOMIZE dialog to appear
  const dialogReady = await waitForDialog(Runtime, 'customise', 5000) ||
                      await waitForDialog(Runtime, 'customize', 2000);
  if (!dialogReady) {
    logger('Dialog did not appear');
    return false;
  }

  // Configure options
  await configureSlideOptions(Runtime, options, logger);

  // Click Generate
  const generated = await clickGenerateButton(Runtime, logger);
  if (!generated) {
    logger('Failed to click Generate button');
    return false;
  }

  // Small delay before next trigger
  await delay(1500);
  return true;
}

/**
 * Check if all slides are ready (none loading)
 */
async function areAllSlidesReady(
  Runtime: ChromeClient['Runtime'],
  expectedCount: number,
  logger: BrowserLogger,
): Promise<boolean> {
  const status = await getArtifactStatus(Runtime, 'slides');
  logger(`Slides status: ${status.readyCount} ready, ${status.loadingCount} loading, ${status.totalCount} total`);
  return status.totalCount >= expectedCount && status.loadingCount === 0;
}

/**
 * Refresh the page and wait for it to load
 */
async function refreshPage(
  Page: ChromeClient['Page'],
  Runtime: ChromeClient['Runtime'],
  logger: BrowserLogger,
): Promise<void> {
  logger('Refreshing page...');
  await Page.reload({});

  // Wait for page to stabilize
  await delay(5000);

  // Wait until page has content
  const maxWait = 30000;
  const start = Date.now();
  while (Date.now() - start < maxWait) {
    const { result } = await Runtime.evaluate({
      expression: `!!document.querySelector('source-picker, .artifact-item-button')`,
      returnByValue: true,
    });
    if (result?.value) {
      logger('Page reloaded successfully');
      return;
    }
    await delay(1000);
  }
  logger('Page reload timeout, continuing...');
}

/**
 * Batch generate multiple slide decks with wait-and-refresh strategy
 *
 * Strategy:
 * 1. Trigger all generations quickly (one after another)
 * 2. Wait 10 minutes initially
 * 3. Check if all ready - if not, refresh and wait 5 more minutes
 * 4. Repeat refresh cycle up to max 20 minutes total
 * 5. Download all completed slides
 */
export async function batchGenerateSlides(
  client: ChromeClient,
  audiences: SlideOptions['audience'][],
  baseOptions: Omit<SlideOptions, 'audience'>,
  outputDir: string,
  logger: BrowserLogger,
): Promise<ArtifactDownloadResult[]> {
  const { Runtime, Page } = client;

  // Check if notebook has sources
  const hasSources = await hasNotebookSources(Runtime, logger);
  if (!hasSources) {
    logger('Cannot generate slides: notebook has no sources');
    return [];
  }

  // Close any open dialog before starting
  await closeAnyOpenDialog(Runtime, logger);

  // Get initial artifact count
  const initialCount = await countArtifacts(Runtime, 'slides');
  logger(`Initial slide count: ${initialCount}`);

  // ========================================
  // PHASE 1: TRIGGER ALL GENERATIONS
  // ========================================
  logger('\n' + '='.repeat(50));
  logger(`PHASE 1: TRIGGERING ${audiences.length} GENERATIONS`);
  logger('='.repeat(50));

  const triggered: SlideOptions['audience'][] = [];

  for (let i = 0; i < audiences.length; i++) {
    const audience = audiences[i];
    logger(`\n[${i + 1}/${audiences.length}] Triggering: ${audience?.toUpperCase()}`);

    const options: SlideOptions = {
      ...baseOptions,
      audience,
    };

    const success = await triggerSlideGeneration(Runtime, options, logger);
    if (success) {
      triggered.push(audience);
      logger(`  ✓ ${audience} triggered`);
    } else {
      logger(`  ✗ ${audience} failed to trigger`);
    }
  }

  logger(`\nTriggered ${triggered.length}/${audiences.length} generations`);

  if (triggered.length === 0) {
    logger('No generations triggered, aborting');
    return [];
  }

  const expectedCount = initialCount + triggered.length;

  // ========================================
  // PHASE 2: WAIT WITH REFRESH STRATEGY
  // ========================================
  logger('\n' + '='.repeat(50));
  logger('PHASE 2: WAITING FOR COMPLETION');
  logger('='.repeat(50));

  const INITIAL_WAIT_MS = 10 * 60 * 1000;  // 10 minutes
  const REFRESH_WAIT_MS = 5 * 60 * 1000;   // 5 minutes per refresh cycle
  const MAX_TOTAL_MS = 20 * 60 * 1000;     // 20 minutes max

  const startTime = Date.now();
  let allReady = false;

  // Initial wait of 10 minutes (with periodic status checks)
  logger(`\nWaiting ${INITIAL_WAIT_MS / 60000} minutes initially...`);
  const initialDeadline = Math.min(startTime + INITIAL_WAIT_MS, startTime + MAX_TOTAL_MS);

  while (Date.now() < initialDeadline) {
    await delay(30000); // Check every 30 seconds
    const elapsed = Math.round((Date.now() - startTime) / 1000);

    // Check status periodically
    allReady = await areAllSlidesReady(Runtime, expectedCount, logger);
    if (allReady) {
      logger(`All slides ready after ${elapsed}s!`);
      break;
    }

    // Log progress every 2 minutes
    if (elapsed % 120 === 0) {
      logger(`[${Math.round(elapsed / 60)}m] Still generating...`);
    }
  }

  // Refresh cycles if not ready
  let refreshCount = 0;
  const maxRefreshes = 2; // Up to 2 refresh cycles (10 + 5 + 5 = 20 min max)

  while (!allReady && Date.now() - startTime < MAX_TOTAL_MS && refreshCount < maxRefreshes) {
    refreshCount++;
    const elapsed = Math.round((Date.now() - startTime) / 1000);
    logger(`\n[Refresh ${refreshCount}] Not ready after ${Math.round(elapsed / 60)}m, refreshing page...`);

    await refreshPage(Page, Runtime, logger);

    // Wait 5 minutes after refresh
    const refreshDeadline = Math.min(Date.now() + REFRESH_WAIT_MS, startTime + MAX_TOTAL_MS);

    while (Date.now() < refreshDeadline) {
      await delay(30000);
      allReady = await areAllSlidesReady(Runtime, expectedCount, logger);
      if (allReady) {
        const totalElapsed = Math.round((Date.now() - startTime) / 1000);
        logger(`All slides ready after ${Math.round(totalElapsed / 60)}m!`);
        break;
      }
    }
  }

  const totalElapsed = Math.round((Date.now() - startTime) / 1000);
  if (!allReady) {
    logger(`\nTimeout after ${Math.round(totalElapsed / 60)}m - proceeding with download of ready slides`);
  }

  // ========================================
  // PHASE 3: DOWNLOAD ALL SLIDES
  // ========================================
  logger('\n' + '='.repeat(50));
  logger('PHASE 3: DOWNLOADING SLIDES');
  logger('='.repeat(50));

  // Wait a moment for UI to stabilize
  await delay(2000);

  const results: ArtifactDownloadResult[] = [];
  const { downloadAllArtifacts } = await import('./downloadHandler.js');

  // Download all slides starting from initialCount
  const downloads = await downloadAllArtifacts(
    client,
    'slides',
    outputDir,
    triggered,
    initialCount,
    logger,
  );

  results.push(...downloads);

  // ========================================
  // SUMMARY
  // ========================================
  logger('\n' + '='.repeat(50));
  logger(`COMPLETED: ${results.length}/${triggered.length} slide decks downloaded`);
  logger('='.repeat(50));

  for (const r of results) {
    logger(`  ✓ ${r.filename}`);
  }

  return results;
}
