// SPDX-License-Identifier: Apache-2.0
import React, { useState, useRef, useEffect } from 'react';
import type { WindowState } from './types';

interface WindowFrameProps {
  window: WindowState;
  children: React.ReactNode;
  onFocus: () => void;
  onClose: () => void;
  onMinimize: () => void;
  onMaximizeToggle: () => void;
  onUpdatePosition: (x: number, y: number) => void;
  onUpdateSize: (w: number, h: number) => void;
}

export const WindowFrame: React.FC<WindowFrameProps> = ({
  window,
  children,
  onFocus,
  onClose,
  onMinimize,
  onMaximizeToggle,
  onUpdatePosition,
  onUpdateSize,
}) => {
  const [isDragging, setIsDragging] = useState(false);
  const [isResizing, setIsResizing] = useState(false);
  const dragStartRef = useRef<{ mouseX: number; mouseY: number; initialX: number; initialY: number }>({
    mouseX: 0,
    mouseY: 0,
    initialX: 0,
    initialY: 0,
  });
  const resizeStartRef = useRef<{ mouseX: number; mouseY: number; initialW: number; initialH: number }>({
    mouseX: 0,
    mouseY: 0,
    initialW: 0,
    initialH: 0,
  });

  const handleHeaderMouseDown = (e: React.MouseEvent) => {
    if (window.isMaximized) return;
    onFocus();
    setIsDragging(true);
    dragStartRef.current = {
      mouseX: e.clientX,
      mouseY: e.clientY,
      initialX: window.position.x,
      initialY: window.position.y,
    };
  };

  const handleResizeMouseDown = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (window.isMaximized) return;
    onFocus();
    setIsResizing(true);
    resizeStartRef.current = {
      mouseX: e.clientX,
      mouseY: e.clientY,
      initialW: window.size.width,
      initialH: window.size.height,
    };
  };

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (isDragging) {
        const dx = e.clientX - dragStartRef.current.mouseX;
        const dy = e.clientY - dragStartRef.current.mouseY;
        const newX = Math.max(10, Math.min(windowInnerW() - 100, dragStartRef.current.initialX + dx));
        const newY = Math.max(48, Math.min(windowInnerH() - 100, dragStartRef.current.initialY + dy));
        onUpdatePosition(newX, newY);
      } else if (isResizing) {
        const dx = e.clientX - resizeStartRef.current.mouseX;
        const dy = e.clientY - resizeStartRef.current.mouseY;
        const newW = Math.max(420, resizeStartRef.current.initialW + dx);
        const newH = Math.max(280, resizeStartRef.current.initialH + dy);
        onUpdateSize(newW, newH);
      }
    };

    const handleMouseUp = () => {
      setIsDragging(false);
      setIsResizing(false);
    };

    if (isDragging || isResizing) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
      return () => {
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
      };
    }
  }, [isDragging, isResizing, onUpdatePosition, onUpdateSize]);

  const windowInnerW = () => (typeof window !== 'undefined' ? window.innerWidth : 1200);
  const windowInnerH = () => (typeof window !== 'undefined' ? window.innerHeight : 800);

  if (!window.isOpen || window.isMinimized) {
    return null;
  }

  const maximizedStyle: React.CSSProperties = {
    top: '46px',
    left: '12px',
    right: '12px',
    bottom: '76px',
    width: 'calc(100vw - 24px)',
    height: 'calc(100vh - 122px)',
    zIndex: window.zIndex,
  };

  const normalStyle: React.CSSProperties = {
    top: `${window.position.y}px`,
    left: `${window.position.x}px`,
    width: `${window.size.width}px`,
    height: `${window.size.height}px`,
    zIndex: window.zIndex,
  };

  return (
    <div
      onMouseDown={onFocus}
      style={window.isMaximized ? maximizedStyle : normalStyle}
      className={`fixed flex flex-col rounded-2xl shadow-2xl backdrop-blur-xl border border-[var(--md-sys-color-outline-variant)] bg-[var(--md-sys-color-surface)]/95 overflow-hidden transition-all duration-100 ${
        isDragging ? 'opacity-90 select-none' : ''
      }`}
    >
      {/* Window Header */}
      <div
        onMouseDown={handleHeaderMouseDown}
        onDoubleClick={onMaximizeToggle}
        className="h-10 px-4 flex items-center justify-between bg-[var(--md-sys-color-surface-container-high)] border-b border-[var(--md-sys-color-outline-variant)] select-none cursor-move"
      >
        {/* Left: Traffic Lights / Window Controls */}
        <div className="flex items-center gap-2">
          <button
            onClick={e => {
              e.stopPropagation();
              onClose();
            }}
            className="w-3.5 h-3.5 rounded-full bg-rose-500 hover:bg-rose-600 transition-colors flex items-center justify-center text-[9px] text-black/60 font-bold leading-none hover:text-black"
            title="Close"
          >
            ×
          </button>
          <button
            onClick={e => {
              e.stopPropagation();
              onMinimize();
            }}
            className="w-3.5 h-3.5 rounded-full bg-amber-400 hover:bg-amber-500 transition-colors flex items-center justify-center text-[9px] text-black/60 font-bold leading-none hover:text-black"
            title="Minimize"
          >
            –
          </button>
          <button
            onClick={e => {
              e.stopPropagation();
              onMaximizeToggle();
            }}
            className="w-3.5 h-3.5 rounded-full bg-emerald-400 hover:bg-emerald-500 transition-colors flex items-center justify-center text-[9px] text-black/60 font-bold leading-none hover:text-black"
            title={window.isMaximized ? 'Restore' : 'Maximize'}
          >
            {window.isMaximized ? '▫' : '+'}
          </button>
        </div>

        {/* Center: Title & Icon */}
        <div className="flex items-center gap-2 text-xs font-bold text-[var(--md-sys-color-on-surface)] truncate pointer-events-none">
          <span>{window.icon}</span>
          <span>{window.title}</span>
        </div>

        {/* Right: Window Status Pills */}
        <div className="flex items-center gap-1.5 text-[10px] text-[var(--md-sys-color-on-surface-variant)] font-mono">
          <span>{Math.round(window.size.width)}×{Math.round(window.size.height)}</span>
        </div>
      </div>

      {/* Window Body */}
      <div className="flex-1 overflow-auto bg-[var(--md-sys-color-surface)] relative">
        {children}
      </div>

      {/* Resize Grip (Bottom Right) */}
      {!window.isMaximized && (
        <div
          onMouseDown={handleResizeMouseDown}
          className="absolute bottom-0 right-0 w-4 h-4 cursor-se-resize flex items-center justify-center text-[10px] text-[var(--md-sys-color-on-surface-variant)]/40 hover:text-[var(--md-sys-color-primary)] select-none"
        >
          ◢
        </div>
      )}
    </div>
  );
};
