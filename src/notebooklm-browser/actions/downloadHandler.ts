/**
 * Download Handler for NotebookLM Browser Automation
 * Handles artifact downloads using CDP
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { ChromeClient } from '../../browser/types.js';
import type { BrowserLogger, ArtifactType, ArtifactDownloadResult } from '../types.js';
import { ARTIFACT_SELECTORS, DOWNLOAD_SELECTORS, NOTEBOOKLM_TIMEOUTS } from '../constants.js';
import { delay } from '../../browser/utils.js';

interface DownloadInfo {
  guid: string;
  url: string;
  suggestedFilename: string;
  state?: string;
}

/**
 * Set up download directory for CDP downloads
 */
export async function setupDownloadDirectory(
  Browser: ChromeClient['Browser'],
  Page: ChromeClient['Page'],
  outputDir: string,
  logger: BrowserLogger,
): Promise<void> {
  // Ensure directory exists
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
    logger(`Created download directory: ${outputDir}`);
  }

  // Set download behavior
  await Browser.setDownloadBehavior({
    behavior: 'allowAndName',
    downloadPath: outputDir,
    eventsEnabled: true,
  });

  logger(`Download directory set to: ${outputDir}`);
}

/**
 * Click the More menu on an artifact and then Download
 */
export async function triggerArtifactDownload(
  Runtime: ChromeClient['Runtime'],
  artifactType: ArtifactType,
  index: number = -1, // -1 means last artifact
  logger: BrowserLogger,
): Promise<boolean> {
  const selector = ARTIFACT_SELECTORS[artifactType];
  const moreSelectors = JSON.stringify(DOWNLOAD_SELECTORS.moreButton);
  const downloadSelectors = JSON.stringify(DOWNLOAD_SELECTORS.downloadButton);

  logger(`Triggering download for ${artifactType} (index: ${index})`);

  // First, click the More button on the artifact
  const moreResult = await Runtime.evaluate({
    expression: `(async () => {
      const selector = ${JSON.stringify(selector)};
      const moreSelectors = ${moreSelectors};

      const artifacts = document.querySelectorAll(selector);
      if (artifacts.length === 0) return { error: 'no artifacts' };

      const idx = ${index} < 0 ? artifacts.length - 1 : ${index};
      if (idx >= artifacts.length) return { error: 'index out of range' };

      const artifact = artifacts[idx];

      // Find the artifact container
      const container = artifact.closest('.artifact-item-button') || artifact.parentElement;
      if (!container) return { error: 'no container' };

      // Find and click More button
      for (const sel of moreSelectors) {
        let btn;
        // First try within container
        btn = container.querySelector(sel);
        if (!btn) {
          // Fall back to artifact parent
          btn = artifact.parentElement?.querySelector(sel);
        }
        if (btn) {
          btn.click();
          return { clicked: true };
        }
      }

      // Try hovering to reveal button
      artifact.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
      await new Promise(r => setTimeout(r, 300));

      for (const sel of moreSelectors) {
        const btn = container.querySelector(sel) || document.querySelector(sel);
        if (btn) {
          btn.click();
          return { clicked: true, viaHover: true };
        }
      }

      return { error: 'more button not found' };
    })()`,
    awaitPromise: true,
    returnByValue: true,
  });

  const moreOutcome = moreResult.result?.value as { clicked?: boolean; error?: string } | undefined;

  if (!moreOutcome?.clicked) {
    logger(`Could not click More button: ${moreOutcome?.error}`);
    return false;
  }

  // Wait for menu to appear
  await delay(500);

  // Click Download in the menu
  const downloadResult = await Runtime.evaluate({
    expression: `(async () => {
      const downloadSelectors = ${downloadSelectors};

      // Wait a bit for menu animation
      await new Promise(r => setTimeout(r, 200));

      // Find Download button in menu
      for (const sel of downloadSelectors) {
        // Handle :has-text selector
        let elements;
        if (sel.includes(':has-text')) {
          const match = sel.match(/(.+):has-text\\(['"](.+)['"]\\)/);
          if (match) {
            const [, baseSelector, text] = match;
            elements = Array.from(document.querySelectorAll(baseSelector || 'button, [role="menuitem"]'));
            elements = elements.filter(el =>
              el.textContent?.toLowerCase().includes(text.toLowerCase())
            );
          }
        } else {
          elements = document.querySelectorAll(sel);
        }

        if (elements?.length > 0) {
          for (const el of elements) {
            if (el.offsetParent !== null) { // Visible
              el.click();
              return { clicked: true };
            }
          }
        }
      }

      // Fallback: find any visible button/menuitem with "Download" text
      const allItems = document.querySelectorAll('button, [role="menuitem"]');
      for (const item of allItems) {
        if (item.offsetParent !== null && item.textContent?.toLowerCase().includes('download')) {
          item.click();
          return { clicked: true, fallback: true };
        }
      }

      return { error: 'download button not found' };
    })()`,
    awaitPromise: true,
    returnByValue: true,
  });

  const downloadOutcome = downloadResult.result?.value as { clicked?: boolean; error?: string } | undefined;

  if (!downloadOutcome?.clicked) {
    logger(`Could not click Download: ${downloadOutcome?.error}`);
    return false;
  }

  logger('Download triggered successfully');
  return true;
}

