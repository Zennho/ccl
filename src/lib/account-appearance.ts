import type {MicrosoftAccount} from './account-restore';
import type {LocalSkin} from './avatar-store';
interface Cape {id:string;active:boolean;texture?:string|null}
interface Appearance {skin?:string|null;model:string;capes:Cape[]}
interface State {page:string;account:MicrosoftAccount|null;savedAccounts:MicrosoftAccount[];appearance:Appearance|null;localSkin:LocalSkin|null;localCape:{data?:string}|null;skinModel:string;previewCapeId:string}
interface Viewer {dispose():void;is2d?:boolean}
interface Options {
 state:State;container:HTMLElement;render:()=>void;renderChrome:()=>void;flash:(message:string,kind?:string)=>void;
 cacheAvatar:(uuid:string,skin:unknown)=>void;getAccounts:()=>Promise<unknown>;getAppearance:()=>Promise<Appearance>;
 createPreview:(canvas:HTMLCanvasElement,skin:string,cape:string|null,model:string)=>Promise<Viewer>;
}
export function createAccountAppearance({state,container,render,renderChrome,flash,cacheAvatar,getAccounts,getAppearance,createPreview}:Options) {
 let accountListRevision=0,viewer:Viewer|null=null,previewGeneration=0;
 let appearanceRequest:{account:MicrosoftAccount;promise:Promise<void>}|null=null;
 async function refreshAccountList() {
  const revision=++accountListRevision;
  try {const accounts=await getAccounts();if(revision!==accountListRevision)return;state.savedAccounts=Array.isArray(accounts)?accounts.filter(a=>typeof a?.uuid==='string'&&typeof a?.name==='string'):[];if(state.page==='account')render();}
  catch { /* Existing account remains usable when the credential store is unavailable. */ }
 }
 function refreshPreview() {
  const generation=++previewGeneration;
  if(viewer){viewer.dispose();viewer=null;}
  const canvas=container.querySelector<HTMLCanvasElement>('#skin-preview');if(!canvas)return;
  const cape=state.localCape?.data||state.appearance?.capes?.find(c=>c.id===state.previewCapeId)?.texture||null;
  const skin=state.localSkin?.data||state.appearance?.skin||null;
  if(!skin)return;
  void createPreview(canvas,skin,cape,state.skinModel).then(next=>{
   if(generation!==previewGeneration)next.dispose();
   else {viewer=next;if(next.is2d){const caption=container.querySelector('.preview-caption');if(caption)caption.textContent=`2D 预览 · ${state.localCape?'本地披风预览':state.previewCapeId?'账户披风预览':'无披风'}`;}}
  }).catch(()=>{if(generation===previewGeneration){const fallback=container.querySelector<HTMLElement>('.preview-fallback');if(fallback)fallback.hidden=false;}});
 }
 function refreshAppearance({reuse=false}:{reuse?:boolean}={}) {
  const account=state.account;if(!account?.uuid)return Promise.resolve();
  if(reuse&&appearanceRequest?.account===account)return appearanceRequest.promise;
  const request:{account:MicrosoftAccount;promise:Promise<void>}={account,promise:Promise.resolve()};appearanceRequest=request;
  request.promise=(async()=>{
   try {const result=await getAppearance();if(state.account!==account||appearanceRequest!==request)return;state.appearance=result;cacheAvatar(account.uuid,result.skin);if(!state.localSkin)state.skinModel=result.model==='slim'?'slim':'classic';state.previewCapeId=result.capes.find(c=>c.active)?.id||'';}
   catch(error){if(state.account!==account||appearanceRequest!==request)return;state.appearance=null;flash(`无法获取账户外观：${error}`,'error');}
   finally{if(appearanceRequest===request)appearanceRequest=null;}
   if(state.page==='account')render();else renderChrome();
  })();
  return request.promise;
 }
 return {refreshAccountList,refreshPreview,refreshAppearance};
}
