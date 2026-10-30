import React from 'react';

export interface Diagnosis {
  title?: unknown;
  source?: unknown;
  steps?: unknown;
}
export interface Crash {
  version: string;
  gameDir: string;
  logName: string | null;
  code?: number | null;
  diagnosis?: Diagnosis | null;
}
export interface LaunchView {
  id: string;
  version: string;
  phase: 'authenticating' | 'preparing' | 'waiting' | 'failed';
  error?: string;
  warning?: string;
  authError?: boolean;
  crash?: Crash | null;
}

function DiagnosisContent({ crash }: { crash: Crash }) {
  const diagnosis = crash.diagnosis;
  const title = typeof diagnosis?.title === 'string' ? diagnosis.title : '暂未识别出明确原因';
  const source = typeof diagnosis?.source === 'string' ? diagnosis.source : '启动日志';
  const steps = Array.isArray(diagnosis?.steps)
    ? diagnosis.steps.filter((s): s is string => typeof s === 'string').slice(0, 4)
    : ['打开启动日志查看退出前的错误信息。'];
  return (
    <div className="crash-diagnosis">
      <span>可能原因 · {source}</span>
      <strong>{title}</strong>
      <ul>
        {steps.map((step, i) => (
          <li key={i}>{step}</li>
        ))}
      </ul>
      <small>诊断结果仅供参考，请结合完整日志确认。</small>
    </div>
  );
}
export function CrashDialog({ crash }: { crash: Crash }) {
  return (
    <div className="confirm-overlay crash-overlay">
      <section
        className="confirm-box crash-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="crash-dialog-title"
      >
        <span className="section-index">GAME / DIAGNOSIS</span>
        <h3 id="crash-dialog-title">游戏异常退出</h3>
        <p>
          {crash.version} · 退出代码 {crash.code ?? '未知'}
        </p>
        <DiagnosisContent crash={crash} />
        <div>
          <button className="outline-btn" data-action="close-crash-dialog">
            关闭
          </button>
          <button className="save-button" data-action="open-crash-log">
            打开启动日志
          </button>
        </div>
      </section>
    </div>
  );
}
export function LaunchScreen({ view }: { view: LaunchView }) {
  const failed = view.phase === 'failed',
    waiting = view.phase === 'waiting',
    authenticating = view.phase === 'authenticating';
  return (
    <div
      className={`launch-screen ${failed ? 'launch-failed' : ''}`}
      data-launch-id={view.id}
      role="status"
      aria-live="polite"
    >
      <div className="launch-stage">
        <div className="launch-album" aria-hidden="true">
          <div className="launch-disc-window">
            <div className="launch-disc">
              <div className="launch-disc-rotor" />
              <div className="launch-disc-hub" />
            </div>
          </div>
          <div className="launch-sleeve">
            <div className="launch-cover" />
            <div className="launch-default-art">
              <i />
              <i />
              <i />
            </div>
          </div>
        </div>
        <div className="launch-screen-copy">
          <div className="launch-copy-header">
            <div>
              <span className="launch-eyebrow">CCL / MINECRAFT</span>
              <h2>
                {failed
                  ? '启动遇到问题'
                  : authenticating
                    ? '正在验证正版账户'
                    : waiting
                      ? '等待游戏窗口'
                      : '正在准备游戏'}
              </h2>
            </div>
            <span className="launch-version-label">{view.version}</span>
          </div>
          <p>
            {failed
              ? view.error
              : view.warning
                ? view.warning
                : authenticating
                  ? '正在恢复微软账户登录，请稍候。'
                  : waiting
                    ? '游戏进程已启动，正在等待游戏窗口出现。'
                    : '正在准备游戏环境并启动 Java，请稍候。'}
          </p>
          {failed && view.crash?.diagnosis && <DiagnosisContent crash={view.crash} />}
          <div className={`launch-progress ${failed ? 'failed' : 'preparing'}`}>
            <i />
          </div>
          <div className="launch-screen-actions">
            {failed && view.authError ? (
              <button className="save-button" data-action="launch-account">
                账户与外观
              </button>
            ) : failed && view.crash ? (
              <button className="save-button" data-action="open-crash-log">
                打开启动日志
              </button>
            ) : waiting ? (
              <button className="outline-btn" data-action="open-log">
                查看启动日志
              </button>
            ) : null}
            <button className="outline-btn" data-action="close-launch-view">
              返回主页
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
