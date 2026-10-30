import React from 'react';
import { Icon } from './icons';
import type { ContentState } from './content-state';
import { updateReport } from './update-report';

export function LocalPacks({ s }: { s: ContentState }) {
  const label = s.contentKind === 'shader' ? '光影包' : '材质包',
    selected = s.versions.find((v) => v.id === s.contentTarget);
  const matches = s.localPacks
    .map((pack, index) => ({ pack, index }))
    .filter(({ pack }) =>
      pack.name.toLocaleLowerCase().includes(s.packQuery.trim().toLocaleLowerCase()),
    );
  return (
    <>
      <div className="section-title">
        <div>
          <span className="section-index">02 / INSTALLED PACKS</span>
          <h3>
            当前游戏目录的{label}{' '}
            <span className="count" id="local-pack-count">
              {s.localPacks.length}
            </span>
          </h3>
        </div>
        <span className="section-note">
          {selected?.isolated ? '独立游戏目录' : '可能与其他版本共用目录'}
        </span>
      </div>
      <div className="mod-toolbar">
        <input
          id="local-pack-search"
          defaultValue={s.packQuery}
          placeholder={`筛选已安装的${label}`}
          aria-label={`筛选已安装的${label}`}
        />
        <button
          className="outline-btn"
          data-action="refresh-packs"
          disabled={!s.contentTarget || s.packWorking}
        >
          刷新
        </button>
        <button className="outline-btn" data-action="open-pack-folder" disabled={!s.contentTarget}>
          <Icon name="folder-open" size={15} /> 打开文件夹
        </button>
        <button
          className="outline-btn"
          data-action="check-pack-updates"
          disabled={!s.contentTarget || s.packChecking || s.packWorking}
        >
          {s.packChecking ? '检查中…' : '检查更新'}
        </button>
      </div>
      <p className="mod-update-summary" id="pack-update-summary">
        {updateReport(
          s.packUpdates,
          '更新检查仅覆盖由 CCL 安装且可识别的资源包；CurseForge 需要 API Key。',
        )}
      </p>
      <div id="local-pack-list">
        {s.packLoading ? (
          <div className="empty-state">
            <strong>正在读取资源包…</strong>
          </div>
        ) : s.packError ? (
          <div className="empty-state">
            <strong>读取失败</strong>
            <p>{s.packError}</p>
          </div>
        ) : !matches.length ? (
          <div className="empty-state">
            <Icon name="box" size={27} />
            <strong>{s.localPacks.length ? '没有匹配的资源包' : '当前游戏目录没有资源包'}</strong>
            <p>
              {s.localPacks.length ? '试试其他关键词。' : '在上方浏览下载，或打开文件夹手动添加。'}
            </p>
          </div>
        ) : (
          <div className="version-list">
            {matches.map(({ pack: p, index: i }) => {
              const update = s.packUpdates?.updates?.find((u) => u.name === p.name);
              return (
                <div className="version-row" key={p.name}>
                  <div className="row-icon">
                    <Icon name={p.directory ? 'folder-open' : 'box'} size={19} />
                  </div>
                  <div className="row-name">
                    <strong className="java-path" title={p.name}>
                      {p.name}
                    </strong>
                    <span>
                      {p.directory ? '文件夹' : 'ZIP 文件'} ·{' '}
                      {p.source
                        ? p.source === 'modrinth'
                          ? 'Modrinth'
                          : 'CurseForge'
                        : '手动添加或来源未知'}
                      {update ? ` · 可更新至 ${update.latest}` : ''}
                    </span>
                  </div>
                  {update?.projectUrl && (
                    <button className="row-button" data-open-project={update.projectUrl}>
                      查看更新
                    </button>
                  )}
                  {p.source && p.projectId && (
                    <button className="row-button" data-local-pack-details={i}>
                      详情
                    </button>
                  )}
                  <button
                    className="row-button danger-button"
                    data-pack-remove={i}
                    disabled={s.packWorking}
                  >
                    删除
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>
      {s.packDelete && (
        <div className="confirm-overlay">
          <div className="confirm-box" role="dialog" aria-modal="true">
            <span className="section-index">REMOVE PACK</span>
            <h3>删除{label}？</h3>
            <p>
              {s.packDelete.name}{' '}
              将从游戏目录删除。若多个版本共用此目录，也会影响其他版本；游戏中的启用状态需自行调整。
            </p>
            <div>
              <button className="row-button" data-action="cancel-pack-remove">
                取消
              </button>
              <button className="row-button danger-button" data-action="confirm-pack-remove">
                确认删除
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
