import React from 'react';

export interface PublicServer {
  name?: string;
  address: string;
  version?: string;
  description?: string;
  status?: string;
  playersOnline?: number | null;
  playersMax?: number | null;
  tags?: string[];
  requiresMods?: boolean | null;
  sourceIds?: string[];
}
export interface ServerSource {
  id: string;
  name: string;
  url: string;
  status: string;
}
export interface ServerCatalog {
  servers: PublicServer[];
  sources?: ServerSource[];
  updatedAt?: string;
  truncated?: boolean;
}
export interface PublicServersPageProps {
  catalog: ServerCatalog | null;
  filtered: PublicServer[];
  query: string;
  status: string;
  page: number;
  loading: boolean;
  error: string;
}

// These icons are React-owned, so updating results cannot leave React tracking
// elements replaced by the legacy icon hydration routine.
function ServerIcon({ name, size }: { name: 'globe' | 'refresh'; size: number }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`lucide lucide-${name === 'globe' ? 'globe-2' : 'refresh-cw'}`}
      aria-hidden="true"
    >
      {name === 'globe' ? (
        <>
          <path d="M21.54 15H17a2 2 0 0 0-2 2v4.54" />
          <path d="M7 3.34V5a3 3 0 0 0 3 3 2 2 0 0 1 2 2c0 1.1.9 2 2 2a2 2 0 0 0 2-2c0-1.1.9-2 2-2h3.17" />
          <path d="M11 21.95V18a2 2 0 0 0-2-2 2 2 0 0 1-2-2v-1a2 2 0 0 0-2-2H2.05" />
          <circle cx="12" cy="12" r="10" />
        </>
      ) : (
        <>
          <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />
          <path d="M21 3v5h-5" />
          <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" />
          <path d="M8 16H3v5" />
        </>
      )}
    </svg>
  );
}
function ServerThumbnail({ address }: { address: string }) {
  return (
    <div className="server-symbol thumbnail">
      <span className="thumbnail-fallback">
        <ServerIcon name="globe" size={19} />
      </span>
      <img
        className="thumbnail-image"
        alt=""
        hidden
        data-thumbnail-kind="server"
        data-thumbnail-value={address}
      />
    </div>
  );
}

