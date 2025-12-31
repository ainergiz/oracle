/**
 * Audio/Podcast Generation for NotebookLM Browser Automation
 */

import type { ChromeClient } from '../../browser/types.js';
import type { BrowserLogger, AudioOptions, ArtifactDownloadResult } from '../types.js';
import { AUDIO_SELECTORS, DEFAULT_CONFIG, NOTEBOOKLM_TIMEOUTS } from '../constants.js';
import { countArtifacts, waitForArtifactReady } from './artifactMonitor.js';
import {
  openCustomizeDialog,
  waitForDialog,
  selectRadioOption,
  selectDropdownOption,
  fillDialogTextarea,
  clickGenerateButton,
} from './dialogInteraction.js';
import { downloadLatestArtifact } from './downloadHandler.js';

/**
 * Generate audio overview (podcast) with customization options
 */
export async function generateAudio(
  client: ChromeClient,
  options: AudioOptions,
  outputDir: string,
  logger: BrowserLogger,
): Promise<ArtifactDownloadResult | null> {
  const { Runtime } = client;

  // Get initial artifact count
  const initialCount = await countArtifacts(Runtime, 'audio');
  logger(`Initial audio count: ${initialCount}`);

  // Open customization dialog
  const dialogOpened = await openCustomizeDialog(Runtime, 'audio', logger);
  if (!dialogOpened) {
    // Try direct generation if dialog doesn't open
    logger('Could not open customize dialog, attempting direct generation');
    return await tryDirectAudioGeneration(client, initialCount, outputDir, logger);
  }

  // Wait for dialog to appear
  const dialogReady = await waitForDialog(Runtime);
  if (!dialogReady) {
    logger('Dialog did not appear');
    return null;
  }

  // Configure options
  await configureAudioOptions(Runtime, options, logger);

  // Click Generate
  const generated = await clickGenerateButton(Runtime, logger);
  if (!generated) {
    logger('Failed to click Generate button');
    return null;
  }

  // Wait for artifact to be ready (audio takes longer - 10 min)
  const ready = await waitForArtifactReady(
    Runtime,
    'audio',
    initialCount,
    logger,
    NOTEBOOKLM_TIMEOUTS.audioGeneration,
  );

  if (!ready) {
    logger('Audio generation timed out');
    return null;
  }

  // Download the artifact
  const format = options.format ?? DEFAULT_CONFIG.audioFormat;
  const result = await downloadLatestArtifact(client, 'audio', outputDir, format, logger);

  return result;
}

/**
 * Configure audio generation options in the dialog
 */
async function configureAudioOptions(
  Runtime: ChromeClient['Runtime'],
  options: AudioOptions,
  logger: BrowserLogger,
): Promise<void> {
  // Select format
  if (options.format) {
    const formatMap: Record<string, string> = {
      'deep-dive': 'Deep dive',
      brief: 'Brief',
      critique: 'Critique',
      debate: 'Debate',
    };
    const formatText = formatMap[options.format] ?? 'Deep dive';
    await selectRadioOption(Runtime, formatText, logger);
  }

  // Select language
  if (options.language && options.language !== 'en-US') {
    await selectDropdownOption(Runtime, 'language', getLanguageDisplayName(options.language), logger);
  }

  // Fill custom prompt
  if (options.customPrompt) {
    await fillDialogTextarea(Runtime, options.customPrompt, logger);
  }
}

/**
 * Try direct audio generation without dialog
 * Some UI states may not have a customize option
 */
async function tryDirectAudioGeneration(
  client: ChromeClient,
  initialCount: number,
  outputDir: string,
  logger: BrowserLogger,
): Promise<ArtifactDownloadResult | null> {
  const { Runtime } = client;

  // Try to click the main audio generate button
  const clickResult = await Runtime.evaluate({
    expression: `(() => {
      // Find audio artifact button container
      const containers = document.querySelectorAll('.create-artifact-button-container');
      for (const container of containers) {
        const label = container.getAttribute('aria-label')?.toLowerCase() || '';
        if (label.includes('audio')) {
          // Find and click the generate button
          const btn = container.querySelector('button:not(.edit-button)');
          if (btn) {
            btn.click();
            return { clicked: true };
          }
        }
      }
      return { clicked: false };
    })()`,
    returnByValue: true,
  });

  const outcome = clickResult.result?.value as { clicked?: boolean } | undefined;

  if (!outcome?.clicked) {
    logger('Could not find audio generate button');
    return null;
  }

  // Wait for artifact to be ready
  const ready = await waitForArtifactReady(
    Runtime,
    'audio',
    initialCount,
    logger,
    NOTEBOOKLM_TIMEOUTS.audioGeneration,
  );

  if (!ready) {
    logger('Audio generation timed out');
    return null;
  }

  // Download
  return await downloadLatestArtifact(client, 'audio', outputDir, 'audio', logger);
}

/**
 * Get display name for language code
 */
function getLanguageDisplayName(code: string): string {
  const languageNames: Record<string, string> = {
    'en-US': 'English (US)',
    'en-GB': 'English (UK)',
    'en-AU': 'English (Australia)',
    'es-ES': 'Spanish (Spain)',
    'es-MX': 'Spanish (Mexico)',
    'fr-FR': 'French',
    'de-DE': 'German',
    'it-IT': 'Italian',
    'pt-BR': 'Portuguese (Brazil)',
    'pt-PT': 'Portuguese (Portugal)',
    'ja-JP': 'Japanese',
    'ko-KR': 'Korean',
    'zh-CN': 'Chinese (Simplified)',
    'zh-TW': 'Chinese (Traditional)',
    'ru-RU': 'Russian',
    'ar-SA': 'Arabic',
    'hi-IN': 'Hindi',
    'nl-NL': 'Dutch',
    'pl-PL': 'Polish',
    'sv-SE': 'Swedish',
  };

  return languageNames[code] ?? code;
}
