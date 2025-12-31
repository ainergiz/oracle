/**
 * Gemini Tools Selection Actions
 *
 * Handles selecting tools from the Tools drawer (Deep Think, Create images, etc.)
 * Tools are SEPARATE from the model picker (Fast/Thinking/Pro).
 *
 * Flow:
 * 1. Click "Tools" button to open drawer
 * 2. Click desired tool (e.g., "Deep Think")
 * 3. Tool becomes active (indicator shows, placeholder changes)
 */

import type { ChromeClient } from '../../browser/types.js';
import type { BrowserLogger } from '../types.js';
import {
  GEMINI_TOOL_SELECTORS,
  GEMINI_TOOL_DESELECT_SELECTORS,
  GEMINI_TOOL_PLACEHOLDERS,
} from '../constants.js';
import type { GeminiTool } from '../constants.js';
import { delay } from '../../browser/utils.js';

type CDPRuntime = ChromeClient['Runtime'];

export interface ToolSelectionResult {
  toolSelected: string;
  wasAlreadyActive: boolean;
}

/**
 * Check if a tool is currently active by looking for its deselect button
 */
export async function isToolActive(
  runtime: CDPRuntime,
  toolId: GeminiTool,
): Promise<boolean> {
  const deselectSelector = GEMINI_TOOL_DESELECT_SELECTORS[toolId as keyof typeof GEMINI_TOOL_DESELECT_SELECTORS];
  if (!deselectSelector) {
    return false;
  }

  const { result } = await runtime.evaluate({
    expression: `
      (function() {
        // Look for deselect button
        const buttons = document.querySelectorAll('button');
        for (const btn of buttons) {
          const text = btn.textContent?.toLowerCase() || '';
          if (text.includes('deselect') && text.includes('${toolId.replace('-', ' ')}')) {
            return true;
          }
        }
        return false;
      })()
    `,
    returnByValue: true,
  });

  return result.value === true;
}

/**
 * Open the Tools drawer by clicking the Tools button
 */
export async function openToolsDrawer(
  runtime: CDPRuntime,
  logger: BrowserLogger,
): Promise<boolean> {
  const { result } = await runtime.evaluate({
    expression: `
      (function() {
        // Try specific toolbox-drawer button first (Angular Material component)
        const toolboxBtn = document.querySelector('button.toolbox-drawer-button');
        if (toolboxBtn) {
          toolboxBtn.click();
          return { found: true, method: 'toolbox-drawer-button' };
        }

        // Try button inside toolbox-drawer component
        const drawerBtn = document.querySelector('toolbox-drawer button');
        if (drawerBtn) {
          drawerBtn.click();
          return { found: true, method: 'toolbox-drawer > button' };
        }

        // Fallback: Find any button with "Tools" text
        const buttons = document.querySelectorAll('button');
        for (const btn of buttons) {
          const text = btn.textContent?.trim() || '';
          if (text === 'Tools' || btn.getAttribute('aria-label')?.includes('Tools')) {
            btn.click();
            return { found: true, method: 'text-match' };
          }
        }
        return { found: false };
      })()
    `,
    returnByValue: true,
  });

  const outcome = result.value as { found: boolean; method?: string } | undefined;
  if (outcome?.found) {
    logger(`[gemini-browser] Opened Tools drawer via ${outcome.method}`);
    await delay(500); // Wait for drawer animation
    return true;
  }

  logger('[gemini-browser] Could not find Tools button');
  return false;
}

/**
 * Select a tool from the Tools drawer
 */
export async function selectToolFromDrawer(
  runtime: CDPRuntime,
  toolId: GeminiTool,
  logger: BrowserLogger,
): Promise<boolean> {
  // Map tool ID to display name
  const toolNameMap: Record<string, string> = {
    'deep-think': 'Deep Think',
    'deep-research': 'Deep Research',
    'create-images': 'Create images',
    'create-videos': 'Create videos',
    'canvas': 'Canvas',
    'guided-learning': 'Guided Learning',
  };
  const toolName = toolNameMap[toolId] || toolId;

  const { result } = await runtime.evaluate({
    expression: `
      (function() {
        const toolName = "${toolName}";

        // Method 1: Find toolbox-drawer-item with matching label
        const drawerItems = document.querySelectorAll('toolbox-drawer-item');
        for (const item of drawerItems) {
          const label = item.querySelector('.label');
          if (label && label.textContent?.trim() === toolName) {
            const btn = item.querySelector('button');
            if (btn && !btn.disabled) {
              btn.click();
              return { found: true, method: 'drawer-item-label' };
            }
          }
        }

        // Method 2: Find button with toolbox-drawer-item-list-button class containing the tool name
        const itemButtons = document.querySelectorAll('button.toolbox-drawer-item-list-button');
        for (const btn of itemButtons) {
          const text = btn.textContent?.trim() || '';
          if (text.includes(toolName) && !btn.disabled) {
            btn.click();
            return { found: true, method: 'item-list-button' };
          }
        }

        // Method 3: Find any button containing the tool name
        const allButtons = document.querySelectorAll('button');
        for (const btn of allButtons) {
          const text = btn.textContent?.trim() || '';
          if (text.includes(toolName) && !btn.disabled) {
            btn.click();
            return { found: true, method: 'text-match' };
          }
        }

        return { found: false };
      })()
    `,
    returnByValue: true,
  });

  const outcome = result.value as { found: boolean; method?: string } | undefined;
  if (outcome?.found) {
    logger(`[gemini-browser] Selected tool: ${toolName} via ${outcome.method}`);
    await delay(500); // Wait for tool activation
    return true;
  }

  logger(`[gemini-browser] Could not find tool: ${toolName}`);
  return false;
}

