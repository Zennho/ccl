import React from 'react';
import type { GameVersion } from './types';

export type VersionVisual = { color: string; cover?: string | null };
export function VersionIcon({
  version,
  visual,
  className = 'row-icon',
}: {
  version?: GameVersion;
  visual: VersionVisual;
  className?: string;
}) {
  const badges: Record<string, string> = {
    Fabric: 'F',
    Forge: 'FG',
    NeoForge: 'NF',
    Quilt: 'Q',
    整合包: '包',
  };
  const kind = version?.kind || '正式版',
    badge = badges[kind];
  return (
    <div
      style={{ '--instance-color': visual.color } as React.CSSProperties}
      className={`${className} game-version-icon`}
      title={kind}
      aria-label={kind}
    >
      <svg viewBox="0 0 32 32" aria-hidden="true">
        <path fill="#876045" d="M3 9 16 3l13 6v14l-13 7L3 23z" />
        <path fill="#6c4b38" d="M16 15 29 9v14l-13 7z" />
        <path fill="#95b86c" d="M3 9 16 3l13 6-13 6z" />
        <path fill="#779f5d" d="M3 9 16 15v5l-4-2v-2l-3-1v2l-3-2v-2l-3-1z" />
        <path fill="#658954" d="M16 15 29 9v4l-3 2v-2l-3 2v2l-3 1v-2l-4 2z" />
        <path fill="#ad8260" d="M6 19h2v2H6zm5 3h2v2h-2z" />
        <path fill="#8e684a" d="M20 21h2v2h-2zm5-4h2v2h-2z" />
      </svg>
      {visual.cover && <img className="instance-icon-cover" src={visual.cover} alt="" />}
      {badge && <span className="game-version-badge">{badge}</span>}
    </div>
  );
}
