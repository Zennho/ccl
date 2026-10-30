import type {PublicServer,ServerCatalog} from '../react/public-servers';
import type {NetworkAddress} from '../react/lan-room';
interface State {page:string;lanAddresses:NetworkAddress[];lanBusy:boolean;lanPort:string;lanTarget:string;lanTest:string;lanRoom:{port:number}|null;serverCatalog:ServerCatalog|null;serverQuery:string;serverStatus:string;serverLoading:boolean;serverError:string;serverPage:number}
interface Options {state:State;render:()=>void;flash:(message:string,kind?:string)=>void;getAddresses:()=>Promise<NetworkAddress[]>;getServers:()=>Promise<ServerCatalog>;startRoom:(port:number)=>Promise<number>;stopRoom:()=>Promise<unknown>;testConnection:(address:string)=>Promise<unknown>}
export async function copyText(value:string) {
 if(navigator.clipboard?.writeText)return navigator.clipboard.writeText(value);
 const input=document.createElement('textarea');input.value=value;input.style.position='fixed';input.style.opacity='0';document.body.appendChild(input);input.select();
 const ok=document.execCommand('copy');input.remove();if(!ok)throw new Error('复制失败');
}
export function createMultiplayer({state,render,flash,getAddresses,getServers,startRoom,stopRoom,testConnection}:Options) {
 async function refreshAddresses() {
  try {state.lanAddresses=await getAddresses();if(state.page==='multiplayer')render();}
  catch(error){flash(`读取 IPv6 地址失败：${error}`,'error');}
 }
 function filteredServers():PublicServer[] {
  const query=state.serverQuery.trim().toLowerCase(),list=Array.isArray(state.serverCatalog?.servers)?state.serverCatalog.servers:[];
  return list.filter(server=>server&&typeof server.address==='string'&&(!query||[server.name,server.address,server.version,server.description,...(Array.isArray(server.tags)?server.tags:[])].some(value=>String(value||'').toLowerCase().includes(query)))&&(state.serverStatus==='all'||server.status===state.serverStatus));
 }
 async function refreshPublicServers() {
  if(state.serverLoading)return;
  state.serverLoading=true;state.serverError='';if(state.page==='multiplayer')render();
  try {const data=await getServers();if(!data||!Array.isArray(data.servers))throw new Error('目录格式无效');state.serverCatalog=data;state.serverPage=0;}
  catch(error){state.serverError=String(error);}
  finally{state.serverLoading=false;if(state.page==='multiplayer')render();}
 }
 async function host(port:number){
  if(state.lanBusy||state.lanRoom)return;
  if(!Number.isInteger(port)||port<1||port>65535){flash('请输入 1–65535 的游戏局域网端口。','error');return;}
  state.lanPort=String(port);state.lanBusy=true;render();
  try{const relayPort=await startRoom(port);state.lanRoom={port:relayPort};await refreshAddresses();}
  catch(error){flash(`创建房间失败：${error}`,'error');}finally{state.lanBusy=false;render();}
 }
 async function test(address:string){
  if(state.lanBusy)return;state.lanTarget=address.trim();state.lanTest='';state.lanBusy=true;render();
  try{await testConnection(state.lanTarget);state.lanTest='TCP 连接成功；游戏能否加入还取决于版本、模组和服务器状态。';}
  catch(error){state.lanTest=String(error);}finally{state.lanBusy=false;render();}
 }
 async function stop(){
  if(state.lanBusy)return;state.lanBusy=true;render();try{await stopRoom();state.lanRoom=null;flash('房间已关闭。');}
  catch(error){flash(`关闭房间失败：${error}`,'error');}finally{state.lanBusy=false;render();}
 }
 return {refreshAddresses,filteredServers,refreshPublicServers,host,test,stop};
}
