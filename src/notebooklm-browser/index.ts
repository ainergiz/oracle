/**
 * NotebookLM Browser Automation - Main Entry Point
 *
 * Provides browser automation for generating artifacts from NotebookLM notebooks
 * (slides, audio, video, infographics)
 */

import { mkdtemp, rm, mkdir } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

import type { ChromeClient } from '../browser/types.js';
import type {
  NotebookLMBrowserConfig,
  NotebookLMRunOptions,
  NotebookLMRunResult,
  ArtifactDownloadResult,
  BrowserLogger,
  NotebookMode,
} from './types.js';
import {
  NOTEBOOKLM_URL,
  NOTEBOOKLM_COOKIE_URLS,
  NOTEBOOKLM_TIMEOUTS,
} from './constants.js';

// Re-use Chrome lifecycle from browser module
import {
  launchChrome,
  registerTerminationHooks,
  hideChromeWindow,
  connectToChrome,
  connectToRemoteChrome,
} from '../browser/chromeLifecycle.js';
import { syncCookies } from '../browser/cookies.js';
import { delay } from '../browser/utils.js';

// NotebookLM-specific actions
import {
  navigateToNotebook,
  handleGoogleConsent,
  ensureNotebookLMLoggedIn,
  ensureNotebookReady,
} from './actions/navigation.js';
import {
  navigateToHomepage,
  clickCreateButton,
  waitForNewNotebookReady,
  handleUploadDialog,
} from './actions/notebookCreation.js';
import { generateSlides } from './actions/slideGeneration.js';
import { generateAudio } from './actions/audioGeneration.js';
import { generateVideo } from './actions/videoGeneration.js';
import { generateInfographic } from './actions/infographicGeneration.js';

export type { NotebookLMBrowserConfig, NotebookLMRunOptions, NotebookLMRunResult, ArtifactDownloadResult };
export { NOTEBOOKLM_URL };

const DEFAULT_DEBUG_PORT = 9224; // Different from Gemini and ChatGPT

/**
 * Run NotebookLM artifact generation in browser automation mode
 */
