import React from 'react';
import { Icon } from './icons';
import type { ManageView } from '../lib/instance-manage';
export function ManageDialog({ view: d }: { view: ManageView }) {
  const backups = d.kind === 'backups',
    label = backups ? '备份与恢复' : '存档管理';
  const date = (value?: number) => {
    if (!value) return '时间未知';
    const n = Number(value);
    return Number.isFinite(n) ? new Date(backups ? n * 1000 : n).toLocaleString() : '时间未知';
  };
  const size = (value?: number) =>
    Number(value) >= 1073741824
      ? `${(Number(value) / 1073741824).toFixed(2)} GB`
      : `${(Number(value || 0) / 1048576).toFixed(1)} MB`;
  return (
    <div className="install-overlay">
      <section
        className="install-dialog manage-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="manage-title"
      >
        <div className="install-dialog-head">
          <div>
            <span className="section-index">
              {backups ? 'INSTANCE / BACKUPS' : 'INSTANCE / WORLDS'}
            </span>
            <h2 id="manage-title">{label}</h2>
            <p>
              {d.name} · {d.isolated ? '独立游戏目录' : '共用游戏目录'}
            </p>
          </div>
          <button
            className="icon-button"
            data-action="close-manage"
            aria-label="关闭"
            disabled={d.busy}
          >
            <Icon name="x" size={19} />
          </button>
        </div>
        <div className="manage-toolbar">
          {backups ? (
            <>
              <button
                className="save-button"
                data-action="create-instance-backup"
                disabled={d.busy}
              >
                创建实例备份
              </button>
              <button className="outline-btn" data-action="switch-worlds" disabled={d.busy}>
                存档管理
              </button>
            </>
          ) : (
            <>
              <button className="outline-btn" data-action="open-saves-folder" disabled={d.busy}>
                打开存档目录
              </button>
              <button className="outline-btn" data-action="switch-backups" disabled={d.busy}>
                查看备份
              </button>
            </>
          )}
          <button className="outline-btn" data-action="refresh-manage" disabled={d.busy}>
            刷新
          </button>
        </div>
        <p className="manage-note">
          {backups
            ? '备份包含模组、配置、资源包和存档。操作时请先退出游戏，恢复前会自动保存当前实例。'
            : '显示当前游戏目录中的世界；单独备份后可在“查看备份”中恢复。'}
        </p>
        {d.confirm && (
          <div className="manage-confirm" role="alert">
            <strong>
              {d.confirm.action === 'restore'
                ? '恢复所选备份？'
                : backups
                  ? '删除所选备份？'
                  : '删除所选存档？'}
            </strong>
            <p>
              {d.confirm.action === 'restore'
                ? '将替换备份覆盖范围内的当前数据，恢复前会自动备份整个实例；共用游戏目录可能影响其他版本。'
                : backups
                  ? '删除后无法从此备份恢复。'
                  : '删除前会自动备份此存档；共用游戏目录可能影响其他版本。'}
            </p>
            <div>
              <button className="outline-btn" data-action="manage-cancel" disabled={d.busy}>
                取消
              </button>
              <button
                className="row-button danger-button"
                data-action="manage-confirm"
                disabled={d.busy}
              >
                确认{d.confirm.action === 'restore' ? '恢复' : '删除'}
              </button>
            </div>
          </div>
        )}
        {d.busy && (
          <p className="manage-busy" role="status">
            正在处理，请稍候…
          </p>
        )}
        {d.error && <p className="manage-error">{d.error}</p>}
        <div className="manage-list">
          {d.loading ? (
            <div className="empty-state">正在读取…</div>
          ) : d.items.length ? (
            d.items.map((item, i) => (
              <div className="version-row manage-row" key={i}>
                <div className="row-icon">
                  <Icon name={backups ? 'hard-drive' : 'box'} size={18} />
                </div>
                <div className="row-name">
                  <strong>
                    {backups
                      ? item.scope === 'world'
                        ? `存档备份 · ${item.world}`
                        : '实例备份'
                      : item.name}
                  </strong>
                  <span>
                    {backups ? (
                      `${date(item.created)} · ${size(item.size)}`
                    ) : (
                      <>
                        {item.folder} · {item.gameVersion ? `Minecraft ${item.gameVersion} · ` : ''}
                        {date(item.lastPlayed)}
                        {item.metadataError ? ' · 存档信息暂不可读' : ''}
                      </>
                    )}
                  </span>
                </div>
                {backups ? (
                  <button className="row-button" data-manage-restore={i} disabled={d.busy}>
                    恢复
                  </button>
                ) : (
                  <>
                    <button className="row-button" data-world-open={i} disabled={d.busy}>
                      文件夹
                    </button>
                    <button className="row-button" data-world-backup={i} disabled={d.busy}>
                      备份
                    </button>
                  </>
                )}
                <button
                  className="row-button danger-button"
                  data-manage-delete={i}
                  disabled={d.busy}
                >
                  删除
                </button>
              </div>
            ))
          ) : (
            <div className="empty-state">
              <strong>{backups ? '尚无备份' : '没有找到存档'}</strong>
            </div>
          )}
        </div>
        <div className="install-actions">
          <button className="outline-btn" data-action="close-manage" disabled={d.busy}>
            关闭
          </button>
        </div>
      </section>
    </div>
  );
}
