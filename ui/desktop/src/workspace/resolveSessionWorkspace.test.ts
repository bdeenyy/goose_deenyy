import { describe, expect, it } from 'vitest';
import { applyWorkspaceToUserInput } from './resolveSessionWorkspace';
import type { PreparedSessionWorkspace } from './resolveSessionWorkspace';
import { pathMappingFromStagedFiles } from './workspaceHint';

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

  it('builds path mapping from staged files after finalize', () => {
    const mapping = pathMappingFromStagedFiles([
      { original: '/tmp/file.txt', staged: '/project/.goose/sessions/id/inputs/file.txt', strategy: 'copy' },
      { original: '/tmp/ref.txt', staged: '/tmp/ref.txt', strategy: 'reference' },
    ]);

    expect(mapping).toEqual({
      '/tmp/file.txt': '/project/.goose/sessions/id/inputs/file.txt',
    });
  });
});
