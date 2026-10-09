// SPDX-License-Identifier: Apache-2.0

export type AppId =
  | 'bunsh'
  | 'kernel-monitor'
  | 'spacedrive'
  | 'codex-studio'
  | 'apk-manager'
  | 'm3-fusion'
  | 'diagnostics'
  | 'arcade';

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
  category: 'kernel' | 'shell' | 'files' | 'ai' | 'packages' | 'design' | 'system' | 'games';
  defaultSize: WindowSize;
  defaultPosition: WindowPosition;
}

export interface SystemNotification {
  id: string;
  title: string;
  message: string;
  timestamp: string;
  icon?: string;
  level?: 'info' | 'success' | 'warning' | 'error';
}

export interface KernelSubsystemInfo {
  name: string;
  tier: 'ostd' | 'core' | 'comp' | 'lib';
  status: 'active' | 'standby' | 'ready';
  description: string;
  workers: number;
  memoryKb: number;
}

export interface ApkPackageInfo {
  name: string;
  version: string;
  description: string;
  installed: boolean;
  size: string;
  repo: string;
  signed: boolean;
}

export interface ContainerInfo {
  id: string;
  name: string;
  image: string;
  status: string;
  ports: string;
  memoryMb: number;
  cpuPercent: number;
}
