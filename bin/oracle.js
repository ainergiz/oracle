#!/usr/bin/env bun
import 'dotenv/config';
import { Command, InvalidArgumentError, Option } from 'commander';
import chalk from 'chalk';
import kleur from 'kleur';
import {
  ensureSessionStorage,
  initializeSession,
  updateSessionMetadata,
  readSessionMetadata,
  listSessionsMetadata,
  filterSessionsByRange,
  createSessionLogWriter,
  readSessionLog,
  wait,
  SESSIONS_DIR,
  deleteSessionsOlderThan,
} from '../src/sessionManager.js';
import { runOracle, MODEL_CONFIGS, parseIntOption, renderPromptMarkdown, readFiles } from '../src/oracle.js';

const VERSION = '1.0.0';


const program = new Command();
program
  .name('oracle')
  .description('One-shot GPT-5 Pro / GPT-5.1 tool for hard questions that benefit from large file context and server-side search.')
  .version(VERSION)
  .option('-p, --prompt <text>', 'User prompt to send to the model.')
  .option('-f, --file <paths...>', 'Paths to files or directories to append to the prompt; repeat, comma-separate, or supply a space-separated list.', collectPaths, [])
  .option('-m, --model <model>', 'Model to target (gpt-5-pro | gpt-5.1).', validateModel, 'gpt-5-pro')
  .option('--files-report', 'Show token usage per attached file (also prints automatically when files exceed the token budget).', false)
  .addOption(
    new Option('--preview [mode]', 'Preview the request without calling the API (summary | json | full).')
      .choices(['summary', 'json', 'full'])
      .preset('summary'),
  )
  .addOption(new Option('--exec-session <id>').hideHelp())
  .option('--render-markdown', 'Emit the assembled markdown bundle for prompt + files and exit.', false)
  .showHelpAfterError('(use --help for usage)');

program
  .command('session [id]')
  .description('Attach to a stored session or list recent sessions when no ID is provided.')
  .option('--hours <hours>', 'Look back this many hours when listing sessions (default 24).', parseFloatOption, 24)
  .option('--limit <count>', 'Maximum sessions to show when listing (max 1000).', parseIntOption, 100)
  .option('--all', 'Include all stored sessions regardless of age.', false)
  .action(async (sessionId, cmd) => {
    if (!sessionId) {
      const showExamples = usesDefaultStatusFilters(cmd);
      await showStatus({
        hours: cmd.all ? Infinity : cmd.hours,
        includeAll: cmd.all,
        limit: cmd.limit,
        showExamples,
      });
      return;
    }
    await attachSession(sessionId);
  });

const statusCommand = program
  .command('status')
  .description('List recent sessions (24h window by default).')
  .option('--hours <hours>', 'Look back this many hours (default 24).', parseFloatOption, 24)
  .option('--limit <count>', 'Maximum sessions to show (max 1000).', parseIntOption, 100)
  .option('--all', 'Include all stored sessions regardless of age.', false)
  .action(async (cmd) => {
    const showExamples = usesDefaultStatusFilters(cmd);
    await showStatus({
      hours: cmd.all ? Infinity : cmd.hours,
      includeAll: cmd.all,
      limit: cmd.limit,
      showExamples,
    });
  });

statusCommand
  .command('clear')
  .description('Delete stored sessions older than the provided window (24h default).')
  .option('--hours <hours>', 'Delete sessions older than this many hours (default 24).', parseFloatOption, 24)
  .option('--all', 'Delete all stored sessions.', false)
  .action(async (cmd) => {
    const result = await deleteSessionsOlderThan({ hours: cmd.hours, includeAll: cmd.all });
    const scope = cmd.all ? 'all stored sessions' : `sessions older than ${cmd.hours}h`;
    console.log(`Deleted ${result.deleted} ${result.deleted === 1 ? 'session' : 'sessions'} (${scope}).`);
  });

const isTty = process.stdout.isTTY;
const bold = (text) => (isTty ? kleur.bold(text) : text);
const dim = (text) => (isTty ? kleur.dim(text) : text);

program.addHelpText('beforeAll', () => `${bold(`Oracle CLI v${VERSION}`)} — GPT-5 Pro/GPT-5.1 for tough questions with code/file context.\n`);
program.addHelpText(
  'after',
  () => `
${bold('Tips')}
${dim(' •')} This CLI is tuned for tough questions. Attach source files for best results, but keep total input under ~196k tokens.
${dim(' •')} The model has no built-in knowledge of your project—start each run with a sentence or two about the architecture, key components, and why you’re asking the question if that context matters.
${dim(' •')} Run ${bold('--files-report')} to see per-file token impact before spending money.
${dim(' •')} Non-preview runs spawn detached sessions so requests keep running even if your terminal closes.

${bold('Examples')}
${bold('  oracle')} --prompt "Summarize risks" --file docs/risk.md --files-report --preview
${dim('    Inspect tokens + files without calling the API.')}

${bold('  oracle')} --prompt "Explain bug" --file src/,docs/crash.log --files-report
${dim('    Attach both the src/ directory and docs/crash.log, launch a background session, and note the printed Session ID.')}

${bold('  oracle status')} --hours 72 --limit 50
${dim('    Show sessions from the last 72h (capped at 50 entries).')}

${bold('  oracle session')} <sessionId>
${dim('    Attach to a running/completed session, streaming the saved transcript.')}
`,
);

