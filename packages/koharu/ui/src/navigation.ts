import { Bot, Cpu, KeyRound, Keyboard, Languages, Palette, SlidersHorizontal, Type, Upload } from 'lucide-react'

export const settingsTabs = [
  ['appearance', Palette],
  ['pipeline', Cpu],
  ['providers', KeyRound],
  ['translation', Languages],
  ['typesetting', Type],
  ['shortcuts', Keyboard],
] as const

export type SettingsTab = (typeof settingsTabs)[number][0]

export const rightSidebarPanels = [
  { id: 'properties', icon: SlidersHorizontal, label: 'agent.properties' },
  { id: 'agent', icon: Bot, label: 'agent.title' },
  { id: 'shenron', icon: Upload, label: 'Shenron' },
] as const

export type RightSidebarPanel = (typeof rightSidebarPanels)[number]['id']

export const titleBarMenuSections = {
  file: 'menu.file',
  edit: 'menu.edit',
  process: 'menu.process',
  view: 'menu.view',
  help: 'menu.help',
} as const
