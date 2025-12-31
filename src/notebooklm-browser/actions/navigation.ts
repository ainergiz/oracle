/**
 * NotebookLM Browser Navigation and Login Detection
 */

import type { ChromeClient } from '../../browser/types.js';
import type { BrowserLogger, NotebookLMLoginProbeResult } from '../types.js';
import {
  NOTEBOOKLM_URL,
  LOGIN_SELECTORS,
  NOTEBOOKLM_TIMEOUTS,
} from '../constants.js';
import { delay } from '../../browser/utils.js';

/**
 * Navigate to NotebookLM notebook
 */
export async function navigateToNotebook(
  Page: ChromeClient['Page'],
  Runtime: ChromeClient['Runtime'],
  url: string,
  logger: BrowserLogger,
): Promise<void> {
  logger(`Navigating to ${url}`);
  await Page.navigate({ url });
  await waitForDocumentReady(Runtime, NOTEBOOKLM_TIMEOUTS.navigation);
}

/**
 * Wait for document to reach ready state
 */
async function waitForDocumentReady(
  Runtime: ChromeClient['Runtime'],
  timeoutMs: number,
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const { result } = await Runtime.evaluate({
      expression: 'document.readyState',
      returnByValue: true,
    });
    if (result?.value === 'complete' || result?.value === 'interactive') {
      return;
    }
    await delay(100);
  }
  throw new Error('Page did not reach ready state in time');
}

/**
 * Handle Google consent screen if present
 */
export async function handleGoogleConsent(
  Runtime: ChromeClient['Runtime'],
  logger: BrowserLogger,
): Promise<boolean> {
  const expression = `(() => {
    // Check if we're on consent page
    const isConsentPage = location.href.includes('consent.google.com');
    if (!isConsentPage) return { onConsent: false };

    // Try to find and click "Accept all" button
    const buttons = Array.from(document.querySelectorAll('button'));
    const acceptBtn = buttons.find(btn =>
      btn.textContent?.toLowerCase().includes('accept all')
    );

    if (acceptBtn) {
      acceptBtn.click();
      return { onConsent: true, clicked: true };
    }

    return { onConsent: true, clicked: false };
  })()`;

  const { result } = await Runtime.evaluate({
    expression,
    returnByValue: true,
  });

  const outcome = result?.value as { onConsent?: boolean; clicked?: boolean } | undefined;

  if (outcome?.onConsent) {
    if (outcome.clicked) {
      logger('Accepted Google consent dialog');
      await delay(1500); // Wait for redirect
      return true;
    }
    logger('On consent page but could not find accept button');
  }

  return false;
}

/**
 * Check if user is logged into NotebookLM
 */
export async function probeNotebookLMLogin(
  Runtime: ChromeClient['Runtime'],
): Promise<NotebookLMLoginProbeResult> {
  const expression = buildLoginProbeExpression();

  const { result } = await Runtime.evaluate({
    expression,
    awaitPromise: true,
    returnByValue: true,
  });

  return normalizeLoginProbe(result?.value);
}

/**
 * Ensure user is logged into NotebookLM
 */
export async function ensureNotebookLMLoggedIn(
  Runtime: ChromeClient['Runtime'],
  logger: BrowserLogger,
  options: { appliedCookies?: number; manualLogin?: boolean; remoteSession?: boolean } = {},
): Promise<void> {
  const probe = await probeNotebookLMLogin(Runtime);

  if (probe.ok) {
    logger(`NotebookLM login verified (url=${probe.pageUrl ?? 'n/a'})`);
    return;
  }

  // Try account picker if present
  const accountSelected = await attemptGoogleAccountSelection(Runtime, logger);
  if (accountSelected) {
    await delay(2000);
    const retryProbe = await probeNotebookLMLogin(Runtime);
    if (retryProbe.ok) {
      logger('NotebookLM login restored via account picker');
      return;
    }
  }

  // Handle manual login mode
  if (options.manualLogin) {
    logger('Manual login mode: waiting for user to sign into Google...');
    const deadline = Date.now() + NOTEBOOKLM_TIMEOUTS.login;

    while (Date.now() < deadline) {
      const checkProbe = await probeNotebookLMLogin(Runtime);
      if (checkProbe.ok) {
        logger('NotebookLM login detected after manual sign-in');
        return;
      }
      await delay(2000);
    }

    throw new Error('Manual login timed out. Please sign into Google and try again.');
  }

  // Build error message with hints
  const cookieHint = options.remoteSession
    ? 'The remote Chrome session is not signed into Google. Sign in there, then rerun.'
    : (options.appliedCookies ?? 0) === 0
      ? 'No Google cookies were applied. Sign into notebooklm.google.com in Chrome first.'
      : 'Google session appears missing. Sign into notebooklm.google.com in Chrome.';

  throw new Error(`NotebookLM login not detected. ${cookieHint}`);
}

/**
 * Try to select an account from Google account picker
 */
async function attemptGoogleAccountSelection(
  Runtime: ChromeClient['Runtime'],
  logger: BrowserLogger,
): Promise<boolean> {
  const expression = `(() => {
    // Look for account picker elements
    const accountElements = document.querySelectorAll('[data-identifier], .account-picker [role="button"]');

    for (const el of accountElements) {
      const identifier = el.getAttribute('data-identifier') || el.textContent || '';
      // Click the first account that looks like an email
      if (identifier.includes('@')) {
        el.click?.();
        return { clicked: true, account: identifier };
      }
    }

    return { clicked: false };
  })()`;

  const { result } = await Runtime.evaluate({
    expression,
    returnByValue: true,
  });

  const outcome = result?.value as { clicked?: boolean; account?: string } | undefined;

  if (outcome?.clicked) {
    logger(`Selected Google account: ${outcome.account ?? 'unknown'}`);
    return true;
  }

  return false;
}

