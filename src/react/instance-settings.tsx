import React from 'react';
import { Icon } from './icons';
import type { InstanceLaunchOptions, InstanceSettings, JavaRuntime } from './types';

export interface InstanceSettingsDialogProps {
  name: string;
  values: InstanceLaunchOptions;
  saved: InstanceSettings | null;
  runtimes: JavaRuntime[];
}

export function InstanceSettingsDialog({
  name,
  values,
  saved,
  runtimes,
}: InstanceSettingsDialogProps) {
  const javaOn = !!saved?.overrideJava,
    memoryOn = !!saved?.overrideMemory,
    argsOn = !!saved?.overrideArgs;
  return (
    <div className="install-overlay">
      <section
        className="install-dialog instance-settings-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="instance-settings-title"
      >
        <div className="install-dialog-head">
          <div>
            <span className="section-index">INSTANCE / LAUNCH</span>
            <h2 id="instance-settings-title">
              实例设置 <em>{name}</em>
            </h2>
            <p>单独调整此实例的启动方式；未开启的项目跟随全局设置。</p>
          </div>
          <button
            className="icon-button"
            type="button"
            data-action="close-instance-settings"
            aria-label="关闭"
          >
            <Icon name="x" size={19} />
          </button>
        </div>
        <form id="instance-settings-form">
          <div className="instance-setting-group">
            <label className="instance-override">
              <input type="checkbox" name="overrideJava" defaultChecked={javaOn} />
              <span>
                <strong>指定 Java 环境</strong>
                <small>关闭时使用全局 Java 路径</small>
              </span>
            </label>
            <fieldset id="instance-java-fields" disabled={!javaOn}>
              <div className="field">
                <label htmlFor="instance-java">Java 可执行文件</label>
                <input
                  id="instance-java"
                  name="javaPath"
                  list="instance-java-list"
                  defaultValue={values.javaPath}
                  required
                />
                <datalist id="instance-java-list">
                  {runtimes
                    .filter((j) => typeof j.path === 'string' && j.path)
                    .map((j, i) => (
                      <option key={`${j.path}:${i}`} value={j.path}>
                        Java {j.major || j.version || ''}
                      </option>
                    ))}
                </datalist>
                <p>选择已检测的环境，或输入 Java 路径。</p>
              </div>
            </fieldset>
          </div>
          <div className="instance-setting-group">
            <label className="instance-override">
              <input type="checkbox" name="overrideMemory" defaultChecked={memoryOn} />
              <span>
                <strong>指定内存配置</strong>
                <small>关闭时使用全局内存配置</small>
              </span>
            </label>
            <fieldset id="instance-memory-fields" disabled={!memoryOn}>
              <div className="field memory-field">
                <label htmlFor="instance-memory-mode">内存分配</label>
                <select
                  id="instance-memory-mode"
                  name="memoryMode"
                  defaultValue={values.memoryMode}
                >
                  <option value="auto">自动分配</option>
                  <option value="manual">手动设置</option>
                </select>
              </div>
              <div
                id="instance-memory-manual"
                className="field memory-field"
                hidden={values.memoryMode !== 'manual'}
              >
                <div className="memory-value">
                  <label htmlFor="instance-memory">手动内存上限</label>
                  <div>
                    <input
                      id="instance-memory"
                      name="memory"
                      type="number"
                      min="512"
                      max="32768"
                      step="1"
                      defaultValue={values.memory}
                      required
                    />
                    <span>MB</span>
                  </div>
                </div>
                <input
                  id="instance-memory-range"
                  aria-label="调整实例最大内存"
                  type="range"
                  min="512"
                  max="32768"
                  step="256"
                  defaultValue={values.memory}
                />
                <div className="range-labels">
                  <span>512 MB</span>
                  <span>32 GB</span>
                </div>
              </div>
              <p className="instance-setting-hint">
                自动分配会根据设备内存动态计算；自定义 JVM 参数中的 -Xmx 会覆盖此设置。
              </p>
            </fieldset>
          </div>
          <div className="instance-setting-group">
            <label className="instance-override">
              <input type="checkbox" name="overrideArgs" defaultChecked={argsOn} />
              <span>
                <strong>指定启动参数</strong>
                <small>关闭时使用全局优化和启动参数</small>
              </span>
            </label>
            <fieldset id="instance-args-fields" disabled={!argsOn}>
              <div className="field">
                <label className="option-check">
                  <input name="optimize" type="checkbox" defaultChecked={values.optimize} /> 启用 G1
                  垃圾回收优化
                </label>
              </div>
              <div className="field">
                <label htmlFor="instance-jvm">JVM 参数</label>
                <input
                  id="instance-jvm"
                  name="jvmArgs"
                  maxLength={16384}
                  defaultValue={values.jvmArgs}
                />
              </div>
              <div className="field">
                <label htmlFor="instance-game">游戏参数</label>
                <input
                  id="instance-game"
                  name="gameArgs"
                  maxLength={16384}
                  defaultValue={values.gameArgs}
                />
              </div>
            </fieldset>
          </div>
          <div className="install-actions">
            {saved && (
              <button className="outline-btn" type="button" data-action="reset-instance-settings">
                全部使用全局设置
              </button>
            )}
            <button className="save-button" type="submit">
              保存实例设置
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
