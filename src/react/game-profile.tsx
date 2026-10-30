import React from 'react';
import { Icon } from './icons';
import type { ProfileView } from '../lib/game-profile';
function playTime(seconds?: number | null) {
  const minutes = Math.floor(Math.max(0, Number(seconds) || 0) / 60),
    hours = Math.floor(minutes / 60);
  return hours ? `${hours} 小时 ${minutes % 60} 分钟` : `${minutes} 分钟`;
}
function date(value?: number) {
  const n = Number(value);
  return value && Number.isFinite(n) ? new Date(n * 1000).toLocaleString() : '暂无记录';
}
export function GameProfileDialog({ view: d }: { view: ProfileView }) {
  const stats = d.stats || {};
  return (
    <div className="install-overlay">
      <section
        className="install-dialog profile-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="profile-title"
      >
        <div className="install-dialog-head">
          <div>
            <span className="section-index">INSTANCE / JOURNAL</span>
            <h2 id="profile-title">游戏档案</h2>
            <p>{d.name} · 游戏进程结束后更新游玩时长。</p>
          </div>
          <button className="icon-button" data-action="close-game-profile" aria-label="关闭">
            <Icon name="x" size={19} />
          </button>
        </div>
        <div className="profile-stats">
          <div>
            <small>累计游玩</small>
            <strong>{playTime(stats.seconds)}</strong>
          </div>
          <div>
            <small>启动次数</small>
            <strong>{stats.launches || 0}</strong>
          </div>
          <div>
            <small>最近启动</small>
            <strong>{date(stats.lastStarted)}</strong>
          </div>
          <div>
            <small>上次运行</small>
            <strong>
              {stats.lastDuration != null ? playTime(stats.lastDuration) : '暂无记录'}
            </strong>
          </div>
        </div>
        {d.statsError && <p className="manage-error">游戏记录读取失败：{d.statsError}</p>}
        <div className="profile-gallery-heading">
          <div>
            <strong>游戏截图</strong>
            <small>
              {d.isolated ? '此实例的截图目录' : '共用游戏目录中的截图，可能来自其他版本'}
            </small>
          </div>
          <div className="profile-gallery-actions">
            <button className="outline-btn" data-action="refresh-game-profile" disabled={d.loading}>
              刷新
            </button>
            <button className="outline-btn" data-action="open-screenshot-folder">
              打开截图文件夹
            </button>
          </div>
        </div>
        {d.error && <p className="manage-error">{d.error}</p>}
        <div className="profile-gallery">
          {d.loading ? (
            <div className="empty-state">正在读取截图…</div>
          ) : d.shots.length ? (
            d.shots.map((shot, i) => (
              <button
                className="profile-shot"
                data-profile-shot={i}
                aria-label={`查看 ${shot.name}`}
                key={`${i}:${shot.name}`}
              >
                <span hidden={!!d.images[i]}>{d.imageErrors[i] ? '无法预览' : '加载中…'}</span>
                <img
                  data-profile-image={i}
                  src={d.images[i] || undefined}
                  alt=""
                  hidden={!d.images[i]}
                />
                <small>{shot.name}</small>
              </button>
            ))
          ) : (
            <div className="empty-state">
              <strong>还没有截图</strong>
              <p>在游戏中按 F2 截图后，可在这里查看。</p>
            </div>
          )}
        </div>
        <div className="content-pagination">
          <span>第 {d.page + 1} 页</span>
          <div>
            <button
              className="outline-btn"
              data-profile-page={d.page - 1}
              disabled={d.loading || d.page === 0}
            >
              上一页
            </button>
            <button
              className="outline-btn"
              data-profile-page={d.page + 1}
              disabled={d.loading || !d.hasMore}
            >
              下一页
            </button>
          </div>
        </div>
        {d.preview && (
          <div className="profile-lightbox" role="dialog" aria-label="截图预览">
            <button
              className="icon-button"
              data-action="close-profile-preview"
              aria-label="关闭预览"
            >
              <Icon name="x" size={19} />
            </button>
            <img src={d.preview.data} alt={d.preview.name} />
            <span>{d.preview.name}</span>
          </div>
        )}
        <div className="install-actions">
          <button className="outline-btn" data-action="close-game-profile">
            关闭
          </button>
        </div>
      </section>
    </div>
  );
}
