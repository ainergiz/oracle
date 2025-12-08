import path from 'node:path';
import { readFile } from 'node:fs/promises';
import type { ChromeClient, BrowserAttachment, BrowserLogger } from '../types.js';
import { FILE_INPUT_SELECTORS, SEND_BUTTON_SELECTORS, UPLOAD_STATUS_SELECTORS } from '../constants.js';
import { delay } from '../utils.js';
import { logDomFailure } from '../domDebug.js';

export async function uploadAttachmentFile(
  deps: { runtime: ChromeClient['Runtime']; dom?: ChromeClient['DOM'] },
  attachment: BrowserAttachment,
  logger: BrowserLogger,
) {
  const { runtime, dom } = deps;
  if (!dom) {
    throw new Error('DOM domain unavailable while uploading attachments.');
  }

  const acceptIsImageOnly = (accept: string | undefined | null): boolean => {
    if (!accept) return false;
    const parts = accept
      .split(',')
      .map((p) => p.trim().toLowerCase())
      .filter(Boolean);
    return parts.length > 0 && parts.every((p) => p.startsWith('image/'));
  };

  const pickAccept = (attributes: string[]): string | undefined => {
    for (let i = 0; i < attributes.length - 1; i += 2) {
      if (attributes[i] === 'accept') {
        return attributes[i + 1];
      }
    }
    return undefined;
  };

  // New ChatGPT UI hides the real file input behind a composer "+" menu; click it pre-emptively.
  await Promise.resolve(
    runtime.evaluate({
      expression: `(() => {
        const selectors = [
          '#composer-plus-btn',
          'button[data-testid="composer-plus-btn"]',
          '[data-testid*="plus"]',
          'button[aria-label*="add"]',
          'button[aria-label*="attachment"]',
          'button[aria-label*="file"]',
        ];
        for (const selector of selectors) {
          const el = document.querySelector(selector);
          if (el instanceof HTMLElement) {
            el.click();
            return true;
          }
        }
        return false;
      })()`,
      returnByValue: true,
    }),
  ).catch(() => undefined);

  // Give the menu a brief moment to mount its inputs/options.
  await delay(200);

  const documentNode = await dom.getDocument();
  const selectors = FILE_INPUT_SELECTORS;
  const candidateNodeIds: number[] = [];
  const waitForInputs = async (attempts: number) => {
    for (let i = 0; i < attempts; i++) {
      await findInput(false);
      if (candidateNodeIds.length > 0) return;
      await delay(150);
    }
  };

  const findInput = async (allowImageOnly: boolean) => {
    for (const selector of selectors) {
      const result = await dom.querySelector({ nodeId: documentNode.root.nodeId, selector });
      if (!result.nodeId) continue;
      let accept: string | undefined;
      try {
        const attrs = await dom.getAttributes({ nodeId: result.nodeId });
        const list = Array.isArray(attrs) ? attrs : attrs?.attributes ?? [];
        accept = pickAccept(list);
      } catch {
        accept = undefined;
      }
      if (!allowImageOnly && acceptIsImageOnly(accept)) {
        continue; // skip image-only pickers; they reject text attachments
      }
      if (!candidateNodeIds.includes(result.nodeId)) {
        candidateNodeIds.push(result.nodeId);
      }
    }
  };

  await waitForInputs(6);

  if (candidateNodeIds.length === 0) {
    // The generic attachment input often mounts only after clicking the menu item; try to force it.
    await Promise.resolve(
      runtime.evaluate({
        expression: `(() => {
          const menuItems = Array.from(document.querySelectorAll('[data-testid*="upload"],[data-testid*="attachment"], [role="menuitem"], [data-radix-collection-item]'));
          for (const el of menuItems) {
            const text = (el.textContent || '').toLowerCase();
            const tid = el.getAttribute?.('data-testid')?.toLowerCase?.() || '';
            if (tid.includes('upload') || tid.includes('attachment') || text.includes('upload') || text.includes('file')) {
              if (el instanceof HTMLElement) {
                el.click();
                return true;
              }
            }
          }
          return false;
        })()`,
        returnByValue: true,
      }),
    ).catch(() => undefined);

    await delay(250);
    await waitForInputs(6);
  }

  // Final fallback: accept image-only inputs if that's all we have.
  if (candidateNodeIds.length === 0) {
    await findInput(true);
  }

  if (candidateNodeIds.length === 0) {
    await logDomFailure(runtime, logger, 'file-input');
    throw new Error('Unable to locate ChatGPT file attachment input.');
  }

  logger(`Attachment inputs found: ${candidateNodeIds.length}`);
  for (const nodeId of candidateNodeIds) {
    logger(` - input node ${nodeId}`);
  }

  // Skip re-uploads if the file is already attached.
  const alreadyAttached = await runtime.evaluate({
    expression: `(() => {
      const expected = ${JSON.stringify(path.basename(attachment.path).toLowerCase())};
      const inputs = Array.from(document.querySelectorAll('input[type="file"]')).some((el) =>
        Array.from(el.files || []).some((f) => f?.name?.toLowerCase?.() === expected),
      );
      const chips = Array.from(document.querySelectorAll('[data-testid*="chip"],[data-testid*="attachment"],a,div,span')).some((n) =>
        (n?.textContent || '').toLowerCase().includes(expected),
      );
      return inputs || chips;
    })()`,
    returnByValue: true,
  });
  if (alreadyAttached?.result?.value === true) {
    logger(`Attachment already present: ${path.basename(attachment.path)}`);
    return;
  }

  for (const nodeId of candidateNodeIds) {
    await dom.setFileInputFiles({ nodeId, files: [attachment.path] });
  }
  // Some ChatGPT composers expect an explicit change/input event after programmatic file selection.
  const dispatchEvents = selectors
    .map((selector) => `
      (() => {
        const el = document.querySelector(${JSON.stringify(selector)});
        if (el instanceof HTMLInputElement) {
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
        }
      })();
    `)
    .join('\n');
  await runtime.evaluate({ expression: `(function(){${dispatchEvents} return true;})()`, returnByValue: true });
  const expectedName = path.basename(attachment.path);
  const ready = await waitForAttachmentSelection(runtime, expectedName, 10_000);
  if (!ready) {
    logger('Attachment not detected after primary upload; trying injection fallback.');
    // Fallback: inject via DataTransfer/File for UIs that ignore setFileInputFiles on hidden inputs.
    const fileBuffer = await readFile(attachment.path);
    const base64 = fileBuffer.toString('base64');
    const injectResult = await runtime.evaluate({
      expression: `(() => {
        const selectors = ${JSON.stringify(selectors)};
        const binary = atob(${JSON.stringify(base64)});
        const len = binary.length;
        const bytes = new Uint8Array(len);
        for (let i = 0; i < len; i++) bytes[i] = binary.charCodeAt(i);
        const file = new File([bytes], ${JSON.stringify(expectedName)}, { type: 'application/octet-stream' });
        let attached = false;

        // If no suitable input exists, add a hidden one to the form/body so we can set files reliably.
        if (selectors.length > 0 && !document.querySelector(selectors.join(','))) {
          const host = document.querySelector('form') || document.body;
          if (host) {
            const proxy = document.createElement('input');
            proxy.type = 'file';
            proxy.id = 'oracle-upload-proxy';
            proxy.style.position = 'fixed';
            proxy.style.left = '-9999px';
            host.appendChild(proxy);
          }
        }

        for (const selector of selectors) {
          const el = document.querySelector(selector);
          if (el instanceof HTMLInputElement) {
            const dt = new DataTransfer();
            dt.items.add(file);
            el.files = dt.files;
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
            if (el.files?.length) {
              attached = true;
              break;
            }
          }
        }

        if (!attached) {
          const dropTargets = [
            '[data-testid*="composer"]',
            '.ProseMirror',
            'form',
            'textarea',
            'main',
            'body'
          ];
          const dt = new DataTransfer();
          dt.items.add(file);
          const events = ['dragenter', 'dragover', 'drop'];
          for (const selector of dropTargets) {
            const node = document.querySelector(selector);
            if (!(node instanceof HTMLElement)) continue;
            for (const type of events) {
              const evt = new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: dt });
              node.dispatchEvent(evt);
            }
            // If drop listeners stopped propagation, assume it worked.
            if (dt.files?.length || node.querySelector('[data-testid*="chip"],[data-testid*="attachment"]')) {
              attached = true;
              break;
            }
          }
        }

        return attached;
      })()`,
      returnByValue: true,
    });
    const injected = Boolean(injectResult?.result?.value);
    if (!injected) {
      await logDomFailure(runtime, logger, 'file-upload');
      throw new Error('Attachment did not register with the ChatGPT composer in time.');
    }
  }
  await waitForAttachmentVisible(runtime, expectedName, 10_000, logger);
  logger('Attachment queued');
}

