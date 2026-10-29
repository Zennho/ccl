import React from 'react';
import parse from 'html-react-parser';
import type { GameVersion, JavaRuntime } from './types';

export function Icon({ name, size = 18 }: { name: string; size?: number }) {
  return <i data-lucide={name} {...{ width: size, height: size }} />;
}

type HomePageProps = { version: GameVersion | undefined; versionIcon: string; description: string };
export function HomePage({ version: v, versionIcon, description }: HomePageProps) {
  return <>
    <section className="hero home-hero">
      <div className="hero-art">
        {['sun', 'cloud cloud-a', 'cloud cloud-b', 'mountain mountain-back', 'mountain mountain-mid', 'mountain mountain-front', 'ground'].map(className => <div className={className} key={className} />)}
        {['tree tree-a', 'tree tree-b', 'tree tree-c'].map(className => <div className={className} key={className}><i /></div>)}
        <div className="art-grid" /><div className="hero-custom" />
      </div>
      <div className="hero-shade" /><div className="hero-content"><div className="hero-kicker">MINECRAFT · JAVA 版</div><h1>准备好，<em>出发。</em></h1><p>你的世界，在这里继续。</p></div>
    </section>
    <div className="section-title home-title"><h3>开始游戏</h3><button className="row-button log-link" data-action="open-log" disabled={!v?.installed}>启动日志</button></div>
    <section className="launch-panel"><div className="launch-version">{parse(versionIcon)}<div><small>当前版本</small><strong>{v ? v.name || v.id : '选择一个版本'}</strong><span>{v?.installed ? `${v.kind} · 已安装` : '先在版本管理中安装游戏'}</span>{v?.installed && description && <span className="instance-description-home">{description}</span>}</div></div>
      <button className="change-version" data-page="versions">切换版本 <Icon name="chevron-down" size={15} /></button>
      <button className="play-button" data-action="launch" disabled={!v?.installed}><Icon name="play" /> 启动游戏</button>
    </section>
  </>;
}

const actions = [
  ['instance-settings', 'settings-2', '实例设置'], ['instance-theme', 'layout-grid', '实例主题'],
  ['game-profile', 'gamepad-2', '游戏档案'], ['manage-backups', 'hard-drive', '备份与恢复'],
  ['manage-worlds', 'folder-open', '存档管理'], ['instance-overview', 'hard-drive', '实例概览'],
  ['open-version-folder', 'folder-open', '游戏目录'], ['export-game', 'download', '导出游戏'], ['delete-version', 'x', '删除版本'],
] as const;
type VersionRowProps = { version: GameVersion; selected: string; versionIcon: string };
function VersionRow({ version: v, selected, versionIcon }: VersionRowProps) {
  return <div className="version-row">{parse(versionIcon)}<div className="row-name"><strong>{v.name || v.id}</strong><span>{v.kind}{v.released ? ` · ${v.released}` : ''}</span></div>
    <div className={`row-state ${v.installed ? 'installed' : ''}`}><span />{v.installed ? '已安装' : '可安装'}</div>
    {v.installed ? <><button className={`row-button ${selected === v.id ? 'selected' : ''}`} data-select={v.id}>{selected === v.id ? '当前版本' : '选择版本'}</button>
      <details className="version-menu"><summary aria-label={`${v.name || v.id} 的更多操作`} title="更多操作"><Icon name="more-horizontal" /></summary><div className="version-menu-items">
        {actions.map(([key, icon, title]) => <button key={key} {...{ [`data-${key}`]: v.id }}><Icon name={icon} size={15} /> {title}</button>)}
        {v.kind === '正式版' && <button data-install={v.id}><Icon name="layers-3" size={15} /> 配置安装</button>}
      </div></details></> : v.kind === '正式版' ? <button className="row-button install-choice" data-install={v.id}><Icon name="download" size={14} /> 安装</button> : null}
  </div>;
}

