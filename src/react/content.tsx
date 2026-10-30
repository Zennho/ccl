import React from 'react';
import { Icon } from './icons';
import type { ContentState } from './content-state';
import { ShaderStatus } from './shader-status';
import { LocalMods } from './local-mods';
import { LocalPacks } from './local-packs';

const count = (n: number) =>
  n >= 1000000 ? (n / 1000000).toFixed(1) + 'm' : n >= 1000 ? (n / 1000).toFixed(1) + 'k' : n;
export function ContentPage({ state: s }: { state: ContentState }) {
  return (
    <>
      <div className="page-heading inner-heading">
        <div>
          <h1>模组与资源</h1>
          <p>浏览并安装与目标版本兼容的内容。</p>
        </div>
      </div>
      <section className="content-search">
        {s.contentKind !== 'modpack' && (
          <label className="target-select">
            安装到已安装的游戏版本
            <select
              id="contentTarget"
              defaultValue={s.contentTarget}
              disabled={s.contentBusy || s.modWorking}
            >
              <option value="">选择目标版本</option>
              {s.versions
                .filter((v) => v.installed)
                .map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name || v.id}
                  </option>
                ))}
            </select>
          </label>
        )}
        <form id="content-form">
          <div className="content-selects">
            <label>
              内容来源
              <select name="source" defaultValue={s.contentSource} disabled={s.contentBusy}>
                <option value="modrinth">Modrinth</option>
                <option value="curseforge">CurseForge</option>
              </select>
            </label>
            <label>
              内容类型
              <select name="kind" defaultValue={s.contentKind} disabled={s.contentBusy}>
                <option value="mod">模组</option>
                <option value="modpack">整合包</option>
                <option value="resourcepack">材质包</option>
                <option value="shader">光影包</option>
              </select>
            </label>
            <label className="content-sort">
              排序方式
              <select name="sort" defaultValue={s.contentSort} disabled={s.contentBusy}>
                <option value="downloads">下载最多</option>
                <option value="updated">最近更新</option>
                <option value="newest">最新发布</option>
                <option value="recommended">推荐 / 相关度</option>
              </select>
            </label>
          </div>
          <div className="content-filters">
            <label>
              分类
              <select
                key={`${s.contentSource}:${s.contentKind}`}
                id="content-category"
                name="category"
                defaultValue={s.contentCategory}
                disabled={s.contentCategoriesLoading || !s.contentCategories.length}
                title={
                  s.contentCategoryError ||
                  (s.contentCategoriesLoading ? '正在加载分类' : '按来源分类筛选')
                }
              >
                <option value="">全部分类</option>
                {s.contentCategories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
            {s.contentKind === 'modpack' && (
              <>
                <label>
                  游戏版本
                  <input
                    name="gameFilter"
                    defaultValue={s.contentGameFilter}
                    placeholder="例如 1.20.1"
                    maxLength={40}
                    pattern="[A-Za-z0-9._-]*"
                  />
                </label>
                <label>
                  加载器
                  <select name="loaderFilter" defaultValue={s.contentLoaderFilter}>
                    <option value="">全部加载器</option>
                    {['fabric', 'quilt', 'forge', 'neoforge'].map((v) => (
                      <option value={v} key={v}>
                        {v}
                      </option>
                    ))}
                  </select>
                </label>
              </>
            )}
            {s.contentSource === 'modrinth' && (
              <label>
                运行环境
                <select name="environment" defaultValue={s.contentEnvironment}>
                  <option value="">全部环境</option>
                  <option value="client_only">仅客户端</option>
                  <option value="client_and_server">客户端和服务端</option>
                </select>
              </label>
            )}
          </div>
          {s.contentSource === 'curseforge' && (
            <label className="content-key">
              CurseForge API Key
              <input
                type="password"
                name="apiKey"
                disabled={s.contentBusy}
                defaultValue={s.contentKey}
                placeholder="输入 API Key（仅当前会话保存）"
                autoComplete="off"
              />
            </label>
          )}
          <div className="content-search-row">
            <input
              name="query"
              defaultValue={s.contentQuery}
              placeholder="搜索模组、整合包、材质包或光影包"
            />
            <button className="save-button" type="submit" disabled={s.contentBusy}>
              搜索 <Icon name="chevron-right" size={16} />
            </button>
          </div>
        </form>
        <p>
          {s.contentKind === 'mod'
            ? '只显示与目标版本和加载器兼容的模组。'
            : s.contentKind === 'modpack'
              ? '整合包将创建独立游戏目录。'
              : s.contentKind === 'shader'
                ? '按游戏版本筛选；使用光影还需在游戏中安装并启用 Iris、OptiFine 等光影支持。'
                : '按游戏版本筛选；下载后在游戏资源包设置中启用。'}
        </p>
        <div id="shader-status">
          <ShaderStatus s={s} />
        </div>
      </section>
      <div className="section-title">
        <div>
          <span className="section-index">01 / DISCOVER</span>
          <h3>
            浏览内容 <span className="count">{s.contentResults.length}</span>
          </h3>
        </div>
        <span className="section-note">
          {s.contentSource === 'modrinth' ? 'Modrinth' : 'CurseForge'}
        </span>
      </div>
      <div className="version-list">
        {s.contentResults.length ? (
          s.contentResults.map((hit, i) => (
            <div className="version-row content-row" key={hit.id}>
              <div className="row-icon thumbnail">
                <span className="thumbnail-fallback">
                  <Icon name={s.contentKind === 'mod' ? 'blocks' : 'box'} size={19} />
                </span>
                {hit.iconUrl && (
                  <img
                    key={hit.iconUrl}
                    className="thumbnail-image"
                    alt=""
                    hidden
                    data-thumbnail-kind="content"
                    data-thumbnail-value={hit.iconUrl}
                  />
                )}
              </div>
              <div className="row-name">
                <strong>{hit.title}</strong>
                <span data-content-summary={i}>{hit.localizedDescription || hit.description}</span>
                <span>
                  {hit.author} · {count(hit.downloads)} 次下载
                </span>
              </div>
              <button className="row-button content-details" data-content-details={i}>
                详情
              </button>
              <button
                className={`row-button ${hit.installed ? 'selected' : ''}`}
                data-content-install={i}
                disabled={s.contentBusy || (s.contentKind !== 'modpack' && hit.installed)}
              >
                {hit.installed && s.contentKind !== 'modpack' ? (
                  '已安装'
                ) : (
                  <>
                    <Icon name="download" size={14} />{' '}
                    {s.contentKind !== 'modpack' ? '选择版本' : '安装'}
                  </>
                )}
              </button>
            </div>
          ))
        ) : (
          <div className="empty-state">
            <Icon name="compass" size={27} />
            <strong>
              {s.contentBusy
                ? '正在加载…'
                : s.contentError
                  ? '加载失败'
                  : s.contentLoaded
                    ? '此页没有兼容项目'
                    : '选择游戏版本后浏览内容'}
            </strong>
            <p>
              {s.contentError ||
                (s.contentLoaded && s.contentHasMore
                  ? '可继续浏览下一页。'
                  : s.contentSource === 'curseforge' && !s.contentKey
                    ? '输入 CurseForge API Key 后即可浏览。'
                    : '选择已安装的游戏版本，或切换到整合包浏览。')}
            </p>
          </div>
        )}
      </div>
      <div className="content-pagination">
        <span>{s.contentLoaded ? `第 ${s.contentPage + 1} 页` : ''}</span>
        <div>
          <button
            className="outline-btn"
            data-content-page={s.contentPage - 1}
            disabled={s.contentBusy || s.contentPage === 0}
          >
            上一页
          </button>
          <button
            className="outline-btn"
            data-content-page={s.contentPage + 1}
            disabled={s.contentBusy || !s.contentHasMore}
          >
            下一页
          </button>
        </div>
      </div>
      {s.contentKind === 'mod' && <LocalMods s={s} />}
      {['resourcepack', 'shader'].includes(s.contentKind) && <LocalPacks s={s} />}
    </>
  );
}
