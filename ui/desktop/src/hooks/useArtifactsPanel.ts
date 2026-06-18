import { useCallback, useEffect, useRef, useState } from 'react';
import type { SessionArtifactsResult } from '../workspace/artifactScanner';

const ARTIFACTS_PANEL_OPEN_KEY = 'artifacts_panel_open';
const NARROW_WINDOW_THRESHOLD = 900;

export function useArtifactsPanel(sessionId: string | null, workingDir?: string) {
  const [isOpen, setIsOpenState] = useState<boolean>(() => {
    return localStorage.getItem(ARTIFACTS_PANEL_OPEN_KEY) === 'true';
  });
  const [artifacts, setArtifacts] = useState<SessionArtifactsResult | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const isOpenRef = useRef(isOpen);

  useEffect(() => {
    isOpenRef.current = isOpen;
  }, [isOpen]);

  const setIsOpen = useCallback((open: boolean) => {
    setIsOpenState(open);
    localStorage.setItem(ARTIFACTS_PANEL_OPEN_KEY, String(open));
  }, []);

  const toggle = useCallback(() => {
    setIsOpen(!isOpenRef.current);
  }, [setIsOpen]);

  const refresh = useCallback(async () => {
    if (!sessionId) {
      setArtifacts(null);
      return;
    }

    setIsLoading(true);
    try {
      const result = await window.electron.listSessionArtifacts(sessionId, workingDir);
      setArtifacts(result);
    } catch {
      setArtifacts(null);
    } finally {
      setIsLoading(false);
    }
  }, [sessionId, workingDir]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (isOpen) {
      void refresh();
    }
  }, [isOpen, refresh]);

  useEffect(() => {
    let lastWidth = window.innerWidth;
    if (lastWidth < NARROW_WINDOW_THRESHOLD && isOpenRef.current) {
      setIsOpen(false);
    }

    const onResize = () => {
      const width = window.innerWidth;
      if (
        width < NARROW_WINDOW_THRESHOLD &&
        lastWidth >= NARROW_WINDOW_THRESHOLD &&
        isOpenRef.current
      ) {
        setIsOpen(false);
      }
      lastWidth = width;
    };

    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [setIsOpen]);

  const fileCount = artifacts?.totalCount ?? 0;

  return {
    isOpen,
    setIsOpen,
    toggle,
    artifacts,
    isLoading,
    refresh,
    fileCount,
  };
}