export async function waitForAttachmentCompletion(
  Runtime: ChromeClient['Runtime'],
  timeoutMs: number,
  expectedNames: string[] = [],
  logger?: BrowserLogger,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  const expectedNormalized = expectedNames.map((name) => name.toLowerCase());
  const expression = `(() => {
    const sendSelectors = ${JSON.stringify(SEND_BUTTON_SELECTORS)};
    let button = null;
    for (const selector of sendSelectors) {
      button = document.querySelector(selector);
      if (button) break;
    }
    const disabled = button
      ? button.hasAttribute('disabled') ||
        button.getAttribute('aria-disabled') === 'true' ||
        button.getAttribute('data-disabled') === 'true' ||
        window.getComputedStyle(button).pointerEvents === 'none'
      : null;
    const uploadingSelectors = ${JSON.stringify(UPLOAD_STATUS_SELECTORS)};
    const uploading = uploadingSelectors.some((selector) => {
      return Array.from(document.querySelectorAll(selector)).some((node) => {
        const ariaBusy = node.getAttribute?.('aria-busy');
        const dataState = node.getAttribute?.('data-state');
        if (ariaBusy === 'true' || dataState === 'loading' || dataState === 'uploading' || dataState === 'pending') {
          return true;
        }
        const text = node.textContent?.toLowerCase?.() ?? '';
        return text.includes('upload') || text.includes('processing') || text.includes('uploading');
      });
    });
    const fileSelectors = ${JSON.stringify(FILE_INPUT_SELECTORS)};
    const attachedNames = [];
    for (const selector of fileSelectors) {
      for (const node of Array.from(document.querySelectorAll(selector))) {
        const el = node instanceof HTMLInputElement ? node : null;
        if (el?.files?.length) {
          for (const file of Array.from(el.files)) {
            if (file?.name) attachedNames.push(file.name.toLowerCase());
          }
        }
      }
    }
    const chipSelectors = ['[data-testid*="chip"]', '[data-testid*="attachment"]', '[data-testid*="upload"]'];
    for (const selector of chipSelectors) {
      for (const node of Array.from(document.querySelectorAll(selector))) {
        const text = node?.textContent?.toLowerCase?.();
        if (text) attachedNames.push(text);
      }
    }
    const filesAttached = attachedNames.length > 0;
    return { state: button ? (disabled ? 'disabled' : 'ready') : 'missing', uploading, filesAttached, attachedNames };
  })()`;
  while (Date.now() < deadline) {
    const { result } = await Runtime.evaluate({ expression, returnByValue: true });
    const value = result?.value as {
      state?: string;
      uploading?: boolean;
      filesAttached?: boolean;
      attachedNames?: string[];
    } | undefined;
    if (value && !value.uploading) {
      const attached = new Set((value.attachedNames ?? []).map((name) => name.toLowerCase()));
      const missing = expectedNormalized.filter((name) => !attached.has(name));
      if (missing.length === 0) {
        if (value.state === 'ready') {
          return;
        }
        if (value.state === 'missing' && value.filesAttached) {
          return;
        }
      }
    }
    await delay(250);
  }
  logger?.('Attachment upload timed out while waiting for ChatGPT composer to become ready.');
  await logDomFailure(Runtime, logger ?? (() => {}), 'file-upload-timeout');
  throw new Error('Attachments did not finish uploading before timeout.');
}