/**
 * Wait for a download to complete
 * Returns the downloaded file info
 */
export async function waitForDownload(
  Browser: ChromeClient['Browser'],
  outputDir: string,
  logger: BrowserLogger,
  timeoutMs: number = NOTEBOOKLM_TIMEOUTS.downloadReady,
): Promise<{ filename: string; path: string } | null> {
  const deadline = Date.now() + timeoutMs;

  // Monitor the output directory for new files
  const existingFiles = new Set(fs.existsSync(outputDir) ? fs.readdirSync(outputDir) : []);

  logger('Waiting for download to complete...');

  while (Date.now() < deadline) {
    await delay(500);

    // Check for new files
    const currentFiles = fs.readdirSync(outputDir);
    for (const file of currentFiles) {
      if (!existingFiles.has(file)) {
        // New file found
        const filePath = path.join(outputDir, file);

        // Skip temporary download files
        if (file.endsWith('.crdownload') || file.endsWith('.tmp') || file.startsWith('.')) {
          continue;
        }

        // Verify file is complete (size isn't changing)
        const stat1 = fs.statSync(filePath);
        await delay(200);

        if (!fs.existsSync(filePath)) continue;
        const stat2 = fs.statSync(filePath);

        if (stat1.size === stat2.size && stat2.size > 0) {
          logger(`Download complete: ${file}`);
          return { filename: file, path: filePath };
        }
      }
    }
  }

  logger('Download timeout');
  return null;
}

/**
 * Download the latest artifact of a given type
 */
export async function downloadLatestArtifact(
  client: ChromeClient,
  artifactType: ArtifactType,
  outputDir: string,
  prefix: string,
  logger: BrowserLogger,
): Promise<ArtifactDownloadResult | null> {
  const { Browser, Page, Runtime } = client;

  // Setup download directory
  await setupDownloadDirectory(Browser, Page, outputDir, logger);

  // Trigger download
  const triggered = await triggerArtifactDownload(Runtime, artifactType, -1, logger);
  if (!triggered) {
    return null;
  }

  // Wait for download
  const download = await waitForDownload(Browser, outputDir, logger);
  if (!download) {
    return null;
  }

  // Rename with prefix if needed
  let finalPath = download.path;
  let finalFilename = download.filename;

  // Always format to ensure proper extension, even without prefix
  finalFilename = formatFilename(download.filename, prefix, artifactType);
  finalPath = path.join(outputDir, finalFilename);

  if (download.path !== finalPath) {
    fs.renameSync(download.path, finalPath);
    logger(`Renamed to: ${finalFilename}`);
  }

  return {
    filename: finalFilename,
    path: finalPath,
    suggestedFilename: download.filename,
    artifactType,
  };
}

/**
 * Download all artifacts of a given type
 * @param audiences Optional array of audience names to use as prefixes (for batch downloads)
 * @param startIndex Start downloading from this index (skip earlier artifacts)
 */
