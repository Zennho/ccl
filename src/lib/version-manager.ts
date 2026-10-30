import type {GameVersion,JavaRuntime} from '../react/types';
interface State {gameDir:string;versions:GameVersion[];selected:string;online:boolean;page:string;loading:boolean;notice:string;noticeKind:string;javaLoading:boolean;javaRuntimes:JavaRuntime[]}
interface Options {state:State;render:()=>void;renderChrome:()=>void;persist:()=>void;loadCovers:()=>void;flash:(message:string,kind?:string)=>void;listVersions:(gameDir:string)=>Promise<GameVersion[]>;installed:(gameDir:string)=>Promise<GameVersion[]>;listJava:()=>Promise<JavaRuntime[]>}
export function createVersionManager({state,render,renderChrome,persist,loadCovers,flash,listVersions,installed,listJava}:Options) {
 async function refreshInstalled(dir:string) {
  if(dir!==state.gameDir)return;
  try {
   const versions=await installed(dir);if(dir!==state.gameDir)return;
   const byId=new Map(versions.map(v=>[v.id,v]));
   if(state.online){const known=new Set(state.versions.map(v=>v.id)),extra=versions.filter(v=>!known.has(v.id));
    state.versions=[...extra,...state.versions.map(v=>['正式版','快照版','旧版 Beta','旧版 Alpha','其他版本'].includes(v.kind)?{...v,installed:byId.has(v.id),isolated:!!byId.get(v.id)?.isolated,hasInstanceData:!!byId.get(v.id)?.hasInstanceData}:byId.get(v.id)).filter((v):v is GameVersion=>!!v)];
   } else state.versions=versions;
   if(!versions.some(v=>v.id===state.selected)){state.selected=versions[0]?.id||'';persist();}
   loadCovers();if(state.page==='versions'||state.page==='home')render();else renderChrome();
  } catch(error){if(dir===state.gameDir)flash(`无法刷新已安装版本：${error}`,'error');}
 }
 async function refreshJava() {
  state.javaLoading=true;if(state.page==='java')render();
  try{state.javaRuntimes=await listJava();}
  catch(error){state.notice=`检测 Java 失败：${error}`;state.noticeKind='error';}
  state.javaLoading=false;if(state.page==='java')render();
 }
 async function refresh() {
  state.loading=true;render();
  try{state.versions=await listVersions(state.gameDir);state.online=true;}
  catch(error){state.online=false;try{state.versions=await installed(state.gameDir);}catch{}state.notice=`无法获取官方版本列表：${error}`;state.noticeKind='error';}
  if(!state.versions.some(v=>v.id===state.selected&&v.installed))state.selected=state.versions.find(v=>v.installed)?.id||'';
  state.loading=false;persist();render();loadCovers();
 }
 return {refreshInstalled,refreshJava,refresh};
}
