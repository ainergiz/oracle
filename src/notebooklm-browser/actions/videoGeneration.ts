/**
 * Video Generation for NotebookLM Browser Automation
 */

import type { ChromeClient } from '../../browser/types.js';
import type { BrowserLogger, VideoOptions, ArtifactDownloadResult } from '../types.js';
import { VIDEO_SELECTORS, VIDEO_THEME_DESCRIPTIONS, DEFAULT_CONFIG, NOTEBOOKLM_TIMEOUTS } from '../constants.js';
import { countArtifacts, waitForArtifactReady } from './artifactMonitor.js';
import {
  openCustomizeDialog,
  waitForDialog,
  selectRadioOption,
  selectToggleOption,
  fillDialogTextarea,
  fillDialogInput,
  clickGenerateButton,
} from './dialogInteraction.js';
import { downloadLatestArtifact } from './downloadHandler.js';

/**
 * Generate video overview with customization options
 */
export async function generateVideo(
  client: ChromeClient,
  options: VideoOptions,
  outputDir: string,
  logger: BrowserLogger,
): Promise<ArtifactDownloadResult | null> {
  const { Runtime } = client;

  // Get initial artifact count
  const initialCount = await countArtifacts(Runtime, 'video');
  logger(`Initial video count: ${initialCount}`);

  // Open customization dialog
  const dialogOpened = await openCustomizeDialog(Runtime, 'video', logger);
  if (!dialogOpened) {
    logger('Failed to open video customization dialog');
    return null;
  }

  // Wait for dialog to appear
  const dialogReady = await waitForDialog(Runtime);
  if (!dialogReady) {
    logger('Dialog did not appear');
    return null;
  }

  // Configure options
  await configureVideoOptions(Runtime, options, logger);

  // Click Generate
  const generated = await clickGenerateButton(Runtime, logger);
  if (!generated) {
    logger('Failed to click Generate button');
    return null;
  }

  // Wait for artifact to be ready (video takes longest - 15 min)
  const ready = await waitForArtifactReady(
    Runtime,
    'video',
    initialCount,
    logger,
    NOTEBOOKLM_TIMEOUTS.videoGeneration,
  );

  if (!ready) {
    logger('Video generation timed out');
    return null;
  }

  // Download the artifact
  const theme = options.theme ?? DEFAULT_CONFIG.videoTheme;
  const result = await downloadLatestArtifact(client, 'video', outputDir, theme, logger);

  return result;
}

/**
 * Configure video generation options in the dialog
 */
async function configureVideoOptions(
  Runtime: ChromeClient['Runtime'],
  options: VideoOptions,
  logger: BrowserLogger,
): Promise<void> {
  // Select format
  if (options.format) {
    const formatText = options.format.charAt(0).toUpperCase() + options.format.slice(1);
    // Try both radio and toggle (UI may vary)
    const radioSelected = await selectRadioOption(Runtime, formatText, logger);
    if (!radioSelected) {
      await selectToggleOption(Runtime, formatText, logger);
    }
  }

  // Select theme (or use custom theme)
  if (options.customTheme) {
    // Fill custom theme input
    await fillDialogInput(Runtime, 'theme', options.customTheme, logger);
  } else if (options.theme) {
    const themeMap: Record<string, string> = {
      'retro-90s': 'Retro',
      futuristic: 'Futuristic',
      corporate: 'Corporate',
      minimal: 'Minimal',
    };
    const themeText = themeMap[options.theme] ?? 'Corporate';

    // Try both radio and toggle
    const radioSelected = await selectRadioOption(Runtime, themeText, logger);
    if (!radioSelected) {
      await selectToggleOption(Runtime, themeText, logger);
    }
  }

  // Fill custom prompt
  if (options.customPrompt) {
    await fillDialogTextarea(Runtime, options.customPrompt, logger);
  }
}

/**
 * Generate video with a specific theme description
 */
export async function generateVideoWithTheme(
  client: ChromeClient,
  themeDescription: string,
  format: VideoOptions['format'] = 'explainer',
  outputDir: string,
  logger: BrowserLogger,
): Promise<ArtifactDownloadResult | null> {
  const options: VideoOptions = {
    format,
    customTheme: themeDescription,
  };

  return generateVideo(client, options, outputDir, logger);
}
