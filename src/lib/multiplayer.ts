import type {PublicServer,ServerCatalog} from '../react/public-servers';
import type {NetworkAddress} from '../react/lan-room';
interface State {page:string;lanAddresses:NetworkAddress[];serverCatalog:ServerCatalog|null;serverQuery:string;serverStatus:string;serverLoading:boolean;serverError:string;serverPage:number}
interface Options {state:State;render:()=>void;flash:(message:string,kind?:string)=>void;getAddresses:()=>Promise<NetworkAddress[]>;getServers:()=>Promise<ServerCatalog>}
export async function copyText(value:string) {
 if(navigator.clipboard?.writeText)return navigator.clipboard.writeText(value);
 const input=document.createElement('textarea');input.value=value;input.style.position='fixed';input.style.opacity='0';document.body.appendChild(input);input.select();
 const ok=document.execCommand('copy');input.remove();if(!ok)throw new Error('复制失败');
}
export function createMultiplayer({state,render,flash,getAddresses,getServers}:Options) {
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
 return {refreshAddresses,filteredServers,refreshPublicServers};
}
