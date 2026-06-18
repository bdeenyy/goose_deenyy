import { useCallback } from 'react';
import {
  Copy,
  ExternalLink,
  FolderOpen,
  FolderDot,
  GitBranch,
  LoaderCircle,
  RefreshCw,
  Sparkles,
} from 'lucide-react';
import { toast } from 'react-toastify';
import { defineMessages, useIntl } from '../../i18n';
import type { SessionArtifactsResult } from '../../workspace/artifactScanner';
import type { ResolvedWorkspaceProfile } from '../../workspace/types';
import { cn } from '../../utils';
import { Button } from '../ui/button';
import { ScrollArea } from '../ui/scroll-area';

const i18n = defineMessages({
  title: {
    id: 'sessionArtifacts.title',
    defaultMessage: 'Artifacts',
  },
  inputs: {
    id: 'sessionArtifacts.inputs',
    defaultMessage: 'Inputs',
  },
  workspace: {
    id: 'sessionArtifacts.workspace',
    defaultMessage: 'Workspace',
  },
  meta: {
    id: 'sessionArtifacts.meta',
    defaultMessage: 'Meta',
  },
  refresh: {
    id: 'sessionArtifacts.refresh',
    defaultMessage: 'Refresh',
  },
  empty: {
    id: 'sessionArtifacts.empty',
    defaultMessage: 'No files yet',
  },
  openInFinder: {
    id: 'sessionArtifacts.openInFinder',
    defaultMessage: 'Open in file manager',
  },
  copyPath: {
    id: 'sessionArtifacts.copyPath',
    defaultMessage: 'Copy path',
  },
  copiedPath: {
    id: 'sessionArtifacts.copiedPath',
    defaultMessage: 'Path copied',
  },
  externalBadge: {
    id: 'sessionArtifacts.externalBadge',
    defaultMessage: 'External',
  },
  truncated: {
    id: 'sessionArtifacts.truncated',
    defaultMessage: 'Showing first {count} files',
  },
  profileSandbox: {
    id: 'sessionArtifacts.profileSandbox',
    defaultMessage: 'Sandbox',
  },
  profileWorktree: {
    id: 'sessionArtifacts.profileWorktree',
    defaultMessage: 'Worktree',
  },
  profileDirect: {
    id: 'sessionArtifacts.profileDirect',
    defaultMessage: 'Direct',
  },
  workingDir: {
    id: 'sessionArtifacts.workingDir',
    defaultMessage: 'Working directory',
  },
  rootPath: {
    id: 'sessionArtifacts.rootPath',
    defaultMessage: 'Workspace root',
  },
  branchName: {
    id: 'sessionArtifacts.branchName',
    defaultMessage: 'Branch',
  },
  repoRoot: {
    id: 'sessionArtifacts.repoRoot',
    defaultMessage: 'Repository',
  },
});

interface SessionArtifactsPanelProps {
  artifacts: SessionArtifactsResult | null;
  isLoading: boolean;
  onRefresh: () => void;
  onClose?: () => void;
  className?: string;
}

function profileLabel(intl: ReturnType<typeof useIntl>, profile: ResolvedWorkspaceProfile): string {
  switch (profile) {
    case 'sandbox':
      return intl.formatMessage(i18n.profileSandbox);
    case 'worktree':
      return intl.formatMessage(i18n.profileWorktree);
    case 'direct':
      return intl.formatMessage(i18n.profileDirect);
  }
}

function ProfileIcon({ profile }: { profile: ResolvedWorkspaceProfile }) {
  switch (profile) {
    case 'sandbox':
      return <FolderDot className="size-3.5" />;
    case 'worktree':
      return <GitBranch className="size-3.5" />;
    case 'direct':
      return <FolderOpen className="size-3.5" />;
  }
}

