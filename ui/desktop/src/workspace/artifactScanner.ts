import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readManifestForSession } from './workspaceManager';
import type { ResolvedWorkspaceProfile, StagedFile, WorkspaceManifest } from './types';

const execFileAsync = promisify(execFile);

export const MAX_ARTIFACT_FILES = 500;

const EXCLUDED_DIRS = new Set(['.git', 'node_modules', 'target']);

export interface WorkspaceFileEntry {
  path: string;
  relativePath: string;
}

export interface SessionArtifactsMeta {
  profile: ResolvedWorkspaceProfile;
  rootPath: string;
  workingDir: string;
  repoRoot?: string;
  branchName?: string;
}

export interface SessionArtifactsResult {
  inputs: StagedFile[];
  workspace: WorkspaceFileEntry[];
  meta: SessionArtifactsMeta;
  totalCount: number;
  truncated: boolean;
}

export function shouldExcludeDir(name: string): boolean {
  return name.startsWith('.') || EXCLUDED_DIRS.has(name);
}

export function shouldExcludeFile(name: string): boolean {
  return name.startsWith('.');
}

export async function walkWorkspaceFiles(
  workingDir: string,
  maxFiles = MAX_ARTIFACT_FILES
): Promise<{ files: WorkspaceFileEntry[]; truncated: boolean }> {
  const files: WorkspaceFileEntry[] = [];
  let truncated = false;

  async function walk(dir: string): Promise<void> {
    if (truncated) {
      return;
    }

    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (truncated) {
        return;
      }

      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        if (shouldExcludeDir(entry.name)) {
          continue;
        }
        await walk(fullPath);
      } else if (entry.isFile()) {
        if (shouldExcludeFile(entry.name)) {
          continue;
        }
        files.push({
          path: fullPath,
          relativePath: path.relative(workingDir, fullPath),
        });
        if (files.length >= maxFiles) {
          truncated = true;
          return;
        }
      }
    }
  }

  if (fsSync.existsSync(workingDir)) {
    await walk(workingDir);
  }

  return { files, truncated };
}

function parseGitStatusPath(line: string): string | null {
  if (line.length < 4) {
    return null;
  }

  let filePath = line.slice(3).trim();
  const renameArrow = ' -> ';
  const renameIndex = filePath.indexOf(renameArrow);
  if (renameIndex !== -1) {
    filePath = filePath.slice(renameIndex + renameArrow.length).trim();
  }

  if (filePath.startsWith('"') && filePath.endsWith('"')) {
    try {
      filePath = JSON.parse(filePath) as string;
    } catch {
      filePath = filePath.slice(1, -1);
    }
  }

  return filePath || null;
}

export async function listWorktreeChangedFiles(
  workingDir: string,
  maxFiles = MAX_ARTIFACT_FILES
): Promise<{ files: WorkspaceFileEntry[]; truncated: boolean }> {
  const files: WorkspaceFileEntry[] = [];
  let truncated = false;

  try {
    const { stdout } = await execFileAsync(
      'git',
      ['-C', workingDir, 'status', '--porcelain'],
      { timeout: 10_000 }
    );

    const seen = new Set<string>();
    for (const line of stdout.split('\n')) {
      if (truncated || !line.trim()) {
        continue;
      }

      const relativePath = parseGitStatusPath(line);
      if (!relativePath || seen.has(relativePath)) {
        continue;
      }
      seen.add(relativePath);

      const fullPath = path.join(workingDir, relativePath);
      if (!fsSync.existsSync(fullPath) || !fsSync.statSync(fullPath).isFile()) {
        continue;
      }

      files.push({ path: fullPath, relativePath });
      if (files.length >= maxFiles) {
        truncated = true;
      }
    }
  } catch {
    return { files: [], truncated: false };
  }

  return { files, truncated };
}

export async function buildSessionArtifactsFromManifest(
  manifest: WorkspaceManifest
): Promise<SessionArtifactsResult> {
  let files: WorkspaceFileEntry[] = [];
  let truncated = false;

  switch (manifest.profile) {
    case 'sandbox': {
      const result = await walkWorkspaceFiles(manifest.workingDir);
      files = result.files;
      truncated = result.truncated;
      break;
    }
    case 'worktree': {
      const result = await listWorktreeChangedFiles(manifest.workingDir);
      files = result.files;
      truncated = result.truncated;
      break;
    }
    case 'direct':
      break;
  }

  return {
    inputs: manifest.stagedFiles,
    workspace: files,
    meta: {
      profile: manifest.profile,
      rootPath: manifest.rootPath,
      workingDir: manifest.workingDir,
      repoRoot: manifest.repoRoot,
      branchName: manifest.branchName,
    },
    totalCount: manifest.stagedFiles.length + files.length,
    truncated,
  };
}

export async function listSessionArtifacts(
  sessionId: string,
  workingDirFallback?: string,
  goosePathRoot?: string
): Promise<SessionArtifactsResult> {
  const manifest = await readManifestForSession(sessionId, goosePathRoot);
  if (manifest) {
    return buildSessionArtifactsFromManifest(manifest);
  }

  const workingDir = workingDirFallback?.trim() ?? '';

  return {
    inputs: [],
    workspace: [],
    meta: {
      profile: 'direct',
      rootPath: workingDir,
      workingDir,
    },
    totalCount: 0,
    truncated: false,
  };
}
