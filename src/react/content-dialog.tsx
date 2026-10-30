import React from 'react';
import { Icon } from './icons';
import type { ContentDraft, ContentLink } from '../lib/content-detail';
function descriptionText(value?: string) {
  const template = document.createElement('template');
  template.innerHTML = String(value || '');
  template.content
    .querySelectorAll('script,style,iframe,object,embed,svg,video,audio,img')
    .forEach((node) => node.remove());
  template.content
    .querySelectorAll('br')
    .forEach((node) => node.replaceWith(document.createTextNode('\n')));
  template.content
    .querySelectorAll('p,div,li,h1,h2,h3,h4,h5,h6,pre,blockquote,tr')
    .forEach((node) => node.append(document.createTextNode('\n')));
  return (template.content.textContent || '')
    .replace(/!\[([^\]]*)\]\([^\n)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^\n)]*\)/g, '$1')
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/^\s*`{3,}[^\n]*$/gm, '')
    .replace(/\*\*|~~|`/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
function ProjectDescription({ draft: d }: { draft: ContentDraft }) {
  const original = descriptionText(d.description) || String(d.summary || '').trim();
  const excerptText = String(d.encyclopedia?.summary || '')
      .replace(/\[[^\]]{1,120}\]/g, '')
      .trim(),
    excerpt = /[\u3400-\u9fff]/.test(excerptText) ? excerptText : '';
  const chinese = d.translation ? descriptionText(d.translation) : excerpt,
    showChinese = !!chinese && !d.showOriginal,
    description = showChinese ? chinese : original;
  const status = d.descriptionLoading
    ? '正在获取完整介绍…'
    : d.translationLoading
      ? '正在获取中文介绍…'
      : showChinese
        ? d.translation
          ? 'AI 翻译 · 仅供参考'
          : 'MC 百科摘要'
        : d.descriptionError
          ? '完整介绍暂时不可用'
          : '';
  return (
    <section className="project-description">
      <div className="project-description-head">
        <strong>项目介绍</strong>
        {status && <small>{status}</small>}
        {chinese && (
          <button className="text-link" type="button" data-action="toggle-content-language">
            {showChinese ? '查看原文' : '查看中文'}
          </button>
        )}
      </div>
      {description ? (
        <div className="project-description-text" tabIndex={0}>
          {description}
        </div>
      ) : (
        <p>
          {d.descriptionLoading
            ? '正在加载介绍…'
            : d.descriptionError
              ? '暂时无法获取介绍。'
              : '暂无介绍。'}
        </p>
      )}
    </section>
  );
}
function ProjectLinks({ draft: d }: { draft: ContentDraft }) {
  const links: ContentLink[] = [];
  if (d.projectUrl)
    links.push({ label: d.source === 'modrinth' ? 'Modrinth' : 'CurseForge', url: d.projectUrl });
  for (const link of d.links || [])
    if (link && typeof link.url === 'string' && !links.some((x) => x.url === link.url))
      links.push(link);
  if (d.encyclopedia?.url && !links.some((x) => x.label === 'MC 百科'))
    links.push({ label: 'MC 百科', url: d.encyclopedia.url });
  if (!links.some((x) => x.label === 'MC 百科'))
    links.push({
      label: '搜索 MC 百科',
      url: `https://search.mcmod.cn/s?key=${encodeURIComponent(d.title)}`,
    });
  return (
    <div className="project-links">
      <strong>相关网址</strong>
      {links.map((link) => (
        <button
          key={link.url}
          type="button"
          className="content-project-link"
          data-open-project={link.url}
          title="在浏览器中打开"
        >
          <span>{link.label}</span>
          <small>{link.url} ↗</small>
        </button>
      ))}
      {d.linksLoading ? (
        <p>正在获取其他网址…</p>
      ) : d.linksError ? (
        <p>其他网址暂时不可用，仍可打开上面的链接。</p>
      ) : null}
    </div>
  );
}
export function ContentDialog({
  draft: d,
  shaderEnv,
  shaderEnvLoading,
}: {
  draft: ContentDraft;
  shaderEnv: { detected?: string[] } | null;
  shaderEnvLoading: boolean;
}) {
  const pack = d.kind === 'modpack',
    label: Record<string, string> = { mod: '模组', resourcepack: '材质包', shader: '光影包' },
    name = label[d.kind] || '内容';
  return (
    <div className="install-overlay" data-action="close-mod-backdrop">
      <section
        className="install-dialog mod-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="mod-dialog-title"
      >
        <div className="install-dialog-head">
          <div>
            <span className="section-index">
              {pack ? 'MODPACK' : name + '版本'} / {d.source}
            </span>
            <h2 id="mod-dialog-title">{d.title}</h2>
            <p>
              {pack
                ? '整合包将创建独立游戏目录'
                : `安装到 ${d.target}${d.kind === 'mod' ? ' · 自动安装必需依赖' : d.kind === 'shader' ? ' · 游戏中需支持光影并手动启用' : ' · 在游戏资源包设置中启用'}`}
            </p>
          </div>
          <button className="icon-button" data-action="close-mod-dialog" aria-label="关闭">
            <Icon name="x" size={19} />
          </button>
        </div>
        {d.kind === 'shader' && (
          <p className="pack-dialog-status">
            {shaderEnvLoading
              ? '正在检测光影环境…'
              : shaderEnv?.detected?.length
                ? `已检测到 ${shaderEnv.detected.join('、')}；请在游戏中启用光影，具体兼容性以实际运行为准。`
                : '尚未确认光影环境；下载后仍需 Iris、Oculus 或 OptiFine 等组件。'}
          </p>
        )}
        <div className="mod-project-description">
          <ProjectDescription draft={d} />
        </div>
        <div className="mod-project-links">
          <ProjectLinks draft={d} />
        </div>
        {!pack && (
          <>
            <div className="install-section-heading">
              <span>01</span>
              <div>
                <strong>选择{name}版本</strong>
                <small>
                  {d.kind === 'mod'
                    ? '仅显示兼容目标游戏版本和加载器的版本'
                    : '仅显示来源标注支持目标游戏版本的版本'}
                </small>
              </div>
            </div>
            {d.loading ? (
              <div className="empty-state">正在获取兼容版本…</div>
            ) : d.error ? (
              <div className="empty-state">{d.error}</div>
            ) : d.versions.length ? (
              <div className="mod-version-list">
                {d.versions.map((v, i) => (
                  <label className="mod-version-option" key={v.id}>
                    <input type="radio" name="modVersion" value={v.id} defaultChecked={i === 0} />
                    <span>
                      <strong>{v.name}</strong>
                      <small>
                        {v.number} · {v.date}
                      </small>
                    </span>
                  </label>
                ))}
              </div>
            ) : (
              <div className="empty-state">没有找到兼容版本</div>
            )}
          </>
        )}
        <div className="install-actions">
          <button className="outline-btn" data-action="close-mod-dialog">
            取消
          </button>
          <button
            className="save-button"
            data-action="confirm-mod-install"
            disabled={d.installed || (!pack && (d.loading || !!d.error || !d.versions.length))}
          >
            {d.installed ? '已安装' : '加入下载任务'} <Icon name="chevron-right" size={16} />
          </button>
        </div>
      </section>
    </div>
  );
}
