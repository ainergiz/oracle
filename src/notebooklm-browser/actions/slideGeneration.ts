/**
 * Slide Generation for NotebookLM Browser Automation
 */

import type { ChromeClient } from '../../browser/types.js';
import type { BrowserLogger, SlideOptions, ArtifactDownloadResult } from '../types.js';
import { SLIDE_SELECTORS, SLIDE_AUDIENCE_PROMPTS, DEFAULT_CONFIG } from '../constants.js';
import { countArtifacts, waitForArtifactReady } from './artifactMonitor.js';
import {
  openCustomizeDialog,
  waitForDialog,
  selectRadioOption,
  selectToggleOption,
  fillDialogTextarea,
  clickGenerateButton,
} from './dialogInteraction.js';
import { downloadLatestArtifact } from './downloadHandler.js';

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

  // Get initial artifact count
  const initialCount = await countArtifacts(Runtime, 'slides');
  logger(`Initial slide count: ${initialCount}`);

  // Open customization dialog
  const dialogOpened = await openCustomizeDialog(Runtime, 'slides', logger);
  if (!dialogOpened) {
    logger('Failed to open slides customization dialog');
    return null;
  }

  // Wait for dialog to appear
  const dialogReady = await waitForDialog(Runtime);
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
 * Generate multiple slide decks for different audiences
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