export async function downloadAllArtifacts(
  client: ChromeClient,
  artifactType: ArtifactType,
  outputDir: string,
  audiences: (string | undefined)[] | string,
  startIndex: number = 0,
  logger: BrowserLogger,
  skipLoading: boolean = true,
): Promise<ArtifactDownloadResult[]> {
  const { Browser, Page, Runtime } = client;
  const selector = ARTIFACT_SELECTORS[artifactType];

  // Setup download directory
  await setupDownloadDirectory(Browser, Page, outputDir, logger);

  // Get artifact count
  const countResult = await Runtime.evaluate({
    expression: `document.querySelectorAll(${JSON.stringify(selector)}).length`,
    returnByValue: true,
  });

  const totalCount = (countResult.result?.value as number) || 0;
  if (totalCount === 0 || totalCount <= startIndex) {
    logger('No new artifacts to download');
    return [];
  }

  // Handle both single prefix string and array of audience names
  const audienceList = Array.isArray(audiences) ? audiences : null;
  const singlePrefix = typeof audiences === 'string' ? audiences : null;

  const results: ArtifactDownloadResult[] = [];
  const artifactsToDownload = totalCount - startIndex;

  logger(`Downloading ${artifactsToDownload} artifacts (starting from index ${startIndex})`);

  for (let i = startIndex; i < totalCount; i++) {
    const relativeIndex = i - startIndex;

    // Check if artifact is still loading
    if (skipLoading) {
      const loadingResult = await Runtime.evaluate({
        expression: `(() => {
          const artifacts = document.querySelectorAll(${JSON.stringify(selector)});
          const artifact = artifacts[${i}];
          if (!artifact) return { loading: false };

          const parent = artifact.closest('.artifact-item-button');
          if (!parent) return { loading: false };

          // Check multiple loading indicators
          const hasShimmer = Array.from(parent.classList).some(c => c.startsWith('shimmer'));
          const titleEl = parent.querySelector('.artifact-title');
          const isGenerating = titleEl?.textContent?.toLowerCase().includes('generating');
          const hasSyncIcon = !!parent.querySelector('mat-icon.rotate');

          return { loading: hasShimmer || isGenerating || hasSyncIcon };
        })()`,
        returnByValue: true,
      });

      const loadResult = loadingResult.result?.value as { loading: boolean } | undefined;
      if (loadResult?.loading) {
        logger(`[${relativeIndex + 1}/${artifactsToDownload}] Skipping (still loading)`);
        continue;
      }
    }

    // Determine prefix based on audience list or single prefix
    let prefix: string;
    if (audienceList && audienceList[relativeIndex]) {
      prefix = `${String(relativeIndex + 1).padStart(2, '0')}_${audienceList[relativeIndex]}`;
    } else if (singlePrefix) {
      prefix = `${String(relativeIndex + 1).padStart(2, '0')}_${singlePrefix}`;
    } else {
      prefix = String(relativeIndex + 1).padStart(2, '0');
    }

    logger(`[${relativeIndex + 1}/${artifactsToDownload}] Downloading...`);

    // Trigger download for this specific artifact
    const triggered = await triggerArtifactDownload(Runtime, artifactType, i, logger);
    if (!triggered) {
      logger(`[${relativeIndex + 1}/${artifactsToDownload}] Failed to trigger download`);
      continue;
    }

    // Wait for download
    const download = await waitForDownload(Browser, outputDir, logger);
    if (!download) {
      logger(`[${relativeIndex + 1}/${artifactsToDownload}] Download timeout`);
      continue;
    }

    // Rename with prefix and ensure proper extension
    const finalFilename = formatFilename(download.filename, prefix, artifactType);
    const finalPath = path.join(outputDir, finalFilename);

    if (download.path !== finalPath) {
      fs.renameSync(download.path, finalPath);
    }

    results.push({
      filename: finalFilename,
      path: finalPath,
      suggestedFilename: download.filename,
      artifactType,
    });

    // Small delay between downloads
    await delay(500);
  }

  logger(`Downloaded ${results.length}/${artifactsToDownload} artifacts`);
  return results;
}

/**
 * Default file extensions for each artifact type
 * NotebookLM sometimes returns files without extensions
 */
const ARTIFACT_EXTENSIONS: Record<ArtifactType, string> = {
  slides: '.pdf',
  audio: '.wav',
  video: '.mp4',
  infographic: '.png',
};

/**
 * Format filename with prefix and ensure proper extension
 */
function formatFilename(suggested: string, prefix: string, artifactType?: ArtifactType): string {
  // Clean prefix (replace spaces with underscores)
  const cleanPrefix = prefix ? prefix.replace(/\s+/g, '_') : '';

  // Check if file already has an extension
  const lastDot = suggested.lastIndexOf('.');
  const hasExtension = lastDot > 0 && lastDot > suggested.length - 6; // Extension should be short

  let name: string;
  let ext: string;

  if (hasExtension) {
    name = suggested.slice(0, lastDot);
    ext = suggested.slice(lastDot); // includes the dot
  } else {
    // No extension - add default based on artifact type
    name = suggested;
    ext = artifactType ? ARTIFACT_EXTENSIONS[artifactType] : '';
  }

  if (cleanPrefix) {
    return `${cleanPrefix}_${name}${ext}`;
  }
  return `${name}${ext}`;
}
