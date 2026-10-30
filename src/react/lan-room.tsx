import React from 'react';
import { Icon } from './pages';

export type NetworkAddress = { address: string; interface: string; scope: string };
export interface LanRoomPageProps {
  room: { port: number } | null;
  busy: boolean;
  addresses: NetworkAddress[];
  port: string;
  target: string;
  test: string;
}

export function LanRoomPage({ room, busy, addresses, port, target, test }: LanRoomPageProps) {
  return <>
    <div className="server-tabs" role="tablist" aria-label="联机功能"><button type="button" data-lan-view="room" role="tab" aria-selected="true">IPv6 房间</button><button type="button" data-lan-view="servers" role="tab" aria-selected="false">公开服务器</button></div>
    <div className="page-heading inner-heading"><div><h1>多人联机</h1><p>通过 IPv6 邀请朋友加入你的 Java 版世界。</p></div><button className="outline-btn" data-action="refresh-ipv6" disabled={busy}><Icon name="refresh-cw" size={16} /> 刷新地址</button></div>
    <div className="lan-layout"><section className="lan-card lan-host"><div className="lan-card-head"><div><span className="lan-number">01 / HOST</span><h2>创建联机房间</h2><p>先在游戏内进入世界，选择“对局域网开放”，记下游戏显示的端口。</p></div><span className={`lan-status ${room ? 'is-open' : ''}`}><i />{room ? '房间开放中' : '未开放'}</span></div>
      <form id="lan-host-form"><label htmlFor="lan-game-port">游戏局域网端口</label><div className="lan-input-row"><input id="lan-game-port" name="lanGamePort" type="number" min="1" max="65535" required placeholder="例如 51234" defaultValue={port} disabled={!!room || busy} />{room ? <button type="button" className="outline-btn" data-action="stop-ipv6-room" disabled={busy}>关闭房间</button> : <button type="submit" className="save-button" disabled={busy}>{busy ? '正在开启…' : '开启房间'} <Icon name="chevron-right" size={16} /></button>}</div></form>
      {room ? <div className="lan-addresses"><div className="lan-address-title"><strong>分享给朋友</strong><span>中转端口 {room.port}</span></div>{addresses.length ? addresses.map((a, i) => <div className="lan-address" key={`${a.address}:${a.interface}`}><div><code>[{a.address}]:{room.port}</code><small>{a.scope} · {a.interface}</small></div><button className="row-button" data-copy-ipv6={i}>复制</button></div>) : <p>未检测到可用的公网或内网 IPv6 地址，请检查网络连接后刷新。</p>}</div> : <div className="lan-hint">创建后，将生成朋友可在游戏中使用的 IPv6 地址。</div>}
      <p className="lan-footnote">仅分享给可信任的朋友。房间开放时，CCL 会监听网络并转发到本机游戏；关闭 CCL 或房间会断开连接。</p></section>
      <section className="lan-card lan-join"><div className="lan-card-head"><div><span className="lan-number">02 / JOIN</span><h2>加入朋友的世界</h2><p>粘贴房主分享的地址，检查连接后在游戏中加入。</p></div></div><form id="lan-test-form"><label htmlFor="lan-target">房间地址</label><div className="lan-input-row"><input id="lan-target" name="lanTarget" defaultValue={target} placeholder="[IPv6地址]:端口" required /><button className="outline-btn" type="submit" disabled={busy}>{busy ? '检测中…' : '检测连接'}</button></div></form>{test && <p className="lan-test-result">{test}</p>}<div className="lan-steps"><span>1</span><p>启动相同游戏版本及兼容的模组。</p><span>2</span><p>在游戏中打开“多人游戏 → 直接连接”，粘贴房间地址。</p></div></section></div>
    <p className="lan-network-note">跨网络联机需要双方有可互通的 IPv6，房主的路由器和防火墙需允许入站 TCP。公网候选地址不保证外网可达；内网地址通常只适用于同一网络。</p>
  </>;
}
