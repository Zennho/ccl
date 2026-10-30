import React from 'react';
import { Icon } from './icons';
import type { LocalMod } from './types';

export function LocalModDialog({ mod }: { mod: LocalMod }) {
  return (
    <div className="install-overlay" data-action="close-local-mod-backdrop">
      <section
        className="install-dialog local-mod-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="local-mod-title"
      >
        <div className="install-dialog-head">
          <div>
            <span className="section-index">INSTALLED MOD</span>
            <h2 id="local-mod-title">{mod.displayName || mod.name}</h2>
            <p>
              {mod.enabled ? '已启用' : '已停用'}
              {mod.version ? ` · ${mod.version}` : ''}
            </p>
          </div>
          <button className="icon-button" data-action="close-local-mod" aria-label="关闭">
            <Icon name="x" size={19} />
          </button>
        </div>
        <div className="local-mod-detail-body">
          <div className={`row-icon thumbnail local-mod-icon${mod.icon ? ' has-thumbnail' : ''}`}>
            <span className="thumbnail-fallback">
              <Icon name="blocks" size={19} />
            </span>
            {mod.icon && (
              <img
                className="thumbnail-image"
                src={mod.icon}
                alt=""
                onError={(e) => {
                  e.currentTarget.hidden = true;
                  e.currentTarget.parentElement?.classList.remove('has-thumbnail');
                }}
              />
            )}
          </div>
          <div>
            <strong>{mod.name}</strong>
            {mod.modId && <p>模组 ID：{mod.modId}</p>}
          </div>
        </div>
        <section className="project-description">
          <div className="project-description-head">
            <strong>模组介绍</strong>
          </div>
          {mod.description ? (
            <div className="project-description-text">{mod.description}</div>
          ) : (
            <p>此模组没有提供本地介绍。</p>
          )}
        </section>
        {mod.website && (
          <div className="project-links">
            <strong>相关网址</strong>
            <button className="content-project-link" data-open-project={mod.website}>
              <span>项目主页</span>
              <small>{mod.website} ↗</small>
            </button>
          </div>
        )}
        <div className="install-actions">
          <button className="outline-btn" data-action="close-local-mod">
            关闭
          </button>
        </div>
      </section>
    </div>
  );
}
