import React from 'react';
import { Icon } from './icons';
import { VersionIcon, type VersionVisual } from './version-icon';
import type { GameVersion } from './types';

const actions = [
  ['instance-settings', 'settings-2', '实例设置'],
  ['instance-theme', 'layout-grid', '实例主题'],
  ['game-profile', 'gamepad-2', '游戏档案'],
  ['manage-backups', 'hard-drive', '备份与恢复'],
  ['manage-worlds', 'folder-open', '存档管理'],
  ['instance-overview', 'hard-drive', '实例概览'],
  ['open-version-folder', 'folder-open', '游戏目录'],
  ['export-game', 'download', '导出游戏'],
  ['delete-version', 'x', '删除版本'],
] as const;
type VersionRowProps = { version: GameVersion; selected: string; visual: VersionVisual };
function VersionRow({ version: v, selected, visual }: VersionRowProps) {
  return (
    <div className="version-row">
      <VersionIcon version={v} visual={visual} />
      <div className="row-name">
        <strong>{v.name || v.id}</strong>
        <span>
          {v.kind}
          {v.released ? ` · ${v.released}` : ''}
        </span>
      </div>
      <div className={`row-state ${v.installed ? 'installed' : ''}`}>
        <span />
        {v.installed ? '已安装' : '可安装'}
      </div>
      {v.installed ? (
        <>
          <button
            className={`row-button ${selected === v.id ? 'selected' : ''}`}
            data-select={v.id}
          >
            {selected === v.id ? '当前版本' : '选择版本'}
          </button>
          <details className="version-menu">
            <summary aria-label={`${v.name || v.id} 的更多操作`} title="更多操作">
              <Icon name="more-horizontal" />
            </summary>
            <div className="version-menu-items">
              {actions.map(([key, icon, title]) => (
                <button key={key} {...{ [`data-${key}`]: v.id }}>
                  <Icon name={icon} size={15} /> {title}
                </button>
              ))}
              {['正式版', '快照版', '旧版 Beta', '旧版 Alpha'].includes(v.kind) && (
                <button data-install={v.id}>
                  <Icon name="layers-3" size={15} /> 配置安装
                </button>
              )}
            </div>
          </details>
        </>
      ) : ['正式版', '快照版', '旧版 Beta', '旧版 Alpha'].includes(v.kind) ? (
        <button className="row-button install-choice" data-install={v.id}>
          <Icon name="download" size={14} /> 安装
        </button>
      ) : null}
    </div>
  );
}

type VersionsPageProps = {
  versions: GameVersion[];
  query: string;
  selected: string;
  loading: boolean;
  versionVisual: (version: GameVersion) => VersionVisual;
  deleteVersion: { name: string; isolated: boolean } | null;
  deleting: boolean;
};
export function VersionsPage({
  versions,
  query,
  selected,
  loading,
  versionVisual,
  deleteVersion,
  deleting,
}: VersionsPageProps) {
  const search = query.trim().toLowerCase();
  const list = versions.filter(
    (v) => !search || `${v.name || ''} ${v.id} ${v.kind}`.toLowerCase().includes(search),
  );
  const groupLabels = [
    '自定义实例',
    '整合包',
    '正式版',
    '快照版',
    '旧版 Beta',
    '旧版 Alpha',
    '其他版本',
  ];
  const groupFor = (version: GameVersion) =>
    ['Fabric', 'Forge', 'NeoForge', 'Quilt'].includes(version.kind)
      ? '自定义实例'
      : groupLabels.includes(version.kind)
        ? version.kind
        : '其他版本';
  return (
    <>
      <div className="page-heading inner-heading">
        <div>
          <h1>版本管理</h1>
          <p>选择游戏版本，安装加载器或管理游戏文件。</p>
        </div>
        <div className="heading-actions">
          <button className="outline-btn" data-action="import-game">
            <Icon name="folder-open" size={16} /> 导入游戏
          </button>
          <button className="outline-btn" data-action="refresh" disabled={loading}>
            <Icon name="refresh-cw" size={16} /> {loading ? '正在获取' : '刷新'}
          </button>
        </div>
      </div>
      <div className="version-toolbar">
        <div>
          <strong>游戏版本</strong>
          <span className="count">{list.length}</span>
        </div>
        <label className="version-search">
          <span className="sr-only">搜索版本</span>
          <input id="version-filter" type="search" placeholder="搜索版本" defaultValue={query} />
        </label>
      </div>
      <div className="versions-groups">
        {list.length ? (
          groupLabels.map((label) => {
            const items = list.filter((version) => groupFor(version) === label);
            return items.length ? (
              <details
                className="version-group"
                data-version-group={label}
                key={label}
                open={!!search || ['自定义实例', '整合包', '正式版'].includes(label)}
              >
                <summary className="version-group-heading">
                  <Icon name="chevron-right" size={14} />
                  <strong>{label}</strong>
                  <span>{items.length}</span>
                </summary>
                <div className="version-list versions-list">
                  {items.map((v) => (
                    <VersionRow
                      key={v.id}
                      version={v}
                      selected={selected}
                      visual={versionVisual(v)}
                    />
                  ))}
                </div>
              </details>
            ) : null;
          })
        ) : (
          <div className="empty-state">
            <Icon name="box" size={27} />
            <strong>
              {loading ? '正在获取版本列表…' : search ? '没有找到匹配的版本' : '还没有可显示的版本'}
            </strong>
            <p>{search ? '试试其他关键词。' : '检查网络连接后刷新列表。'}</p>
          </div>
        )}
      </div>
      {deleteVersion && (
        <div className="confirm-overlay">
          <section
            className="confirm-box"
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-version-title"
          >
            <span className="section-index">REMOVE VERSION</span>
            <h3 id="delete-version-title">删除 {deleteVersion.name}？</h3>
            <p>
              将删除该版本文件。共用资源、Java、存档和模组会保留；被其他版本依赖的游戏本体无法删除。
            </p>
            {deleteVersion.isolated && (
              <>
                <p>
                  保留的实例数据会留在 instances
                  目录；重新安装相同整合包前，需要先备份或移除旧目录。
                </p>
                <label className="archive-check">
                  <input type="checkbox" id="delete-instance-data" />
                  <span>
                    <strong>同时删除此实例的游戏数据</strong>
                    <small>包括该实例的存档、模组和配置，无法恢复。</small>
                  </span>
                </label>
              </>
            )}
            <div>
              <button
                className="row-button"
                data-action="cancel-version-delete"
                disabled={deleting}
              >
                取消
              </button>
              <button
                className="row-button danger-button"
                data-action="confirm-version-delete"
                disabled={deleting}
              >
                {deleting ? '正在删除…' : '删除版本'}
              </button>
            </div>
          </section>
        </div>
      )}
    </>
  );
}