function collectPaths(value, previous) {
  if (!value) {
    return previous;
  }
  const nextValues = Array.isArray(value) ? value : [value];
  return previous.concat(nextValues.flatMap((entry) => entry.split(',')).map((entry) => entry.trim()).filter(Boolean));
}

function parseFloatOption(value) {
  const parsed = Number.parseFloat(value);
  if (Number.isNaN(parsed)) {
    throw new InvalidArgumentError('Value must be a number.');
  }
  return parsed;
}

function validateModel(value) {
  if (!MODEL_CONFIGS[value]) {
    throw new InvalidArgumentError(`Unsupported model "${value}". Choose one of: ${Object.keys(MODEL_CONFIGS).join(', ')}`);
  }
  return value;
}

function usesDefaultStatusFilters(cmd) {
  const hoursSource = cmd.getOptionValueSource?.('hours') ?? 'default';
  const limitSource = cmd.getOptionValueSource?.('limit') ?? 'default';
  const allSource = cmd.getOptionValueSource?.('all') ?? 'default';
  return hoursSource === 'default' && limitSource === 'default' && allSource === 'default';
}

const rawArgs = process.argv.slice(2);

function resolvePreviewMode(value) {
  if (typeof value === 'string' && value.length > 0) {
    return value;
  }
  if (value === true) {
    return 'summary';
  }
  return undefined;
}

async function runRootCommand(options) {
  const previewMode = resolvePreviewMode(options.preview);

  if (rawArgs.length === 0) {
    console.log(chalk.yellow('No prompt or subcommand supplied. See `oracle --help` for usage.'));
    program.help({ error: false });
    return;
  }

  if (options.session) {
    await attachSession(options.session);
    return;
  }

  if (options.execSession) {
    await executeSession(options.execSession);
    return;
  }

  if (options.renderMarkdown) {
    if (!options.prompt) {
      throw new Error('Prompt is required when using --render-markdown.');
    }
    const markdown = await renderPromptMarkdown(options, { cwd: process.cwd() });
    console.log(markdown);
    return;
  }

  if (previewMode) {
    if (!options.prompt) {
      throw new Error('Prompt is required when using --preview.');
    }
    await runOracle(
      { ...options, previewMode, preview: true },
      { log: console.log, write: (chunk) => process.stdout.write(chunk) },
    );
    return;
  }

  if (!options.prompt) {
    throw new Error('Prompt is required when starting a new session.');
  }

  if (options.file && options.file.length > 0) {
    await readFiles(options.file, { cwd: process.cwd() });
  }

  await ensureSessionStorage();
  const sessionMeta = await initializeSession(options, process.cwd());
  await runInteractiveSession(sessionMeta, options);
  console.log(chalk.bold(`Session ${sessionMeta.id} completed`));
}

async function runInteractiveSession(sessionMeta, options) {
  const runOptions = {
    ...options,
    sessionId: sessionMeta.id,
    preview: false,
    previewMode: undefined,
    file: options.file ?? [],
  };
  const { logLine, writeChunk, stream } = createSessionLogWriter(sessionMeta.id);
  let headerAugmented = false;
  const combinedLog = (message = '') => {
    if (!headerAugmented && message.startsWith('Oracle (')) {
      headerAugmented = true;
      console.log(`${message}\n${chalk.blue(`Reattach via: oracle session ${sessionMeta.id}`)}`);
      logLine(message);
      logLine(`Reattach via: oracle session ${sessionMeta.id}`);
      return;
    }
    console.log(message);
    logLine(message);
  };
  const combinedWrite = (chunk) => {
    writeChunk(chunk);
    return process.stdout.write(chunk);
  };
  try {
    await updateSessionMetadata(sessionMeta.id, { status: 'running', startedAt: new Date().toISOString() });
    const result = await runOracle(runOptions, {
      log: combinedLog,
      write: combinedWrite,
    });
    await updateSessionMetadata(sessionMeta.id, {
      status: 'completed',
      completedAt: new Date().toISOString(),
      usage: result.usage,
      elapsedMs: result.elapsedMs,
    });
    return result;
  } catch (error) {
    combinedLog(`ERROR: ${error?.message ?? error}`);
    await updateSessionMetadata(sessionMeta.id, {
      status: 'error',
      completedAt: new Date().toISOString(),
      errorMessage: error?.message ?? String(error),
    });
    throw error;
  } finally {
    stream.end();
  }
}

