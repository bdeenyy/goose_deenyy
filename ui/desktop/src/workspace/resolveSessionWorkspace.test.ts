import { describe, expect, it } from 'vitest';
import { applyWorkspaceToUserInput } from './resolveSessionWorkspace';
import type { PreparedSessionWorkspace } from './resolveSessionWorkspace';

describe('resolveSessionWorkspace', () => {
  it('does not prepend workspace hint to user message', () => {
    const workspace: PreparedSessionWorkspace = {
      workingDir: '/tmp/workspace',
      pendingWorkspaceId: 'pending-id',
      workspaceHint: '[Workspace isolation]\nWrite files only inside: /tmp/workspace',
      pathMapping: { '/tmp/file.txt': '/tmp/workspace/inputs/file.txt' },
      profile: 'sandbox',
    };

    const result = applyWorkspaceToUserInput(
      { msg: 'please read /tmp/file.txt', images: [] },
      workspace
    );

    expect(result.msg).toBe('please read /tmp/workspace/inputs/file.txt');
    expect(result.msg).not.toContain('[Workspace isolation]');
  });
});