export async function waitForAttachmentVisible(
  Runtime: ChromeClient['Runtime'],
  expectedName: string,
  timeoutMs: number,
  logger?: BrowserLogger,
): Promise<void> {
  // Attachments can take a few seconds to render in the composer (headless/remote Chrome is slower),
  // so respect the caller-provided timeout instead of capping at 2s.
  const deadline = Date.now() + timeoutMs;
  const expression = `(() => {
    const expected = ${JSON.stringify(expectedName)};
    const normalized = expected.toLowerCase();
    const matchNode = (node) => {
      if (!node) return false;
      const text = (node.textContent || '').toLowerCase();
      const aria = node.getAttribute?.('aria-label')?.toLowerCase?.() ?? '';
      const title = node.getAttribute?.('title')?.toLowerCase?.() ?? '';
      const testId = node.getAttribute?.('data-testid')?.toLowerCase?.() ?? '';
      const alt = node.getAttribute?.('alt')?.toLowerCase?.() ?? '';
      return [text, aria, title, testId, alt].some((value) => value.includes(normalized));
    };

    const turns = Array.from(document.querySelectorAll('article[data-testid^="conversation-turn"]'));
    const userTurns = turns.filter((node) => node.querySelector('[data-message-author-role="user"]'));
    const lastUser = userTurns[userTurns.length - 1];
    if (lastUser) {
      const turnMatch = Array.from(lastUser.querySelectorAll('*')).some(matchNode);
      if (turnMatch) return { found: true, userTurns: userTurns.length, source: 'turn' };
    }

    const composerSelectors = [
      '[data-testid*="composer"]',
      'form textarea',
      'form [data-testid*="attachment"]',
      '[data-testid*="upload"]',
      '[data-testid*="chip"]',
      'form',
      'button',
      'label',
      'input[type="file"]',
    ];
    const composerMatch = composerSelectors.some((selector) =>
      Array.from(document.querySelectorAll(selector)).some(matchNode),
    );
    if (composerMatch) {
      return { found: true, userTurns: userTurns.length, source: 'composer' };
    }

    const attrMatch = Array.from(document.querySelectorAll('[aria-label], [title], [data-testid]')).some(matchNode);
    if (attrMatch) {
      return { found: true, userTurns: userTurns.length, source: 'attrs' };
    }

    const fileInputs = Array.from(document.querySelectorAll('input[type="file"]')).some((node) => {
      const el = node instanceof HTMLInputElement ? node : null;
      if (!el?.files?.length) return false;
      return Array.from(el.files).some((file) => file?.name?.toLowerCase?.().includes(normalized));
    });
    if (fileInputs) {
      return { found: true, userTurns: userTurns.length, source: 'input' };
    }

    const bodyMatch = (document.body?.innerText || '').toLowerCase().includes(normalized);
    return { found: bodyMatch, userTurns: userTurns.length, source: bodyMatch ? 'body' : undefined };
  })()`;
  while (Date.now() < deadline) {
    const { result } = await Runtime.evaluate({ expression, returnByValue: true });
    const value = result?.value as { found?: boolean } | undefined;
    if (value?.found) {
      return;
    }
    await delay(200);
  }
  logger?.('Attachment not visible in composer; giving up.');
  await logDomFailure(Runtime, logger ?? (() => {}), 'attachment-visible');
  throw new Error('Attachment did not appear in ChatGPT composer.');
}

async function waitForAttachmentSelection(
  Runtime: ChromeClient['Runtime'],
  expectedName: string,
  timeoutMs: number,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  const expression = `(() => {
    const selectors = ${JSON.stringify(FILE_INPUT_SELECTORS)};
    for (const selector of selectors) {
      const inputs = Array.from(document.querySelectorAll(selector));
      for (const input of inputs) {
        if (!(input instanceof HTMLInputElement) || !input.files) {
          continue;
        }
        const names = Array.from(input.files ?? []).map((file) => file?.name ?? '');
        if (names.some((name) => name === ${JSON.stringify(expectedName)})) {
          return { matched: true, names };
        }
      }
    }
    return { matched: false, names: [] };
  })()`;
  while (Date.now() < deadline) {
    const { result } = await Runtime.evaluate({ expression, returnByValue: true });
    const matched = Boolean(result?.value?.matched);
    if (matched) {
      return true;
    }
    await delay(150);
  }
  return false;
}