/**
 * Ensure a specific tool is selected
 * Opens Tools drawer and selects the tool if not already active
 */
export async function ensureToolSelection(
  runtime: CDPRuntime,
  toolId: GeminiTool,
  logger: BrowserLogger,
): Promise<ToolSelectionResult> {
  // Check if tool is already active
  const alreadyActive = await isToolActive(runtime, toolId);
  if (alreadyActive) {
    logger(`[gemini-browser] Tool ${toolId} is already active`);
    return {
      toolSelected: toolId,
      wasAlreadyActive: true,
    };
  }

  // Open Tools drawer
  const drawerOpened = await openToolsDrawer(runtime, logger);
  if (!drawerOpened) {
    throw new Error(`Failed to open Tools drawer for ${toolId}`);
  }

  // Wait for drawer to fully open
  await delay(300);

  // Select the tool
  const toolSelected = await selectToolFromDrawer(runtime, toolId, logger);
  if (!toolSelected) {
    throw new Error(`Failed to select tool: ${toolId}`);
  }

  // Verify tool is now active
  await delay(500);
  const isNowActive = await isToolActive(runtime, toolId);
  if (!isNowActive) {
    // Tool might be active but deselect button not visible, check placeholder
    const placeholderCheck = await verifyToolByPlaceholder(runtime, toolId);
    if (!placeholderCheck) {
      logger(`[gemini-browser] Warning: Could not verify ${toolId} activation`);
    }
  }

  return {
    toolSelected: toolId,
    wasAlreadyActive: false,
  };
}

/**
 * Verify tool is active by checking the prompt placeholder text
 */
async function verifyToolByPlaceholder(
  runtime: CDPRuntime,
  toolId: GeminiTool,
): Promise<boolean> {
  const expectedPlaceholder = GEMINI_TOOL_PLACEHOLDERS[toolId as keyof typeof GEMINI_TOOL_PLACEHOLDERS];
  if (!expectedPlaceholder) {
    return true; // No placeholder check available
  }

  const { result } = await runtime.evaluate({
    expression: `
      (function() {
        const textbox = document.querySelector('[role="textbox"]');
        if (!textbox) return false;
        const placeholder = textbox.getAttribute('placeholder') ||
                           textbox.getAttribute('aria-placeholder') ||
                           textbox.textContent?.trim() || '';
        return placeholder.toLowerCase().includes("${expectedPlaceholder.toLowerCase()}");
      })()
    `,
    returnByValue: true,
  });

  return result.value === true;
}

/**
 * Deselect the currently active tool
 */
export async function deselectTool(
  runtime: CDPRuntime,
  toolId: GeminiTool,
  logger: BrowserLogger,
): Promise<boolean> {
  const { result } = await runtime.evaluate({
    expression: `
      (function() {
        // Find deselect button (has close icon)
        const buttons = document.querySelectorAll('button');
        for (const btn of buttons) {
          const text = btn.textContent?.toLowerCase() || '';
          if (text.includes('deselect')) {
            btn.click();
            return true;
          }
        }
        return false;
      })()
    `,
    returnByValue: true,
  });

  if (result.value === true) {
    logger(`[gemini-browser] Deselected tool: ${toolId}`);
    return true;
  }

  return false;
}

/**
 * Check if Deep Think is requested based on model name
 */
export function isDeepThinkRequested(model: string): boolean {
  const normalized = model.toLowerCase();
  return normalized.includes('deep-think') || normalized.includes('deepthink');
}

/**
 * Check if image creation is requested based on model name
 */
export function isImageCreationRequested(model: string): boolean {
  const normalized = model.toLowerCase();
  return normalized.includes('create-image') || normalized.includes('image-gen');
}

/**
 * Check if Deep Research is requested based on model name
 */
export function isDeepResearchRequested(model: string): boolean {
  const normalized = model.toLowerCase();
  return normalized.includes('deep-research') || normalized.includes('deepresearch');
}
