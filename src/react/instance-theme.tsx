import React from 'react';
import { Icon } from './icons';
import type { ThemeDraft } from '../lib/instance-theme';
export function InstanceThemeDialog({
  draft: d,
  cover,
  colors,
}: {
  draft: ThemeDraft;
  cover: string | null;
  colors: string[];
}) {
  return (
    <div className="install-overlay">
      <section
        className="install-dialog instance-theme-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="instance-theme-title"
      >
        <div className="install-dialog-head">
          <div>
            <span className="section-index">INSTANCE / APPEARANCE</span>
            <h2 id="instance-theme-title">实例主题</h2>
            <p>{d.name} · 为这个版本设置封面、颜色和简介。</p>
          </div>
          <button
            className="icon-button"
            data-action="close-instance-theme"
            aria-label="关闭"
            disabled={d.saving}
          >
            <Icon name="x" size={19} />
          </button>
        </div>
        <div
          className="instance-theme-preview"
          style={{ '--instance-color': d.color } as React.CSSProperties}
        >
          {cover ? (
            <img src={cover} alt="实例封面预览" />
          ) : (
            <span>
              <Icon name="layers-3" size={28} />
            </span>
          )}
          <strong>{d.name}</strong>
        </div>
        <div className="theme-image-actions">
          <label className="outline-btn theme-upload">
            选择封面
            <input
              type="file"
              data-instance-cover
              accept="image/png,image/jpeg,image/webp"
              disabled={d.saving}
            />
          </label>
          <button
            type="button"
            className="text-link"
            data-action="remove-instance-cover"
            disabled={d.saving}
          >
            移除封面
          </button>
        </div>
        <p className="manage-note">
          选中实例后，封面会用于主页横幅和启动唱片；未设置时使用全局横幅。
        </p>
        <div className="instance-theme-field">
          <strong>主题颜色</strong>
          <div className="instance-color-options">
            {colors.map((color) => (
              <button
                key={color}
                type="button"
                className={`instance-color ${d.color === color ? 'selected' : ''}`}
                data-instance-color={color}
                style={{ '--instance-color': color } as React.CSSProperties}
                aria-label={`选择 ${color}`}
                aria-pressed={d.color === color}
              />
            ))}
          </div>
        </div>
        <label className="instance-theme-field">
          <strong>实例简介</strong>
          <textarea
            id="instance-description"
            maxLength={180}
            placeholder="记录这个世界或整合包的特色"
            disabled={d.saving}
            defaultValue={d.description}
          />
        </label>
        {d.error && <p className="manage-error">{d.error}</p>}
        <div className="install-actions">
          <button className="outline-btn" data-action="close-instance-theme" disabled={d.saving}>
            取消
          </button>
          <button className="save-button" data-action="save-instance-theme" disabled={d.saving}>
            {d.saving ? '保存中…' : '保存主题'}
          </button>
        </div>
      </section>
    </div>
  );
}