export async function runNotebookLMBrowserMode(
  options: NotebookLMRunOptions,
): Promise<NotebookLMRunResult> {
  const { artifactType, sourceFiles } = options;
  const mode: NotebookMode = options.mode ?? 'existing';
  let notebookUrl = options.notebookUrl;

  // Validate options based on mode
  if (mode === 'existing' && !notebookUrl) {
    throw new Error('Notebook URL is required when mode is "existing".');
  }

  const config = resolveNotebookLMConfig(options.config);
  const logger: BrowserLogger = options.log ?? ((_message: string) => {});
  if (logger.verbose === undefined) {
    logger.verbose = Boolean(config.debug);
  }

  if (config.debug) {
    logger(`[notebooklm-browser] config: ${JSON.stringify({ ...config, notebookUrl, artifactType })}`);
  }

  // Remote Chrome mode
  if (config.remoteChrome) {
    return runRemoteNotebookLMBrowserMode(mode, notebookUrl, artifactType, config, logger, options);
  }

  // Local Chrome mode
  const manualLogin = Boolean(config.manualLogin);
  const manualProfileDir = config.manualLoginProfileDir
    ? path.resolve(config.manualLoginProfileDir)
    : path.join(os.homedir(), '.oracle', 'notebooklm-browser-profile');

  const userDataDir = manualLogin
    ? manualProfileDir
    : await mkdtemp(path.join(os.tmpdir(), 'oracle-notebooklm-'));

  if (manualLogin) {
    await mkdir(userDataDir, { recursive: true });
    logger(`Manual login mode; using persistent profile at ${userDataDir}`);
  } else {
    logger(`Created temporary Chrome profile at ${userDataDir}`);
  }

  // Build a compatible config for launchChrome
  // For createNew mode, start at homepage; for existing mode, start at notebook URL
  const initialUrl = mode === 'createNew' ? NOTEBOOKLM_URL : notebookUrl!;
  const chromeConfig = {
    chromeProfile: config.chromeProfile ?? null,
    chromePath: config.chromePath ?? null,
    chromeCookiePath: config.chromeCookiePath ?? null,
    url: initialUrl,
    chatgptUrl: null,
    timeoutMs: config.timeoutMs ?? NOTEBOOKLM_TIMEOUTS.slidesGeneration,
    debugPort: config.debugPort ?? DEFAULT_DEBUG_PORT,
    inputTimeoutMs: config.inputTimeoutMs ?? NOTEBOOKLM_TIMEOUTS.pageReady,
    cookieSync: config.cookieSync ?? true,
    cookieNames: config.cookieNames ?? null,
    cookieSyncWaitMs: 0,
    inlineCookies: config.inlineCookies ?? null,
    inlineCookiesSource: config.inlineCookiesSource ?? null,
    headless: config.headless ?? false,
    keepBrowser: config.keepBrowser ?? false,
    hideWindow: config.hideWindow ?? false,
    desiredModel: null,
    modelStrategy: 'select' as const,
    debug: config.debug ?? false,
    allowCookieErrors: config.allowCookieErrors ?? false,
    remoteChrome: null,
    manualLogin: config.manualLogin ?? false,
    manualLoginProfileDir: config.manualLoginProfileDir ?? null,
    manualLoginCookieSync: config.manualLoginCookieSync ?? false,
    thinkingTime: undefined,
  };

  const chrome = await launchChrome(
    chromeConfig,
    userDataDir,
    logger,
  );

  const effectiveKeepBrowser = Boolean(config.keepBrowser);
  let removeTerminationHooks: (() => void) | null = null;
  let runStatus: 'attempted' | 'complete' = 'attempted';

  try {
    removeTerminationHooks = registerTerminationHooks(chrome, userDataDir, effectiveKeepBrowser, logger, {
      isInFlight: () => runStatus !== 'complete',
      preserveUserDataDir: manualLogin,
    });
  } catch {
    // ignore
  }

  let client: Awaited<ReturnType<typeof connectToChrome>> | null = null;
  const startedAt = Date.now();
  let artifact: ArtifactDownloadResult | null = null;
  let connectionClosedUnexpectedly = false;
  let appliedCookies = 0;

  try {
    client = await connectToChrome(chrome.port, logger);
    const { Network, Page, Runtime, Browser, Input, DOM } = client;

    // Track disconnection
    client.on('disconnect', () => {
      connectionClosedUnexpectedly = true;
      logger('Chrome window closed unexpectedly');
    });

    // Enable required domains
    await Promise.all([
      Network.enable({}),
      Page.enable(),
      Runtime.enable(),
      Browser.setDownloadBehavior({
        behavior: 'allowAndName',
        downloadPath: config.outputDir ?? process.cwd(),
        eventsEnabled: true,
      }),
      DOM?.enable?.(),
    ].filter(Boolean));

    // Hide window if requested
    if (!config.headless && config.hideWindow) {
      await hideChromeWindow(chrome, logger);
    }

    // Clear cookies if not manual login
    if (!manualLogin) {
      await Network.clearBrowserCookies();
    }

    // Sync cookies from Chrome profile
    if (config.cookieSync && (!manualLogin || config.manualLoginCookieSync)) {
      const cookieCount = await syncCookies(
        Network,
        NOTEBOOKLM_COOKIE_URLS[0],
        config.chromeProfile,
        logger,
        {
          allowErrors: config.allowCookieErrors ?? false,
          filterNames: config.cookieNames ?? undefined,
          inlineCookies: config.inlineCookies ?? undefined,
          cookiePath: config.chromeCookiePath ?? undefined,
        },
      );
      appliedCookies = cookieCount;
      logger(cookieCount > 0
        ? `Applied ${cookieCount} Google cookies from Chrome profile`
        : 'No Google cookies found; continuing'
      );
    }

    // Handle navigation based on mode
    if (mode === 'createNew') {
      // Create new notebook mode
      logger('Creating new notebook...');

      // Navigate to homepage
      await navigateToHomepage(Page, Runtime, logger);

      // Handle consent screen if present
      await handleGoogleConsent(Runtime, logger);
      await delay(500);

      // Ensure logged in
      await ensureNotebookLMLoggedIn(Runtime, logger, {
        appliedCookies,
        manualLogin,
      });

      // Click create button
      const created = await clickCreateButton(Runtime, logger);
      if (!created) {
        throw new Error('Failed to click Create new notebook button');
      }

      // Wait for new notebook to be ready
      const newNotebookUrl = await waitForNewNotebookReady(
        Runtime,
        config.inputTimeoutMs ?? NOTEBOOKLM_TIMEOUTS.pageReady,
        logger,
      );

      if (!newNotebookUrl) {
        throw new Error('Failed to create new notebook');
      }

      notebookUrl = newNotebookUrl;
      logger(`New notebook created at: ${notebookUrl}`);

      // Handle the upload dialog that appears after notebook creation
      // Either upload source files or close the dialog
      const uploadedCount = await handleUploadDialog(client, sourceFiles, logger);
      if (sourceFiles?.length) {
        if (uploadedCount > 0) {
          logger(`Uploaded ${uploadedCount} source files`);
        } else {
          logger('Warning: No source files were uploaded');
        }
      }
    } else {
      // Existing notebook mode
      await navigateToNotebook(Page, Runtime, notebookUrl!, logger);

      // Handle consent screen if present
      await handleGoogleConsent(Runtime, logger);
      await delay(500);

      // Ensure logged in
      await ensureNotebookLMLoggedIn(Runtime, logger, {
        appliedCookies,
        manualLogin,
      });
    }

    // Wait for notebook to be ready
    await ensureNotebookReady(Runtime, config.inputTimeoutMs ?? NOTEBOOKLM_TIMEOUTS.pageReady, logger);
    logger('Notebook is ready');

    // Additional wait for full page load
    await delay(2000);

    // Get options for the specific artifact type
    const genOptions = options.options ?? {};
    const outputDir = config.outputDir ?? process.cwd();

    // Generate the requested artifact type
    switch (artifactType) {
      case 'slides':
        artifact = await generateSlides(client, genOptions.slides ?? {}, outputDir, logger);
        break;

      case 'audio':
        artifact = await generateAudio(client, genOptions.audio ?? {}, outputDir, logger);
        break;

      case 'video':
        artifact = await generateVideo(client, genOptions.video ?? {}, outputDir, logger);
        break;

      case 'infographic':
        artifact = await generateInfographic(client, genOptions.infographic ?? {}, outputDir, logger);
        break;

      default:
        throw new Error(`Unsupported artifact type: ${artifactType}`);
    }

    runStatus = 'complete';

    const durationMs = Date.now() - startedAt;
    return {
      answerText: artifact ? `Generated ${artifactType}: ${artifact.filename}` : '',
      answerMarkdown: artifact ? `Generated ${artifactType}: ${artifact.filename}` : '',
      tookMs: durationMs,
      answerTokens: 0,
      answerChars: 0,
      chromePid: chrome.pid,
      chromePort: chrome.port,
      userDataDir,
      controllerPid: process.pid,
      artifact: artifact ?? undefined,
      artifactType,
      generationTimeMs: durationMs,
      notebookReady: true,
    };

  } catch (error) {
    const durationMs = Date.now() - startedAt;
    const errorMessage = error instanceof Error ? error.message : String(error);

    logger(`NotebookLM browser mode failed: ${errorMessage}`);

    return {
      answerText: '',
      answerMarkdown: '',
      tookMs: durationMs,
      answerTokens: 0,
      answerChars: 0,
      chromePid: chrome.pid,
      chromePort: chrome.port,
      userDataDir,
      controllerPid: process.pid,
      error: errorMessage,
      artifactType,
      generationTimeMs: durationMs,
      notebookReady: false,
    };

  } finally {
    // Cleanup
    if (!effectiveKeepBrowser && client) {
      try {
        await client.Browser?.close?.();
      } catch {
        // ignore
      }
    }

    if (removeTerminationHooks) {
      removeTerminationHooks();
    }

    // Clean up temp profile if not keeping browser and not manual login
    if (!effectiveKeepBrowser && !manualLogin) {
      try {
        await rm(userDataDir, { recursive: true, force: true });
      } catch {
        // ignore
      }
    }
  }
}

