import type { StagedFile, WorkspaceManifest } from './types';

export function buildWorkspaceHint(manifest: WorkspaceManifest): string {
  if (manifest.profile === 'direct') {
    return '';
  }

  const lines = [
    '[Workspace isolation]',
    `Write files only inside: ${manifest.workingDir}`,
  ];

  if (manifest.profile === 'worktree' && manifest.branchName) {
    lines.push(`Git worktree branch: ${manifest.branchName}`);
    if (manifest.repoRoot) {
      lines.push(`Repository root: ${manifest.repoRoot}`);
    }
  }

  if (manifest.stagedFiles.length > 0) {
    lines.push('Attached files:');
    for (const file of manifest.stagedFiles) {
      if (file.strategy === 'copy' || file.strategy === 'symlink') {
        lines.push(`- ${file.staged} (from ${file.original})`);
      } else {
        lines.push(`- ${file.original} (read-only reference; write only in workspace)`);
      }
    }
  }

  return lines.join('\n');
}

export function pathMappingFromStagedFiles(stagedFiles: StagedFile[]): Record<string, string> {
  const mapping: Record<string, string> = {};
  for (const file of stagedFiles) {
    if (file.original !== file.staged) {
      mapping[file.original] = file.staged;
    }
  }
  return mapping;
}

export function applyPathMapping(message: string, mapping: Record<string, string>): string {
  let result = message;
  const entries = Object.entries(mapping).sort((a, b) => b[0].length - a[0].length);
  for (const [original, staged] of entries) {
    result = result.split(original).join(staged);
  }
  return result;
}

export function prependWorkspaceHint(message: string, hint: string): string {
  if (!hint.trim()) {
    return message;
  }
  return message.trim() ? `${hint}\n\n${message}` : hint;
}
