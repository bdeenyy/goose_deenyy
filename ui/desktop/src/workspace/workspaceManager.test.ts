import { describe, expect, it } from 'vitest';
import { sandboxSessionRoot } from './workspaceManager';

describe('workspaceManager', () => {
  it('places sandbox session root under context directory', () => {
    expect(sandboxSessionRoot('/Users/me/GooseDoc', 'session-abc')).toBe(
      '/Users/me/GooseDoc/.goose/sessions/session-abc'
    );
  });
});
