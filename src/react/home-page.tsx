import React from 'react';
import { Icon } from './icons';
import { VersionIcon, type VersionVisual } from './version-icon';
import type { GameVersion } from './types';

type HomePageProps = {
  version: GameVersion | undefined;
  visual: VersionVisual;
  description: string;
  versions: GameVersion[];
  accountStatus: string;
  playerName: string;
  versionVisual: (version: GameVersion) => VersionVisual;
};
export function HomePage({
  version: v,
  visual,
  description,
  versions,
  accountStatus,
  playerName,
  versionVisual,
}: HomePageProps) {
  const installed = versions.filter((item) => item.installed);
  return (
    <>
      <div className="page-heading home-heading">
        <div>
          <h1>开始游戏</h1>
          <p>选择版本和账户，直接开始或管理当前游戏。</p>
        </div>
        <button className="outline-btn" data-page="versions">
          <Icon name="download" size={16} /> 安装游戏
        </button>
      </div>
      <section className="hero home-hero" aria-label="当前游戏">
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
        <div className="launch-panel">
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
          <details className="home-version-menu" data-home-version-menu>
            <summary className="change-version" aria-label="切换游戏版本">
              切换版本 <Icon name="chevron-down" size={15} />
            </summary>
            <div className="home-version-options">
              {versions
                .filter((item) => item.installed)
                .map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    data-select={item.id}
                    className={item.id === v?.id ? 'selected' : ''}
                  >
                    <strong>{item.name || item.id}</strong>
                    <small>
                      {item.kind}
                      {item.id === v?.id ? ' · 当前' : ''}
                    </small>
                  </button>
                ))}
              <button type="button" data-page="versions" className="quick-manage">
                管理版本 →
              </button>
            </div>
          </details>
          <button className="home-player" type="button" data-page="account">
            <small>当前玩家</small>
            <strong>{playerName}</strong>
            <span>{accountStatus}</span>
          </button>
          <button className="play-button" data-action="launch" disabled={!v?.installed}>
            <Icon name="play" /> 启动游戏
          </button>
        </div>
      </section>
      <div className="home-workspace">
        <section className="home-instances" aria-labelledby="home-instances-title">
          <div className="section-title">
            <h2 id="home-instances-title">
              已安装实例 <span className="count">{installed.length}</span>
            </h2>
            <button className="text-link" data-page="versions">
              全部实例 →
            </button>
          </div>
          <div className="version-list">
            {installed.length ? (
              installed.slice(0, 4).map((item) => (
                <div className="version-row home-instance-row" key={item.id}>
                  <VersionIcon version={item} visual={versionVisual(item)} />
                  <div className="row-name">
                    <strong>{item.name || item.id}</strong>
                    <span>
                      {item.kind}
                      {item.isolated ? ' · 独立目录' : ''}
                    </span>
                  </div>
                  <span className="home-instance-state">
                    {item.id === v?.id ? '当前' : '已安装'}
                  </span>
                  <button className="row-button" data-instance-overview={item.id}>
                    详情
                  </button>
                  {item.id !== v?.id && (
                    <button className="row-button" data-select={item.id}>
                      选择
                    </button>
                  )}
                </div>
              ))
            ) : (
              <div className="empty-state">
                <strong>还没有已安装的实例</strong>
                <p>安装游戏或导入已有游戏包后，即可在这里启动。</p>
                <button className="outline-btn" data-page="versions">
                  安装或导入游戏
                </button>
              </div>
            )}
          </div>
        </section>
        <aside className="home-quick-actions" aria-label="当前实例快捷操作">
          <div className="section-title">
            <h2>当前实例</h2>
          </div>
          <div className="home-quick-card">
            <strong>{v?.installed ? v.name || v.id : '尚未选择实例'}</strong>
            <p>{v?.installed ? `${v.kind} · 已安装` : '安装或选择一个版本后管理内容'}</p>
            <div className="home-quick-buttons">
              <button className="row-button" data-page="content" data-current-content-target>
                模组与资源
              </button>
              {v?.installed && (
                <button className="row-button" data-manage-worlds={v.id}>
                  存档管理
                </button>
              )}
              {v?.installed && (
                <button className="row-button" data-manage-backups={v.id}>
                  备份与恢复
                </button>
              )}
              {v?.installed && (
                <button className="row-button" data-instance-settings={v.id}>
                  实例设置
                </button>
              )}
            </div>
          </div>
          <button
            className="home-log-link text-link"
            data-action="open-log"
            disabled={!v?.installed}
          >
            查看启动日志 →
          </button>
        </aside>
      </div>
    </>
  );
}