async function executeSession(sessionId) {
  const metadata = await readSessionMetadata(sessionId);
  if (!metadata) {
    console.error(chalk.red(`No session found with ID ${sessionId}`));
    process.exitCode = 1;
    return;
  }
  const options = { ...metadata.options, sessionId }; // include sessionId for logging
  options.file = metadata.options.file ?? [];
  options.preview = false;
  options.previewMode = undefined;
  options.silent = false;
  options.prompt = metadata.options.prompt;
  const { logLine, writeChunk, stream } = createSessionLogWriter(sessionId);
  try {
    await updateSessionMetadata(sessionId, { status: 'running', startedAt: new Date().toISOString() });
    const result = await runOracle(options, {
      cwd: metadata.cwd,
      log: logLine,
      write: writeChunk,
      sessionId,
    });
    await updateSessionMetadata(sessionId, {
      status: 'completed',
      completedAt: new Date().toISOString(),
      usage: result.usage,
      elapsedMs: result.elapsedMs,
    });
  } catch (error) {
    logLine(`ERROR: ${error?.message ?? error}`);
    await updateSessionMetadata(sessionId, {
      status: 'error',
      completedAt: new Date().toISOString(),
      errorMessage: error?.message ?? String(error),
    });
  } finally {
    stream.end();
  }
}

async function showStatus({ hours, includeAll, limit, showExamples = false }) {
  const metas = await listSessionsMetadata();
  const { entries, truncated, total } = filterSessionsByRange(metas, { hours, includeAll, limit });
  if (!entries.length) {
    console.log('No sessions found for the requested range.');
    if (showExamples) {
      printStatusExamples();
    }
    return;
  }
  console.log(chalk.bold('Recent Sessions'));
  for (const entry of entries) {
    const status = (entry.status || 'unknown').padEnd(9);
    const model = (entry.model || 'n/a').padEnd(10);
    const created = entry.createdAt.replace('T', ' ').replace('Z', '');
    console.log(`${created} | ${status} | ${model} | ${entry.id}`);
  }
  if (truncated) {
    console.log(
      chalk.yellow(
        `Showing ${entries.length} of ${total} sessions from the requested range. Run "oracle status clear" or delete entries in ${SESSIONS_DIR} to free space, or rerun with --status-limit/--status-all.`,
      ),
    );
  }
  if (showExamples) {
    printStatusExamples();
  }
}

function printStatusExamples() {
  console.log('');
  console.log(chalk.bold('Usage Examples'));
  console.log(`${chalk.bold('  oracle status --hours 72 --limit 50')}`);
  console.log(dim('    Show 72h of history capped at 50 entries.'));
  console.log(`${chalk.bold('  oracle status clear --hours 168')}`);
  console.log(dim('    Delete sessions older than 7 days (use --all to wipe everything).'));
  console.log(`${chalk.bold('  oracle session <session-id>')}`);
  console.log(dim('    Attach to a specific running/completed session to stream its output.'));
}

async function attachSession(sessionId) {
  const metadata = await readSessionMetadata(sessionId);
  if (!metadata) {
    console.error(chalk.red(`No session found with ID ${sessionId}`));
    process.exitCode = 1;
    return;
  }
  console.log(chalk.bold(`Session ${sessionId}`));
  console.log(`Created: ${metadata.createdAt}`);
  console.log(`Status: ${metadata.status}`);
  console.log(`Model: ${metadata.model}`);

  let lastLength = 0;
  const printNew = async () => {
    const text = await readSessionLog(sessionId);
    const nextChunk = text.slice(lastLength);
    if (nextChunk.length > 0) {
      process.stdout.write(nextChunk);
      lastLength = text.length;
    }
  };

  await printNew();

  // biome-ignore lint/nursery/noUnnecessaryConditions: deliberate infinite poll
  while (true) {
    const latest = await readSessionMetadata(sessionId);
    if (!latest) {
      break;
    }
    if (latest.status === 'completed' || latest.status === 'error') {
      await printNew();
      if (latest.status === 'error' && latest.errorMessage) {
        console.log(`\nSession failed: ${latest.errorMessage}`);
      }
      if (latest.usage) {
        const usage = latest.usage;
        console.log(`\nFinished (tok i/o/r/t: ${usage.inputTokens}/${usage.outputTokens}/${usage.reasoningTokens}/${usage.totalTokens})`);
      }
      break;
    }
    await wait(1000);
    await printNew();
  }
}

program.action(async function () {
  const options = this.optsWithGlobals();
  await runRootCommand(options);
});

await program.parseAsync(process.argv).catch((error) => {
  console.error(chalk.red('✖'), error?.message || error);
  process.exitCode = 1;
});
