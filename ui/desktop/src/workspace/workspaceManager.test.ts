import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';
import {
  cleanupOrphanedWorkspaces,
  cleanupWorkspace,
  createGitWorktree,
  finalizeWorkspace,
  getWorkspaceInfo,
  readManifestForSession,
  sandboxSessionRoot,
  stageSessionFiles,
} from './workspaceManager';
import type { WorkspaceManifest } from './types';

const execFileAsync = promisify(execFile);

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
    const pendingStaged = path.join(pendingRoot, 'inputs', 'file.txt');
    await fs.mkdir(path.dirname(pendingStaged), { recursive: true });
    await fs.mkdir(pendingWorkingDir, { recursive: true });
    await fs.writeFile(pendingStaged, 'data');

    const manifest: WorkspaceManifest = {
      sessionId: pendingId,
      profile: 'sandbox',
      rootPath: pendingRoot,
      workingDir: pendingWorkingDir,
      stagedFiles: [
        { original: '/tmp/file.txt', staged: pendingStaged, strategy: 'copy' },
      ],
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
    const finalStaged = path.join(finalRoot, 'inputs', 'file.txt');
    expect(fsSync.existsSync(finalWorkingDir)).toBe(true);
    expect(fsSync.existsSync(pendingWorkingDir)).toBe(false);

    const updated = await readManifestForSession(sessionId, gooseRoot);
    expect(updated?.workingDir).toBe(finalWorkingDir);
    expect(updated?.rootPath).toBe(finalRoot);
    expect(updated?.stagedFiles[0]?.staged).toBe(finalStaged);
    expect(updated?.status).toBe('active');

    const info = await getWorkspaceInfo(sessionId, gooseRoot);
    expect(info?.workingDir).toBe(finalWorkingDir);
  });

  it('stages follow-up files into an existing sandbox session', async () => {
    const gooseRoot = await makeTempDir('goose-data-');
    const contextDir = await makeTempDir('context-');
    const sessionId = 'existing-session';
    const sessionRoot = sandboxSessionRoot(contextDir, sessionId);
    const workingDir = path.join(sessionRoot, 'workspace');
    await fs.mkdir(workingDir, { recursive: true });

    const externalFile = path.join(await makeTempDir('external-'), 'note.txt');
    await fs.writeFile(externalFile, 'hello');

    const manifest: WorkspaceManifest = {
      sessionId,
      profile: 'sandbox',
      rootPath: sessionRoot,
      workingDir,
      stagedFiles: [],
      createdAt: new Date().toISOString(),
    };
    await writeManifestAtIndex(gooseRoot, sessionId, manifest);

    const { pathMapping } = await stageSessionFiles({
      sessionId,
      filePaths: [externalFile],
      externalFileStrategy: 'copy',
      goosePathRoot: gooseRoot,
    });

    expect(Object.keys(pathMapping)).toEqual([externalFile]);
    const stagedPath = pathMapping[externalFile];
    expect(stagedPath.startsWith(path.join(sessionRoot, 'inputs'))).toBe(true);
    expect(fsSync.existsSync(stagedPath)).toBe(true);

    const updated = await readManifestForSession(sessionId, gooseRoot);
    expect(updated?.stagedFiles).toHaveLength(1);
  });

  it('removes orphaned sandbox workspace roots after TTL', async () => {
    const gooseRoot = await makeTempDir('goose-data-');
    const contextDir = await makeTempDir('context-');
    const pendingId = 'orphan-pending';
    const sessionRoot = sandboxSessionRoot(contextDir, pendingId);
    const workingDir = path.join(sessionRoot, 'workspace');
    await fs.mkdir(workingDir, { recursive: true });
    await fs.writeFile(path.join(workingDir, 'leftover.txt'), 'data');

    const staleDate = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString();
    const manifest: WorkspaceManifest = {
      sessionId: pendingId,
      profile: 'sandbox',
      rootPath: sessionRoot,
      workingDir,
      stagedFiles: [],
      createdAt: staleDate,
      status: 'pending',
    };
    await writeManifestAtIndex(gooseRoot, pendingId, manifest);

    await cleanupOrphanedWorkspaces(gooseRoot);

    expect(fsSync.existsSync(sessionRoot)).toBe(false);
    expect(fsSync.existsSync(workspaceIndexPath(gooseRoot, pendingId))).toBe(false);
  });

  it('does not delete active finalized workspaces after TTL', async () => {
    const gooseRoot = await makeTempDir('goose-data-');
    const contextDir = await makeTempDir('context-');
    const sessionId = 'active-session';
    const sessionRoot = sandboxSessionRoot(contextDir, sessionId);
    const workingDir = path.join(sessionRoot, 'workspace');
    await fs.mkdir(workingDir, { recursive: true });
    await fs.writeFile(path.join(workingDir, 'keep.txt'), 'data');

    const staleDate = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString();
    const manifest: WorkspaceManifest = {
      sessionId,
      profile: 'sandbox',
      rootPath: sessionRoot,
      workingDir,
      stagedFiles: [],
      createdAt: staleDate,
      status: 'active',
    };
    await writeManifestAtIndex(gooseRoot, sessionId, manifest);

    await cleanupOrphanedWorkspaces(gooseRoot);

    expect(fsSync.existsSync(sessionRoot)).toBe(true);
    expect(fsSync.existsSync(workspaceIndexPath(gooseRoot, sessionId))).toBe(true);
  });

  it('maps repo files to the worktree path instead of copying into inputs', async () => {
    const gooseRoot = await makeTempDir('goose-data-');
    const repoRoot = await makeTempDir('git-repo-');
    await execFileAsync('git', ['init'], { cwd: repoRoot });
    await execFileAsync('git', ['config', 'user.email', 'test@example.com'], { cwd: repoRoot });
    await execFileAsync('git', ['config', 'user.name', 'Test User'], { cwd: repoRoot });
    await fs.mkdir(path.join(repoRoot, 'src'), { recursive: true });
    const repoFile = path.join(repoRoot, 'src', 'foo.ts');
    await fs.writeFile(repoFile, 'export const foo = 1;');
    await execFileAsync('git', ['add', 'src/foo.ts'], { cwd: repoRoot });
    await execFileAsync('git', ['commit', '-m', 'init'], { cwd: repoRoot });

    const sessionId = 'worktree-session';
    const { workingDir, branchName } = await createGitWorktree(repoRoot, sessionId);
    const worktreeFile = path.join(workingDir, 'src', 'foo.ts');
    expect(fsSync.existsSync(worktreeFile)).toBe(true);

    const manifest: WorkspaceManifest = {
      sessionId,
      profile: 'worktree',
      rootPath: workingDir,
      workingDir,
      repoRoot,
      branchName,
      stagedFiles: [],
      createdAt: new Date().toISOString(),
      status: 'active',
    };
    await writeManifestAtIndex(gooseRoot, sessionId, manifest);

    const { pathMapping } = await stageSessionFiles({
      sessionId,
      filePaths: [repoFile],
      externalFileStrategy: 'copy',
      goosePathRoot: gooseRoot,
    });

    expect(pathMapping[repoFile]).toBe(worktreeFile);

    const updated = await readManifestForSession(sessionId, gooseRoot);
    expect(updated?.stagedFiles).toHaveLength(1);
    expect(updated?.stagedFiles[0]?.staged).toBe(worktreeFile);
    expect(updated?.stagedFiles[0]?.strategy).toBe('reference');
  });

  it('copies dirty repo file contents into the worktree before staging', async () => {
    const gooseRoot = await makeTempDir('goose-data-');
    const repoRoot = await makeTempDir('git-repo-');
    await execFileAsync('git', ['init'], { cwd: repoRoot });
    await execFileAsync('git', ['config', 'user.email', 'test@example.com'], { cwd: repoRoot });
    await execFileAsync('git', ['config', 'user.name', 'Test User'], { cwd: repoRoot });
    await fs.mkdir(path.join(repoRoot, 'src'), { recursive: true });
    const repoFile = path.join(repoRoot, 'src', 'foo.ts');
    await fs.writeFile(repoFile, 'export const foo = 1;');
    await execFileAsync('git', ['add', 'src/foo.ts'], { cwd: repoRoot });
    await execFileAsync('git', ['commit', '-m', 'init'], { cwd: repoRoot });

    const sessionId = 'dirty-worktree-session';
    const { workingDir, branchName } = await createGitWorktree(repoRoot, sessionId);
    const worktreeFile = path.join(workingDir, 'src', 'foo.ts');
    await fs.writeFile(repoFile, 'export const foo = 2; // dirty edit');

    const manifest: WorkspaceManifest = {
      sessionId,
      profile: 'worktree',
      rootPath: workingDir,
      workingDir,
      repoRoot,
      branchName,
      stagedFiles: [],
      createdAt: new Date().toISOString(),
      status: 'active',
    };
    await writeManifestAtIndex(gooseRoot, sessionId, manifest);

    const { pathMapping } = await stageSessionFiles({
      sessionId,
      filePaths: [repoFile],
      externalFileStrategy: 'copy',
      goosePathRoot: gooseRoot,
    });

    expect(pathMapping[repoFile]).toBe(worktreeFile);
    expect(fsSync.readFileSync(worktreeFile, 'utf8')).toBe('export const foo = 2; // dirty edit');

    const updated = await readManifestForSession(sessionId, gooseRoot);
    expect(updated?.stagedFiles[0]?.strategy).toBe('copy');
  });

  it('stages dropped directories into sandbox inputs', async () => {
    const gooseRoot = await makeTempDir('goose-data-');
    const contextDir = await makeTempDir('context-');
    const sessionId = 'dir-session';
    const sessionRoot = sandboxSessionRoot(contextDir, sessionId);
    const workingDir = path.join(sessionRoot, 'workspace');
    await fs.mkdir(workingDir, { recursive: true });

    const externalDir = await makeTempDir('external-dir-');
    await fs.writeFile(path.join(externalDir, 'note.txt'), 'hello');

    const manifest: WorkspaceManifest = {
      sessionId,
      profile: 'sandbox',
      rootPath: sessionRoot,
      workingDir,
      stagedFiles: [],
      createdAt: new Date().toISOString(),
      status: 'active',
    };
    await writeManifestAtIndex(gooseRoot, sessionId, manifest);

    const { pathMapping } = await stageSessionFiles({
      sessionId,
      filePaths: [externalDir],
      externalFileStrategy: 'copy',
      goosePathRoot: gooseRoot,
    });

    const stagedDir = pathMapping[externalDir];
    expect(stagedDir).toBeDefined();
    expect(fsSync.existsSync(path.join(stagedDir, 'note.txt'))).toBe(true);
  });

  it('symlinks oversized files into inputs when copy strategy is requested', async () => {
    const gooseRoot = await makeTempDir('goose-data-');
    const contextDir = await makeTempDir('context-');
    const sessionId = 'large-file-session';
    const sessionRoot = sandboxSessionRoot(contextDir, sessionId);
    const workingDir = path.join(sessionRoot, 'workspace');
    await fs.mkdir(workingDir, { recursive: true });

    const largeFile = path.join(await makeTempDir('large-file-'), 'big.bin');
    const largeFileBytes = 50 * 1024 * 1024 + 1;
    await fs.writeFile(largeFile, Buffer.alloc(largeFileBytes));

    const manifest: WorkspaceManifest = {
      sessionId,
      profile: 'sandbox',
      rootPath: sessionRoot,
      workingDir,
      stagedFiles: [],
      createdAt: new Date().toISOString(),
      status: 'active',
    };
    await writeManifestAtIndex(gooseRoot, sessionId, manifest);

    const { pathMapping } = await stageSessionFiles({
      sessionId,
      filePaths: [largeFile],
      externalFileStrategy: 'copy',
      goosePathRoot: gooseRoot,
    });

    expect(pathMapping[largeFile]).toMatch(/inputs[/\\]big\.bin$/);

    const updated = await readManifestForSession(sessionId, gooseRoot);
    expect(updated?.stagedFiles[0]?.strategy).toBe('symlink');
    expect(fsSync.lstatSync(pathMapping[largeFile]).isSymbolicLink()).toBe(true);
  });

  it('uses a unique branch name when the default worktree branch already exists', async () => {
    const repoRoot = await makeTempDir('git-repo-');
    await execFileAsync('git', ['init'], { cwd: repoRoot });
    await execFileAsync('git', ['config', 'user.email', 'test@example.com'], { cwd: repoRoot });
    await execFileAsync('git', ['config', 'user.name', 'Test User'], { cwd: repoRoot });
    await fs.writeFile(path.join(repoRoot, 'README.md'), '# test');
    await execFileAsync('git', ['add', 'README.md'], { cwd: repoRoot });
    await execFileAsync('git', ['commit', '-m', 'init'], { cwd: repoRoot });

    const sessionId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
    const existingBranch = 'goose/session-aaaaaaaa';
    await execFileAsync('git', ['branch', existingBranch], { cwd: repoRoot });

    const { branchName, workingDir } = await createGitWorktree(repoRoot, sessionId);

    expect(branchName).toBe(`${existingBranch}-1`);
    expect(fsSync.existsSync(workingDir)).toBe(true);

    const originalRef = (
      await execFileAsync('git', ['-C', repoRoot, 'rev-parse', existingBranch], {
        timeout: 10_000,
      })
    ).stdout.trim();
    const collisionRef = (
      await execFileAsync('git', ['-C', repoRoot, 'rev-parse', branchName], { timeout: 10_000 })
    ).stdout.trim();
    expect(collisionRef).toBe(originalRef);
  });
});
