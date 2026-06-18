export type WorkspaceProfile = 'auto' | 'sandbox' | 'worktree' | 'direct';

export type ResolvedWorkspaceProfile = 'sandbox' | 'worktree' | 'direct';

export type ExternalFileStrategy = 'copy' | 'reference' | 'symlink';

export interface StagedFile {
  original: string;
  staged: string;
  strategy: ExternalFileStrategy;
}

export interface WorkspaceManifest {
  sessionId: string;
  profile: ResolvedWorkspaceProfile;
  rootPath: string;
  workingDir: string;
  repoRoot?: string;
  branchName?: string;
  stagedFiles: StagedFile[];
  createdAt: string;
}

export interface ResolveWorkspaceRequest {
  pendingId: string;
  profile: WorkspaceProfile;
  externalFileStrategy: ExternalFileStrategy;
  explicitWorkingDir?: string;
  externalFilePaths?: string[];
  directoryExplicitlyChosen?: boolean;
  goosePathRoot?: string;
}

export interface ResolveWorkspaceResult {
  workingDir: string;
  pendingWorkspaceId: string;
  profile: ResolvedWorkspaceProfile;
  manifest: WorkspaceManifest;
  pathMapping: Record<string, string>;
  workspaceHint: string;
}

export interface FinalizeWorkspaceRequest {
  pendingWorkspaceId: string;
  sessionId: string;
  goosePathRoot?: string;
}

export interface WorkspaceInfo {
  profile: ResolvedWorkspaceProfile;
  rootPath: string;
  workingDir: string;
  stagedFiles: StagedFile[];
}
