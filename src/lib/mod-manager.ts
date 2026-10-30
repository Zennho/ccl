interface LocalMod { name:string; enabled:boolean }
type ModAction = 'delete' | 'enable' | 'disable';
interface ModState {
 page:string; contentTarget:string; gameDir:string; localMods:LocalMod[]; selectedMods:Set<string>;
 modWorking:boolean; modUpdates:unknown; modConflicts:unknown; contentResults:unknown[];
 notice:string; noticeKind:string;
}
interface Options {
 state:ModState; render:()=>void; search:()=>Promise<unknown>; flash:(message:string,kind?:string)=>void;
 list:(gameDir:string,version:string)=>Promise<LocalMod[]>;
 remove:(gameDir:string,version:string,name:string)=>Promise<unknown>;
 setEnabled:(gameDir:string,version:string,name:string,enabled:boolean)=>Promise<unknown>;
}
export function createModManager({state,render,search,flash,list,remove,setEnabled}:Options) {
 let epoch=0;
 async function refreshMods() {
  const version=state.contentTarget,gameDir=state.gameDir;
  if(!version){state.localMods=[];if(state.page==='content')render();return;}
  try {
   const mods=await list(gameDir,version);
   if(version===state.contentTarget&&gameDir===state.gameDir){
    state.localMods=mods;const names=new Set(mods.map(mod=>mod.name));
    for(const name of state.selectedMods)if(!names.has(name))state.selectedMods.delete(name);
   }
  } catch(error){if(version===state.contentTarget&&gameDir===state.gameDir){state.localMods=[];state.notice=`读取模组失败：${error}`;state.noticeKind='error';}}
  if(state.page==='content'&&version===state.contentTarget&&gameDir===state.gameDir)render();
 }
 async function applyModChanges(action:ModAction,names:string[]) {
  if(state.modWorking||!names.length)return;
  const version=state.contentTarget,gameDir=state.gameDir,chosen=state.localMods.filter(mod=>names.includes(mod.name));
  state.modWorking=true;epoch++;state.modUpdates=null;state.modConflicts=null;render();let done=0;const failed:string[]=[];
  for(const mod of chosen){
   if(action!=='delete'&&mod.enabled===(action==='enable'))continue;
   try {if(action==='delete')await remove(gameDir,version,mod.name);else await setEnabled(gameDir,version,mod.name,action==='enable');done++;}
   catch(error){failed.push(`${mod.name}：${error}`);}
  }
  state.modWorking=false;
  if(version===state.contentTarget&&gameDir===state.gameDir){state.selectedMods.clear();await refreshMods();if(action==='delete'&&state.contentResults.length)await search();}
  flash(failed.length?`已处理 ${done} 个，${failed.length} 个失败：${failed.join('；')}`:`已处理 ${done} 个模组。`,failed.length?'error':'');
 }
 return {refreshMods,applyModChanges,revision:()=>epoch,invalidate:()=>{epoch++;}};
}
