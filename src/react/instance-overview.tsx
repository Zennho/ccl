import React from 'react';
import { Icon } from './pages';

interface InstanceOverview {
  gameVersion: string;
  loader: string;
  isolated: boolean;
  mods: number;
  resourcePacks: number;
  shaderPacks: number;
  sizeBytes: number;
  sizeIncomplete: boolean;
  lastLaunched?: number | null;
}
export interface InstanceOverviewView {
  version: string;
  name: string;
  loading: boolean;
  error: string;
  info: InstanceOverview | null;
}
function formatSize(n: number) { return n >= 1073741824 ? `${(n / 1073741824).toFixed(2)} GB` : `${(n / 1048576).toFixed(1)} MB`; }
export function InstanceOverviewDialog({ view }: { view: InstanceOverviewView }) {
  const info = view.info;
  const date = info?.lastLaunched ? new Date(info.lastLaunched * 1000).toLocaleString() : '暂无启动记录';
  return <div className="install-overlay"><section className="install-dialog instance-dialog" role="dialog" aria-modal="true" aria-labelledby="instance-title">
    <div className="install-dialog-head"><div><span className="section-index">GAME / INSTANCE</span><h2 id="instance-title">{view.name}</h2><p>查看此版本的游戏目录与资源情况。</p></div><button className="icon-button" data-action="close-instance" aria-label="关闭"><Icon name="x" size={19}/></button></div>
    {view.loading ? <div className="empty-state">正在统计实例文件…</div> : view.error ? <div className="empty-state">读取失败：{view.error}</div> : info && <><div className="instance-grid"><div><small>游戏版本</small><strong>{info.gameVersion}</strong></div><div><small>加载器</small><strong>{info.loader === 'vanilla' ? '原版' : info.loader}</strong></div><div><small>游戏目录</small><strong>{info.isolated ? '独立' : '共用'}</strong></div><div><small>模组文件</small><strong>{info.mods}</strong></div><div><small>材质包</small><strong>{info.resourcePacks}</strong></div><div><small>光影包</small><strong>{info.shaderPacks}</strong></div><div><small>目录占用{info.sizeIncomplete ? ' · 不完整' : ''}</small><strong>{formatSize(info.sizeBytes)}</strong></div><div><small>最近启动</small><strong>{date}</strong></div></div><p className="instance-note">{info.isolated ? '统计独立游戏目录；共享的游戏本体和库文件不计入。' : '统计共用游戏目录，其他未隔离的版本也会使用这些数据。'}{info.sizeIncomplete ? ' 部分文件无法读取或为符号链接，结果可能偏小。' : ''}</p></>}
    <div className="install-actions"><button className="outline-btn" data-action="close-instance">关闭</button><button className="save-button" data-open-version-folder={view.version}>打开游戏目录</button></div>
  </section></div>;
}
