import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { readManifestForSession } from './workspaceManager';
import type { ResolvedWorkspaceProfile, StagedFile } from './types';

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

export async function buildSessionArtifactsFromManifest(
  manifest: import('./types').WorkspaceManifest
): Promise<SessionArtifactsResult> {
  const { files, truncated } = await walkWorkspaceFiles(manifest.workingDir);

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
): Promise<SessionArtifactsResult | null> {
  const manifest = await readManifestForSession(sessionId, goosePathRoot);
  if (manifest) {
    return buildSessionArtifactsFromManifest(manifest);
  }

  if (!workingDirFallback?.trim()) {
    return null;
  }

  const workingDir = workingDirFallback.trim();
  const { files, truncated } = await walkWorkspaceFiles(workingDir);

  return {
    inputs: [],
    workspace: files,
    meta: {
      profile: 'direct',
      rootPath: workingDir,
      workingDir,
    },
    totalCount: files.length,
    truncated,
  };
}
