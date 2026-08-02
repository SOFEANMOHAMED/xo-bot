import { useEffect, useRef } from 'react';

interface KeyboardShortcut {
  key: string;
  ctrlKey?: boolean;
  shiftKey?: boolean;
  altKey?: boolean;
  action: () => void;
  description?: string;
}

/**
 * Custom hook for keyboard shortcuts
 */
export function useKeyboardShortcuts(shortcuts: KeyboardShortcut[]) {
  // Use ref to store shortcuts to avoid recreating the handler on every change
  const shortcutsRef = useRef(shortcuts);
  
  useEffect(() => {
    shortcutsRef.current = shortcuts;
  }, [shortcuts]);

  useEffect(() => {
    // Guard against undefined or empty shortcuts
    if (!shortcutsRef.current || !Array.isArray(shortcutsRef.current) || shortcutsRef.current.length === 0) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      // Guard against undefined shortcuts
      if (!shortcutsRef.current || !Array.isArray(shortcutsRef.current) || shortcutsRef.current.length === 0) {
        return;
      }

      // Guard against undefined event
      if (!event || typeof event !== 'object') {
        return;
      }

      try {
        shortcutsRef.current.forEach((shortcut) => {
          if (!shortcut || typeof shortcut !== 'object') {
            return;
          }

          const { key, ctrlKey, shiftKey, altKey, action } = shortcut;
          
          if (!key || typeof action !== 'function') {
            return;
          }

          // Guard against undefined event.key
          if (!event.key || typeof event.key !== 'string') {
            return;
          }
          
          const matchesKey = event.key.toLowerCase() === key.toLowerCase();
          const matchesCtrl = ctrlKey === undefined ? true : (event.ctrlKey === ctrlKey || event.metaKey === ctrlKey);
          const matchesShift = shiftKey === undefined ? true : event.shiftKey === shiftKey;
          const matchesAlt = altKey === undefined ? true : event.altKey === altKey;

          if (matchesKey && matchesCtrl && matchesShift && matchesAlt) {
            // Don't trigger if user is typing in an input
            const target = event.target as HTMLElement;
            if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
              return;
            }

            event.preventDefault();
            event.stopPropagation(); // Prevent event from bubbling to other handlers
            try {
              action();
            } catch (error) {
              // Silently handle errors to avoid breaking other handlers
            }
          }
        });
      } catch (error) {
        // Silently handle errors to avoid breaking other handlers
      }
    };

    // Use capture phase to avoid conflicts with other handlers
    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, []); // Empty dependency array since we use ref
}

