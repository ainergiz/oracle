import chalk from 'chalk';
import OpenAI from 'openai';
import { countTokens as countTokensGpt5 } from 'gpt-tokenizer/model/gpt-5';
import { countTokens as countTokensGpt5Pro } from 'gpt-tokenizer/model/gpt-5-pro';
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { performance } from 'node:perf_hooks';
import pkg from '../package.json' assert { type: 'json' };

export const MODEL_CONFIGS = {
  'gpt-5-pro': {
    model: 'gpt-5-pro',
    tokenizer: countTokensGpt5Pro,
    inputLimit: 196000,
    pricing: {
      inputPerToken: 15 / 1_000_000,
      outputPerToken: 120 / 1_000_000,
    },
    reasoning: null,
  },
  'gpt-5.1': {
    model: 'gpt-5.1',
    tokenizer: countTokensGpt5,
    inputLimit: 196000,
    pricing: {
      inputPerToken: 1.25 / 1_000_000,
      outputPerToken: 10 / 1_000_000,
    },
    reasoning: { effort: 'high' },
  },
};

export const DEFAULT_SYSTEM_PROMPT = [
  'You are Oracle, a focused one-shot problem solver.',
  'Emphasize direct answers, cite any files referenced, and clearly note when the search tool was used.',
].join(' ');

const TOKENIZER_OPTIONS = { allowedSpecial: 'all' };

export function collectPaths(value, previous = []) {
  if (!value) {
    return previous;
  }
  const nextValues = Array.isArray(value) ? value : [value];
  return previous
    .concat(nextValues.flatMap((entry) => entry.split(',')))
    .map((entry) => entry.trim())
    .filter(Boolean);
}

export function parseIntOption(value) {
  if (value == null) {
    return undefined;
  }
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed)) {
    throw new Error('Value must be an integer.');
  }
  return parsed;
}

async function expandToFiles(targetPath, fsModule) {
  let stats;
  try {
    stats = await fsModule.stat(targetPath);
  } catch (error) {
    throw new Error(`Missing file or directory: ${targetPath}`);
  }
  if (stats.isFile()) {
    return [targetPath];
  }
  if (stats.isDirectory()) {
    const entries = await fsModule.readdir(targetPath);
    const nestedFiles = await Promise.all(
      entries.map((entry) => expandToFiles(path.join(targetPath, entry), fsModule)),
    );
    return nestedFiles.flat();
  }
  throw new Error(`Not a file or directory: ${targetPath}`);
}

export async function readFiles(filePaths, { cwd = process.cwd(), fsModule = fs } = {}) {
  const files = [];
  const seen = new Set();
  for (const rawPath of filePaths) {
    const absolutePath = path.resolve(cwd, rawPath);
    const expandedPaths = await expandToFiles(absolutePath, fsModule);
    for (const concretePath of expandedPaths) {
      if (seen.has(concretePath)) {
        continue;
      }
      seen.add(concretePath);
      const content = await fsModule.readFile(concretePath, 'utf8');
      files.push({ path: concretePath, content });
    }
  }
  return files;
}

export function createFileSections(files, cwd = process.cwd()) {
  return files.map((file, index) => {
    const relative = path.relative(cwd, file.path) || file.path;
    const sectionText = [
      `### File ${index + 1}: ${relative}`,
      '```',
      file.content.trimEnd(),
      '```',
    ].join('\n');
    return {
      index: index + 1,
      absolutePath: file.path,
      displayPath: relative,
      sectionText,
      content: file.content,
    };
  });
}

export function buildPrompt(basePrompt, files, cwd = process.cwd()) {
  if (!files.length) {
    return basePrompt.trim();
  }
  const sections = createFileSections(files, cwd);
  return `${basePrompt.trim()}\n\n### Attached Files\n${sections.map((section) => section.sectionText).join('\n\n')}`;
}

export function extractTextOutput(response) {
  if (Array.isArray(response.output_text) && response.output_text.length > 0) {
    return response.output_text.join('\n').trim();
  }
  if (!Array.isArray(response.output)) {
    return '';
  }
  const textChunks = [];
  for (const item of response.output) {
    if (item.type === 'message' && Array.isArray(item.content)) {
      for (const contentItem of item.content) {
        if (contentItem.type === 'text' && typeof contentItem.text === 'string') {
          textChunks.push(contentItem.text);
        }
        if (contentItem.type === 'output_text' && typeof contentItem.text === 'string') {
          textChunks.push(contentItem.text);
        }
      }
    }
    if (item.type === 'output_text' && typeof item.text === 'string') {
      textChunks.push(item.text);
    }
  }
  return textChunks.join('\n').trim();
}

export function formatUSD(value) {
  if (!Number.isFinite(value)) {
    return 'n/a';
  }
  if (value >= 0.1) {
    return `$${value.toFixed(2)}`;
  }
  if (value >= 0.01) {
    return `$${value.toFixed(3)}`;
  }
  return `$${value.toFixed(6)}`;
}