export function PublicServersPage({
  catalog,
  filtered,
  query,
  status,
  page: requestedPage,
  loading,
  error,
}: PublicServersPageProps) {
  const size = 40,
    sources = Array.isArray(catalog?.sources) ? catalog.sources : [],
    all = Array.isArray(catalog?.servers) ? catalog.servers : [];
  const maxPage = Math.max(0, Math.ceil(filtered.length / size) - 1),
    page = Math.min(requestedPage, maxPage);
  const date =
    catalog?.updatedAt && !Number.isNaN(Date.parse(catalog.updatedAt))
      ? new Date(catalog.updatedAt).toLocaleString()
      : '尚未获取';
  const rows = filtered.slice(page * size, (page + 1) * size);
  return (
    <>
      <div className="server-tabs" role="tablist" aria-label="联机功能">
        <button type="button" data-lan-view="room" role="tab" aria-selected="false">
          IPv6 房间
        </button>
        <button type="button" data-lan-view="servers" role="tab" aria-selected="true">
          公开服务器
        </button>
      </div>
      <div className="page-heading inner-heading">
        <div>
          <h1>公开服务器</h1>
          <p>浏览 Minecraft Java 版社区服务器，复制地址后在游戏中加入。</p>
        </div>
        <button className="outline-btn" data-action="refresh-public-servers" disabled={loading}>
          <ServerIcon name="refresh" size={16} /> {loading ? '获取中' : '刷新目录'}
        </button>
      </div>
      <div className="server-summary">
        <div>
          <span className="section-index">PUBLIC SERVERS / DAILY SNAPSHOT</span>
          <strong>{catalog ? `${filtered.length} / ${all.length} 个服务器` : '服务器目录'}</strong>
          <p>
            目录更新：{date}
            {catalog?.truncated ? ' · 部分来源已截取' : ''}
          </p>
        </div>
        <span>状态与人数为每日快照，可能已经变化</span>
      </div>
      <div className="server-sources">
        <strong>数据来源</strong>
        {sources.length ? (
          sources.map((source, i) => (
            <button
              key={`${source.id}:${i}`}
              className="text-link"
              data-open-project={source.url}
              title={
                source.status === 'ok'
                  ? '本次已更新'
                  : source.status === 'stale'
                    ? '使用上次快照'
                    : '暂不可用'
              }
            >
              {source.name}
              {source.status === 'stale'
                ? ' · 旧快照'
                : source.status === 'unavailable'
                  ? ' · 不可用'
                  : ''}
            </button>
          ))
        ) : (
          <span>Minecraft Java Servers</span>
        )}
      </div>
      <div className="server-toolbar">
        <label className="server-search">
          <span className="sr-only">搜索服务器</span>
          <input
            id="server-search"
            type="search"
            placeholder="搜索名称、地址、版本或玩法"
            defaultValue={query}
          />
        </label>
        <label>
          <span className="sr-only">筛选状态</span>
          <select id="server-status" defaultValue={status}>
            <option value="all">全部状态</option>
            <option value="online">快照在线</option>
            <option value="offline">快照离线</option>
          </select>
        </label>
      </div>
      {error && (
        <div className="server-warning">
          目录加载失败：{error}
          {catalog ? '；当前显示的是上次获取的目录。' : ''}
        </div>
      )}
      <div className="server-list">
        {rows.length ? (
          rows.map((s, i) => (
            <article className="server-row" key={`${s.address}:${page * size + i}`}>
              <ServerThumbnail address={s.address} />
              <div className="server-details">
                <div className="server-name">
                  <strong>{s.name || s.address}</strong>
                  <span className={`server-state ${s.status === 'online' ? 'online' : ''}`}>
                    {s.status === 'online'
                      ? '快照在线'
                      : s.status === 'offline'
                        ? '快照离线'
                        : '状态未知'}
                  </span>
                </div>
                <p>{s.description || '暂无简介'}</p>
                <div className="server-meta">
                  <code>{s.address}</code>
                  <span>{s.version || '版本未知'}</span>
                  {Array.isArray(s.tags) &&
                    s.tags.slice(0, 3).map((tag, n) => <span key={`${tag}:${n}`}>{tag}</span>)}
                  {s.requiresMods === true && <span>需要模组</span>}
                  {Array.isArray(s.sourceIds) && s.sourceIds.length > 0 && (
                    <span>
                      来源：
                      {s.sourceIds
                        .map((id) => sources.find((source) => source.id === id)?.name || '')
                        .filter(Boolean)
                        .join('、')}
                    </span>
                  )}
                </div>
              </div>
              <div className="server-players">
                {Number.isInteger(s.playersOnline) ? s.playersOnline : '—'}
                <small> / {Number.isInteger(s.playersMax) ? s.playersMax : '—'}</small>
                <span>快照人数</span>
              </div>
              <button className="row-button" data-server-copy={page * size + i}>
                复制地址
              </button>
            </article>
          ))
        ) : (
          <div className="empty-state">
            <ServerIcon name="globe" size={27} />
            <strong>
              {loading
                ? '正在获取服务器目录…'
                : catalog
                  ? '没有匹配的服务器'
                  : '暂未获取服务器目录'}
            </strong>
            <p>{catalog ? '试试其他关键词或状态。' : '可点击刷新重试。'}</p>
          </div>
        )}
      </div>
      <div className="server-pagination-slot">
        {maxPage > 0 && (
          <div className="server-pagination">
            <span>
              第 {page + 1} / {maxPage + 1} 页{' '}
              <label className="server-page-jump">
                前往{' '}
                <input
                  key={page}
                  id="server-page-jump"
                  type="number"
                  min="1"
                  max={maxPage + 1}
                  defaultValue={page + 1}
                  aria-label="跳转到服务器列表页"
                />{' '}
                页
              </label>
            </span>
            <div>
              <button className="outline-btn" data-server-page={page - 1} disabled={page === 0}>
                上一页
              </button>
              <button
                className="outline-btn"
                data-server-page={page + 1}
                disabled={page === maxPage}
              >
                下一页
              </button>
            </div>
          </div>
        )}
      </div>
      <p className="lan-network-note">
        服务器由第三方运营，CCL
        不保证其安全性或可用性。加入前请核对版本、模组及服务器规则；正版服务器需要正版账户。
      </p>
    </>
  );
}
