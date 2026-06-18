import { useCallback, useRef, useState } from 'react';
import { defineMessages, useIntl } from '../../i18n';
import type { ExternalFileStrategy } from '../../utils/settings';
import { Button } from '../ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog';

const i18n = defineMessages({
  title: {
    id: 'externalFileStrategy.title',
    defaultMessage: 'How should attached files be handled?',
  },
  description: {
    id: 'externalFileStrategy.description',
    defaultMessage:
      'These files are outside the session workspace. Choose how goose should access them.',
  },
  copy: {
    id: 'externalFileStrategy.copy',
    defaultMessage: 'Copy into workspace (recommended)',
  },
  copyDetail: {
    id: 'externalFileStrategy.copyDetail',
    defaultMessage: 'Safe — originals stay untouched.',
  },
  reference: {
    id: 'externalFileStrategy.reference',
    defaultMessage: 'Read-only reference',
  },
  referenceDetail: {
    id: 'externalFileStrategy.referenceDetail',
    defaultMessage: 'Use original paths; goose writes only in workspace.',
  },
  symlink: {
    id: 'externalFileStrategy.symlink',
    defaultMessage: 'Link into workspace',
  },
  symlinkDetail: {
    id: 'externalFileStrategy.symlinkDetail',
    defaultMessage: 'Saves space; changes may affect originals.',
  },
  remember: {
    id: 'externalFileStrategy.remember',
    defaultMessage: 'Remember my choice',
  },
});

interface ExternalFileStrategyPromptProps {
  open: boolean;
  onChoose: (strategy: ExternalFileStrategy, remember: boolean) => void;
  onCancel: () => void;
}

export function ExternalFileStrategyPrompt({
  open,
  onChoose,
  onCancel,
}: ExternalFileStrategyPromptProps) {
  const intl = useIntl();
  const [remember, setRemember] = useState(false);

  const choose = useCallback(
    (strategy: ExternalFileStrategy) => {
      onChoose(strategy, remember);
    },
    [onChoose, remember]
  );

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onCancel()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{intl.formatMessage(i18n.title)}</DialogTitle>
          <DialogDescription>{intl.formatMessage(i18n.description)}</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-2">
          <Button variant="outline" className="h-auto flex-col items-start p-3" onClick={() => choose('copy')}>
            <span className="font-medium">{intl.formatMessage(i18n.copy)}</span>
            <span className="text-xs text-text-secondary">{intl.formatMessage(i18n.copyDetail)}</span>
          </Button>
          <Button
            variant="outline"
            className="h-auto flex-col items-start p-3"
            onClick={() => choose('reference')}
          >
            <span className="font-medium">{intl.formatMessage(i18n.reference)}</span>
            <span className="text-xs text-text-secondary">{intl.formatMessage(i18n.referenceDetail)}</span>
          </Button>
          <Button
            variant="outline"
            className="h-auto flex-col items-start p-3"
            onClick={() => choose('symlink')}
          >
            <span className="font-medium">{intl.formatMessage(i18n.symlink)}</span>
            <span className="text-xs text-text-secondary">{intl.formatMessage(i18n.symlinkDetail)}</span>
          </Button>
        </div>

        <label className="flex items-center gap-2 text-sm text-text-secondary cursor-pointer">
          <input
            type="checkbox"
            checked={remember}
            onChange={(e) => setRemember(e.target.checked)}
            className="rounded"
          />
          {intl.formatMessage(i18n.remember)}
        </label>

        <DialogFooter>
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function useExternalFileStrategyPrompt() {
  const strategyPromptResolverRef = useRef<((value: ExternalFileStrategy | null) => void) | null>(
    null
  );
  const [open, setOpen] = useState(false);

  const prompt = useCallback((): Promise<ExternalFileStrategy | null> => {
    setOpen(true);
    return new Promise((resolve) => {
      strategyPromptResolverRef.current = (strategy) => {
        setOpen(false);
        resolve(strategy);
      };
    });
  }, []);

  const handleChoose = useCallback((strategy: ExternalFileStrategy, remember: boolean) => {
    if (remember) {
      void window.electron.setSetting('rememberExternalFileChoice', true);
      void window.electron.setSetting('externalFileStrategy', strategy);
    }
    strategyPromptResolverRef.current?.(strategy);
    strategyPromptResolverRef.current = null;
    setOpen(false);
  }, []);

  const handleCancel = useCallback(() => {
    strategyPromptResolverRef.current?.(null);
    strategyPromptResolverRef.current = null;
    setOpen(false);
  }, []);

  return { open, prompt, handleChoose, handleCancel };
}
