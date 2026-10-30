export interface LocalSkin {data:string;path:string;name:string;model?:string}
interface State {page:string;localSkin:LocalSkin|null;skinModel:string}
interface Options {state:State;store:(mode:'get'|'put'|'delete',key:string,value?:unknown)=>Promise<unknown>;render:()=>void;renderChrome:()=>void;flash:(message:string,kind?:string)=>void}
const validAccount=(uuid:unknown):uuid is string=>typeof uuid==='string'&&/^[A-Za-z0-9_-]{1,64}$/.test(uuid);
const validSkin=(skin:unknown):skin is string=>typeof skin==='string'&&skin.length<=3*1024*1024&&skin.startsWith('data:image/png;base64,');
function isLocalSkin(value:unknown):value is LocalSkin {
 if(!value||typeof value!=='object')return false;
 const skin=value as Partial<LocalSkin>;
 return typeof skin.data==='string'&&skin.data.startsWith('data:image/png;base64,')&&typeof skin.path==='string'&&typeof skin.name==='string';
}
export function createAvatarStore({state,store,render,renderChrome,flash}:Options) {
 const cached=new Map<string,string>(),revisions=new Map<string,number>(),writes=new Map<string,Promise<unknown>>(),loads=new Map<string,Promise<void>>();
 let localRevision=0,localStorageTask:Promise<unknown>=Promise.resolve();
 function cacheOnlineAvatar(uuid:unknown,skin:unknown) {
  if(!validAccount(uuid))return;
  const valid=validSkin(skin);revisions.set(uuid,(revisions.get(uuid)||0)+1);
  if(valid)cached.set(uuid,skin);else cached.delete(uuid);
  const pending=(writes.get(uuid)||Promise.resolve()).catch(()=>{}).then(()=>store(valid?'put':'delete',`online-avatar:${uuid}`,valid?skin:undefined));
  writes.set(uuid,pending);void pending.catch(()=>{}).finally(()=>{if(writes.get(uuid)===pending)writes.delete(uuid);});
 }
 function restoreOnlineAvatar(uuid:unknown):Promise<void> {
  if(!validAccount(uuid)||cached.has(uuid))return Promise.resolve();
  const existing=loads.get(uuid);if(existing)return existing;
  const revision=revisions.get(uuid)||0;
  const pending=store('get',`online-avatar:${uuid}`).then(skin=>{
   if((revisions.get(uuid)||0)!==revision||!validSkin(skin))return;
   cached.set(uuid,skin);renderChrome();
  }).catch(()=>{}).finally(()=>{if(loads.get(uuid)===pending)loads.delete(uuid);});
  loads.set(uuid,pending);return pending;
 }
 function saveLocalSkin(skin:LocalSkin|null) {
  ++localRevision;
  localStorageTask=localStorageTask.catch(()=>{}).then(()=>store(skin?'put':'delete','local-skin',skin||undefined));
  void localStorageTask.catch(()=>flash('皮肤预览无法保存，重启后需要重新选择。','error'));
 }
 async function restoreLocalSkin() {
  const revision=localRevision;
  try {const skin=await store('get','local-skin');if(revision===localRevision&&isLocalSkin(skin)){state.localSkin=skin;state.skinModel=skin.model==='slim'?'slim':'classic';if(state.page==='account')render();else renderChrome();}}
  catch { /* Local preview remains optional when image storage is unavailable. */ }
 }
 return {cacheOnlineAvatar,restoreOnlineAvatar,saveLocalSkin,restoreLocalSkin,get:(uuid:string)=>cached.get(uuid)};
}
