import React from 'react';
import { createPortal } from 'react-dom';

/**
 * Renders a full-viewport modal overlay via portal so it is not clipped by
 * parent overflow/transform (e.g. AdminLayout main scroll area).
 */
export const ModalOverlay: React.FC<{
  children: React.ReactNode;
  /** Extra class on the panel wrapper (max-width etc.) */
  panelClassName?: string;
  onClose?: () => void;
}> = ({ children, panelClassName = 'w-full max-w-lg', onClose }) => {
  if (typeof document === 'undefined') return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[10000] overflow-y-auto bg-black/70 backdrop-blur-sm"
      style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 10000 }}
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <div className="flex min-h-full items-center justify-center p-4 sm:p-6">
        <div
          className={`${panelClassName} relative z-[10001] max-h-[calc(100dvh-2rem)] overflow-y-auto`}
          style={{ position: 'relative', zIndex: 10001 }}
          onClick={(e) => e.stopPropagation()}
        >
          {children}
        </div>
      </div>
    </div>,
    document.body
  );
};

export default ModalOverlay;
