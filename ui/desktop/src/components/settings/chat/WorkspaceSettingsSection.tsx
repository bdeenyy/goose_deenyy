import { useEffect, useState } from 'react';
import { defineMessages, useIntl } from '../../../i18n';
import type { ExternalFileStrategy, WorkspaceProfile } from '../../../utils/settings';

const i18n = defineMessages({
  title: {
    id: 'workspaceSettings.title',
    defaultMessage: 'Session workspace',
  },
  description: {
    id: 'workspaceSettings.description',
    defaultMessage: 'Control how goose isolates each session from your files and projects.',
  },
  profileLabel: {
    id: 'workspaceSettings.profileLabel',
    defaultMessage: 'Isolation mode',
  },
  profileAuto: {
    id: 'workspaceSettings.profileAuto',
    defaultMessage: 'Auto (worktree in git repos, otherwise sandbox)',
  },
  profileSandbox: {
    id: 'workspaceSettings.profileSandbox',
    defaultMessage: 'Always sandbox',
  },
  profileWorktree: {
    id: 'workspaceSettings.profileWorktree',
    defaultMessage: 'Prefer git worktree',
  },
  profileDirect: {
    id: 'workspaceSettings.profileDirect',
    defaultMessage: 'Direct (no isolation)',
  },
  strategyLabel: {
    id: 'workspaceSettings.strategyLabel',
    defaultMessage: 'External files default',
  },
  strategyCopy: {
    id: 'workspaceSettings.strategyCopy',
    defaultMessage: 'Copy into workspace',
  },
  strategyReference: {
    id: 'workspaceSettings.strategyReference',
    defaultMessage: 'Read-only reference',
  },
  strategySymlink: {
    id: 'workspaceSettings.strategySymlink',
    defaultMessage: 'Symlink into workspace',
  },
  rememberLabel: {
    id: 'workspaceSettings.rememberLabel',
    defaultMessage: 'Remember external file choice',
  },
});

export function WorkspaceSettingsSection() {
  const intl = useIntl();
  const [workspaceProfile, setWorkspaceProfile] = useState<WorkspaceProfile>('auto');
  const [externalFileStrategy, setExternalFileStrategy] = useState<ExternalFileStrategy>('copy');
  const [rememberExternalFileChoice, setRememberExternalFileChoice] = useState(false);

  useEffect(() => {
    void (async () => {
      setWorkspaceProfile(await window.electron.getSetting('workspaceProfile'));
      setExternalFileStrategy(await window.electron.getSetting('externalFileStrategy'));
      setRememberExternalFileChoice(await window.electron.getSetting('rememberExternalFileChoice'));
    })();
  }, []);

  const updateProfile = async (value: WorkspaceProfile) => {
    setWorkspaceProfile(value);
    await window.electron.setSetting('workspaceProfile', value);
  };

  const updateStrategy = async (value: ExternalFileStrategy) => {
    setExternalFileStrategy(value);
    await window.electron.setSetting('externalFileStrategy', value);
  };

  const updateRemember = async (value: boolean) => {
    setRememberExternalFileChoice(value);
    await window.electron.setSetting('rememberExternalFileChoice', value);
  };

  return (
    <section className="space-y-4">
      <div>
        <h3 className="text-sm font-medium text-text-primary">{intl.formatMessage(i18n.title)}</h3>
        <p className="text-xs text-text-secondary mt-1">{intl.formatMessage(i18n.description)}</p>
      </div>

      <label className="block space-y-1">
        <span className="text-xs text-text-secondary">{intl.formatMessage(i18n.profileLabel)}</span>
        <select
          className="w-full rounded-md border border-border-default bg-background-primary px-2 py-1.5 text-sm"
          value={workspaceProfile}
          onChange={(e) => void updateProfile(e.target.value as WorkspaceProfile)}
        >
          <option value="auto">{intl.formatMessage(i18n.profileAuto)}</option>
          <option value="sandbox">{intl.formatMessage(i18n.profileSandbox)}</option>
          <option value="worktree">{intl.formatMessage(i18n.profileWorktree)}</option>
          <option value="direct">{intl.formatMessage(i18n.profileDirect)}</option>
        </select>
      </label>

      <label className="block space-y-1">
        <span className="text-xs text-text-secondary">{intl.formatMessage(i18n.strategyLabel)}</span>
        <select
          className="w-full rounded-md border border-border-default bg-background-primary px-2 py-1.5 text-sm"
          value={externalFileStrategy}
          onChange={(e) => void updateStrategy(e.target.value as ExternalFileStrategy)}
        >
          <option value="copy">{intl.formatMessage(i18n.strategyCopy)}</option>
          <option value="reference">{intl.formatMessage(i18n.strategyReference)}</option>
          <option value="symlink">{intl.formatMessage(i18n.strategySymlink)}</option>
        </select>
      </label>

      <label className="flex items-center gap-2 text-sm text-text-secondary cursor-pointer">
        <input
          type="checkbox"
          checked={rememberExternalFileChoice}
          onChange={(e) => void updateRemember(e.target.checked)}
          className="rounded"
        />
        {intl.formatMessage(i18n.rememberLabel)}
      </label>
    </section>
  );
}
