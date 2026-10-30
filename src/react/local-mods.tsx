import React from 'react';
import { Icon } from './icons';
import type { ContentState } from './content-state';
import { updateReport } from './update-report';

export function LocalMods({ s }: { s: ContentState }) {
  const matches = s.localMods
    .map((mod, index) => ({ mod, index }))
    .filter(
      ({ mod }) =>
        `${mod.name} ${mod.displayName || ''} ${mod.modId || ''}`
          .toLocaleLowerCase()
          .includes(s.modQuery.trim().toLocaleLowerCase()) &&
        (s.modFilter === 'all' || mod.enabled === (s.modFilter === 'enabled')),
    );
  const selected = s.selectedMods.size,
    busy = s.modWorking || s.contentBusy,
    issues = s.modConflicts?.issues || [];
  return (
    <>
      <div className="section-title">
        <div>
          <span className="section-index">02 / INSTALLED MODS</span>
          <h3>
            当前实例模组{' '}
            <span className="count" id="local-mod-count">
              {s.localMods.length}
            </span>
          </h3>
        </div>
        <span className="section-note" id="local-mod-target">
          {s.contentTarget || '未选择游戏版本'}
        </span>
      </div>
      <div className="mod-toolbar">
        <input
          id="local-mod-search"
          defaultValue={s.modQuery}
          placeholder="筛选已安装的模组"
          aria-label="筛选已安装的模组"
        />
        <select id="local-mod-filter" aria-label="模组状态" defaultValue={s.modFilter}>
          <option value="all">全部状态</option>
          <option value="enabled">已启用</option>
          <option value="disabled">已停用</option>
        </select>
        <button
          className="outline-btn"
          data-action="check-mod-conflicts"
          disabled={s.modConflictsLoading || !s.contentTarget || s.modWorking}
        >
          {s.modConflictsLoading ? '排查中…' : '排查冲突'}
        </button>
        <button
          className="outline-btn"
          data-action="check-mod-updates"
          disabled={s.modChecking || !s.contentTarget || s.modWorking}
        >
          {s.modChecking ? '检查中…' : '检查更新'}
        </button>
      </div>
      <div id="local-mod-update-summary">
        <p className="mod-update-summary">
          {updateReport(
            s.modUpdates,
            '更新检查仅覆盖可识别的 Modrinth 模组，并按当前游戏版本和加载器筛选。',
          )}
        </p>
      </div>
      <div id="mod-conflict-report">
        {s.modConflicts && (
          <div className="conflict-report">
            <strong>
              {issues.length ? `发现 ${issues.length} 个可能问题` : '未发现可识别的冲突'}
            </strong>
            <span>
              已检查 {s.modConflicts.checked} 个；{s.modConflicts.unknown}{' '}
              个文件无法识别。未识别的版本规则不会被视为冲突。
            </span>
            {!!issues.length && (
              <ul>
                {issues.map((issue, i) => (
                  <li key={i}>
                    {issue.message}
                    {!!issue.files?.length && (
                      <>
                        {' '}
                        <small>{issue.files.join('、')}</small>
                      </>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
      <div id="local-mod-list">
        <div className="mod-bulk">
          <label>
            <input
              type="checkbox"
              id="mod-select-visible"
              key={String(
                !!matches.length && matches.every(({ mod }) => s.selectedMods.has(mod.name)),
              )}
              defaultChecked={
                !!matches.length && matches.every(({ mod }) => s.selectedMods.has(mod.name))
              }
              disabled={!matches.length || busy}
            />{' '}
            选择筛选结果
          </label>
          <span>已选择 {selected} 个</span>
          <div>
            <button
              className="row-button"
              data-action="bulk-mod-enable"
              disabled={!selected || busy}
            >
              启用
            </button>
            <button
              className="row-button"
              data-action="bulk-mod-disable"
              disabled={!selected || busy}
            >
              停用
            </button>
            <button
              className="row-button danger-button"
              data-action="bulk-mod-delete"
              disabled={!selected || busy}
            >
              删除
            </button>
          </div>
        </div>
        <div className="version-list">
          {matches.length ? (
            matches.map(({ mod: m, index: i }) => {
              const update = s.modUpdates?.updates.find((u) => u.name === m.name);
              return (
                <div className="version-row" key={m.name}>
                  <input
                    className="mod-check"
                    type="checkbox"
                    data-mod-select={i}
                    aria-label={`选择 ${m.name}`}
                    key={String(s.selectedMods.has(m.name))}
                    defaultChecked={s.selectedMods.has(m.name)}
                    disabled={busy}
                  />
                  <div
                    className={`row-icon thumbnail local-mod-icon${m.icon ? ' has-thumbnail' : ''}`}
                  >
                    <span className="thumbnail-fallback">
                      <Icon name="blocks" size={19} />
                    </span>
                    {m.icon && (
                      <img
                        className="thumbnail-image"
                        src={m.icon}
                        alt=""
                        onError={(e) => {
                          e.currentTarget.hidden = true;
                          e.currentTarget.parentElement?.classList.remove('has-thumbnail');
                        }}
                      />
                    )}
                  </div>
                  <div className="row-name">
                    <strong className="java-path">{m.displayName || m.name}</strong>
                    {m.description && <span className="local-mod-summary">{m.description}</span>}
                    <span>
                      {m.enabled ? '已启用' : '已停用'}
                      {update ? ` · 可更新至 ${update.latest}` : ''}
                    </span>
                  </div>
                  <button className="row-button" data-local-mod-details={i}>
                    详情
                  </button>
                  {update && (
                    <button
                      className="row-button"
                      data-open-project={`https://modrinth.com/mod/${update.projectId}`}
                    >
                      查看更新
                    </button>
                  )}
                  <button className="row-button" data-mod-toggle={i} disabled={busy}>
                    {m.enabled ? '停用' : '启用'}
                  </button>
                  <button className="row-button danger-button" data-mod-remove={i} disabled={busy}>
                    删除
                  </button>
                </div>
              );
            })
          ) : (
            <div className="empty-state">
              <Icon name="box" size={27} />
              <strong>{s.localMods.length ? '没有匹配的模组' : '当前实例没有模组'}</strong>
              <p>{s.localMods.length ? '试试其他筛选条件。' : '在上方搜索并安装兼容的模组。'}</p>
            </div>
          )}
        </div>
      </div>
      {!!s.modDelete?.length && (
        <div className="confirm-overlay">
          <div className="confirm-box">
            <span className="section-index">REMOVE MOD</span>
            <h3>删除 {s.modDelete.length} 个模组？</h3>
            <p>
              {s.modDelete.join('、')}{' '}
              将从当前实例删除。其他模组可能依赖这些文件；模组配置和存档会保留。
            </p>
            <div>
              <button className="row-button" data-action="cancel-mod-remove">
                取消
              </button>
              <button className="row-button danger-button" data-action="confirm-mod-remove">
                确认删除
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
