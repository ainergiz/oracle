/**
 * Notebook Creation for NotebookLM Browser Automation
 * Handles creating new notebooks and uploading sources
 */

import type { ChromeClient } from '../../browser/types.js';
import type { BrowserLogger } from '../types.js';
import { NOTEBOOKLM_URL, HOMEPAGE_SELECTORS, SOURCE_UPLOAD_SELECTORS, NOTEBOOKLM_TIMEOUTS } from '../constants.js';
import { delay } from '../../browser/utils.js';

/**
 * Navigate to NotebookLM homepage
 */
export async function navigateToHomepage(
  Page: ChromeClient['Page'],
  Runtime: ChromeClient['Runtime'],
  logger: BrowserLogger,
): Promise<void> {
  logger(`Navigating to NotebookLM homepage: ${NOTEBOOKLM_URL}`);

  await Page.navigate({ url: NOTEBOOKLM_URL });

  // Wait for page to load
  await delay(2000);

  // Wait for either login page or homepage to be ready
  const maxWait = NOTEBOOKLM_TIMEOUTS.pageReady;
  const startTime = Date.now();

  while (Date.now() - startTime < maxWait) {
    const result = await Runtime.evaluate({
      expression: `(() => {
        // Check if we're on the homepage (has notebook list or create button)
        const createBtn = document.querySelector("button[aria-label='Create new notebook'], .create-new-button");
        const notebookList = document.querySelector('.notebook-list, .recent-notebooks');
        const loginBtn = document.querySelector('a[href*="ServiceLogin"], button:has-text("Sign in")');

        return {
          hasCreateButton: !!createBtn,
          hasNotebookList: !!notebookList,
          needsLogin: !!loginBtn,
          url: window.location.href,
        };
      })()`,
      returnByValue: true,
    });

    const state = result.result?.value as {
      hasCreateButton?: boolean;
      hasNotebookList?: boolean;
      needsLogin?: boolean;
      url?: string;
    } | undefined;

    if (state?.hasCreateButton || state?.hasNotebookList) {
      logger('Homepage loaded successfully');
      return;
    }

    if (state?.needsLogin) {
      logger('Login required - homepage reached but needs authentication');
      return;
    }

    await delay(500);
  }

  logger('Homepage navigation completed (may need login)');
}

/**
 * Click the Create new notebook button on homepage
 */
export async function clickCreateButton(
  Runtime: ChromeClient['Runtime'],
  logger: BrowserLogger,
): Promise<boolean> {
  logger('Attempting to click Create new notebook button');

  // Try each selector in order
  for (const selector of HOMEPAGE_SELECTORS.createButton) {
    const result = await Runtime.evaluate({
      expression: `(() => {
        const btn = document.querySelector('${selector.replace(/'/g, "\\'")}');
        if (btn && !btn.disabled) {
          btn.click();
          return { clicked: true, selector: '${selector.replace(/'/g, "\\'")}' };
        }
        return { clicked: false };
      })()`,
      returnByValue: true,
    });

    const outcome = result.result?.value as { clicked?: boolean; selector?: string } | undefined;

    if (outcome?.clicked) {
      logger(`Clicked Create button using selector: ${outcome.selector}`);
      return true;
    }
  }

  // Try a more aggressive approach with text content
  const fallbackResult = await Runtime.evaluate({
    expression: `(() => {
      // Find any button with "Create" text
      const buttons = document.querySelectorAll('button');
      for (const btn of buttons) {
        const text = btn.textContent?.toLowerCase() || '';
        const label = btn.getAttribute('aria-label')?.toLowerCase() || '';
        if ((text.includes('create') || label.includes('create')) && !btn.disabled) {
          btn.click();
          return { clicked: true, text: btn.textContent };
        }
      }
      return { clicked: false };
    })()`,
    returnByValue: true,
  });

  const fallbackOutcome = fallbackResult.result?.value as { clicked?: boolean; text?: string } | undefined;

  if (fallbackOutcome?.clicked) {
    logger(`Clicked Create button via text search: ${fallbackOutcome.text}`);
    return true;
  }

  logger('Could not find Create new notebook button');
  return false;
}

/**
 * Check if the "Add sources" upload dialog is currently visible
 */