export function formatNumber(value, { estimated = false } = {}) {
  if (value == null) {
    return 'n/a';
  }
  const suffix = estimated ? ' (est.)' : '';
  return `${value.toLocaleString()}${suffix}`;
}

export function formatElapsed(ms) {
  const totalSeconds = ms / 1000;
  if (totalSeconds < 60) {
    return `${totalSeconds.toFixed(2)}s`;
  }
  const minutes = Math.floor(totalSeconds / 60);
  let seconds = Math.round(totalSeconds - minutes * 60);
  let adjustedMinutes = minutes;
  if (seconds === 60) {
    adjustedMinutes += 1;
    seconds = 0;
  }
  return `${adjustedMinutes}m ${seconds}s`;
}

export function getFileTokenStats(files, { cwd = process.cwd(), tokenizer, tokenizerOptions, inputTokenBudget }) {
  if (!files.length) {
    return { stats: [], totalTokens: 0 };
  }
  const sections = createFileSections(files, cwd);
  const stats = sections
    .map((section) => {
      const tokens = tokenizer(section.sectionText, tokenizerOptions);
      const percent = inputTokenBudget ? (tokens / inputTokenBudget) * 100 : undefined;
      return {
        path: section.absolutePath,
        displayPath: section.displayPath,
        tokens,
        percent,
      };
    })
    .sort((a, b) => b.tokens - a.tokens);
  const totalTokens = stats.reduce((sum, entry) => sum + entry.tokens, 0);
  return { stats, totalTokens };
}

export function printFileTokenStats({ stats, totalTokens }, { inputTokenBudget, log = console.log }) {
  if (!stats.length) {
    return;
  }
  log(chalk.bold('File Token Usage'));
  for (const entry of stats) {
    const percentLabel =
      inputTokenBudget && entry.percent != null ? `${entry.percent.toFixed(2)}%` : 'n/a';
    log(`${entry.tokens.toLocaleString().padStart(10)}  ${percentLabel.padStart(8)}  ${entry.displayPath}`);
  }
  if (inputTokenBudget) {
    const totalPercent = (totalTokens / inputTokenBudget) * 100;
    log(
      `Total: ${totalTokens.toLocaleString()} tokens (${totalPercent.toFixed(
        2,
      )}% of ${inputTokenBudget.toLocaleString()})`,
    );
  } else {
    log(`Total: ${totalTokens.toLocaleString()} tokens`);
  }
}

export function buildRequestBody({ modelConfig, systemPrompt, userPrompt, searchEnabled, maxOutputTokens }) {
  return {
    model: modelConfig.model,
    instructions: systemPrompt,
    input: [
      {
        role: 'user',
        content: [
          {
            type: 'input_text',
            text: userPrompt,
          },
        ],
      },
    ],
    tools: searchEnabled ? [{ type: 'web_search_preview' }] : undefined,
    reasoning: modelConfig.reasoning || undefined,
    max_output_tokens: maxOutputTokens,
  };
}

