import { describe, expect, test, vi } from 'vitest';

vi.mock('../../src/cli/tui/index.js', () => ({
  launchTui: vi.fn().mockResolvedValue(undefined),
}));

const launchTuiMock = vi.mocked(await import('../../src/cli/tui/index.js')).launchTui as ReturnType<typeof vi.fn>;

describe('zero-arg TUI entry', () => {
  test('invokes launchTui when no args and TTY', async () => {
    const originalArgv = process.argv;
    const originalTty = process.stdout.isTTY;
    process.argv = ['node', 'bin/oracle-cli.js']; // mimics zero-arg user input
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
    process.env.ORACLE_FORCE_TUI = '1';

    await import('../../bin/oracle-cli.js');

    // Commander wires the action async; poll briefly to avoid flakiness on slower runners.
    for (let i = 0; i < 10 && launchTuiMock.mock.calls.length === 0; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }

    expect(launchTuiMock).toHaveBeenCalled();

    // restore
    delete process.env.ORACLE_FORCE_TUI;
    process.argv = originalArgv;
    Object.defineProperty(process.stdout, 'isTTY', { value: originalTty, configurable: true });
  }, 15_000);
});