export async function isUploadDialogVisible(
  Runtime: ChromeClient['Runtime'],
): Promise<boolean> {
  const result = await Runtime.evaluate({
    expression: `(() => {
      // Check for upload dialog by component or role
      const uploadDialog = document.querySelector('upload-dialog');
      const addSourcesDialog = document.querySelector("[role='dialog']");

      if (uploadDialog) {
        return true;
      }

      if (addSourcesDialog) {
        const text = addSourcesDialog.textContent?.toLowerCase() || '';
        return text.includes('add sources') || text.includes('upload');
      }

      return false;
    })()`,
    returnByValue: true,
  });

  return Boolean(result.result?.value);
}

/**
 * Close the upload dialog if it's visible
 */
export async function closeUploadDialog(
  Runtime: ChromeClient['Runtime'],
  logger: BrowserLogger,
): Promise<boolean> {
  logger('Attempting to close upload dialog');

  const result = await Runtime.evaluate({
    expression: `(() => {
      // Try to find and click the close button
      const closeSelectors = [
        "button[aria-label='Close dialogue']",
        "button[aria-label='Close dialog']",
        "button[aria-label='Close']",
        "upload-dialog button.close",
        ".mat-dialog-container button.close",
        "mat-icon:has-text('close')",
      ];

      for (const selector of closeSelectors) {
        const btn = document.querySelector(selector);
        if (btn) {
          btn.click();
          return { closed: true, selector };
        }
      }

      // Try clicking close icon inside dialog
      const dialog = document.querySelector('upload-dialog, [role="dialog"]');
      if (dialog) {
        const closeIcon = dialog.querySelector('mat-icon');
        if (closeIcon && closeIcon.textContent?.trim() === 'close') {
          closeIcon.closest('button')?.click();
          return { closed: true, selector: 'mat-icon close' };
        }
      }

      return { closed: false };
    })()`,
    returnByValue: true,
  });

  const outcome = result.result?.value as { closed?: boolean; selector?: string } | undefined;

  if (outcome?.closed) {
    logger(`Closed upload dialog using: ${outcome.selector}`);
    await delay(500);
    return true;
  }

  logger('Could not close upload dialog');
  return false;
}

/**
 * Wait for new notebook to be ready after creation
 * Returns the new notebook URL
 */
export async function waitForNewNotebookReady(
  Runtime: ChromeClient['Runtime'],
  timeoutMs: number,
  logger: BrowserLogger,
): Promise<string | null> {
  logger('Waiting for new notebook to be ready...');

  const startTime = Date.now();

  while (Date.now() - startTime < timeoutMs) {
    const result = await Runtime.evaluate({
      expression: `(() => {
        const url = window.location.href;
        // Check if URL contains notebook ID pattern
        const isNotebookUrl = url.includes('/notebook/') || url.match(/notebooklm\\.google\\.com\\/[a-zA-Z0-9_-]+$/);

        // Check if upload dialog is showing (this appears immediately after notebook creation)
        const uploadDialog = document.querySelector('upload-dialog');
        const hasUploadDialog = uploadDialog !== null;

        // Check if notebook UI is ready (has artifact generation buttons)
        const hasArtifactButtons = document.querySelector('.create-artifact-button-container, .artifact-item-button');
        const hasSourcePanel = document.querySelector('.source-panel, .sources-container');

        return {
          url,
          isNotebookUrl: !!isNotebookUrl,
          hasUploadDialog,
          isReady: !!(hasArtifactButtons || hasSourcePanel || hasUploadDialog),
        };
      })()`,
      returnByValue: true,
    });

    const state = result.result?.value as {
      url?: string;
      isNotebookUrl?: boolean;
      hasUploadDialog?: boolean;
      isReady?: boolean;
    } | undefined;

    // Notebook is ready when we have the notebook URL and either the upload dialog or UI is showing
    if (state?.isNotebookUrl && state?.isReady) {
      if (state?.hasUploadDialog) {
        logger(`New notebook ready at: ${state.url} (upload dialog showing)`);
      } else {
        logger(`New notebook ready at: ${state.url}`);
      }
      return state.url ?? null;
    }

    if (state?.isNotebookUrl) {
      logger('Notebook URL detected, waiting for UI to load...');
    }

    await delay(1000);
  }

  // Return current URL even if not fully ready
  const finalResult = await Runtime.evaluate({
    expression: `window.location.href`,
    returnByValue: true,
  });

  const finalUrl = finalResult.result?.value as string | undefined;
  logger(`Timeout waiting for notebook ready, current URL: ${finalUrl}`);

  return finalUrl ?? null;
}

/**
 * Upload source files to the notebook using the already-open upload dialog
 * This should be called when the upload dialog is already visible
 */
