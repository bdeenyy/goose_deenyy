import { describe, expect, it } from 'vitest';
import { applyPathMapping, buildWorkspaceHint, prependWorkspaceHint } from './workspaceHint';
import type { WorkspaceManifest } from './types';

describe('workspaceHint', () => {
  it('builds sandbox hint with staged files', () => {
    const manifest: WorkspaceManifest = {
      sessionId: 'abc',
      profile: 'sandbox',
      rootPath: '/data/workspaces/abc',
      workingDir: '/data/workspaces/abc/workspace',
      stagedFiles: [
        {
          original: '/tmp/report.pdf',
          staged: '/data/workspaces/abc/inputs/report.pdf',
          strategy: 'copy',
        },
      ],
      createdAt: new Date().toISOString(),
    };

    const hint = buildWorkspaceHint(manifest);
    expect(hint).toContain('Write files only inside');
    expect(hint).toContain('/data/workspaces/abc/inputs/report.pdf');
    expect(hint).toContain('/tmp/report.pdf');
  });

  it('maps original paths in message text', () => {
    const mapped = applyPathMapping('please read /tmp/a.txt', {
      '/tmp/a.txt': '/sandbox/inputs/a.txt',
    });
    expect(mapped).toBe('please read /sandbox/inputs/a.txt');
  });

  it('prepends hint before user message', () => {
    const result = prependWorkspaceHint('hello', '[Workspace isolation]\nwrite here');
    expect(result).toContain('[Workspace isolation]');
    expect(result).toContain('hello');
  });
});
