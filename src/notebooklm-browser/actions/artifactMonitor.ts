/**
 * Artifact Monitor for NotebookLM Browser Automation
 * Monitors artifact generation status using shimmer detection
 */

import type { ChromeClient } from '../../browser/types.js';
import type { BrowserLogger, ArtifactType, ArtifactStatus } from '../types.js';
import { ARTIFACT_SELECTORS, NOTEBOOKLM_TIMEOUTS, getArtifactTimeout } from '../constants.js';
import { delay } from '../../browser/utils.js';

/**
 * Count current artifacts of a given type
 */
export async function countArtifacts(
  Runtime: ChromeClient['Runtime'],
  artifactType: ArtifactType,
): Promise<number> {
  const selector = ARTIFACT_SELECTORS[artifactType];

  const { result } = await Runtime.evaluate({
    expression: `(() => {
      const selector = ${JSON.stringify(selector)};
      const artifacts = document.querySelectorAll(selector);
      return artifacts.length;
    })()`,
    returnByValue: true,
  });

  return typeof result?.value === 'number' ? result.value : 0;
}

/**
 * Check if a specific artifact is still loading
 * NotebookLM uses shimmer-* CSS classes, disabled button state, and "Generating" text
 */
export async function isArtifactLoading(
  Runtime: ChromeClient['Runtime'],
  artifactType: ArtifactType,
  index: number = -1, // -1 means check the last/latest artifact
): Promise<boolean> {
  const selector = ARTIFACT_SELECTORS[artifactType];

  const { result } = await Runtime.evaluate({
    expression: `(() => {
      const selector = ${JSON.stringify(selector)};
      const artifacts = document.querySelectorAll(selector);
      if (artifacts.length === 0) return { found: false, loading: false };

      // Get the artifact at index (-1 means last one)
      const idx = ${index} < 0 ? artifacts.length - 1 : ${index};
      if (idx >= artifacts.length) return { found: false, loading: false };

      const artifact = artifacts[idx];

      // Check parent container
      const parent = artifact.closest('.artifact-item-button');
      if (!parent) return { found: true, loading: false };

      // Multiple loading indicators to check:

      // 1. Shimmer class (can be shimmer, shimmer-yellow, shimmer-blue, etc.)
      const hasShimmer = Array.from(parent.classList).some(c => c.startsWith('shimmer'));

      // 2. Button is disabled
      const button = parent.querySelector('button');
      const isDisabled = button?.disabled || button?.classList.contains('mat-mdc-button-disabled');

      // 3. Title contains "Generating"
      const titleEl = parent.querySelector('.artifact-title');
      const titleText = titleEl?.textContent?.toLowerCase() || '';
      const isGenerating = titleText.includes('generating');

      // 4. Has rotating sync icon
      const syncIcon = parent.querySelector('mat-icon.rotate');
      const hasSyncIcon = !!syncIcon;

      // Loading if ANY of these are true
      const loading = hasShimmer || isGenerating || hasSyncIcon;

      return {
        found: true,
        loading,
        indicators: { hasShimmer, isDisabled, isGenerating, hasSyncIcon }
      };
    })()`,
    returnByValue: true,
  });

  const outcome = result?.value as {
    found?: boolean;
    loading?: boolean;
    indicators?: { hasShimmer: boolean; isDisabled: boolean; isGenerating: boolean; hasSyncIcon: boolean };
  } | undefined;
  return outcome?.loading ?? false;
}

/**
 * Get the status of all artifacts of a given type
 */
export async function getArtifactStatus(
  Runtime: ChromeClient['Runtime'],
  artifactType: ArtifactType,
): Promise<ArtifactStatus> {
  const selector = ARTIFACT_SELECTORS[artifactType];

  const { result } = await Runtime.evaluate({
    expression: `(() => {
      const selector = ${JSON.stringify(selector)};
      const artifacts = document.querySelectorAll(selector);
      const total = artifacts.length;

      let loadingCount = 0;
      for (const artifact of artifacts) {
        const parent = artifact.closest('.artifact-item-button');
        if (!parent) continue;

        // Check multiple loading indicators
        const hasShimmer = Array.from(parent.classList).some(c => c.startsWith('shimmer'));
        const titleEl = parent.querySelector('.artifact-title');
        const isGenerating = titleEl?.textContent?.toLowerCase().includes('generating');
        const hasSyncIcon = !!parent.querySelector('mat-icon.rotate');

        if (hasShimmer || isGenerating || hasSyncIcon) {
          loadingCount++;
        }
      }

      return {
        totalCount: total,
        loadingCount: loadingCount,
        readyCount: total - loadingCount,
      };
    })()`,
    returnByValue: true,
  });

  const status = result?.value as ArtifactStatus | undefined;
  return status ?? { totalCount: 0, loadingCount: 0, readyCount: 0 };
}

/**
 * Wait for a NEW artifact to appear AND finish loading
 * Uses artifact counting for progress tracking and shimmer detection for completion
 */
