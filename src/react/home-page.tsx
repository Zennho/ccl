import React from 'react';
import { Icon } from './icons';
import { VersionIcon, type VersionVisual } from './version-icon';
import type { GameVersion } from './types';

type HomePageProps = {
  version: GameVersion | undefined;
  visual: VersionVisual;
  description: string;
};
export function HomePage({ version: v, visual, description }: HomePageProps) {
  return (
    <>
      <section className="hero home-hero">
        <div className="hero-art">
          {[
            'sun',
            'cloud cloud-a',
            'cloud cloud-b',
            'mountain mountain-back',
            'mountain mountain-mid',
            'mountain mountain-front',
            'ground',
          ].map((className) => (
            <div className={className} key={className} />
          ))}
          {['tree tree-a', 'tree tree-b', 'tree tree-c'].map((className) => (
            <div className={className} key={className}>
              <i />
            </div>
          ))}
          <div className="art-grid" />
          <div className="hero-custom" />
        </div>
        <div className="hero-shade" />
        <div className="hero-content">
          <div className="hero-kicker">MINECRAFT · JAVA 版</div>
          <h1>
            准备好，<em>出发。</em>
          </h1>
          <p>你的世界，在这里继续。</p>
        </div>
      </section>
      <div className="section-title home-title">
        <h3>开始游戏</h3>
        <button className="row-button log-link" data-action="open-log" disabled={!v?.installed}>
          启动日志
        </button>
      </div>
      <section className="launch-panel">
        <div className="launch-version">
          <VersionIcon version={v} visual={visual} className="version-cube" />
          <div>
            <small>当前版本</small>
            <strong>{v ? v.name || v.id : '选择一个版本'}</strong>
            <span>{v?.installed ? `${v.kind} · 已安装` : '先在版本管理中安装游戏'}</span>
            {v?.installed && description && (
              <span className="instance-description-home">{description}</span>
            )}
          </div>
        </div>
        <button className="change-version" data-page="versions">
          切换版本 <Icon name="chevron-down" size={15} />
        </button>
        <button className="play-button" data-action="launch" disabled={!v?.installed}>
          <Icon name="play" /> 启动游戏
        </button>
      </section>
    </>
  );
}
