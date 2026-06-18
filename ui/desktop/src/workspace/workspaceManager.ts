import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import { app } from 'electron';
import { buildWorkspaceHint } from './workspaceHint';
import type {
  ExternalFileStrategy,
  FinalizeWorkspaceRequest,
  ResolveWorkspaceRequest,
  ResolveWorkspaceResult,
  ResolvedWorkspaceProfile,
  StagedFile,
  WorkspaceInfo,
  WorkspaceManifest,
  WorkspaceProfile,
} from './types';

const execFileAsync = promisify(execFile);

const WORKSPACES_DIR = 'workspaces';
const LARGE_FILE_BYTES = 50 * 1024 * 1024;
const ORPHAN_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export function getGooseDataDir(goosePathRoot?: string): string {
  if (goosePathRoot?.trim()) {
    return path.join(goosePathRoot.trim(), 'data');
  }

  const home = os.homedir();
  if (process.platform === 'darwin') {
    return path.join(home, 'Library', 'Application Support', 'Block', 'goose', 'data');
  }
  if (process.platform === 'win32') {
    const appData = process.env.APPDATA || path.join(home, 'AppData', 'Roaming');
    return path.join(appData, 'Block', 'goose', 'data');
  }
  return path.join(home, '.local', 'share', 'Block', 'goose', 'data');
}

function workspacesRoot(goosePathRoot?: string): string {
  return path.join(getGooseDataDir(goosePathRoot), WORKSPACES_DIR);
}

function workspaceRootForId(id: string, goosePathRoot?: string): string {
  return path.join(workspacesRoot(goosePathRoot), id);
}

function manifestPathForRoot(rootPath: string): string {
  return path.join(rootPath, 'manifest.json');
}

async function runGit(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('git', ['-C', cwd, ...args], { timeout: 10_000 });
  return stdout.trim();
}

export async function findGitRepoRoot(startPath: string): Promise<string | null> {
  try {
    const dir = fsSync.statSync(startPath).isFile() ? path.dirname(startPath) : startPath;
    return await runGit(dir, ['rev-parse', '--show-toplevel']);
  } catch {
    return null;
  }
}

function shortId(id: string): string {
  return id.replace(/-/g, '').slice(0, 8);
}