export async function uploadSources(
  Runtime: ChromeClient['Runtime'],
  sourceFiles: string[],
  logger: BrowserLogger,
): Promise<number> {
  if (!sourceFiles.length) {
    logger('No source files to upload');
    return 0;
  }

  logger(`Attempting to upload ${sourceFiles.length} source files`);

  // Note: Direct file upload via Runtime.evaluate cannot set file input values
  // This function returns 0 - use uploadSourcesWithInput instead
  logger('Note: File upload requires CDP DOM.setFileInputFiles');

  return 0;
}

/**
 * Upload source content using the "Paste text" option
 * This reads file contents and pastes them as text - more reliable than file upload
 */
export async function uploadSourcesWithInput(
  client: ChromeClient,
  sourceFiles: string[],
  logger: BrowserLogger,
): Promise<number> {
  if (!sourceFiles.length) {
    logger('No source files to upload');
    return 0;
  }

  const { Runtime } = client;
  logger(`Adding ${sourceFiles.length} sources via paste text`);

  // Check if upload dialog is already visible
  const dialogVisible = await isUploadDialogVisible(Runtime);
  if (!dialogVisible) {
    logger('Upload dialog not visible');
    return 0;
  }

  logger('Upload dialog visible, using paste text approach...');

  // Read the file content
  const fs = await import('node:fs/promises');
  let successCount = 0;

  for (const filePath of sourceFiles) {
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      logger(`Read ${content.length} chars from ${filePath}`);

      // Click the "Copied text" chip to open paste dialog
      const clickResult = await Runtime.evaluate({
        expression: `(() => {
          // Find the "Copied text" chip
          const chips = document.querySelectorAll('mat-chip');
          for (const chip of chips) {
            if (chip.textContent?.includes('Copied text')) {
              chip.click();
              return { clicked: true };
            }
          }
          // Fallback: try finding by chip group header
          const pasteGroup = Array.from(document.querySelectorAll('.chip-group')).find(
            g => g.textContent?.includes('Paste text')
          );
          if (pasteGroup) {
            const chip = pasteGroup.querySelector('mat-chip');
            if (chip) {
              chip.click();
              return { clicked: true, fallback: true };
            }
          }
          return { clicked: false };
        })()`,
        returnByValue: true,
      });

      const clickOutcome = clickResult.result?.value as { clicked?: boolean } | undefined;
      if (!clickOutcome?.clicked) {
        logger('Could not find "Copied text" chip');
        continue;
      }

      logger('Clicked "Copied text" chip, waiting for form...');
      await delay(1000);

      // Focus the textarea first
      const focusResult = await Runtime.evaluate({
        expression: `(() => {
          const textarea = document.querySelector('textarea[formcontrolname="text"]') ||
                          document.querySelector('textarea.text-area') ||
                          document.querySelector('form textarea');
          if (!textarea) {
            return { found: false };
          }
          textarea.focus();
          textarea.click();
          return { found: true };
        })()`,
        returnByValue: true,
      });

      const focusOutcome = focusResult.result?.value as { found?: boolean } | undefined;
      if (!focusOutcome?.found) {
        logger('Could not find textarea');
        continue;
      }

      // Use CDP Input.insertText to type the content
      const { Input } = client;
      if (Input) {
        logger('Using CDP Input.insertText to fill textarea...');
        await Input.insertText({ text: content });
      } else {
        logger('Input domain not available, cannot insert text');
        continue;
      }

      // CRITICAL: Trigger blur and proper events IMMEDIATELY after typing
      // Angular needs blur to mark field as "touched" which enables the button
      await Runtime.evaluate({
        expression: `(() => {
          const textarea = document.querySelector('textarea[formcontrolname="text"]');
          if (textarea) {
            // Dispatch input event (marks as dirty)
            textarea.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText' }));
            // Dispatch change event
            textarea.dispatchEvent(new Event('change', { bubbles: true }));
            // Dispatch blur event (marks as touched - CRITICAL for Angular validation)
            textarea.dispatchEvent(new FocusEvent('blur', { bubbles: true }));
          }
        })()`,
        returnByValue: true,
      });

      // Wait for Angular to process the events and enable the button
      logger('Waiting for Angular to enable Insert button...');
      await delay(1000);

      // Now click the Insert button
      // Angular Material buttons need a proper MouseEvent, not just .click()
      let buttonClicked = false;

      for (let attempt = 0; attempt < 5 && !buttonClicked; attempt++) {
        // First check the form state
        const stateResult = await Runtime.evaluate({
          expression: `(() => {
            const form = document.querySelector('form');
            const textarea = document.querySelector('textarea[formcontrolname="text"]');
            const btn = document.querySelector('button[type="submit"]');

            return {
              textLength: textarea?.value?.length || 0,
              formClasses: form?.className || '',
              btnClasses: btn?.className || '',
              btnText: btn?.textContent?.trim() || '',
            };
          })()`,
          returnByValue: true,
        });

        const state = stateResult.result?.value as {
          textLength?: number;
          formClasses?: string;
          btnClasses?: string;
          btnText?: string;
        } | undefined;

        logger(`Attempt ${attempt + 1}: ${state?.textLength} chars, form: ${state?.formClasses}, btn: "${state?.btnText}"`);

        // Use CDP Input.dispatchMouseEvent for a proper click
        // First get the button position
        const posResult = await Runtime.evaluate({
          expression: `(() => {
            // Find the Insert button specifically
            const buttons = document.querySelectorAll('button[type="submit"], button.mat-mdc-unelevated-button');
            for (const btn of buttons) {
              if (btn.textContent?.trim().toLowerCase() === 'insert') {
                const rect = btn.getBoundingClientRect();
                return {
                  found: true,
                  x: rect.x + rect.width / 2,
                  y: rect.y + rect.height / 2,
                  width: rect.width,
                  height: rect.height,
                };
              }
            }
            return { found: false };
          })()`,
          returnByValue: true,
        });

        const pos = posResult.result?.value as {
          found?: boolean;
          x?: number;
          y?: number;
          width?: number;
          height?: number;
        } | undefined;

        if (!pos?.found || pos.x === undefined || pos.y === undefined) {
          logger('Insert button not found');
          await delay(500);
          continue;
        }

        logger(`Insert button at (${Math.round(pos.x)}, ${Math.round(pos.y)})`);

        // Use CDP Input to simulate a real mouse click
        const { Input } = client;
        if (Input) {
          await Input.dispatchMouseEvent({
            type: 'mousePressed',
            x: pos.x,
            y: pos.y,
            button: 'left',
            clickCount: 1,
          });
          await Input.dispatchMouseEvent({
            type: 'mouseReleased',
            x: pos.x,
            y: pos.y,
            button: 'left',
            clickCount: 1,
          });
          logger('Dispatched mouse click via CDP');
          buttonClicked = true;
          successCount++;
          // Wait for source to be processed
          await delay(3000);
          break;
        } else {
          // Fallback: try direct click with MouseEvent
          const clickResult = await Runtime.evaluate({
            expression: `(() => {
              const buttons = document.querySelectorAll('button[type="submit"], button.mat-mdc-unelevated-button');
              for (const btn of buttons) {
                if (btn.textContent?.trim().toLowerCase() === 'insert') {
                  // Create proper MouseEvent
                  const rect = btn.getBoundingClientRect();
                  const event = new MouseEvent('click', {
                    bubbles: true,
                    cancelable: true,
                    view: window,
                    clientX: rect.x + rect.width / 2,
                    clientY: rect.y + rect.height / 2,
                  });
                  btn.dispatchEvent(event);
                  return { clicked: true };
                }
              }
              return { clicked: false };
            })()`,
            returnByValue: true,
          });

          const outcome = clickResult.result?.value as { clicked?: boolean } | undefined;
          if (outcome?.clicked) {
            logger('Clicked Insert button via MouseEvent');
            buttonClicked = true;
            successCount++;
            await delay(3000);
            break;
          }
        }

        await delay(500);
      }

      if (!buttonClicked) {
        logger('Could not submit form');
      }

    } catch (error) {
      logger(`Error processing ${filePath}: ${error}`);
    }
  }

  return successCount;
}

