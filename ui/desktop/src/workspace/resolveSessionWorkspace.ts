import type { ExternalFileStrategy, WorkspaceProfile } from '../utils/settings';
import type { ResolveWorkspaceResult } from './types';
import { applyPathMapping } from './workspaceHint';
import type { UserInput } from '../types/message';

export interface PrepareSessionWorkspaceOptions {
  workingDir: string;
  directoryExplicitlyChosen: boolean;
  externalFilePaths: string[];
  workspaceProfile: WorkspaceProfile;
  externalFileStrategy: ExternalFileStrategy;
}

export interface PreparedSessionWorkspace {
  workingDir: string;
  pendingWorkspaceId: string;
  workspaceHint: string;
  pathMapping: Record<string, string>;
  profile: ResolveWorkspaceResult['profile'];
}

export async function prepareSessionWorkspace(
  options: PrepareSessionWorkspaceOptions
): Promise<PreparedSessionWorkspace> {
  const pendingId = crypto.randomUUID();
  const result = await window.electron.resolveSessionWorkspace({
    pendingId,
    profile: options.workspaceProfile,
    externalFileStrategy: options.externalFileStrategy,
    explicitWorkingDir: options.workingDir,
    externalFilePaths: options.externalFilePaths,
    directoryExplicitlyChosen: options.directoryExplicitlyChosen,
  });

  return {
    workingDir: result.workingDir,
    pendingWorkspaceId: result.pendingWorkspaceId,
    workspaceHint: result.workspaceHint,
    pathMapping: result.pathMapping,
    profile: result.profile,
  };
}

export async function finalizeSessionWorkspace(
  pendingWorkspaceId: string,
  sessionId: string
): Promise<void> {
  await window.electron.finalizeSessionWorkspace({ pendingWorkspaceId, sessionId });
}

export function applyWorkspaceToUserInput(
  input: UserInput,
  workspace: PreparedSessionWorkspace
): UserInput {
  const msg = applyPathMapping(input.msg, workspace.pathMapping);
  return { ...input, msg };
}

export function extractExternalFilePaths(input: UserInput): string[] {
  return input.filePaths ?? [];
}

export async function needsExternalFileStrategyChoice(
  workingDir: string,
  filePaths: string[],
  directoryExplicitlyChosen: boolean,
  workspaceProfile: WorkspaceProfile
): Promise<boolean> {
  if (filePaths.length === 0 || directoryExplicitlyChosen || workspaceProfile === 'direct') {
    return false;
  }
  return window.electron.hasExternalWorkspaceFiles({ workingDir, filePaths });
}
