/**
 * Dialog Interaction for NotebookLM Browser Automation
 * Handles Material Design dialog components (mat-dialog, mat-radio, mat-button-toggle, etc.)
 */

import type { ChromeClient } from '../../browser/types.js';
import type { BrowserLogger, ArtifactType } from '../types.js';
import {
  ARTIFACT_EDIT_SELECTORS,
  DIALOG_SELECTORS,
  MATERIAL_SELECTORS,
} from '../constants.js';
import { delay } from '../../browser/utils.js';

/**
 * Open the customization dialog for an artifact type
 */
export async function openCustomizeDialog(
  Runtime: ChromeClient['Runtime'],
  artifactType: ArtifactType,
  logger: BrowserLogger,
): Promise<boolean> {
  const selectors = ARTIFACT_EDIT_SELECTORS[artifactType];
  const selectorsJson = JSON.stringify(selectors);

  logger(`Opening customize dialog for ${artifactType}`);

  // Try to find and click the edit button
  const { result } = await Runtime.evaluate({
    expression: `(() => {
      const selectors = ${selectorsJson};

      for (const selector of selectors) {
        try {
          // Handle complex selectors with :has-text
          let elements;
          if (selector.includes(':has-text')) {
            // Extract base selector and text
            const match = selector.match(/(.+):has-text\\(['"](.+)['"]\\)/);
            if (match) {
              const [, baseSelector, text] = match;
              elements = Array.from(document.querySelectorAll(baseSelector));
              elements = elements.filter(el =>
                el.textContent?.toLowerCase().includes(text.toLowerCase())
              );
            } else {
              continue;
            }
          } else {
            elements = document.querySelectorAll(selector);
          }

          for (const el of elements) {
            if (el && typeof el.click === 'function') {
              el.click();
              return { clicked: true, selector };
            }
          }
        } catch (e) {
          // Continue to next selector
        }
      }

      return { clicked: false };
    })()`,
    returnByValue: true,
  });

  const outcome = result?.value as { clicked?: boolean; selector?: string } | undefined;

  if (outcome?.clicked) {
    logger(`Clicked edit button for ${artifactType}`);
    await delay(500); // Wait for dialog animation
    return true;
  }

  logger(`Could not find edit button for ${artifactType}`);
  return false;
}

/**
 * Wait for the customization dialog to appear
 */
export async function waitForDialog(
  Runtime: ChromeClient['Runtime'],
  timeoutMs: number = 5000,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const { result } = await Runtime.evaluate({
      expression: `(() => {
        const dialog = document.querySelector('mat-dialog-container');
        return dialog && dialog.offsetParent !== null;
      })()`,
      returnByValue: true,
    });

    if (result?.value) {
      return true;
    }
    await delay(100);
  }

  return false;
}

/**
 * Select a radio button option in the dialog
 * Works with mat-radio-button elements
 */
export async function selectRadioOption(
  Runtime: ChromeClient['Runtime'],
  optionText: string,
  logger: BrowserLogger,
): Promise<boolean> {
  logger(`Selecting radio option: ${optionText}`);

  const { result } = await Runtime.evaluate({
    expression: `(() => {
      const text = ${JSON.stringify(optionText)}.toLowerCase();

      // Find all radio buttons
      const radios = document.querySelectorAll('mat-radio-button');

      for (const radio of radios) {
        const radioText = radio.textContent?.toLowerCase() || '';
        if (radioText.includes(text)) {
          // Click the radio input or the radio button itself
          const input = radio.querySelector('input[type="radio"]');
          if (input) {
            input.click();
            return { clicked: true, found: radioText.trim() };
          }
          radio.click();
          return { clicked: true, found: radioText.trim() };
        }
      }

      return { clicked: false };
    })()`,
    returnByValue: true,
  });

  const outcome = result?.value as { clicked?: boolean; found?: string } | undefined;

  if (outcome?.clicked) {
    logger(`Selected radio: ${outcome.found}`);
    await delay(200);
    return true;
  }

  return false;
}

/**
 * Select a toggle button option in the dialog
 * Works with mat-button-toggle elements
 */