/**
 * Run NotebookLM with a remote Chrome instance
 */
async function runRemoteNotebookLMBrowserMode(
  mode: NotebookMode,
  notebookUrl: string | undefined,
  artifactType: NotebookLMRunOptions['artifactType'],
  config: NotebookLMBrowserConfig,
  logger: BrowserLogger,
  options: NotebookLMRunOptions,
): Promise<NotebookLMRunResult> {
  const remote = config.remoteChrome!;
  const { sourceFiles } = options;
  logger(`Connecting to remote Chrome at ${remote.host}:${remote.port}`);

  const startedAt = Date.now();
  let artifact: ArtifactDownloadResult | null = null;
  let effectiveNotebookUrl = notebookUrl;

  try {
    const initialUrl = mode === 'createNew' ? NOTEBOOKLM_URL : notebookUrl!;
    const connection = await connectToRemoteChrome(remote.host, remote.port, logger, initialUrl);
    const client = connection.client;
    const { Network, Page, Runtime, Browser } = client;

    // Enable required domains
    await Promise.all([
      Network.enable({}),
      Page.enable(),
      Runtime.enable(),
      Browser.setDownloadBehavior({
        behavior: 'allowAndName',
        downloadPath: config.outputDir ?? process.cwd(),
        eventsEnabled: true,
      }),
    ]);

    // Handle navigation based on mode
    if (mode === 'createNew') {
      // Create new notebook mode
      logger('Creating new notebook...');

      // Navigate to homepage
      await navigateToHomepage(Page, Runtime, logger);

      // Handle consent screen if present
      await handleGoogleConsent(Runtime, logger);
      await delay(500);

      // Ensure logged in
      await ensureNotebookLMLoggedIn(Runtime, logger, { remoteSession: true });

      // Click create button
      const created = await clickCreateButton(Runtime, logger);
      if (!created) {
        throw new Error('Failed to click Create new notebook button');
      }

      // Wait for new notebook to be ready
      const newNotebookUrl = await waitForNewNotebookReady(
        Runtime,
        config.inputTimeoutMs ?? NOTEBOOKLM_TIMEOUTS.pageReady,
        logger,
      );

      if (!newNotebookUrl) {
        throw new Error('Failed to create new notebook');
      }

      effectiveNotebookUrl = newNotebookUrl;
      logger(`New notebook created at: ${effectiveNotebookUrl}`);

      // Handle the upload dialog that appears after notebook creation
      // Either upload source files or close the dialog
      const uploadedCount = await handleUploadDialog(client, sourceFiles, logger);
      if (sourceFiles?.length) {
        if (uploadedCount > 0) {
          logger(`Uploaded ${uploadedCount} source files`);
        } else {
          logger('Warning: No source files were uploaded');
        }
      }
    } else {
      // Existing notebook mode
      await navigateToNotebook(Page, Runtime, notebookUrl!, logger);

      // Handle consent screen if present
      await handleGoogleConsent(Runtime, logger);
      await delay(500);

      // Ensure logged in
      await ensureNotebookLMLoggedIn(Runtime, logger, { remoteSession: true });
    }

    // Wait for notebook to be ready
    await ensureNotebookReady(Runtime, config.inputTimeoutMs ?? NOTEBOOKLM_TIMEOUTS.pageReady, logger);
    logger('Notebook is ready');

    // Additional wait for full page load
    await delay(2000);

    // Get options for the specific artifact type
    const genOptions = options.options ?? {};
    const outputDir = config.outputDir ?? process.cwd();

    // Generate the requested artifact type
    switch (artifactType) {
      case 'slides':
        artifact = await generateSlides(client, genOptions.slides ?? {}, outputDir, logger);
        break;

      case 'audio':
        artifact = await generateAudio(client, genOptions.audio ?? {}, outputDir, logger);
        break;

      case 'video':
        artifact = await generateVideo(client, genOptions.video ?? {}, outputDir, logger);
        break;

      case 'infographic':
        artifact = await generateInfographic(client, genOptions.infographic ?? {}, outputDir, logger);
        break;
    }

    const durationMs = Date.now() - startedAt;
    return {
      answerText: artifact ? `Generated ${artifactType}: ${artifact.filename}` : '',
      answerMarkdown: artifact ? `Generated ${artifactType}: ${artifact.filename}` : '',
      tookMs: durationMs,
      answerTokens: 0,
      answerChars: 0,
      chromePid: 0,
      chromePort: remote.port,
      chromeHost: remote.host,
      userDataDir: '',
      controllerPid: process.pid,
      artifact: artifact ?? undefined,
      artifactType,
      generationTimeMs: durationMs,
      notebookReady: true,
    };

  } catch (error) {
    const durationMs = Date.now() - startedAt;
    const errorMessage = error instanceof Error ? error.message : String(error);

    logger(`NotebookLM remote browser mode failed: ${errorMessage}`);

    return {
      answerText: '',
      answerMarkdown: '',
      tookMs: durationMs,
      answerTokens: 0,
      answerChars: 0,
      chromePid: 0,
      chromePort: remote.port,
      chromeHost: remote.host,
      userDataDir: '',
      controllerPid: process.pid,
      error: errorMessage,
      artifactType,
      generationTimeMs: durationMs,
      notebookReady: false,
    };
  }
}

