import React from 'react';
import { Icon } from './icons';
import type { JavaRuntime } from './types';

type JavaPageProps = {
  runtimes: JavaRuntime[];
  javaPath: string;
  loading: boolean;
  deleteIndex: number | null;
  hasJob: (key: string) => boolean;
};
export function JavaPage({ runtimes, javaPath, loading, deleteIndex, hasJob }: JavaPageProps) {
  const descriptions: Record<number, string> = {
    8: '适用于多数旧版本',
    17: '适用于部分较新版本',
    21: '适用于较新版本',
    25: '适用于需要 Java 25 的版本',
  };
  const selected = deleteIndex === null ? null : runtimes[deleteIndex];
  return (
    <>
      <div className="page-heading inner-heading">
        <div>
          <h1>Java 管理</h1>
          <p>下载或选择适合游戏版本的 Java。</p>
        </div>
        <button className="outline-btn" data-action="refresh-java" disabled={loading}>
          <Icon name="refresh-cw" size={16} /> {loading ? '正在检测' : '检测本机 Java'}
        </button>
      </div>
      <div className="section-title">
        <div>
          <span className="section-index">01 / DOWNLOAD</span>
          <h3>下载 Java</h3>
        </div>
        <span className="section-note">Eclipse Temurin · JRE · 当前系统和架构</span>
      </div>
      <div className="java-download-grid">
        {[8, 17, 21, 25].map((major) => {
          const installed = runtimes.some((j) => j.managed && j.major === major),
            busy = hasJob(`java:${major}`);
          return (
            <div className="java-download-card" key={major}>
              <div className="java-card-top">
                <span>JAVA</span>
                <Icon name="download" size={16} />
              </div>
              <strong>{major}</strong>
              <p>{descriptions[major]}</p>
              <button data-java-install={major} disabled={busy || installed || loading}>
                {installed ? '已安装' : busy ? '任务中' : '下载安装'}
              </button>
            </div>
          );
        })}
      </div>
      <div className="section-title">
        <div>
          <span className="section-index">02 / INSTALLED</span>
          <h3>
            可用的 Java <span className="count">{runtimes.length}</span>
          </h3>
        </div>
        <span className="section-note">当前启动路径：{javaPath}</span>
      </div>
      <div className="version-list">
        {runtimes.length ? (
          runtimes.map((j, i) => (
            <div className="version-row java-row" key={`${j.path}:${i}`}>
              <div className="row-icon">
                <Icon name="monitor" size={19} />
              </div>
              <div className="row-name">
                <strong>
                  Java {j.major || ''} <span className="java-version">{j.version}</span>
                </strong>
                <span className="java-path" title={j.path}>
                  {j.path}
                </span>
              </div>
              <div className="row-state installed">
                <span />
                {j.managed ? 'CCL 管理' : '本机环境'}
              </div>
              <button
                className={`row-button ${javaPath === j.path ? 'selected' : ''}`}
                data-java-select={i}
              >
                {javaPath === j.path ? '当前使用' : '选择使用'}
              </button>
              {j.managed && (
                <button
                  className="row-button danger-button"
                  data-java-remove={i}
                  disabled={hasJob(`java:${j.major}`)}
                >
                  删除
                </button>
              )}
            </div>
          ))
        ) : (
          <div className="empty-state">
            <Icon name="monitor" size={27} />
            <strong>{loading ? '正在检测 Java…' : '尚未检测到 Java 环境'}</strong>
            <p>下载一个版本，或在启动设置中手动填写路径。</p>
          </div>
        )}
      </div>
      {selected && (
        <div className="confirm-overlay">
          <div className="confirm-box">
            <span className="section-index">REMOVE RUNTIME</span>
            <h3>删除 Java {selected.major}？</h3>
            <p>将删除由 CCL 下载的此 Java 环境。游戏文件和本机其他 Java 不受影响。</p>
            <div>
              <button className="row-button" data-action="cancel-java-remove">
                取消
              </button>
              <button className="row-button danger-button" data-action="confirm-java-remove">
                确认删除
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