export async function selectToggleOption(
  Runtime: ChromeClient['Runtime'],
  optionText: string,
  logger: BrowserLogger,
): Promise<boolean> {
  logger(`Selecting toggle option: ${optionText}`);

  const { result } = await Runtime.evaluate({
    expression: `(() => {
      const text = ${JSON.stringify(optionText)}.toLowerCase();

      // Find all button toggles
      const toggles = document.querySelectorAll('mat-button-toggle');

      for (const toggle of toggles) {
        const toggleText = toggle.textContent?.toLowerCase() || '';
        if (toggleText.includes(text)) {
          // Click the button inside the toggle
          const button = toggle.querySelector('button');
          if (button) {
            button.click();
            return { clicked: true, found: toggleText.trim() };
          }
          toggle.click();
          return { clicked: true, found: toggleText.trim() };
        }
      }

      return { clicked: false };
    })()`,
    returnByValue: true,
  });

  const outcome = result?.value as { clicked?: boolean; found?: string } | undefined;

  if (outcome?.clicked) {
    logger(`Selected toggle: ${outcome.found}`);
    await delay(200);
    return true;
  }

  return false;
}

/**
 * Select from a Material Design dropdown (mat-select)
 */
export async function selectDropdownOption(
  Runtime: ChromeClient['Runtime'],
  dropdownLabel: string,
  optionText: string,
  logger: BrowserLogger,
): Promise<boolean> {
  logger(`Selecting dropdown option: ${optionText} from ${dropdownLabel}`);

  // First, open the dropdown
  const openResult = await Runtime.evaluate({
    expression: `(() => {
      const label = ${JSON.stringify(dropdownLabel)}.toLowerCase();

      // Find mat-select by aria-label or nearby label
      const selects = document.querySelectorAll('mat-select');

      for (const select of selects) {
        const ariaLabel = select.getAttribute('aria-label')?.toLowerCase() || '';
        const selectText = select.textContent?.toLowerCase() || '';

        if (ariaLabel.includes(label) || selectText.includes(label)) {
          select.click();
          return { opened: true };
        }
      }

      // Try finding by label element
      const labels = document.querySelectorAll('mat-label, label');
      for (const labelEl of labels) {
        if (labelEl.textContent?.toLowerCase().includes(label)) {
          const container = labelEl.closest('mat-form-field');
          const select = container?.querySelector('mat-select');
          if (select) {
            select.click();
            return { opened: true };
          }
        }
      }

      return { opened: false };
    })()`,
    returnByValue: true,
  });

  const openOutcome = openResult.result?.value as { opened?: boolean } | undefined;

  if (!openOutcome?.opened) {
    logger(`Could not find dropdown: ${dropdownLabel}`);
    return false;
  }

  // Wait for dropdown to open
  await delay(300);

  // Select the option
  const selectResult = await Runtime.evaluate({
    expression: `(() => {
      const text = ${JSON.stringify(optionText)}.toLowerCase();

      // Find all mat-options
      const options = document.querySelectorAll('mat-option');

      for (const option of options) {
        const optionText = option.textContent?.toLowerCase() || '';
        if (optionText.includes(text)) {
          option.click();
          return { selected: true, found: optionText.trim() };
        }
      }

      return { selected: false };
    })()`,
    returnByValue: true,
  });

  const selectOutcome = selectResult.result?.value as { selected?: boolean; found?: string } | undefined;

  if (selectOutcome?.selected) {
    logger(`Selected dropdown option: ${selectOutcome.found}`);
    await delay(200);
    return true;
  }

  return false;
}

/**
 * Fill a textarea in the dialog
 */
export async function fillDialogTextarea(
  Runtime: ChromeClient['Runtime'],
  text: string,
  logger: BrowserLogger,
): Promise<boolean> {
  logger(`Filling dialog textarea`);

  const { result } = await Runtime.evaluate({
    expression: `(() => {
      const text = ${JSON.stringify(text)};

      // Find textarea in dialog
      const dialog = document.querySelector('mat-dialog-container');
      if (!dialog) return { filled: false, reason: 'no dialog' };

      const textarea = dialog.querySelector('textarea');
      if (!textarea) return { filled: false, reason: 'no textarea' };

      // Clear and fill
      textarea.focus();
      textarea.value = text;

      // Trigger input event for Angular
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
      textarea.dispatchEvent(new Event('change', { bubbles: true }));

      return { filled: true };
    })()`,
    returnByValue: true,
  });

  const outcome = result?.value as { filled?: boolean; reason?: string } | undefined;

  if (outcome?.filled) {
    await delay(100);
    return true;
  }

  logger(`Could not fill textarea: ${outcome?.reason}`);
  return false;
}

/**
 * Fill an input field in the dialog
 */
