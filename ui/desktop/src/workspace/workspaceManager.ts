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
  StageSessionFilesRequest,
  StageSessionFilesResult,
  UnstageablePathsError,
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

export function sandboxSessionRoot(contextDir: string, sessionId: string): string {
  return path.join(contextDir, '.goose', 'sessions', sessionId);
}

async function createSandboxWorkspace(
  contextDir: string,
  pendingId: string
): Promise<{ sessionRoot: string; workingDir: string }> {
  const sessionRoot = sandboxSessionRoot(contextDir, pendingId);
  const workingDir = path.join(sessionRoot, 'workspace');
  await fs.mkdir(path.join(sessionRoot, 'inputs'), { recursive: true });
  await fs.mkdir(workingDir, { recursive: true });
  return { sessionRoot, workingDir };
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

async function branchExists(repoRoot: string, branchName: string): Promise<boolean> {
  try {
    await execFileAsync(
      'git',
      ['-C', repoRoot, 'show-ref', '--verify', '--quiet', `refs/heads/${branchName}`],
      { timeout: 10_000 }
    );
    return true;
  } catch {
    return false;
  }
}

async function uniqueWorktreeBranchName(repoRoot: string, sessionId: string): Promise<string> {
  const base = `goose/session-${shortId(sessionId)}`;
  if (!(await branchExists(repoRoot, base))) {
    return base;
  }

  for (let i = 1; i < 1000; i++) {
    const candidate = `${base}-${i}`;
    if (!(await branchExists(repoRoot, candidate))) {
      return candidate;
    }
  }

  return `${base}-${Date.now()}`;
}

export async function createGitWorktree(
  repoRoot: string,
  sessionId: string
): Promise<{ workingDir: string; branchName: string }> {
  const branchName = await uniqueWorktreeBranchName(repoRoot, sessionId);
  const worktreePath = path.join(repoRoot, '.goose', 'sessions', sessionId);
  await fs.mkdir(path.dirname(worktreePath), { recursive: true });

  try {
    await execFileAsync(
      'git',
      ['-C', repoRoot, 'worktree', 'add', '-b', branchName, worktreePath],
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

export { UnstageablePathsError } from './types';

async function uniqueInputDir(inputsDir: string, dirPath: string): Promise<string> {
  const baseName = path.basename(dirPath);
  let candidate = path.join(inputsDir, baseName);
  if (!fsSync.existsSync(candidate)) {
    return candidate;
  }

  for (let i = 1; i < 1000; i++) {
    candidate = path.join(inputsDir, `${baseName}-${i}`);
    if (!fsSync.existsSync(candidate)) {
      return candidate;
    }
  }
  return path.join(inputsDir, `${baseName}-${Date.now()}`);
}

async function copyDirectoryRecursive(source: string, destination: string): Promise<void> {
  await fs.mkdir(destination, { recursive: true });
  const entries = await fs.readdir(source, { withFileTypes: true });

  for (const entry of entries) {
    const sourcePath = path.join(source, entry.name);
    const destinationPath = path.join(destination, entry.name);

    if (entry.isDirectory()) {
      await copyDirectoryRecursive(sourcePath, destinationPath);
    } else if (entry.isFile()) {
      await fs.copyFile(sourcePath, destinationPath);
    }
  }
}

async function symlinkPath(original: string, staged: string, isDirectory: boolean): Promise<void> {
  const type = isDirectory ? 'dir' : 'file';
  await fs.symlink(original, staged, type);
}

function assertIsolatedStaging(
  filePaths: string[],
  workingDir: string,
  pathMapping: Record<string, string>,
  strategy: ExternalFileStrategy
): void {
  if (strategy === 'reference') {
    return;
  }

  const unstaged = filePaths.filter((filePath) => {
    if (!filePath?.trim() || !fsSync.existsSync(filePath)) {
      return false;
    }
    if (isPathInside(filePath, workingDir)) {
      return false;
    }
    return !(filePath in pathMapping);
  });

  if (unstaged.length > 0) {
    throw new UnstageablePathsError(unstaged);
  }
}

async function stageExternalDirectory(
  original: string,
  inputsDir: string,
  strategy: ExternalFileStrategy
): Promise<{ staged: string; effectiveStrategy: ExternalFileStrategy }> {
  if (strategy === 'reference') {
    return { staged: original, effectiveStrategy: 'reference' };
  }

  const staged = await uniqueInputDir(inputsDir, original);

  if (strategy === 'copy') {
    await copyDirectoryRecursive(original, staged);
    return { staged, effectiveStrategy: 'copy' };
  }

  try {
    await symlinkPath(original, staged, true);
    return { staged, effectiveStrategy: 'symlink' };
  } catch {
    await copyDirectoryRecursive(original, staged);
    return { staged, effectiveStrategy: 'copy' };
  }
}

async function stageExternalFileToInputs(
  original: string,
  inputsDir: string,
  strategy: ExternalFileStrategy,
  sizeBytes: number
): Promise<{ staged: string; effectiveStrategy: ExternalFileStrategy }> {
  if (strategy === 'reference') {
    return { staged: original, effectiveStrategy: 'reference' };
  }

  const staged = await uniqueInputPath(inputsDir, original);

  if (strategy === 'copy') {
    if (sizeBytes > LARGE_FILE_BYTES) {
      try {
        await symlinkPath(original, staged, false);
        return { staged, effectiveStrategy: 'symlink' };
      } catch {
        throw new UnstageablePathsError([original]);
      }
    }
    await fs.copyFile(original, staged);
    return { staged, effectiveStrategy: 'copy' };
  }

  try {
    await symlinkPath(original, staged, false);
    return { staged, effectiveStrategy: 'symlink' };
  } catch {
    await fs.copyFile(original, staged);
    return { staged, effectiveStrategy: 'copy' };
  }
}

async function stageRepoFileInWorktree(
  original: string,
  worktreePath: string,
  strategy: ExternalFileStrategy,
  isDirectory: boolean
): Promise<{ staged: string; effectiveStrategy: ExternalFileStrategy }> {
  const worktreeExists = fsSync.existsSync(worktreePath);
  const sameContent =
    !isDirectory &&
    worktreeExists &&
    fsSync.statSync(worktreePath).isFile() &&
    filesHaveSameContent(original, worktreePath);

  if (worktreeExists && sameContent) {
    return { staged: worktreePath, effectiveStrategy: 'reference' };
  }

  if (!worktreeExists && strategy === 'reference') {
    return { staged: worktreePath, effectiveStrategy: 'reference' };
  }

  const syncStrategy = sameContent ? strategy : 'copy';

  if (isDirectory) {
    if (fsSync.existsSync(worktreePath)) {
      await fs.rm(worktreePath, { recursive: true, force: true });
    }
    await copyDirectoryRecursive(original, worktreePath);
    return { staged: worktreePath, effectiveStrategy: 'copy' };
  }

  await copyFileToWorktreeLocation(original, worktreePath, syncStrategy);
  return { staged: worktreePath, effectiveStrategy: syncStrategy };
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

function replaceSessionIdInPath(pathStr: string, pendingId: string, sessionId: string): string {
  if (!pathStr.includes(pendingId)) {
    return pathStr;
  }
  return pathStr.split(pendingId).join(sessionId);
}

async function removePhysicalWorkspace(
  manifest: WorkspaceManifest,
  indexSessionId: string,
  goosePathRoot?: string
): Promise<void> {
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

  const indexPath = workspaceRootForId(indexSessionId, goosePathRoot);
  const resolvedIndexPath = path.resolve(indexPath);
  const resolvedSessionRoot = path.resolve(manifest.rootPath);

  if (
    manifest.profile !== 'direct' &&
    resolvedSessionRoot !== resolvedIndexPath &&
    fsSync.existsSync(manifest.rootPath)
  ) {
    await fs.rm(manifest.rootPath, { recursive: true, force: true });
  }
}

function worktreePathForRepoFile(
  repoRoot: string,
  workingDir: string,
  filePath: string
): string | null {
  if (!isPathInside(filePath, repoRoot)) {
    return null;
  }

  const relativePath = path.relative(repoRoot, filePath);
  if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
    return null;
  }

  return path.join(workingDir, relativePath);
}

function filesHaveSameContent(pathA: string, pathB: string): boolean {
  const statA = fsSync.statSync(pathA);
  const statB = fsSync.statSync(pathB);
  if (statA.size !== statB.size) {
    return false;
  }
  return fsSync.readFileSync(pathA).equals(fsSync.readFileSync(pathB));
}

async function copyFileToWorktreeLocation(
  original: string,
  worktreePath: string,
  strategy: ExternalFileStrategy
): Promise<void> {
  await fs.mkdir(path.dirname(worktreePath), { recursive: true });

  if (strategy === 'copy') {
    await fs.copyFile(original, worktreePath);
    return;
  }

  try {
    await fs.symlink(original, worktreePath);
  } catch {
    await fs.copyFile(original, worktreePath);
  }
}

export async function stageSessionFiles(
  request: StageSessionFilesRequest
): Promise<StageSessionFilesResult> {
  const manifest = await readManifestForSession(request.sessionId, request.goosePathRoot);
  if (!manifest || manifest.profile === 'direct') {
    return { pathMapping: {} };
  }

  const { stagedFiles, pathMapping } = await stageExternalFiles(
    manifest.rootPath,
    manifest.workingDir,
    request.filePaths,
    request.externalFileStrategy,
    manifest.repoRoot
  );

  if (stagedFiles.length === 0) {
    return { pathMapping: {} };
  }

  manifest.stagedFiles = [...manifest.stagedFiles, ...stagedFiles];
  const indexPath = workspaceRootForId(request.sessionId, request.goosePathRoot);
  await writeManifest(indexPath, manifest);

  return { pathMapping };
}

async function stageExternalFiles(
  workspaceRoot: string,
  workingDir: string,
  filePaths: string[],
  strategy: ExternalFileStrategy,
  repoRoot?: string
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
    const isDirectory = stat.isDirectory();
    if (!stat.isFile() && !isDirectory) {
      throw new UnstageablePathsError([original]);
    }

    if (repoRoot) {
      const worktreePath = worktreePathForRepoFile(repoRoot, workingDir, original);
      if (worktreePath) {
        const { staged, effectiveStrategy } = await stageRepoFileInWorktree(
          original,
          worktreePath,
          strategy,
          isDirectory
        );
        stagedFiles.push({ original, staged, strategy: effectiveStrategy });
        if (staged !== original) {
          pathMapping[original] = staged;
        }
        continue;
      }
    }

    if (isDirectory) {
      const { staged, effectiveStrategy } = await stageExternalDirectory(
        original,
        inputsDir,
        strategy
      );
      stagedFiles.push({ original, staged, strategy: effectiveStrategy });
      if (staged !== original) {
        pathMapping[original] = staged;
      }
      continue;
    }

    const { staged, effectiveStrategy } = await stageExternalFileToInputs(
      original,
      inputsDir,
      strategy,
      stat.size
    );
    stagedFiles.push({ original, staged, strategy: effectiveStrategy });
    if (staged !== original) {
      pathMapping[original] = staged;
    }
  }

  assertIsolatedStaging(filePaths, workingDir, pathMapping, strategy);

  return { stagedFiles, pathMapping };
}

function resolveProfile(
  profile: WorkspaceProfile,
  hasGitContext: boolean
): ResolvedWorkspaceProfile {
  if (profile === 'direct') {
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
    workingDir: manifest.workingDir,
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

  let gitRepoRoot: string | null = null;
  if (request.explicitWorkingDir) {
    gitRepoRoot = await findGitRepoRoot(request.explicitWorkingDir);
  } else if (externalFilePaths.length > 0) {
    gitRepoRoot = await findGitRepoRoot(externalFilePaths[0]);
  }

  const resolvedProfile = resolveProfile(request.profile, gitRepoRoot !== null);

  if (resolvedProfile === 'direct') {
    const workingDir = request.explicitWorkingDir?.trim() || app.getPath('home');
    const rootPath = workspaceRootForId(pendingId, request.goosePathRoot);
    await fs.mkdir(rootPath, { recursive: true });

    const manifest: WorkspaceManifest = {
      sessionId: pendingId,
      profile: 'direct',
      rootPath: workingDir,
      workingDir,
      stagedFiles: [],
      createdAt: new Date().toISOString(),
      status: 'pending',
    };

    await writeManifest(rootPath, manifest);

    return {
      workingDir,
      pendingWorkspaceId: pendingId,
      profile: 'direct',
      manifest,
      pathMapping: {},
      workspaceHint: '',
    };
  }

  const contextDir = request.explicitWorkingDir?.trim() || app.getPath('home');
  const indexRoot = workspaceRootForId(pendingId, request.goosePathRoot);
  let sessionRoot: string;
  let workingDir: string;
  let branchName: string | undefined;
  let repoRoot: string | undefined;
  let profile: ResolvedWorkspaceProfile = resolvedProfile;

  if (resolvedProfile === 'worktree' && gitRepoRoot) {
    try {
      const worktree = await createGitWorktree(gitRepoRoot, pendingId);
      workingDir = worktree.workingDir;
      sessionRoot = worktree.workingDir;
      branchName = worktree.branchName;
      repoRoot = gitRepoRoot;
      profile = 'worktree';
    } catch {
      profile = 'sandbox';
      ({ sessionRoot, workingDir } = await createSandboxWorkspace(contextDir, pendingId));
    }
  } else {
    profile = 'sandbox';
    ({ sessionRoot, workingDir } = await createSandboxWorkspace(contextDir, pendingId));
  }

  const { stagedFiles, pathMapping } = await stageExternalFiles(
    sessionRoot,
    workingDir,
    externalFilePaths,
    request.externalFileStrategy,
    repoRoot
  );

  const manifest: WorkspaceManifest = {
    sessionId: pendingId,
    profile,
    rootPath: sessionRoot,
    workingDir,
    repoRoot,
    branchName,
    stagedFiles,
    createdAt: new Date().toISOString(),
    status: 'pending',
  };

  await fs.mkdir(indexRoot, { recursive: true });
  await writeManifest(indexRoot, manifest);

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
  const pendingIndexPath = path.join(root, pendingWorkspaceId);
  const finalIndexPath = path.join(root, sessionId);

  let manifest: WorkspaceManifest | null = null;
  const pendingManifestPath = manifestPathForRoot(pendingIndexPath);
  if (fsSync.existsSync(pendingManifestPath)) {
    try {
      manifest = JSON.parse(await fs.readFile(pendingManifestPath, 'utf8')) as WorkspaceManifest;
    } catch {
      manifest = null;
    }
  }

  if (fsSync.existsSync(pendingIndexPath) && !fsSync.existsSync(finalIndexPath)) {
    await fs.rename(pendingIndexPath, finalIndexPath);
  }

  if (!manifest) {
    return;
  }

  if (manifest.rootPath.includes(pendingWorkspaceId)) {
    const newRootPath = manifest.rootPath.split(pendingWorkspaceId).join(sessionId);
    if (newRootPath !== manifest.rootPath && fsSync.existsSync(manifest.rootPath)) {
      if (!fsSync.existsSync(newRootPath)) {
        if (manifest.profile === 'worktree' && manifest.repoRoot) {
          await execFileAsync(
            'git',
            ['-C', manifest.repoRoot, 'worktree', 'move', manifest.rootPath, newRootPath],
            { timeout: 30_000 }
          );
        } else {
          await fs.rename(manifest.rootPath, newRootPath);
        }
      }
      manifest.rootPath = newRootPath;
      if (manifest.workingDir.includes(pendingWorkspaceId)) {
        manifest.workingDir = manifest.workingDir.split(pendingWorkspaceId).join(sessionId);
      }
    }
  }

  manifest.stagedFiles = manifest.stagedFiles.map((file) => ({
    ...file,
    staged: replaceSessionIdInPath(file.staged, pendingWorkspaceId, sessionId),
  }));

  manifest.sessionId = sessionId;
  manifest.status = 'active';
  const manifestWritePath = fsSync.existsSync(finalIndexPath) ? finalIndexPath : pendingIndexPath;
  await fs.writeFile(
    manifestPathForRoot(manifestWritePath),
    JSON.stringify(manifest, null, 2),
    'utf8'
  );
}

export async function cleanupWorkspace(
  sessionId: string,
  goosePathRoot?: string
): Promise<void> {
  const manifest = await readManifestForSession(sessionId, goosePathRoot);
  if (!manifest) {
    return;
  }

  await removePhysicalWorkspace(manifest, sessionId, goosePathRoot);

  const indexPath = workspaceRootForId(sessionId, goosePathRoot);
  if (fsSync.existsSync(indexPath)) {
    await fs.rm(indexPath, { recursive: true, force: true });
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
      let manifest: WorkspaceManifest | null = null;

      if (fsSync.existsSync(manifestPath)) {
        manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8')) as WorkspaceManifest;
        createdAt = Date.parse(manifest.createdAt) || createdAt;
        if (manifest.sessionId && manifest.sessionId !== entry.name) {
          continue;
        }
        if (manifest.status !== 'pending') {
          continue;
        }
      } else {
        continue;
      }

      if (now - createdAt > ORPHAN_TTL_MS) {
        if (manifest) {
          await removePhysicalWorkspace(manifest, entry.name, goosePathRoot);
        }
        await fs.rm(dirPath, { recursive: true, force: true });
      }
    } catch {
      // ignore
    }
  }
}
