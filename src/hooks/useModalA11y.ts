import { useEffect, useRef, type RefObject } from 'react';

export interface UseModalA11yOptions {
  preventEscapeDefault?: boolean;
  shouldRestoreFocus?: () => boolean;
}

/**
 * Manages modal Escape-to-close, initial focus placement, and focus restoration on close.
 */
export function useModalA11y(
  open: boolean,
  initialFocusRef: RefObject<HTMLElement | null>,
  onClose: () => void,
  options?: UseModalA11yOptions,
): void {
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const optionsRef = useRef(options);
  optionsRef.current = options;

  useEffect(() => {
    if (!open) return;
    const previousFocus = document.activeElement as HTMLElement | null;
    const raf = requestAnimationFrame(() => {
      initialFocusRef.current?.focus();
    });

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (optionsRef.current?.preventEscapeDefault) {
          event.preventDefault();
        }
        onCloseRef.current();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener('keydown', handleKeyDown);
      const restore = optionsRef.current?.shouldRestoreFocus
        ? optionsRef.current.shouldRestoreFocus()
        : true;
      if (restore) {
        previousFocus?.focus();
      }
    };
  }, [initialFocusRef, open]);
}