export async function fillDialogInput(
  Runtime: ChromeClient['Runtime'],
  placeholderHint: string,
  text: string,
  logger: BrowserLogger,
): Promise<boolean> {
  logger(`Filling dialog input (hint: ${placeholderHint})`);

  const { result } = await Runtime.evaluate({
    expression: `(() => {
      const hint = ${JSON.stringify(placeholderHint)}.toLowerCase();
      const text = ${JSON.stringify(text)};

      // Find dialog
      const dialog = document.querySelector('mat-dialog-container');
      if (!dialog) return { filled: false, reason: 'no dialog' };

      // Find input by placeholder
      const inputs = dialog.querySelectorAll('input, textarea');
      for (const input of inputs) {
        const placeholder = input.getAttribute('placeholder')?.toLowerCase() || '';
        if (placeholder.includes(hint)) {
          input.focus();
          input.value = text;
          input.dispatchEvent(new Event('input', { bubbles: true }));
          input.dispatchEvent(new Event('change', { bubbles: true }));
          return { filled: true };
        }
      }

      return { filled: false, reason: 'no matching input' };
    })()`,
    returnByValue: true,
  });

  const outcome = result?.value as { filled?: boolean; reason?: string } | undefined;

  if (outcome?.filled) {
    await delay(100);
    return true;
  }

  logger(`Could not fill input: ${outcome?.reason}`);
  return false;
}

/**
 * Click the Generate button in the dialog
 */
export async function clickGenerateButton(
  Runtime: ChromeClient['Runtime'],
  logger: BrowserLogger,
): Promise<boolean> {
  logger(`Clicking Generate button`);

  const { result } = await Runtime.evaluate({
    expression: `(() => {
      // Find dialog
      const dialog = document.querySelector('mat-dialog-container');
      if (!dialog) return { clicked: false, reason: 'no dialog' };

      // Find Generate button
      const buttons = dialog.querySelectorAll('button');
      for (const btn of buttons) {
        const text = btn.textContent?.toLowerCase() || '';
        if (text.includes('generate')) {
          btn.click();
          return { clicked: true };
        }
      }

      // Fallback: try primary/accent colored button
      for (const btn of buttons) {
        if (btn.classList.contains('mat-primary') || btn.classList.contains('mat-accent')) {
          btn.click();
          return { clicked: true, fallback: true };
        }
      }

      return { clicked: false, reason: 'no generate button' };
    })()`,
    returnByValue: true,
  });

  const outcome = result?.value as { clicked?: boolean; reason?: string; fallback?: boolean } | undefined;

  if (outcome?.clicked) {
    logger(outcome.fallback ? 'Clicked primary button (fallback)' : 'Clicked Generate button');
    await delay(500); // Wait for dialog to close
    return true;
  }

  logger(`Could not click Generate: ${outcome?.reason}`);
  return false;
}

/**
 * Close the dialog (click Cancel or outside)
 */
export async function closeDialog(
  Runtime: ChromeClient['Runtime'],
  logger: BrowserLogger,
): Promise<boolean> {
  const { result } = await Runtime.evaluate({
    expression: `(() => {
      // Find dialog
      const dialog = document.querySelector('mat-dialog-container');
      if (!dialog) return { closed: true }; // Already closed

      // Find Cancel button
      const buttons = dialog.querySelectorAll('button');
      for (const btn of buttons) {
        const text = btn.textContent?.toLowerCase() || '';
        if (text.includes('cancel') || text.includes('close')) {
          btn.click();
          return { closed: true, method: 'button' };
        }
      }

      // Try clicking backdrop
      const backdrop = document.querySelector('.cdk-overlay-backdrop');
      if (backdrop) {
        backdrop.click();
        return { closed: true, method: 'backdrop' };
      }

      return { closed: false };
    })()`,
    returnByValue: true,
  });

  const outcome = result?.value as { closed?: boolean; method?: string } | undefined;

  if (outcome?.closed) {
    logger(`Dialog closed via ${outcome.method ?? 'unknown'}`);
    await delay(300);
    return true;
  }

  return false;
}

/**
 * Check if a dialog is currently open
 */
export async function isDialogOpen(
  Runtime: ChromeClient['Runtime'],
): Promise<boolean> {
  const { result } = await Runtime.evaluate({
    expression: `(() => {
      const dialog = document.querySelector('mat-dialog-container');
      return dialog && dialog.offsetParent !== null;
    })()`,
    returnByValue: true,
  });

  return result?.value === true;
}
