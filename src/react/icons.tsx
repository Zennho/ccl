import React from 'react';
import {
  Blocks,
  Box,
  ChevronDown,
  ChevronRight,
  Compass,
  Download,
  FolderOpen,
  Gamepad2,
  Globe2,
  HardDrive,
  Layers3,
  LayoutGrid,
  Monitor,
  MoreHorizontal,
  Minus,
  Play,
  RefreshCw,
  Settings,
  Settings2,
  Square,
  UserRound,
  X,
  Zap,
} from 'lucide';

const iconNodes = {
  blocks: Blocks,
  box: Box,
  'chevron-down': ChevronDown,
  'chevron-right': ChevronRight,
  compass: Compass,
  download: Download,
  'folder-open': FolderOpen,
  'gamepad-2': Gamepad2,
  'globe-2': Globe2,
  'hard-drive': HardDrive,
  'layers-3': Layers3,
  'layout-grid': LayoutGrid,
  monitor: Monitor,
  'more-horizontal': MoreHorizontal,
  minus: Minus,
  play: Play,
  'refresh-cw': RefreshCw,
  settings: Settings,
  'settings-2': Settings2,
  square: Square,
  'user-round': UserRound,
  x: X,
  zap: Zap,
} as const;
export function Icon({ name, size = 18 }: { name: string; size?: number }) {
  const node = iconNodes[name as keyof typeof iconNodes];
  if (!node) return null;
  const attrs = Object.fromEntries(
    Object.entries(node[1]).map(([key, value]) => [
      key.replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase()),
      value,
    ]),
  );
  return (
    <svg
      {...attrs}
      width={size}
      height={size}
      className={`lucide lucide-${name}`}
      aria-hidden="true"
    >
      {node[2]?.map(([tag, props], i) => React.createElement(tag, { ...props, key: i }))}
    </svg>
  );
}