/**
 * Resolve config with defaults
 */
function resolveNotebookLMConfig(config?: NotebookLMBrowserConfig): NotebookLMBrowserConfig {
  return {
    chromeProfile: config?.chromeProfile ?? null,
    chromePath: config?.chromePath ?? null,
    chromeCookiePath: config?.chromeCookiePath ?? null,
    url: config?.url ?? NOTEBOOKLM_URL,
    timeoutMs: config?.timeoutMs ?? NOTEBOOKLM_TIMEOUTS.slidesGeneration,
    debugPort: config?.debugPort ?? DEFAULT_DEBUG_PORT,
    inputTimeoutMs: config?.inputTimeoutMs ?? NOTEBOOKLM_TIMEOUTS.pageReady,
    cookieSync: config?.cookieSync ?? true,
    cookieNames: config?.cookieNames ?? null,
    inlineCookies: config?.inlineCookies ?? null,
    inlineCookiesSource: config?.inlineCookiesSource ?? null,
    headless: config?.headless ?? false,
    keepBrowser: config?.keepBrowser ?? false,
    hideWindow: config?.hideWindow ?? false,
    debug: config?.debug ?? false,
    allowCookieErrors: config?.allowCookieErrors ?? false,
    remoteChrome: config?.remoteChrome ?? null,
    manualLogin: config?.manualLogin ?? false,
    manualLoginProfileDir: config?.manualLoginProfileDir ?? null,
    manualLoginCookieSync: config?.manualLoginCookieSync ?? false,
    outputDir: config?.outputDir ?? process.cwd(),
  };
}
