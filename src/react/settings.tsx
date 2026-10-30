import React from 'react';
import { Icon } from './icons';
import type { GameVersion, MemoryMode } from './types';
import type { MemoryInfo } from '../lib/system-status';
type ThemeKey =
  | 'bannerOpacity'
  | 'bannerFrost'
  | 'bannerBlur'
  | 'backgroundOpacity'
  | 'backgroundFrost'
  | 'backgroundBlur';
type Theme = Record<ThemeKey, number>;
export interface SettingsProps {
  version: string;
  selectedVersion?: GameVersion;
  username: string;
  javaPath: string;
  gameDir: string;
  memory: number;
  memoryMode: MemoryMode;
  optimize: boolean;
  jvmArgs: string;
  gameArgs: string;
  proxyUrl: string;
  memoryInfo: MemoryInfo | null;
  memoryInfoLoading: boolean;
  memoryInfoError: string;
  theme: Theme;
  updateState: string;
  updateError: string;
  updateInfo: { available: boolean; latestVersion: string } | null;
}
function SettingHeading({
  icon,
  index,
  title,
  description,
}: {
  icon: string;
  index: string;
  title: string;
  description: string;
}) {
  return (
    <div className="settings-heading">
      <div className="settings-icon">
        <Icon name={icon} size={20} />
      </div>
      <div>
        <span className="section-index">{index}</span>
        <h3>{title}</h3>
        <p>{description}</p>
      </div>
    </div>
  );
}
function Slider({
  theme,
  name,
  label,
  max,
  unit,
}: {
  theme: Theme;
  name: ThemeKey;
  label: string;
  max: number;
  unit: string;
}) {
  return (
    <div className="theme-control">
      <label htmlFor={`theme-${name}`}>
        {label}
        <output>
          {theme[name]}
          {unit}
        </output>
      </label>
      <input
        id={`theme-${name}`}
        data-theme-setting={name}
        type="range"
        min="0"
        max={max}
        defaultValue={theme[name]}
      />
    </div>
  );
}
function AppearanceSettings({ theme }: { theme: Theme }) {
  return (
    <section className="settings-section theme-settings">
      <SettingHeading
        icon="layout-grid"
        index="APPEARANCE"
        title="界面外观"
        description="选择本地图片，自定义启动器的视觉效果。"
      />
      <div className="theme-grid">
        <div className="theme-card">
          <div className="theme-card-head">
            <div>
              <strong>主界面横幅</strong>
              <p>建议使用横向图片。</p>
            </div>
            <span>01</span>
          </div>
          <div className="theme-preview theme-preview-banner" aria-label="横幅预览">
            <span className="theme-preview-underlay" />
            <i />
            <div className="theme-preview-banner-image" />
          </div>
          <div className="theme-image-actions">
            <label className="outline-btn theme-upload">
              选择图片
              <input
                type="file"
                data-theme-image="banner"
                accept="image/png,image/jpeg,image/webp"
              />
            </label>
            <button type="button" className="text-link" data-theme-reset="banner">
              恢复默认
            </button>
          </div>
          <Slider theme={theme} name="bannerOpacity" label="图片透明度" max={100} unit="%" />
          <Slider theme={theme} name="bannerFrost" label="磨砂强度" max={100} unit="%" />
          <Slider theme={theme} name="bannerBlur" label="图片模糊" max={30} unit=" px" />
        </div>
        <div className="theme-card">
          <div className="theme-card-head">
            <div>
              <strong>全局背景</strong>
              <p>图片将显示在整个界面底层。</p>
            </div>
            <span>02</span>
          </div>
          <div className="theme-preview theme-preview-background" aria-label="背景预览">
            <div />
            <i />
          </div>
          <div className="theme-image-actions">
            <label className="outline-btn theme-upload">
              选择图片
              <input
                type="file"
                data-theme-image="background"
                accept="image/png,image/jpeg,image/webp"
              />
            </label>
            <button type="button" className="text-link" data-theme-reset="background">
              恢复默认
            </button>
          </div>
          <Slider theme={theme} name="backgroundOpacity" label="图片透明度" max={100} unit="%" />
          <Slider theme={theme} name="backgroundFrost" label="磨砂强度" max={100} unit="%" />
          <Slider theme={theme} name="backgroundBlur" label="背景模糊" max={30} unit=" px" />
        </div>
      </div>
      <p className="theme-footnote">
        调整即时生效并保存在本设备。支持 PNG、JPEG、WebP，单张图片不超过 20 MB。
      </p>
    </section>
  );
}
function UpdatePanel({
  version,
  updateInfo,
  updateState,
  updateError,
}: Pick<SettingsProps, 'version' | 'updateInfo' | 'updateState' | 'updateError'>) {
  const message =
    updateState === 'checking'
      ? '正在检查 GitHub 更新…'
      : updateState === 'error'
        ? `检查失败：${updateError}`
        : updateInfo?.available
          ? `发现新版本 v${updateInfo.latestVersion}。`
          : updateState === 'success'
            ? '当前已是最新正式版。'
            : '启动后会自动检查新版本。';
  return (
    <section className="settings-section update-settings">
      <SettingHeading
        icon="download"
        index="CCL / UPDATE"
        title="启动器更新"
        description={`当前版本 v${version}`}
      />
      <div className="update-settings-row">
        <p role="status">{message}</p>
        <div>
          <button
            className="outline-btn"
            type="button"
            data-action="check-update"
            disabled={updateState === 'checking'}
          >
            {updateState === 'checking' ? '检查中…' : '检查更新'}
          </button>
          {updateInfo?.available && (
            <button className="save-button" type="button" data-action="open-update">
              前往下载
            </button>
          )}
        </div>
      </div>
    </section>
  );
}
export function SettingsPage(p: SettingsProps) {
  const v = p.selectedVersion,
    info = p.memoryInfo;
  return (
    <>
      <div className="page-heading inner-heading">
        <div>
          <h1>启动设置</h1>
          <p>调整游戏运行环境与启动参数。</p>
        </div>
      </div>
      <form id="settings-form">
        <section className="settings-section">
          <SettingHeading
            icon="user-round"
            index="01 / PLAYER"
            title="玩家身份"
            description="设置用于启动游戏的离线玩家名称。"
          />
          <div className="field">
            <label htmlFor="username">
              玩家名称 <span>1–16 位字母、数字或下划线</span>
            </label>
            <input
              id="username"
              name="username"
              defaultValue={p.username}
              maxLength={16}
              required
              pattern="[A-Za-z0-9_]{1,16}"
            />
            <p>离线玩家名称；正版账户请在“账户与外观”中登录。</p>
            <button className="text-link" type="button" data-page="account">
              打开账户与外观 →
            </button>
          </div>
        </section>
        <section className="settings-section">
          <SettingHeading
            icon="monitor"
            index="02 / ENVIRONMENT"
            title="游戏环境"
            description="配置 Java 和游戏文件的存放位置。"
          />
          <div className="field">
            <label htmlFor="javaPath">
              Java 可执行文件 <span>JAVA PATH</span>
            </label>
            <input id="javaPath" name="javaPath" defaultValue={p.javaPath} required />
            <p>
              使用系统 PATH 中的 java，或填写完整路径。请根据游戏版本选择对应的 Java，或前往 Java
              管理下载。
            </p>
            <button className="text-link" type="button" data-page="java">
              打开 Java 管理 →
            </button>
          </div>
          <div className="field">
            <label htmlFor="gameDir">
              游戏目录 <span>GAME DIRECTORY</span>
            </label>
            <input id="gameDir" name="gameDir" defaultValue={p.gameDir} required />
            <p>下载的版本、资源和游戏存档将保存在这里。</p>
          </div>
          <div className="field isolation-field">
            <label className="option-check">
              <input
                id="version-isolation"
                name="versionIsolation"
                type="checkbox"
                defaultChecked={!!v?.isolated}
                disabled={!v || v.kind === '整合包'}
              />{' '}
              版本隔离
            </label>
            <p>
              {v
                ? `当前版本：${v.name || v.id}${v.kind === '整合包' ? ' · 整合包始终使用独立目录' : ''}`
                : '请先选择已安装的游戏版本。'}
            </p>
            <p>启用后，此版本的存档、模组与配置使用独立游戏目录。切换不会移动或删除原有文件。</p>
          </div>
          <div className="field memory-field">
            <label htmlFor="memory-mode">
              最大内存 <span>JAVA 堆上限</span>
            </label>
            <select id="memory-mode" name="memoryMode" defaultValue={p.memoryMode}>
              <option value="auto">自动分配</option>
              <option value="manual">手动设置</option>
            </select>
            <div id="memory-manual" hidden={p.memoryMode === 'auto'}>
              <div className="memory-value">
                <label htmlFor="memory">手动上限</label>
                <div>
                  <input
                    id="memory"
                    name="memory"
                    type="number"
                    min="512"
                    max="32768"
                    step="1"
                    defaultValue={p.memory}
                    required
                  />
                  <span>MB</span>
                </div>
              </div>
              <input
                id="memory-range"
                aria-label="调整最大内存"
                type="range"
                min="512"
                max="32768"
                step="256"
                defaultValue={p.memory}
              />
              <div className="range-labels">
                <span>512 MB</span>
                <span>32 GB</span>
              </div>
            </div>
            <div id="memory-info">
              <div className="memory-info">
                <span>
                  {p.memoryInfoLoading ? (
                    '正在检测设备内存…'
                  ) : p.memoryInfoError ? (
                    `内存检测失败：${p.memoryInfoError}`
                  ) : info ? (
                    <>
                      {`设备内存 ${info.totalMb} MB · 当前可用 ${info.availableMb} MB`}
                      <br />
                      {info.recommendedMb
                        ? `当前自动上限约 ${info.recommendedMb} MB`
                        : '可用内存不足，自动模式暂不可用'}
                    </>
                  ) : (
                    '尚未检测设备内存'
                  )}
                </span>
                <button
                  className="text-link"
                  type="button"
                  data-action="refresh-memory-info"
                  disabled={p.memoryInfoLoading}
                >
                  刷新
                </button>
              </div>
            </div>
            <p>
              自动模式在每次启动时根据总内存和可用内存重新计算，预留系统空间。自定义 JVM 参数中的
              -Xmx 会覆盖此设置。
            </p>
          </div>
        </section>
        <details className="settings-advanced" data-settings-advanced>
          <summary>
            高级设置 <small>启动参数与网络代理</small>
          </summary>
          <section className="settings-section">
            <SettingHeading
              icon="zap"
              index="03 / LAUNCH OPTIONS"
              title="启动参数"
              description="按需调整 Java 和游戏启动方式。"
            />
            <div className="field">
              <label className="option-check">
                <input name="optimize" type="checkbox" defaultChecked={p.optimize} /> 启用 G1
                垃圾回收优化
              </label>
              <p>使用 Java 内置的 G1GC；自定义 JVM 参数可覆盖或补充设置。</p>
            </div>
            <div className="field">
              <label htmlFor="jvmArgs">
                自定义 JVM 参数 <span>JVM ARGUMENTS</span>
              </label>
              <input
                id="jvmArgs"
                name="jvmArgs"
                defaultValue={p.jvmArgs}
                placeholder="例如 -XX:MaxGCPauseMillis=100"
              />
              <p>用空格分隔，带空格的值可用引号包裹。</p>
            </div>
            <div className="field">
              <label htmlFor="gameArgs">
                自定义游戏参数 <span>GAME ARGUMENTS</span>
              </label>
              <input
                id="gameArgs"
                name="gameArgs"
                defaultValue={p.gameArgs}
                placeholder="例如 --width 1280 --height 720"
              />
            </div>
          </section>
          <section className="settings-section">
            <SettingHeading
              icon="globe-2"
              index="03 / NETWORK"
              title="网络代理"
              description="下载游戏、Java 和模组时使用的连接方式。"
            />
            <div className="field">
              <label htmlFor="proxyUrl">
                手动代理地址 <span>留空时使用系统代理</span>
              </label>
              <input
                id="proxyUrl"
                name="proxyUrl"
                defaultValue={p.proxyUrl}
                placeholder="例如 http://127.0.0.1:7890"
              />
              <p>
                支持 HTTP、HTTPS 和 SOCKS5；使用系统代理时请留空。代理地址不支持填写账号或密码。
              </p>
            </div>
          </section>
        </details>
        <div className="settings-actions">
          <p>设置保存在本设备上。</p>
          <button className="save-button" type="submit">
            保存设置 <Icon name="chevron-right" size={16} />
          </button>
        </div>
      </form>
      <details className="settings-appearance">
        <summary>
          界面外观 <small>横幅与背景</small>
        </summary>
        <AppearanceSettings theme={p.theme} />
      </details>
      <div id="update-panel">
        <UpdatePanel {...p} />
      </div>
    </>
  );
}
