import { Session, startAgent, ExtensionConfig } from './api';
import { DEFAULT_CHAT_TITLE } from './contexts/ChatContext';
import type { setViewType } from './hooks/useNavigation';
import {
  getExtensionConfigsWithOverrides,
  clearExtensionOverrides,
  hasExtensionOverrides,
} from './store/extensionOverrides';
import type { FixedExtensionEntry } from './components/ConfigContext';
import { AppEvents } from './constants/events';
import { decodeRecipe, Recipe } from './recipe';
import type { ExternalFileStrategy, WorkspaceProfile } from './utils/settings';
import {
  applyWorkspaceToUserInput,
  extractExternalFilePaths,
  finalizeSessionWorkspace,
  needsExternalFileStrategyChoice,
  prepareSessionWorkspace,
} from './workspace/resolveSessionWorkspace';
import type { UserInput } from './types/message';

export interface CreateSessionWithWorkspaceOptions {
  workingDir: string;
  directoryExplicitlyChosen?: boolean;
  userInput?: UserInput;
  workspaceProfile?: WorkspaceProfile;
  externalFileStrategy?: ExternalFileStrategy;
  resolveExternalFileStrategy?: () => Promise<ExternalFileStrategy | null>;
  recipeDeeplink?: string;
  recipeId?: string;
  extensionConfigs?: ExtensionConfig[];
  allExtensions?: FixedExtensionEntry[];
}

export interface CreateSessionWithWorkspaceResult {
  session: Session;
  userInput?: UserInput;
}

export function getSessionDisplayName(session: Session): string {
  return session.name || DEFAULT_CHAT_TITLE;
}

export function resumeSession(session: Session, setView: setViewType) {
  const eventDetail = {
    sessionId: session.id,
    initialMessage: undefined,
  };

  window.dispatchEvent(
    new CustomEvent(AppEvents.ADD_ACTIVE_SESSION, {
      detail: eventDetail,
    })
  );

  setView('pair', {
    disableAnimation: true,
    resumeSessionId: session.id,
  });
}

export async function createSession(
  workingDir: string,
  options?: {
    recipeDeeplink?: string;
    recipeId?: string;
    extensionConfigs?: ExtensionConfig[];
    allExtensions?: FixedExtensionEntry[];
  }
): Promise<Session> {
  const body: {
    working_dir: string;
    recipe?: Recipe;
    recipe_id?: string;
    extension_overrides?: ExtensionConfig[];
  } = {
    working_dir: workingDir,
  };

  if (options?.recipeId) {
    body.recipe_id = options.recipeId;
  } else if (options?.recipeDeeplink) {
    body.recipe = await decodeRecipe(options.recipeDeeplink);
  }

  if (options?.extensionConfigs && options.extensionConfigs.length > 0) {
    body.extension_overrides = options.extensionConfigs;
  } else if (options?.allExtensions) {
    const extensionConfigs = getExtensionConfigsWithOverrides(options.allExtensions);
    if (extensionConfigs.length > 0) {
      body.extension_overrides = extensionConfigs;
    }
    if (hasExtensionOverrides()) {
      clearExtensionOverrides();
    }
  }

  const newAgent = await startAgent({
    body,
    throwOnError: true,
  });
  return newAgent.data;
}

export async function createSessionWithWorkspace(
  options: CreateSessionWithWorkspaceOptions
): Promise<CreateSessionWithWorkspaceResult> {
  const directoryExplicitlyChosen = options.directoryExplicitlyChosen ?? false;
  const externalFilePaths = options.userInput ? extractExternalFilePaths(options.userInput) : [];

  let workspaceProfile =
    options.workspaceProfile ??
    ((await window.electron.getSetting('workspaceProfile')) as WorkspaceProfile);
  let externalFileStrategy =
    options.externalFileStrategy ??
    ((await window.electron.getSetting('externalFileStrategy')) as ExternalFileStrategy);

  const rememberChoice = await window.electron.getSetting('rememberExternalFileChoice');
  const needsChoice = await needsExternalFileStrategyChoice(
    options.workingDir,
    externalFilePaths,
    directoryExplicitlyChosen,
    workspaceProfile
  );

  if (needsChoice && !rememberChoice && !options.externalFileStrategy) {
    const chosen = options.resolveExternalFileStrategy
      ? await options.resolveExternalFileStrategy()
      : null;
    if (!chosen) {
      throw new Error('Session creation cancelled');
    }
    externalFileStrategy = chosen;
  }

  const workspace = await prepareSessionWorkspace({
    workingDir: options.workingDir,
    directoryExplicitlyChosen,
    externalFilePaths,
    workspaceProfile,
    externalFileStrategy,
  });

  const session = await createSession(workspace.workingDir, {
    recipeDeeplink: options.recipeDeeplink,
    recipeId: options.recipeId,
    extensionConfigs: options.extensionConfigs,
    allExtensions: options.allExtensions,
  });

  await finalizeSessionWorkspace(workspace.pendingWorkspaceId, session.id);

  const userInput = options.userInput
    ? applyWorkspaceToUserInput(options.userInput, workspace)
    : undefined;

  return { session, userInput };
}

export async function startNewSession(
  initialText: string | undefined,
  setView: setViewType,
  workingDir: string,
  options?: {
    recipeDeeplink?: string;
    recipeId?: string;
    allExtensions?: FixedExtensionEntry[];
  }
): Promise<Session> {
  const { session, userInput } = await createSessionWithWorkspace({
    workingDir,
    userInput: initialText ? { msg: initialText, images: [] } : undefined,
    recipeDeeplink: options?.recipeDeeplink,
    recipeId: options?.recipeId,
    allExtensions: options?.allExtensions,
  });

  window.dispatchEvent(new CustomEvent(AppEvents.SESSION_CREATED, { detail: { session } }));

  const initialMessage = userInput ?? (initialText ? { msg: initialText, images: [] } : undefined);

  window.dispatchEvent(
    new CustomEvent(AppEvents.ADD_ACTIVE_SESSION, {
      detail: { sessionId: session.id, initialMessage },
    })
  );

  setView('pair', {
    disableAnimation: true,
    initialMessage,
    resumeSessionId: session.id,
  });
  return session;
}
