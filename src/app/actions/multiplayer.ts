import type {LauncherState} from '../../lib/launcher-state';
import type {createMultiplayer} from '../../lib/multiplayer';
import type {ClickHandler} from './types';
interface Options {state:LauncherState;render:()=>void;flash:(message:string,kind?:string)=>void;copy:(text:string)=>Promise<unknown>;multiplayer:ReturnType<typeof createMultiplayer>}
export function createMultiplayerHandler({state,render,flash,copy,multiplayer}:Options):ClickHandler {
 return target=>{
  const lanView=target.closest<HTMLElement>('[data-lan-view]');
  if(lanView){state.lanView=lanView.dataset.lanView||'';render();if(state.lanView==='servers'&&!state.serverCatalog&&!state.serverLoading)return multiplayer.refreshPublicServers();return true;}
  const serverCopy=target.closest<HTMLElement>('[data-server-copy]');
  if(serverCopy)return (async()=>{const entry=multiplayer.filteredServers()[Number(serverCopy.dataset.serverCopy)];if(!entry)return;try{await copy(entry.address);flash('服务器地址已复制，在游戏中选择“多人游戏 → 直接连接”粘贴。');}catch(error){flash(`复制失败：${error}`,'error');}})();
  const serverPage=target.closest<HTMLElement>('[data-server-page]');
  if(serverPage){state.serverPage=Math.max(0,Number(serverPage.dataset.serverPage));render();return true;}
  const copyIpv6=target.closest<HTMLElement>('[data-copy-ipv6]');
  if(copyIpv6&&state.lanRoom)return (async()=>{const address=state.lanAddresses[Number(copyIpv6.dataset.copyIpv6)],room=state.lanRoom;if(!address||!room)return;try{await copy(`[${address.address}]:${room.port}`);flash('房间地址已复制。');}catch(error){flash(`复制失败，请手动复制地址：${error}`,'error');}})();
  const action=target.closest<HTMLElement>('[data-action]')?.dataset.action;
  if(action==='refresh-public-servers')return multiplayer.refreshPublicServers();
  if(action==='refresh-ipv6')return multiplayer.refreshAddresses();
  if(action==='stop-ipv6-room')return multiplayer.stop();
  return false;
 };
}