/**
 * Wait for NotebookLM notebook to be ready
 * Checks for the main app UI elements that indicate the notebook is loaded
 */
export async function ensureNotebookReady(
  Runtime: ChromeClient['Runtime'],
  timeoutMs: number = NOTEBOOKLM_TIMEOUTS.pageReady,
  logger: BrowserLogger,
): Promise<void> {
  const ready = await waitForNotebookApp(Runtime, timeoutMs);

  if (!ready) {
    // Check if we're stuck on auth page
    const currentUrl = await getCurrentUrl(Runtime);
    if (currentUrl && isGoogleAuthUrl(currentUrl)) {
      logger('Google auth page detected; waiting for login to complete...');
      const extended = Math.min(timeoutMs * 4, NOTEBOOKLM_TIMEOUTS.login);
      const loggedIn = await waitForNotebookApp(Runtime, extended);
      if (loggedIn) {
        return;
      }
    }
    throw new Error('NotebookLM notebook did not load before timeout');
  }

  logger('NotebookLM notebook is ready');
}

/**
 * Wait for NotebookLM app UI elements
 */
async function waitForNotebookApp(
  Runtime: ChromeClient['Runtime'],
  timeoutMs: number,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;

  // Selectors that indicate the notebook app is loaded
  const appSelectors = [
    // Artifact creation area
    '.create-artifact-button-container',
    // Studio panel
    '.studio-panel',
    // Source panel
    '.source-panel',
    // Query input
    'textarea.query-box-input',
    // Main notebook container
    '.notebook-container',
    // Any artifact buttons (slides, audio, etc)
    "button[aria-description='Slides']",
    "button[aria-description='Audio Overview']",
  ];
  const selectorsJson = JSON.stringify(appSelectors);

  while (Date.now() < deadline) {
    const { result } = await Runtime.evaluate({
      expression: `(() => {
        const selectors = ${selectorsJson};
        for (const selector of selectors) {
          const node = document.querySelector(selector);
          if (node) {
            return true;
          }
        }
        return false;
      })()`,
      returnByValue: true,
    });

    if (result?.value) {
      return true;
    }
    await delay(500);
  }

  return false;
}

/**
 * Get current page URL
 */
async function getCurrentUrl(Runtime: ChromeClient['Runtime']): Promise<string | null> {
  const { result } = await Runtime.evaluate({
    expression: 'typeof location === "object" && location.href ? location.href : null',
    returnByValue: true,
  });
  return typeof result?.value === 'string' ? result.value : null;
}

/**
 * Check if URL is a Google auth page
 */
function isGoogleAuthUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return (
      parsed.hostname.includes('accounts.google.com') ||
      parsed.pathname.includes('/signin') ||
      parsed.pathname.includes('/login')
    );
  } catch {
    return false;
  }
}

/**
 * Build JavaScript expression to probe login state
 */
function buildLoginProbeExpression(): string {
  const loginSelectorsJson = JSON.stringify(LOGIN_SELECTORS);

  return `(async () => {
    const pageUrl = typeof location === 'object' && location?.href ? location.href : null;
    const onAuthPage = pageUrl && (
      pageUrl.includes('accounts.google.com') ||
      pageUrl.includes('/signin') ||
      pageUrl.includes('/login')
    );

    // Check for login buttons/links
    const hasLoginUi = (() => {
      const selectors = ${loginSelectorsJson};
      for (const selector of selectors) {
        try {
          const elements = document.querySelectorAll(selector);
          for (const el of elements) {
            const text = (el.textContent || '').toLowerCase();
            if (text.includes('sign in') || text.includes('log in')) {
              return true;
            }
          }
        } catch {}
      }
      return false;
    })();

    // Check for logged-in indicators (profile image, account button)
    const hasProfileIndicator = (() => {
      const indicators = [
        '[aria-label*="Google Account"]',
        'img[src*="googleusercontent.com"][alt]',
        '[data-ogsr-up]',
        '.gb_d[aria-label]',
      ];
      for (const selector of indicators) {
        if (document.querySelector(selector)) return true;
      }
      return false;
    })();

    // Check if we're on the actual NotebookLM app (not landing page)
    const onNotebookLMApp = pageUrl && (
      pageUrl.includes('notebooklm.google.com/notebook') ||
      pageUrl.includes('notebooklm.google.com/project')
    );

    // Determine login state
    const loggedIn = hasProfileIndicator || (onNotebookLMApp && !hasLoginUi && !onAuthPage);

    return {
      ok: loggedIn,
      pageUrl,
      onAuthPage,
      error: null,
    };
  })()`;
}

/**
 * Normalize login probe result
 */
function normalizeLoginProbe(raw: unknown): NotebookLMLoginProbeResult {
  if (!raw || typeof raw !== 'object') {
    return { ok: false };
  }

  const value = raw as Record<string, unknown>;

  return {
    ok: Boolean(value.ok),
    pageUrl: typeof value.pageUrl === 'string' ? value.pageUrl : null,
    onAuthPage: Boolean(value.onAuthPage),
    error: typeof value.error === 'string' ? value.error : null,
  };
}
