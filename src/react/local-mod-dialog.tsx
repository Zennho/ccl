import React from 'react';
import { Icon } from './icons';
import { ProjectDescription } from './content-dialog';
import type { LocalModDetail } from '../lib/local-mod-detail';

export function LocalModDialog({ mod }: { mod: LocalModDetail }) {
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
        <ProjectDescription
          draft={{
            description: mod.descriptionText,
            summary: '',
            encyclopedia: null,
            translation: mod.translation,
            showOriginal: mod.showOriginal,
            descriptionLoading: mod.descriptionLoading,
            translationLoading: mod.translationLoading,
            descriptionError: mod.descriptionError,
          }}
        />
        {mod.sourceMessage && <p className="local-mod-translation-status">{mod.sourceMessage}</p>}
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
