/**
 * Infographic Generation for NotebookLM Browser Automation
 */

import type { ChromeClient } from '../../browser/types.js';
import type { BrowserLogger, InfographicOptions, ArtifactDownloadResult } from '../types.js';
import { INFOGRAPHIC_SELECTORS, DEFAULT_CONFIG } from '../constants.js';
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
 * Generate infographic with customization options
 */
export async function generateInfographic(
  client: ChromeClient,
  options: InfographicOptions,
  outputDir: string,
  logger: BrowserLogger,
): Promise<ArtifactDownloadResult | null> {
  const { Runtime } = client;

  // Get initial artifact count
  const initialCount = await countArtifacts(Runtime, 'infographic');
  logger(`Initial infographic count: ${initialCount}`);

  // Open customization dialog
  const dialogOpened = await openCustomizeDialog(Runtime, 'infographic', logger);
  if (!dialogOpened) {
    logger('Failed to open infographic customization dialog');
    return null;
  }

  // Wait for dialog to appear
  const dialogReady = await waitForDialog(Runtime);
  if (!dialogReady) {
    logger('Dialog did not appear');
    return null;
  }

  // Configure options
  await configureInfographicOptions(Runtime, options, logger);

  // Click Generate
  const generated = await clickGenerateButton(Runtime, logger);
  if (!generated) {
    logger('Failed to click Generate button');
    return null;
  }

  // Wait for artifact to be ready
  const ready = await waitForArtifactReady(Runtime, 'infographic', initialCount, logger);
  if (!ready) {
    logger('Infographic generation timed out');
    return null;
  }

  // Download the artifact
  const orientation = options.orientation ?? DEFAULT_CONFIG.infographicOrientation;
  const result = await downloadLatestArtifact(client, 'infographic', outputDir, orientation, logger);

  return result;
}

/**
 * Configure infographic generation options in the dialog
 */
async function configureInfographicOptions(
  Runtime: ChromeClient['Runtime'],
  options: InfographicOptions,
  logger: BrowserLogger,
): Promise<void> {
  // Select orientation
  if (options.orientation) {
    const orientationText = options.orientation.charAt(0).toUpperCase() + options.orientation.slice(1);
    // Try both toggle and radio (UI may vary)
    const toggleSelected = await selectToggleOption(Runtime, orientationText, logger);
    if (!toggleSelected) {
      await selectRadioOption(Runtime, orientationText, logger);
    }
  }

  // Select detail level
  if (options.detail) {
    const detailText = options.detail.charAt(0).toUpperCase() + options.detail.slice(1);
    // Try both toggle and radio
    const toggleSelected = await selectToggleOption(Runtime, detailText, logger);
    if (!toggleSelected) {
      await selectRadioOption(Runtime, detailText, logger);
    }
  }

  // Fill custom prompt
  if (options.customPrompt) {
    await fillDialogTextarea(Runtime, options.customPrompt, logger);
  }
}

/**
 * Generate infographics for multiple orientations
 */
export async function generateInfographicsForOrientations(
  client: ChromeClient,
  orientations: InfographicOptions['orientation'][],
  baseOptions: Omit<InfographicOptions, 'orientation'>,
  outputDir: string,
  logger: BrowserLogger,
): Promise<ArtifactDownloadResult[]> {
  const results: ArtifactDownloadResult[] = [];

  for (const orientation of orientations) {
    logger(`\nGenerating infographic: ${orientation}`);

    const options: InfographicOptions = {
      ...baseOptions,
      orientation,
    };

    const result = await generateInfographic(client, options, outputDir, logger);
    if (result) {
      results.push(result);
    }
  }

  logger(`\nGenerated ${results.length}/${orientations.length} infographics`);
  return results;
}