export async function createGitWorktree(
  repoRoot: string,
  sessionId: string
): Promise<{ workingDir: string; branchName: string }> {
  const branchName = `goose/session-${shortId(sessionId)}`;
  const worktreePath = path.join(repoRoot, '.goose', 'sessions', sessionId);
  await fs.mkdir(path.dirname(worktreePath), { recursive: true });

  try {
    await execFileAsync(
      'git',
      ['-C', repoRoot, 'worktree', 'add', '-B', branchName, worktreePath],
      { timeout: 30_000 }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to create git worktree: ${message}`);
  }

  return { workingDir: worktreePath, branchName };
}

function isPathInside(child: string, parent: string): boolean {
  const relative = path.relative(parent, child);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

async function uniqueInputPath(inputsDir: string, filePath: string): Promise<string> {
  const baseName = path.basename(filePath);
  let candidate = path.join(inputsDir, baseName);
  if (!fsSync.existsSync(candidate)) {
    return candidate;
  }

  const ext = path.extname(baseName);
  const stem = path.basename(baseName, ext);
  for (let i = 1; i < 1000; i++) {
    candidate = path.join(inputsDir, `${stem}-${i}${ext}`);
    if (!fsSync.existsSync(candidate)) {
      return candidate;
    }
  }
  return path.join(inputsDir, `${stem}-${Date.now()}${ext}`);
}

async function stageExternalFiles(
  workspaceRoot: string,
  workingDir: string,
  filePaths: string[],
  strategy: ExternalFileStrategy
): Promise<{ stagedFiles: StagedFile[]; pathMapping: Record<string, string> }> {
  const inputsDir = path.join(workspaceRoot, 'inputs');
  await fs.mkdir(inputsDir, { recursive: true });

  const stagedFiles: StagedFile[] = [];
  const pathMapping: Record<string, string> = {};

  for (const original of filePaths) {
    if (!original?.trim() || !fsSync.existsSync(original)) {
      continue;
    }

    if (isPathInside(original, workingDir)) {
      continue;
    }

    const stat = fsSync.statSync(original);
    if (!stat.isFile()) {
      continue;
    }

    if (strategy === 'reference') {
      stagedFiles.push({ original, staged: original, strategy });
      continue;
    }

    const staged = await uniqueInputPath(inputsDir, original);

    if (strategy === 'copy') {
      if (stat.size > LARGE_FILE_BYTES) {
        stagedFiles.push({ original, staged: original, strategy: 'reference' });
        continue;
      }
      await fs.copyFile(original, staged);
    } else {
      try {
        await fs.symlink(original, staged);
      } catch {
        await fs.copyFile(original, staged);
      }
    }

    stagedFiles.push({ original, staged, strategy });
    pathMapping[original] = staged;
  }

  return { stagedFiles, pathMapping };
}

function resolveProfile(
  profile: WorkspaceProfile,
  directoryExplicitlyChosen: boolean,
  hasGitContext: boolean
): ResolvedWorkspaceProfile {
  if (directoryExplicitlyChosen || profile === 'direct') {
    return 'direct';
  }
  if (profile === 'sandbox') {
    return 'sandbox';
  }
  if (profile === 'worktree') {
    return hasGitContext ? 'worktree' : 'sandbox';
  }
  return hasGitContext ? 'worktree' : 'sandbox';
}

async function writeManifest(rootPath: string, manifest: WorkspaceManifest): Promise<void> {
  await fs.writeFile(manifestPathForRoot(rootPath), JSON.stringify(manifest, null, 2), 'utf8');
}

export async function readManifestForSession(
  sessionId: string,
  goosePathRoot?: string
): Promise<WorkspaceManifest | null> {
  const manifestPath = manifestPathForRoot(workspaceRootForId(sessionId, goosePathRoot));
  try {
    const raw = await fs.readFile(manifestPath, 'utf8');
    return JSON.parse(raw) as WorkspaceManifest;
  } catch {
    return null;
  }
}

export async function getWorkspaceInfo(
  sessionId: string,
  goosePathRoot?: string
): Promise<WorkspaceInfo | null> {
  const manifest = await readManifestForSession(sessionId, goosePathRoot);
  if (!manifest) {
    return null;
  }
  return {
    profile: manifest.profile,
    rootPath: manifest.rootPath,
    stagedFiles: manifest.stagedFiles,
  };
}

export async function hasExternalWorkspaceFiles(
  workingDir: string,
  filePaths: string[]
): Promise<boolean> {
  for (const filePath of filePaths) {
    if (!filePath?.trim() || !fsSync.existsSync(filePath)) {
      continue;
    }
    if (!isPathInside(filePath, workingDir)) {
      return true;
    }
  }
  return false;
}

export async function resolveWorkspace(
  request: ResolveWorkspaceRequest
): Promise<ResolveWorkspaceResult> {
  const pendingId = request.pendingId || randomUUID();
  const externalFilePaths = [...new Set((request.externalFilePaths ?? []).filter(Boolean))];
  const directoryExplicitlyChosen = request.directoryExplicitlyChosen ?? false;

  let gitRepoRoot: string | null = null;
  if (externalFilePaths.length > 0) {
    gitRepoRoot = await findGitRepoRoot(externalFilePaths[0]);
  } else if (request.explicitWorkingDir) {
    gitRepoRoot = await findGitRepoRoot(request.explicitWorkingDir);
  }

  const resolvedProfile = resolveProfile(
    request.profile,
    directoryExplicitlyChosen,
    gitRepoRoot !== null
  );

  if (resolvedProfile === 'direct') {
    const workingDir = request.explicitWorkingDir?.trim() || app.getPath('home');
    const manifest: WorkspaceManifest = {
      sessionId: pendingId,
      profile: 'direct',
      rootPath: workingDir,
      workingDir,
      stagedFiles: [],
      createdAt: new Date().toISOString(),
    };

    return {
      workingDir,
      pendingWorkspaceId: pendingId,
      profile: 'direct',
      manifest,
      pathMapping: {},
      workspaceHint: '',
    };
  }

  const rootPath = workspaceRootForId(pendingId, request.goosePathRoot);
  await fs.mkdir(path.join(rootPath, 'inputs'), { recursive: true });
  let workingDir = path.join(rootPath, 'workspace');
  let branchName: string | undefined;
  let repoRoot: string | undefined;
  let profile: ResolvedWorkspaceProfile = resolvedProfile;

  if (resolvedProfile === 'worktree' && gitRepoRoot) {
    try {
      const worktree = await createGitWorktree(gitRepoRoot, pendingId);
      workingDir = worktree.workingDir;
      branchName = worktree.branchName;
      repoRoot = gitRepoRoot;
      profile = 'worktree';
    } catch {
      profile = 'sandbox';
      await fs.mkdir(workingDir, { recursive: true });
    }
  } else {
    profile = 'sandbox';
    await fs.mkdir(workingDir, { recursive: true });
  }

  const { stagedFiles, pathMapping } = await stageExternalFiles(
    rootPath,
    workingDir,
    externalFilePaths,
    request.externalFileStrategy
  );

  const manifest: WorkspaceManifest = {
    sessionId: pendingId,
    profile,
    rootPath,
    workingDir,
    repoRoot,
    branchName,
    stagedFiles,
    createdAt: new Date().toISOString(),
  };

  await writeManifest(rootPath, manifest);

  const workspaceHint = buildWorkspaceHint(manifest);

  return {
    workingDir,
    pendingWorkspaceId: pendingId,
    profile,
    manifest,
    pathMapping,
    workspaceHint,
  };
}

export async function finalizeWorkspace(request: FinalizeWorkspaceRequest): Promise<void> {
  const { pendingWorkspaceId, sessionId } = request;
  if (!pendingWorkspaceId || pendingWorkspaceId === sessionId) {
    return;
  }

  const root = workspacesRoot(request.goosePathRoot);
  const pendingPath = path.join(root, pendingWorkspaceId);
  const finalPath = path.join(root, sessionId);

  if (!fsSync.existsSync(pendingPath)) {
    return;
  }
  if (fsSync.existsSync(finalPath)) {
    return;
  }

  await fs.rename(pendingPath, finalPath);

  const manifestPath = manifestPathForRoot(finalPath);
  try {
    const raw = await fs.readFile(manifestPath, 'utf8');
    const manifest = JSON.parse(raw) as WorkspaceManifest;
    manifest.sessionId = sessionId;
    await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');
  } catch {
    // ignore
  }
}

export async function cleanupWorkspace(
  sessionId: string,
  goosePathRoot?: string
): Promise<void> {
  const manifest = await readManifestForSession(sessionId, goosePathRoot);
  if (!manifest) {
    return;
  }

  if (manifest.profile === 'worktree' && manifest.repoRoot && manifest.branchName) {
    try {
      await execFileAsync(
        'git',
        ['-C', manifest.repoRoot, 'worktree', 'remove', '--force', manifest.workingDir],
        { timeout: 30_000 }
      );
    } catch {
      // ignore
    }
    try {
      await execFileAsync(
        'git',
        ['-C', manifest.repoRoot, 'branch', '-D', manifest.branchName],
        { timeout: 10_000 }
      );
    } catch {
      // ignore
    }
  }

  const rootPath = workspaceRootForId(sessionId, goosePathRoot);

  if (fsSync.existsSync(rootPath)) {
    await fs.rm(rootPath, { recursive: true, force: true });
  }
}

export async function cleanupOrphanedWorkspaces(goosePathRoot?: string): Promise<void> {
  const root = workspacesRoot(goosePathRoot);
  if (!fsSync.existsSync(root)) {
    return;
  }

  const entries = await fs.readdir(root, { withFileTypes: true });
  const now = Date.now();

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }

    const dirPath = path.join(root, entry.name);
    const manifestPath = manifestPathForRoot(dirPath);

    try {
      const stat = await fs.stat(dirPath);
      let createdAt = stat.mtimeMs;

      if (fsSync.existsSync(manifestPath)) {
        const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8')) as WorkspaceManifest;
        createdAt = Date.parse(manifest.createdAt) || createdAt;
        if (manifest.sessionId && manifest.sessionId !== entry.name) {
          continue;
        }
      }

      if (now - createdAt > ORPHAN_TTL_MS) {
        await fs.rm(dirPath, { recursive: true, force: true });
      }
    } catch {
      // ignore
    }
  }
}
