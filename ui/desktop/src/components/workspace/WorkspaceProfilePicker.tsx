import { FolderDot, FolderOpen, GitBranch, Sparkles } from 'lucide-react';
import { defineMessages, useIntl } from '../../i18n';
import type { WorkspaceProfile } from '../../workspace/types';
import { cn } from '../../utils';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../ui/Tooltip';

const i18n = defineMessages({
  auto: {
    id: 'hub.workspaceProfile.auto',
    defaultMessage: 'Auto',
  },
  sandbox: {
    id: 'hub.workspaceProfile.sandbox',
    defaultMessage: 'Sandbox',
  },
  worktree: {
    id: 'hub.workspaceProfile.worktree',
    defaultMessage: 'Worktree',
  },
  direct: {
    id: 'hub.workspaceProfile.direct',
    defaultMessage: 'Direct',
  },
  autoTooltip: {
    id: 'hub.workspaceProfile.autoTooltip',
    defaultMessage: 'Auto (worktree in git repos, otherwise sandbox). Default from Settings.',
  },
  sandboxTooltip: {
    id: 'hub.workspaceProfile.sandboxTooltip',
    defaultMessage: 'Always sandbox. Default from Settings.',
  },
  worktreeTooltip: {
    id: 'hub.workspaceProfile.worktreeTooltip',
    defaultMessage: 'Prefer git worktree. Default from Settings.',
  },
  directTooltip: {
    id: 'hub.workspaceProfile.directTooltip',
    defaultMessage: 'Direct (no isolation). Default from Settings.',
  },
  recommended: {
    id: 'hub.workspaceProfile.recommended',
    defaultMessage: 'Recommended',
  },
});

const PROFILES: Array<{
  value: WorkspaceProfile;
  icon: typeof Sparkles;
  label: typeof i18n.auto;
  tooltip: typeof i18n.autoTooltip;
}> = [
  { value: 'auto', icon: Sparkles, label: i18n.auto, tooltip: i18n.autoTooltip },
  { value: 'sandbox', icon: FolderDot, label: i18n.sandbox, tooltip: i18n.sandboxTooltip },
  { value: 'worktree', icon: GitBranch, label: i18n.worktree, tooltip: i18n.worktreeTooltip },
  { value: 'direct', icon: FolderOpen, label: i18n.direct, tooltip: i18n.directTooltip },
];

interface WorkspaceProfilePickerProps {
  value: WorkspaceProfile;
  onChange: (value: WorkspaceProfile) => void;
  disabled?: boolean;
  compact?: boolean;
  recommended?: WorkspaceProfile | null;
}

export function WorkspaceProfilePicker({
  value,
  onChange,
  disabled = false,
  compact = false,
  recommended = null,
}: WorkspaceProfilePickerProps) {
  const intl = useIntl();

  return (
    <TooltipProvider>
      <div
        className={cn(
          'inline-flex items-center gap-0.5 rounded-lg border border-border-primary bg-background-secondary p-0.5',
          compact && 'scale-95',
          disabled && 'opacity-50 pointer-events-none'
        )}
        role="group"
        aria-label={intl.formatMessage(i18n.autoTooltip)}
      >
        {PROFILES.map(({ value: profileValue, icon: Icon, label, tooltip }) => {
          const isActive = value === profileValue;
          const isRecommended = recommended === profileValue && !isActive;

          return (
            <Tooltip key={profileValue}>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => onChange(profileValue)}
                  className={cn(
                    'relative flex items-center gap-1 rounded-md px-2 py-1 text-xs transition-colors',
                    isActive
                      ? 'bg-background-primary text-text-primary shadow-xs'
                      : 'text-text-secondary hover:bg-background-primary/60 hover:text-text-primary'
                  )}
                  aria-pressed={isActive}
                >
                  <Icon className="size-3.5 shrink-0" />
                  {!compact && <span>{intl.formatMessage(label)}</span>}
                  {isRecommended && (
                    <span className="absolute -right-1 -top-1 rounded-full bg-background-accent px-1 text-[8px] uppercase tracking-wide text-text-secondary">
                      {intl.formatMessage(i18n.recommended)}
                    </span>
                  )}
                </button>
              </TooltipTrigger>
              <TooltipContent side="top">{intl.formatMessage(tooltip)}</TooltipContent>
            </Tooltip>
          );
        })}
      </div>
    </TooltipProvider>
  );
}
