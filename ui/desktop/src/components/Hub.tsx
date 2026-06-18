/**
 * Hub Component
 *
 * The empty-chat landing screen. Visually it's "Pair with no messages yet" —
 * a large time + greeting above a centered, narrower ChatInput. Submitting
 * creates a session and navigates to /pair so the rest of the chat lifecycle
 * lives there.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { IpcRendererEvent } from 'electron';
import { defineMessages, useIntl } from '../i18n';
import { AppEvents } from '../constants/events';
import ChatInput from './ChatInput';
import { ChatInputCard } from './ChatInputCard';
import { ChatState } from '../types/chatState';
import 'react-toastify/dist/ReactToastify.css';
import { View, ViewOptions } from '../utils/navigationUtils';
import { useConfig } from './ConfigContext';
import {
  clearExtensionOverrides,
  getExtensionConfigsWithOverrides,
} from '../store/extensionOverrides';
import { getInitialWorkingDir } from '../utils/workingDir';
import { createSessionWithWorkspace } from '../sessions';
import LoadingGoose from './LoadingGoose';
import { UserInput } from '../types/message';
import { ExternalFileStrategyPrompt, useExternalFileStrategyPrompt } from './workspace/ExternalFileStrategyPrompt';
import { WorkspaceProfilePicker } from './workspace/WorkspaceProfilePicker';
import type { WorkspaceProfile } from '../workspace/types';
import type { DroppedFile } from '../hooks/useFileDrop';

const i18n = defineMessages({
  goodMorning: { id: 'hub.goodMorning', defaultMessage: 'Good morning' },
  goodAfternoon: { id: 'hub.goodAfternoon', defaultMessage: 'Good afternoon' },
  goodEvening: { id: 'hub.goodEvening', defaultMessage: 'Good evening' },
});

function useClock(): { time: string; meridiem: string; hour: number } {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const interval = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(interval);
  }, []);

  const hour = now.getHours();
  const minutes = now.getMinutes();
  const meridiem = hour >= 12 ? 'PM' : 'AM';
  const displayHour = ((hour + 11) % 12) + 1;
  const time = `${displayHour}:${String(minutes).padStart(2, '0')}`;
  return { time, meridiem, hour };
}

function pathsToDroppedFiles(paths: string[]): DroppedFile[] {
  return paths.map((filePath, index) => ({
    id: `pending-${index}-${filePath}`,
    path: filePath,
    name: filePath.split('/').pop() || filePath,
    type: '',
    isImage: false,
  }));
}

export default function Hub({
  setView,
}: {
  setView: (view: View, viewOptions?: ViewOptions) => void;
}) {
  const intl = useIntl();
  const { extensionsList } = useConfig();
  const [workingDir, setWorkingDir] = useState(getInitialWorkingDir());
  const [directoryExplicitlyChosen, setDirectoryExplicitlyChosen] = useState(false);
  const [isCreatingSession, setIsCreatingSession] = useState(false);
  const [pendingDroppedFiles, setPendingDroppedFiles] = useState<DroppedFile[]>([]);
  const [sessionWorkspaceProfile, setSessionWorkspaceProfile] = useState<WorkspaceProfile>('auto');
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const { time, meridiem, hour } = useClock();
  const { open: strategyPromptOpen, prompt: promptStrategy, handleChoose, handleCancel } =
    useExternalFileStrategyPrompt();

  const greeting = useMemo(() => {
    if (hour < 12) return intl.formatMessage(i18n.goodMorning);
    if (hour < 18) return intl.formatMessage(i18n.goodAfternoon);
    return intl.formatMessage(i18n.goodEvening);
  }, [intl, hour]);

  useEffect(() => {
    void window.electron.getSetting('workspaceProfile').then((profile) => {
      setSessionWorkspaceProfile(profile);
    });
  }, []);

  useEffect(() => {
    const handlePendingFiles = (_event: IpcRendererEvent, ...args: unknown[]) => {
      const filePaths = args[0];
      if (Array.isArray(filePaths) && filePaths.length > 0) {
        setPendingDroppedFiles(pathsToDroppedFiles(filePaths as string[]));
      }
    };
    window.electron.on('set-pending-dropped-files', handlePendingFiles);
    return () => {
      window.electron.off('set-pending-dropped-files', handlePendingFiles);
    };
  }, []);

  useEffect(() => {
    const frameId = requestAnimationFrame(() => {
      inputRef.current?.focus();
    });
    return () => cancelAnimationFrame(frameId);
  }, []);

  const recommendedProfile = useMemo((): WorkspaceProfile | null => {
    if (directoryExplicitlyChosen || pendingDroppedFiles.length === 0) {
      return null;
    }
    return 'auto';
  }, [directoryExplicitlyChosen, pendingDroppedFiles.length]);

  const handleWorkingDirChange = (newDir: string) => {
    setWorkingDir(newDir);
    setDirectoryExplicitlyChosen(true);
    setSessionWorkspaceProfile('direct');
  };

  const handleSubmit = async (input: UserInput) => {
    const { msg: userMessage, images } = input;
    if (!(images.length > 0 || userMessage.trim()) || isCreatingSession) return;

    const extensionConfigs = getExtensionConfigsWithOverrides(extensionsList);
    clearExtensionOverrides();
    setIsCreatingSession(true);

    try {
      const { session, userInput } = await createSessionWithWorkspace({
        workingDir,
        directoryExplicitlyChosen,
        workspaceProfile: sessionWorkspaceProfile,
        userInput: input,
        extensionConfigs,
        allExtensions: extensionConfigs.length > 0 ? undefined : extensionsList,
        resolveExternalFileStrategy: promptStrategy,
      });

      const initialMessage = userInput ?? { msg: userMessage, images };

      window.dispatchEvent(new CustomEvent(AppEvents.SESSION_CREATED));
      window.dispatchEvent(
        new CustomEvent(AppEvents.ADD_ACTIVE_SESSION, {
          detail: { sessionId: session.id, initialMessage },
        })
      );

      setView('pair', {
        disableAnimation: true,
        resumeSessionId: session.id,
        initialMessage,
      });
    } catch (error) {
      if (error instanceof Error && error.message === 'Session creation cancelled') {
        setIsCreatingSession(false);
        return;
      }
      console.error('Failed to create session:', error);
      setIsCreatingSession(false);
    }
  };

  return (
    <div className="flex flex-col h-full min-h-0 items-center justify-center px-6 relative">
      <ExternalFileStrategyPrompt
        open={strategyPromptOpen}
        onChoose={handleChoose}
        onCancel={handleCancel}
      />

      <div className="w-full max-w-2xl">
        <div className="flex items-baseline gap-2 mb-1">
          <span className="text-6xl font-light text-text-primary tracking-tight tabular-nums">
            {time}
          </span>
          <span className="text-2xl font-light text-text-secondary">{meridiem}</span>
        </div>
        <p className="text-xl text-text-secondary mb-4">{greeting}</p>

        <div className="mb-3 flex justify-center">
          <WorkspaceProfilePicker
            value={sessionWorkspaceProfile}
            onChange={setSessionWorkspaceProfile}
            disabled={isCreatingSession}
            recommended={recommendedProfile}
          />
        </div>

        <ChatInputCard>
          <ChatInput
            sessionId={null}
            handleSubmit={handleSubmit}
            chatState={isCreatingSession ? ChatState.LoadingConversation : ChatState.Idle}
            onStop={() => {}}
            initialValue=""
            setView={setView}
            totalTokens={0}
            accumulatedInputTokens={0}
            accumulatedOutputTokens={0}
            droppedFiles={pendingDroppedFiles}
            onFilesProcessed={() => setPendingDroppedFiles([])}
            messages={[]}
            disableAnimation={false}
            toolCount={0}
            onWorkingDirChange={handleWorkingDirChange}
            inputRef={inputRef}
          />
        </ChatInputCard>
      </div>

      {isCreatingSession && (
        <div className="absolute bottom-4 left-4 z-20 pointer-events-none">
          <LoadingGoose chatState={ChatState.LoadingConversation} />
        </div>
      )}
    </div>
  );
}