export async function runOracle(options, deps = {}) {
  const {
    apiKey = options.apiKey ?? process.env.OPENAI_API_KEY,
    cwd = deps.cwd ?? process.cwd(),
    fsModule = deps.fs ?? fs,
    log = deps.log ?? console.log,
    write = deps.write ?? ((text) => process.stdout.write(text)),
    now = deps.now ?? (() => performance.now()),
    clientFactory = deps.clientFactory ?? ((key) => new OpenAI({ apiKey: key })),
    client = deps.client,
  } = deps;

  if (!apiKey) {
    throw new Error('Missing OPENAI_API_KEY. Set it via the environment or a .env file.');
  }

  const modelConfig = MODEL_CONFIGS[options.model];
  if (!modelConfig) {
    throw new Error(`Unsupported model "${options.model}". Choose one of: ${Object.keys(MODEL_CONFIGS).join(', ')}`);
  }

  const inputTokenBudget = options.maxInput ?? modelConfig.inputLimit;
  const files = await readFiles(options.file ?? [], { cwd, fsModule });
  const fileTokenInfo = getFileTokenStats(files, {
    cwd,
    tokenizer: modelConfig.tokenizer,
    tokenizerOptions: TOKENIZER_OPTIONS,
    inputTokenBudget,
  });
  const userPrompt = buildPrompt(options.prompt, files, cwd);
  const systemPrompt = options.system?.trim() || DEFAULT_SYSTEM_PROMPT;
  const messages = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt },
  ];

  const estimatedInputTokens = modelConfig.tokenizer(messages, TOKENIZER_OPTIONS);
  const fileCount = files.length;
  const headerLine = `Oracle (${pkg.version}) consulting ${modelConfig.model}'s crystal ball with ${estimatedInputTokens.toLocaleString()} tokens and ${fileCount} files...`;

  if (!options.preview) {
    log(headerLine);
    if (options.sessionId) {
      log(`Session ID: ${options.sessionId}`);
    }
  }
  const shouldReportFiles =
    (options.filesReport || fileTokenInfo.totalTokens > inputTokenBudget) &&
    fileTokenInfo.stats.length > 0;
  if (shouldReportFiles) {
    printFileTokenStats(fileTokenInfo, { inputTokenBudget, log });
  }

  if (estimatedInputTokens > inputTokenBudget) {
    throw new Error(
      `Input too large (${estimatedInputTokens.toLocaleString()} tokens). Limit is ${inputTokenBudget.toLocaleString()} tokens.`,
    );
  }

  const requestBody = buildRequestBody({
    modelConfig,
    systemPrompt,
    userPrompt,
    searchEnabled: true,
    maxOutputTokens: options.maxOutput,
  });

  if (options.preview) {
    if (options.previewJson) {
      log(chalk.bold('Request JSON'));
      log(JSON.stringify(requestBody, null, 2));
      log('');
    }
    log(
      `Estimated input tokens: ${estimatedInputTokens.toLocaleString()} / ${inputTokenBudget.toLocaleString()} (model: ${modelConfig.model})`,
    );
    return {
      mode: 'preview',
      requestBody,
      estimatedInputTokens,
      inputTokenBudget,
    };
  }

  const openAiClient = client ?? clientFactory(apiKey);

  const runStart = now();
  const stream = await openAiClient.responses.stream(requestBody);

  let sawTextDelta = false;
  let answerHeaderPrinted = false;
  const ensureAnswerHeader = () => {
    if (!options.silent && !answerHeaderPrinted) {
      log(chalk.bold('Answer:'));
      answerHeaderPrinted = true;
    }
  };

  try {
    for await (const event of stream) {
      if (event.type === 'response.output_text.delta') {
        sawTextDelta = true;
        ensureAnswerHeader();
        if (!options.silent) {
          write(event.delta);
        }
      }
    }
  } catch (streamError) {
    if (typeof stream.abort === 'function') {
      stream.abort();
    }
    throw streamError;
  }

  const response = await stream.finalResponse();
  const elapsedMs = now() - runStart;

  if (response.status && response.status !== 'completed') {
    const detail = response.error?.message || response.incomplete_details?.reason || response.status;
    throw new Error(`Response did not complete: ${detail}`);
  }

  const answerText = extractTextOutput(response);
  if (!options.silent) {
    if (sawTextDelta) {
      write('\n\n');
    } else {
      ensureAnswerHeader();
      log(answerText || chalk.dim('(no text output)'));
      log('');
    }
  }

  const usage = response.usage ?? {};
  const inputTokens = usage.input_tokens ?? estimatedInputTokens;
  const outputTokens = usage.output_tokens ?? 0;
  const reasoningTokens = usage.reasoning_tokens ?? 0;
  const totalTokens = usage.total_tokens ?? inputTokens + outputTokens + reasoningTokens;
  const cost = inputTokens * modelConfig.pricing.inputPerToken + outputTokens * modelConfig.pricing.outputPerToken;

  const elapsedDisplay = formatElapsed(elapsedMs);
  const statsParts = [];
  const modelLabel = modelConfig.model + (modelConfig.reasoning ? '[high]' : '');
  statsParts.push(modelLabel);
  statsParts.push(formatUSD(cost));
  const tokensDisplay = [inputTokens, outputTokens, reasoningTokens, totalTokens]
    .map((value, index) => {
      const estimatedFlag =
        (index === 0 && usage.input_tokens == null) ||
        (index === 1 && usage.output_tokens == null) ||
        (index === 2 && usage.reasoning_tokens == null) ||
        (index === 3 && usage.total_tokens == null);
      const valueText = value.toLocaleString();
      return estimatedFlag ? `${valueText}*` : valueText;
    })
    .join('/');
  statsParts.push(`tok(i/o/r/t)=${tokensDisplay}`);
  if (!options.search) {
    statsParts.push('search=off');
  }
  if (files.length > 0) {
    statsParts.push(`files=${files.length}`);
  }
  log(`Finished in ${elapsedDisplay} (${statsParts.join(' | ')})`);

  return {
    mode: 'live',
    response,
    usage: { inputTokens, outputTokens, reasoningTokens, totalTokens },
    elapsedMs,
  };
}

export async function renderPromptMarkdown(options, deps = {}) {
  const cwd = deps.cwd ?? process.cwd();
  const fsModule = deps.fs ?? fs;
  const modelConfig = MODEL_CONFIGS[options.model] ?? MODEL_CONFIGS['gpt-5-pro'];
  const files = await readFiles(options.file ?? [], { cwd, fsModule });
  const sections = createFileSections(files, cwd);
  const systemPrompt = options.system?.trim() || DEFAULT_SYSTEM_PROMPT;
  const userPrompt = (options.prompt ?? '').trim();
  const lines = ['[SYSTEM]', systemPrompt, ''];
  lines.push('[USER]', userPrompt, '');
  sections.forEach((section) => {
    lines.push(`[FILE: ${section.displayPath}]`, section.content.trimEnd(), '');
  });
  return lines.join('\n');
}
