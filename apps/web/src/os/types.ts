// SPDX-License-Identifier: Apache-2.0
import type React from 'react';

export type AppId =
  | 'terminal'
  | 'm3-studio'
  | 'arcade'
  | 'drive'
  | 'workbench'
  | 'activity-monitor'
  | 'templates'
  | 'docs'
  | 'bridge';

export interface WindowPosition {
  x: number;
  y: number;
}

export interface WindowSize {
  width: number;
  height: number;
}

export interface WindowState {
  id: AppId;
  title: string;
  icon: string;
  isOpen: boolean;
  isMinimized: boolean;
  isMaximized: boolean;
  zIndex: number;
  position: WindowPosition;
  size: WindowSize;
}

export interface AppMetadata {
  id: AppId;
  title: string;
  tagline: string;
  icon: string;
  category: 'system' | 'design' | 'games' | 'tools' | 'dev';
  defaultSize: WindowSize;
  defaultPosition: WindowPosition;
}

export interface SystemNotification {
  id: string;
  title: string;
  message: string;
  timestamp: string;
  icon?: string;
}