/**
 * Wait for the upload dialog to close (indicating upload complete)
 */
export async function waitForUploadDialogClose(
  Runtime: ChromeClient['Runtime'],
  timeoutMs: number,
  logger: BrowserLogger,
): Promise<boolean> {
  logger('Waiting for upload dialog to close...');

  const startTime = Date.now();

  while (Date.now() - startTime < timeoutMs) {
    const dialogVisible = await isUploadDialogVisible(Runtime);

    if (!dialogVisible) {
      logger('Upload dialog closed - source added successfully');
      return true;
    }

    await delay(1000);
  }

  logger('Timeout waiting for upload dialog to close');
  return false;
}

/**
 * Wait for uploaded sources to finish processing
 * This is called after the upload dialog closes
 */
export async function waitForSourceProcessing(
  Runtime: ChromeClient['Runtime'],
  timeoutMs: number,
  logger: BrowserLogger,
): Promise<boolean> {
  logger('Waiting for sources to finish processing...');

  const startTime = Date.now();

  // First wait for upload dialog to close (this indicates file was accepted)
  while (Date.now() - startTime < timeoutMs) {
    const result = await Runtime.evaluate({
      expression: `(() => {
        // Check if upload dialog is still visible
        const uploadDialog = document.querySelector('upload-dialog');
        const addSourcesDialog = document.querySelector("[role='dialog']");
        const dialogVisible = uploadDialog !== null ||
          (addSourcesDialog && addSourcesDialog.textContent?.toLowerCase().includes('add sources'));

        // Check for processing indicators
        const processingIndicators = document.querySelectorAll('.source-processing, .loading-indicator, .uploading, .mdc-linear-progress');
        const isProcessing = processingIndicators.length > 0;

        // Check for uploaded sources in the source panel
        const sourceItems = document.querySelectorAll('.source-item, .source-card, [data-source-id], .source-list-item');
        const sourceCount = sourceItems.length;

        // Check for error states
        const hasError = document.querySelector('.upload-error, .source-error') !== null;

        return {
          dialogVisible,
          isProcessing,
          sourceCount,
          hasError,
        };
      })()`,
      returnByValue: true,
    });

    const state = result.result?.value as {
      dialogVisible?: boolean;
      isProcessing?: boolean;
      sourceCount?: number;
      hasError?: boolean;
    } | undefined;

    if (state?.hasError) {
      logger('Error detected during source processing');
      return false;
    }

    // Success: dialog closed and we have sources (or still processing but dialog closed)
    if (!state?.dialogVisible && (state?.sourceCount ?? 0) > 0) {
      logger(`Sources processed successfully. Count: ${state?.sourceCount}`);
      return true;
    }

    // Dialog closed but still processing
    if (!state?.dialogVisible && state?.isProcessing) {
      logger('Upload complete, still processing source...');
    }

    // Dialog still visible
    if (state?.dialogVisible) {
      logger('Upload dialog still visible, waiting...');
    }

    await delay(2000);
  }

  logger('Timeout waiting for source processing');
  return false;
}