type VersionsPageProps = { versions: GameVersion[]; query: string; selected: string; loading: boolean; versionIcon: (version: GameVersion) => string };
export function VersionsPage({ versions, query, selected, loading, versionIcon }: VersionsPageProps) {
  const search = query.trim().toLowerCase();
  const list = versions.filter(v => !search || `${v.name || ''} ${v.id} ${v.kind}`.toLowerCase().includes(search));
  return <>
    <div className="page-heading inner-heading"><div><h1>版本管理</h1><p>选择游戏版本，安装加载器或管理游戏文件。</p></div><div className="heading-actions"><button className="outline-btn" data-action="import-game"><Icon name="folder-open" size={16} /> 导入游戏</button><button className="outline-btn" data-action="refresh" disabled={loading}><Icon name="refresh-cw" size={16} /> {loading ? '正在获取' : '刷新'}</button></div></div>
    <div className="version-toolbar"><div><strong>游戏版本</strong><span className="count">{list.length}</span></div><label className="version-search"><span className="sr-only">搜索版本</span><input id="version-filter" type="search" placeholder="搜索版本" defaultValue={query} /></label></div>
    <div className="version-list versions-list">{list.length ? list.map(v => <VersionRow key={v.id} version={v} selected={selected} versionIcon={versionIcon(v)} />) : <div className="empty-state"><Icon name="box" size={27} /><strong>{loading ? '正在获取版本列表…' : search ? '没有找到匹配的版本' : '还没有可显示的版本'}</strong><p>{search ? '试试其他关键词。' : '检查网络连接后刷新列表。'}</p></div>}</div>
  </>;
}

type JavaPageProps = { runtimes: JavaRuntime[]; javaPath: string; loading: boolean; deleteIndex: number | null; hasJob: (key: string) => boolean };
export function JavaPage({ runtimes, javaPath, loading, deleteIndex, hasJob }: JavaPageProps) {
  const descriptions: Record<number, string> = { 8: '适用于多数旧版本', 17: '适用于部分较新版本', 21: '适用于较新版本', 25: '适用于需要 Java 25 的版本' };
  const selected = deleteIndex === null ? null : runtimes[deleteIndex];
  return <>
    <div className="page-heading inner-heading"><div><h1>Java 管理</h1><p>下载或选择适合游戏版本的 Java。</p></div><button className="outline-btn" data-action="refresh-java" disabled={loading}><Icon name="refresh-cw" size={16} /> {loading ? '正在检测' : '检测本机 Java'}</button></div>
    <div className="section-title"><div><span className="section-index">01 / DOWNLOAD</span><h3>下载 Java</h3></div><span className="section-note">Eclipse Temurin · JRE · 当前系统和架构</span></div>
    <div className="java-download-grid">{[8, 17, 21, 25].map(major => {
      const installed = runtimes.some(j => j.managed && j.major === major), busy = hasJob(`java:${major}`);
      return <div className="java-download-card" key={major}><div className="java-card-top"><span>JAVA</span><Icon name="download" size={16} /></div><strong>{major}</strong><p>{descriptions[major]}</p><button data-java-install={major} disabled={busy || installed || loading}>{installed ? '已安装' : busy ? '任务中' : '下载安装'}</button></div>;
    })}</div>
    <div className="section-title"><div><span className="section-index">02 / INSTALLED</span><h3>可用的 Java <span className="count">{runtimes.length}</span></h3></div><span className="section-note">当前启动路径：{javaPath}</span></div>
    <div className="version-list">{runtimes.length ? runtimes.map((j, i) => <div className="version-row java-row" key={`${j.path}:${i}`}><div className="row-icon"><Icon name="monitor" size={19} /></div><div className="row-name"><strong>Java {j.major || ''} <span className="java-version">{j.version}</span></strong><span className="java-path" title={j.path}>{j.path}</span></div><div className="row-state installed"><span />{j.managed ? 'CCL 管理' : '本机环境'}</div><button className={`row-button ${javaPath === j.path ? 'selected' : ''}`} data-java-select={i}>{javaPath === j.path ? '当前使用' : '选择使用'}</button>{j.managed && <button className="row-button danger-button" data-java-remove={i} disabled={hasJob(`java:${j.major}`)}>删除</button>}</div>) : <div className="empty-state"><Icon name="monitor" size={27} /><strong>{loading ? '正在检测 Java…' : '尚未检测到 Java 环境'}</strong><p>下载一个版本，或在启动设置中手动填写路径。</p></div>}</div>
    {selected && <div className="confirm-overlay"><div className="confirm-box"><span className="section-index">REMOVE RUNTIME</span><h3>删除 Java {selected.major}？</h3><p>将删除由 CCL 下载的此 Java 环境。游戏文件和本机其他 Java 不受影响。</p><div><button className="row-button" data-action="cancel-java-remove">取消</button><button className="row-button danger-button" data-action="confirm-java-remove">确认删除</button></div></div></div>}
  </>;
}
