import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  cleanupWorkspace,
  finalizeWorkspace,
  getWorkspaceInfo,
  readManifestForSession,
  sandboxSessionRoot,
} from './workspaceManager';
import type { WorkspaceManifest } from './types';

describe('workspaceManager', () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
  });

  async function makeTempDir(prefix: string): Promise<string> {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
    tempDirs.push(dir);
    return dir;
  }

  function workspaceIndexPath(gooseRoot: string, id: string): string {
    return path.join(gooseRoot, 'data', 'workspaces', id);
  }

  async function writeManifestAtIndex(
    gooseRoot: string,
    id: string,
    manifest: WorkspaceManifest
  ): Promise<void> {
    const indexPath = workspaceIndexPath(gooseRoot, id);
    await fs.mkdir(indexPath, { recursive: true });
    await fs.writeFile(path.join(indexPath, 'manifest.json'), JSON.stringify(manifest, null, 2));
  }

  it('places sandbox session root under context directory', () => {
    expect(sandboxSessionRoot('/Users/me/GooseDoc', 'session-abc')).toBe(
      '/Users/me/GooseDoc/.goose/sessions/session-abc'
    );
  });

  it('does not delete direct-mode user directory on cleanup', async () => {
    const gooseRoot = await makeTempDir('goose-data-');
    const userProject = await makeTempDir('user-project-');
    const marker = path.join(userProject, 'keep-me.txt');
    await fs.writeFile(marker, 'important');

    const sessionId = 'direct-session';
    const manifest: WorkspaceManifest = {
      sessionId,
      profile: 'direct',
      rootPath: userProject,
      workingDir: userProject,
      stagedFiles: [],
      createdAt: new Date().toISOString(),
    };
    await writeManifestAtIndex(gooseRoot, sessionId, manifest);

    await cleanupWorkspace(sessionId, gooseRoot);

    expect(fsSync.existsSync(marker)).toBe(true);
    expect(fsSync.existsSync(workspaceIndexPath(gooseRoot, sessionId))).toBe(false);
  });

  it('deletes sandbox session root on cleanup', async () => {
    const gooseRoot = await makeTempDir('goose-data-');
    const contextDir = await makeTempDir('context-');
    const sessionId = 'sandbox-session';
    const sessionRoot = sandboxSessionRoot(contextDir, sessionId);
    const workingDir = path.join(sessionRoot, 'workspace');
    await fs.mkdir(workingDir, { recursive: true });
    await fs.writeFile(path.join(workingDir, 'output.txt'), 'artifact');

    const manifest: WorkspaceManifest = {
      sessionId,
      profile: 'sandbox',
      rootPath: sessionRoot,
      workingDir,
      stagedFiles: [],
      createdAt: new Date().toISOString(),
    };
    await writeManifestAtIndex(gooseRoot, sessionId, manifest);

    await cleanupWorkspace(sessionId, gooseRoot);

    expect(fsSync.existsSync(sessionRoot)).toBe(false);
    expect(fsSync.existsSync(workspaceIndexPath(gooseRoot, sessionId))).toBe(false);
  });

  it('renames sandbox paths and updates workingDir on finalize', async () => {
    const gooseRoot = await makeTempDir('goose-data-');
    const contextDir = await makeTempDir('context-');
    const pendingId = 'pending-uuid';
    const sessionId = 'final-session-id';
    const pendingRoot = sandboxSessionRoot(contextDir, pendingId);
    const pendingWorkingDir = path.join(pendingRoot, 'workspace');
    await fs.mkdir(pendingWorkingDir, { recursive: true });

    const manifest: WorkspaceManifest = {
      sessionId: pendingId,
      profile: 'sandbox',
      rootPath: pendingRoot,
      workingDir: pendingWorkingDir,
      stagedFiles: [],
      createdAt: new Date().toISOString(),
    };
    await writeManifestAtIndex(gooseRoot, pendingId, manifest);

    await finalizeWorkspace({
      pendingWorkspaceId: pendingId,
      sessionId,
      goosePathRoot: gooseRoot,
    });

    const finalRoot = sandboxSessionRoot(contextDir, sessionId);
    const finalWorkingDir = path.join(finalRoot, 'workspace');
    expect(fsSync.existsSync(finalWorkingDir)).toBe(true);
    expect(fsSync.existsSync(pendingWorkingDir)).toBe(false);

    const updated = await readManifestForSession(sessionId, gooseRoot);
    expect(updated?.workingDir).toBe(finalWorkingDir);
    expect(updated?.rootPath).toBe(finalRoot);

    const info = await getWorkspaceInfo(sessionId, gooseRoot);
    expect(info?.workingDir).toBe(finalWorkingDir);
  });
});
