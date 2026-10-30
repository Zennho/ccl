import React from 'react';
import { Icon } from './icons';
interface Addon {
  id: string;
  title: string;
  desc: string;
  loaders: string[];
}
interface InstallDraft {
  version: string;
  loader: string;
  addons: string[];
}
const choices = [
  ['vanilla', '原版', '不安装加载器'],
  ['fabric', 'Fabric', '轻量，更新及时'],
  ['quilt', 'Quilt', '基于 Fabric 生态'],
  ['forge', 'Forge', '广泛的模组支持'],
  ['neoforge', 'NeoForge', 'Forge 生态分支'],
];
export function InstallDialog({ draft, addons }: { draft: InstallDraft; addons: Addon[] }) {
  return (
    <div className="install-overlay" data-action="close-install-backdrop">
      <section
        className="install-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="install-title"
      >
        <div className="install-dialog-head">
          <div>
            <span className="section-index">NEW INSTALL / JAVA EDITION</span>
            <h2 id="install-title">
              安装 <em>{draft.version}</em>
            </h2>
            <p>先选择运行方式，再按需添加常用模组。</p>
          </div>
          <button className="icon-button" data-action="close-install" aria-label="关闭">
            <Icon name="x" size={19} />
          </button>
        </div>
        <div className="install-section-heading">
          <span>01</span>
          <div>
            <strong>模组加载器</strong>
            <small>选择一个与模组兼容的加载器</small>
          </div>
        </div>
        <div className="loader-grid">
          {choices.map(([id, name, desc]) => (
            <label key={id} className={`loader-card ${draft.loader === id ? 'chosen' : ''}`}>
              <input
                type="radio"
                name="draftLoader"
                value={id}
                defaultChecked={draft.loader === id}
              />
              <span className="choice-dot" />
              <strong>{name}</strong>
              <small>{desc}</small>
            </label>
          ))}
        </div>
        <div className="install-section-heading">
          <span>02</span>
          <div>
            <strong>
              附加模组 <small>可选</small>
            </strong>
            <small>从 Modrinth 自动下载兼容版本及必需依赖</small>
          </div>
        </div>
        <div className="addon-grid">
          {addons.map((a) => {
            const available = a.loaders.includes(draft.loader);
            return (
              <label key={a.id} className={`addon-option ${available ? '' : 'unavailable'}`}>
                <input
                  type="checkbox"
                  name="draftAddon"
                  value={a.id}
                  defaultChecked={draft.addons.includes(a.id)}
                  disabled={!available}
                />
                <span>
                  <strong>{a.title}</strong>
                  <small>{a.desc}</small>
                </span>
              </label>
            );
          })}
        </div>
        <p className="install-note">
          {draft.loader === 'vanilla'
            ? '选择加载器后即可添加模组。'
            : '若所选模组没有兼容的版本，任务会显示具体原因。'}
        </p>
        <div className="install-actions">
          <button className="outline-btn" data-action="close-install">
            取消
          </button>
          <button className="save-button" data-action="confirm-install">
            加入下载任务 <Icon name="chevron-right" size={16} />
          </button>
        </div>
      </section>
    </div>
  );
}
