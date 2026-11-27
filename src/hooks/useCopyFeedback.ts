import { useCallback, useEffect, useRef, useState } from 'react';
import { copyToClipboard } from '../utils/clipboard';

/**
 * Manages transient clipboard copy feedback with automatic timer cleanup on unmount.
 */
export function useCopyFeedback(durationMs = 2000) {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const triggerCopy = useCallback(
    (text: string) => {
      void copyToClipboard(text);
      setCopied(true);
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => setCopied(false), durationMs);
    },
    [durationMs],
  );

  return { copied, triggerCopy };
}
