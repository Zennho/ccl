import React from 'react';
import type { ContentState } from './content-state';

export function ShaderStatus({ s }: { s: ContentState }) {
  if (s.contentKind !== 'shader' || !s.contentTarget) return null;
  const e = s.shaderEnv;
  if (s.shaderEnvLoading)
    return (
      <div className="shader-status">
        <strong>正在检测光影环境…</strong>
      </div>
    );
  if (!e)
    return (
      <div className="shader-status warning">
        <strong>无法确认光影环境</strong>
        <span>{s.shaderEnvError || '请检查目标版本的光影支持组件。'}</span>
        <button className="row-button" data-action="refresh-packs">
          重新检测
        </button>
      </div>
    );
  if (e.detected?.length)
    return (
      <div className="shader-status ready">
        <strong>已检测到 {e.detected.join('、')}</strong>
        <span>请在游戏中启用光影；具体兼容性以游戏内实际运行情况为准。</span>
      </div>
    );
  const suggested =
    e.loader === 'forge'
      ? 'Oculus'
      : ['fabric', 'quilt', 'neoforge'].includes(e.loader || '')
        ? 'Iris'
        : '';
  return (
    <div className="shader-status warning">
      <strong>光影环境{e.uncertain ? '无法完全确认' : '未检测到'}</strong>
      <span>
        {e.uncertain
          ? '部分模组无法读取，可能存在未识别的光影组件。'
          : '未检测到 Iris、Oculus 或 OptiFine。'}
        {suggested
          ? '可浏览与目标版本兼容的 ' + suggested + '。'
          : '请先安装支持光影的加载器或组件。'}
      </span>
      {suggested && (
        <button className="row-button" data-action="find-shader-support" data-query={suggested}>
          查找 {suggested}
        </button>
      )}
    </div>
  );
}
