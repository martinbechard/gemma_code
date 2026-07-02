import { describe, it, expect, vi, beforeEach } from 'vitest';
import { gitTool } from '../../../src/main/tools/git';
import * as workspace from '../../../src/main/workspace';

vi.mock('../../../src/main/workspace', () => ({
  wsRunBash: vi.fn(),
}));

const GIT_TOOL_TIMEOUT_MS = 120_000;

describe('gitTool', () => {
  const mockWsRunBash = vi.mocked(workspace.wsRunBash);
  const mockCtx = {
    conversationId: 'test-conv',
    onFileChange: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should execute a simple git command', async () => {
    mockWsRunBash.mockResolvedValue({
      exitCode: 0,
      durationMs: 10,
      stdout: 'On branch main',
      stderr: '',
      truncated: false,
    });

    const result = await gitTool.run({ command: 'status' }, mockCtx);

    expect(mockWsRunBash).toHaveBeenCalledWith(
      'test-conv',
      'git status',
      GIT_TOOL_TIMEOUT_MS,
    );
    expect(result).toContain('exit=0');
    expect(result).toContain('stdout:\nOn branch main');
  });

  it('should execute a git command with arguments', async () => {
    mockWsRunBash.mockResolvedValue({
      exitCode: 0,
      durationMs: 15,
      stdout: 'Changes staged',
      stderr: '',
      truncated: false,
    });

    const result = await gitTool.run({ command: 'add', args: '.' }, mockCtx);

    expect(mockWsRunBash).toHaveBeenCalledWith(
      'test-conv',
      'git add .',
      GIT_TOOL_TIMEOUT_MS,
    );
    expect(result).toContain('exit=0');
    expect(result).toContain('stdout:\nChanges staged');
  });

  it('should return an error if command is missing', async () => {
    const result = await gitTool.run({}, mockCtx);
    expect(result).toBe('Error: missing <command>');
    expect(workspace.wsRunBash).not.toHaveBeenCalled();
  });

  it('should handle git errors correctly', async () => {
    mockWsRunBash.mockResolvedValue({
      exitCode: 1,
      durationMs: 5,
      stdout: '',
      stderr: 'fatal: not a git repository',
      truncated: false,
    });

    const result = await gitTool.run({ command: 'status' }, mockCtx);

    expect(result).toContain('exit=1');
    expect(result).toContain('stderr:\nfatal: not a git repository');
  });

  it('should call onFileChange after execution', async () => {
    mockWsRunBash.mockResolvedValue({
      exitCode: 0,
      durationMs: 10,
      stdout: 'done',
      stderr: '',
      truncated: false,
    });

    await gitTool.run({ command: 'status' }, mockCtx);
    expect(mockCtx.onFileChange).toHaveBeenCalled();
  });
});