/**
 * Handle the upload dialog after notebook creation
 * Either upload files or close the dialog
 */
export async function handleUploadDialog(
  client: ChromeClient,
  sourceFiles: string[] | undefined,
  logger: BrowserLogger,
): Promise<number> {
  const { Runtime } = client;

  // Check if upload dialog is visible
  const dialogVisible = await isUploadDialogVisible(Runtime);

  if (!dialogVisible) {
    logger('No upload dialog visible');
    return 0;
  }

  logger('Upload dialog detected after notebook creation');

  if (sourceFiles?.length) {
    // Upload the files
    const uploadedCount = await uploadSourcesWithInput(client, sourceFiles, logger);

    if (uploadedCount > 0) {
      // Wait for dialog to close and sources to process
      await waitForSourceProcessing(Runtime, NOTEBOOKLM_TIMEOUTS.uploadModal, logger);
    }

    return uploadedCount;
  } else {
    // No files to upload, close the dialog
    logger('No source files provided, closing upload dialog');
    await closeUploadDialog(Runtime, logger);
    return 0;
  }
}

/**
 * Create a new notebook and optionally upload sources
 * Combined workflow function
 */
export async function createNewNotebook(
  client: ChromeClient,
  sourceFiles: string[] | undefined,
  logger: BrowserLogger,
): Promise<{ notebookUrl: string | null; sourcesUploaded: number }> {
  const { Page, Runtime } = client;

  // Navigate to homepage
  await navigateToHomepage(Page, Runtime, logger);

  // Wait a moment for page to stabilize
  await delay(1000);

  // Click create button
  const created = await clickCreateButton(Runtime, logger);
  if (!created) {
    logger('Failed to click Create button');
    return { notebookUrl: null, sourcesUploaded: 0 };
  }

  // Wait for new notebook to be ready (upload dialog may appear)
  const notebookUrl = await waitForNewNotebookReady(
    Runtime,
    NOTEBOOKLM_TIMEOUTS.pageReady,
    logger,
  );

  if (!notebookUrl) {
    logger('Failed to create new notebook');
    return { notebookUrl: null, sourcesUploaded: 0 };
  }

  // Handle the upload dialog (upload files or close it)
  const sourcesUploaded = await handleUploadDialog(client, sourceFiles, logger);

  return { notebookUrl, sourcesUploaded };
}