export async function waitForArtifactReady(
  Runtime: ChromeClient['Runtime'],
  artifactType: ArtifactType,
  initialCount: number,
  logger: BrowserLogger,
  timeoutMs?: number,
): Promise<boolean> {
  const timeout = timeoutMs ?? getArtifactTimeout(artifactType);
  const pollInterval = NOTEBOOKLM_TIMEOUTS.artifactPoll;
  const deadline = Date.now() + timeout;

  logger(`Waiting for ${artifactType} to generate (initial count: ${initialCount})`);

  let artifactAppeared = false;
  let lastLogTime = Date.now();

  while (Date.now() < deadline) {
    await delay(pollInterval);

    const currentCount = await countArtifacts(Runtime, artifactType);

    if (currentCount > initialCount) {
      if (!artifactAppeared) {
        logger(`New ${artifactType} appeared (count: ${currentCount})`);
        artifactAppeared = true;
      }

      // Check if the latest artifact is still loading
      const loading = await isArtifactLoading(Runtime, artifactType, -1);
      if (!loading) {
        const elapsed = Math.round((timeout - (deadline - Date.now())) / 1000);
        logger(`${artifactType} ready (took ~${elapsed}s)`);
        return true;
      }

      // Log progress every 20 seconds
      if (Date.now() - lastLogTime > 20_000) {
        const elapsed = Math.round((timeout - (deadline - Date.now())) / 1000);
        logger(`Still loading ${artifactType}... (${elapsed}s)`);
        lastLogTime = Date.now();
      }
    } else {
      // Log progress every 30 seconds while waiting for artifact to appear
      if (Date.now() - lastLogTime > 30_000) {
        const elapsed = Math.round((timeout - (deadline - Date.now())) / 1000);
        logger(`Still generating ${artifactType}... (${elapsed}s)`);
        lastLogTime = Date.now();
      }
    }
  }

  logger(`Timeout waiting for ${artifactType} (${Math.round(timeout / 1000)}s)`);
  return false;
}

/**
 * Wait for multiple artifacts to be ready
 * Useful for batch generation workflows
 */
export async function waitForMultipleArtifactsReady(
  Runtime: ChromeClient['Runtime'],
  artifactType: ArtifactType,
  expectedCount: number,
  logger: BrowserLogger,
  timeoutMs?: number,
): Promise<number> {
  const timeout = timeoutMs ?? getArtifactTimeout(artifactType);
  const pollInterval = NOTEBOOKLM_TIMEOUTS.artifactPoll;
  const deadline = Date.now() + timeout;

  logger(`Waiting for ${expectedCount} ${artifactType} to be ready...`);

  let lastLogTime = Date.now();

  while (Date.now() < deadline) {
    await delay(pollInterval);

    const status = await getArtifactStatus(Runtime, artifactType);

    // Log progress every 20 seconds
    if (Date.now() - lastLogTime > 20_000) {
      const elapsed = Math.round((timeout - (deadline - Date.now())) / 1000);
      logger(
        `[${elapsed}s] Total: ${status.totalCount}, Ready: ${status.readyCount}, Loading: ${status.loadingCount}`,
      );
      lastLogTime = Date.now();
    }

    // All done when we have expected count and none are loading
    if (status.totalCount >= expectedCount && status.loadingCount === 0) {
      logger(`All ${status.totalCount} ${artifactType} ready!`);
      return status.readyCount;
    }
  }

  // Return what we have
  const finalStatus = await getArtifactStatus(Runtime, artifactType);
  logger(
    `Timeout: ${finalStatus.readyCount}/${expectedCount} ${artifactType} ready`,
  );
  return finalStatus.readyCount;
}

/**
 * Get information about an artifact at a specific index
 */
export async function getArtifactInfo(
  Runtime: ChromeClient['Runtime'],
  artifactType: ArtifactType,
  index: number = -1, // -1 means last/latest artifact
): Promise<{ title: string; loading: boolean; type: ArtifactType } | null> {
  const selector = ARTIFACT_SELECTORS[artifactType];

  const { result } = await Runtime.evaluate({
    expression: `(() => {
      const selector = ${JSON.stringify(selector)};
      const artifacts = document.querySelectorAll(selector);
      if (artifacts.length === 0) return null;

      // Get the artifact at index (-1 means last one)
      const idx = ${index} < 0 ? artifacts.length - 1 : ${index};
      if (idx >= artifacts.length) return null;

      const artifact = artifacts[idx];

      // Get title
      const titleEl = artifact.querySelector('.artifact-title');
      const title = titleEl ? titleEl.textContent?.trim() : 'Untitled';

      // Check loading state using multiple indicators
      const parent = artifact.closest('.artifact-item-button');
      let loading = false;
      if (parent) {
        const hasShimmer = Array.from(parent.classList).some(c => c.startsWith('shimmer'));
        const isGenerating = title?.toLowerCase().includes('generating');
        const hasSyncIcon = !!parent.querySelector('mat-icon.rotate');
        loading = hasShimmer || isGenerating || hasSyncIcon;
      }

      return {
        title: title || 'Untitled',
        loading: loading,
      };
    })()`,
    returnByValue: true,
  });

  const info = result?.value as { title: string; loading: boolean } | null;
  if (!info) return null;

  return {
    ...info,
    type: artifactType,
  };
}