function FileRow({
  path,
  label,
  badge,
  onOpen,
  onCopy,
}: {
  path: string;
  label: string;
  badge?: string;
  onOpen: (path: string) => void;
  onCopy: (path: string) => void;
}) {
  const intl = useIntl();

  return (
    <div className="group flex min-w-0 items-start gap-1 rounded-md px-2 py-1.5 hover:bg-background-secondary">
      <div className="min-w-0 flex-1">
        <div className="truncate text-xs text-text-primary" title={path}>
          {label}
        </div>
        {badge && (
          <span className="mt-0.5 inline-block rounded bg-background-accent px-1 py-0.5 text-[10px] uppercase tracking-wide text-text-secondary">
            {badge}
          </span>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
        <button
          type="button"
          className="rounded p-1 text-text-secondary hover:bg-background-primary hover:text-text-primary"
          title={intl.formatMessage(i18n.openInFinder)}
          onClick={() => onOpen(path)}
        >
          <ExternalLink className="size-3.5" />
        </button>
        <button
          type="button"
          className="rounded p-1 text-text-secondary hover:bg-background-primary hover:text-text-primary"
          title={intl.formatMessage(i18n.copyPath)}
          onClick={() => onCopy(path)}
        >
          <Copy className="size-3.5" />
        </button>
      </div>
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="px-2 py-1 text-[11px] font-medium uppercase tracking-wide text-text-secondary">
      {children}
    </h3>
  );
}

export default function SessionArtifactsPanel({
  artifacts,
  isLoading,
  onRefresh,
  onClose,
  className,
}: SessionArtifactsPanelProps) {
  const intl = useIntl();

  const handleOpen = useCallback((filePath: string) => {
    void window.electron.openDirectoryInExplorer(filePath);
  }, []);

  const handleCopy = useCallback(
    async (filePath: string) => {
      await navigator.clipboard.writeText(filePath);
      toast.success(intl.formatMessage(i18n.copiedPath));
    },
    [intl]
  );

  const hasContent =
    artifacts &&
    (artifacts.inputs.length > 0 ||
      artifacts.workspace.length > 0 ||
      artifacts.meta.workingDir.length > 0);

  return (
    <aside
      className={cn(
        'flex h-full min-h-0 w-[min(360px,35vw)] shrink-0 flex-col border-l border-border-primary bg-background-primary',
        className
      )}
    >
      <div className="flex items-center justify-between border-b border-border-primary px-3 py-2.5">
        <div className="flex items-center gap-2">
          <Sparkles className="size-4 text-text-secondary" />
          <span className="text-sm font-medium text-text-primary">
            {intl.formatMessage(i18n.title)}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="xs"
            shape="round"
            onClick={onRefresh}
            disabled={isLoading}
            title={intl.formatMessage(i18n.refresh)}
          >
            {isLoading ? (
              <LoaderCircle className="size-3.5 animate-spin" />
            ) : (
              <RefreshCw className="size-3.5" />
            )}
          </Button>
          {onClose && (
            <Button variant="ghost" size="xs" shape="round" onClick={onClose}>
              ×
            </Button>
          )}
        </div>
      </div>

      <ScrollArea className="min-h-0 flex-1" paddingX={1} paddingY={2}>
        {!hasContent && !isLoading ? (
          <p className="px-3 py-6 text-center text-sm text-text-secondary">
            {intl.formatMessage(i18n.empty)}
          </p>
        ) : (
          <div className="space-y-4">
            {artifacts && artifacts.inputs.length > 0 && (
              <section>
                <SectionTitle>{intl.formatMessage(i18n.inputs)}</SectionTitle>
                <div className="space-y-0.5">
                  {artifacts.inputs.map((input) => (
                    <FileRow
                      key={`${input.original}-${input.staged}`}
                      path={input.staged}
                      label={input.original.split('/').pop() || input.original}
                      badge={
                        input.original !== input.staged
                          ? intl.formatMessage(i18n.externalBadge)
                          : undefined
                      }
                      onOpen={handleOpen}
                      onCopy={handleCopy}
                    />
                  ))}
                </div>
              </section>
            )}

            {artifacts && (
              <section>
                <SectionTitle>{intl.formatMessage(i18n.workspace)}</SectionTitle>
                {artifacts.workspace.length === 0 ? (
                  <p className="px-3 text-xs text-text-secondary">
                    {intl.formatMessage(i18n.empty)}
                  </p>
                ) : (
                  <div className="space-y-0.5">
                    {artifacts.workspace.map((file) => (
                      <FileRow
                        key={file.path}
                        path={file.path}
                        label={file.relativePath}
                        onOpen={handleOpen}
                        onCopy={handleCopy}
                      />
                    ))}
                  </div>
                )}
                {artifacts.truncated && (
                  <p className="px-3 pt-2 text-xs text-text-secondary">
                    {intl.formatMessage(i18n.truncated, { count: artifacts.workspace.length })}
                  </p>
                )}
              </section>
            )}

            {artifacts && (
              <section>
                <SectionTitle>{intl.formatMessage(i18n.meta)}</SectionTitle>
                <div className="space-y-2 px-2">
                  <div className="flex items-center gap-2 text-xs text-text-primary">
                    <ProfileIcon profile={artifacts.meta.profile} />
                    <span>{profileLabel(intl, artifacts.meta.profile)}</span>
                  </div>

                  <MetaRow
                    label={intl.formatMessage(i18n.workingDir)}
                    path={artifacts.meta.workingDir}
                    onOpen={handleOpen}
                    onCopy={handleCopy}
                  />

                  {artifacts.meta.rootPath !== artifacts.meta.workingDir && (
                    <MetaRow
                      label={intl.formatMessage(i18n.rootPath)}
                      path={artifacts.meta.rootPath}
                      onOpen={handleOpen}
                      onCopy={handleCopy}
                    />
                  )}

                  {artifacts.meta.repoRoot && (
                    <MetaRow
                      label={intl.formatMessage(i18n.repoRoot)}
                      path={artifacts.meta.repoRoot}
                      onOpen={handleOpen}
                      onCopy={handleCopy}
                    />
                  )}

                  {artifacts.meta.branchName && (
                    <div className="text-xs text-text-secondary">
                      {intl.formatMessage(i18n.branchName)}: {artifacts.meta.branchName}
                    </div>
                  )}
                </div>
              </section>
            )}
          </div>
        )}
      </ScrollArea>
    </aside>
  );
}

function MetaRow({
  label,
  path,
  onOpen,
  onCopy,
}: {
  label: string;
  path: string;
  onOpen: (path: string) => void;
  onCopy: (path: string) => void;
}) {
  const intl = useIntl();

  return (
    <div className="group rounded-md bg-background-secondary px-2 py-1.5">
      <div className="text-[10px] uppercase tracking-wide text-text-secondary">{label}</div>
      <div className="mt-0.5 flex min-w-0 items-start gap-1">
        <div className="min-w-0 flex-1 truncate text-xs text-text-primary" title={path}>
          {path}
        </div>
        <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
          <button
            type="button"
            className="rounded p-1 text-text-secondary hover:text-text-primary"
            title={intl.formatMessage(i18n.openInFinder)}
            onClick={() => onOpen(path)}
          >
            <FolderOpen className="size-3.5" />
          </button>
          <button
            type="button"
            className="rounded p-1 text-text-secondary hover:text-text-primary"
            title={intl.formatMessage(i18n.copyPath)}
            onClick={() => onCopy(path)}
          >
            <Copy className="size-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}
