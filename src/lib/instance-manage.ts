import type {GameVersion} from '../react/types';
export interface ManageItem {id?:string;scope?:string;world?:string;created?:number;size?:number;name?:string;folder?:string;gameVersion?:string;lastPlayed?:number;metadataError?:boolean}
export interface ManageView {kind:'backups'|'worlds';version:string;gameDir:string;name:string;isolated:boolean;items:ManageItem[];loading:boolean;busy:boolean;error:string;confirm:{action:'restore'|'delete';item:ManageItem}|null}
interface State {versions:GameVersion[];gameDir:string;manageView:ManageView|null;instanceView:unknown}
interface Options {state:State;render:()=>void;flash:(message:string,kind?:string)=>void;list:(kind:'backups'|'worlds',gameDir:string,version:string)=>Promise<unknown>;operation:(command:string,args:Record<string,unknown>)=>Promise<unknown>}
export function createInstanceManage({state,render,flash,list,operation}:Options) {
 async function load(view=state.manageView) {
  if(!view)return;view.loading=true;view.error='';render();
  try {const items=await list(view.kind,view.gameDir,view.version);if(state.manageView===view)view.items=Array.isArray(items)?items:[];}
  catch(error){if(state.manageView===view)view.error=String(error);}
  finally{if(state.manageView===view){view.loading=false;render();}}
 }
 async function open(kind:'backups'|'worlds',version:string,gameDir=state.gameDir) {
  const item=state.versions.find(v=>v.id===version&&v.installed);if(!item)return;
  const view:ManageView={kind,version,gameDir,name:item.name||version,isolated:!!item.isolated,items:[],loading:true,busy:false,error:'',confirm:null};
  state.instanceView=null;state.manageView=view;render();await load(view);
 }
 async function perform(command:string,args:Record<string,unknown>,success:string) {
  const view=state.manageView;if(!view||view.busy)return;view.busy=true;view.error='';render();
  try {await operation(command,{gameDir:view.gameDir,version:view.version,...args});if(state.manageView===view){view.confirm=null;flash(success);await load(view);}}
  catch(error){if(state.manageView===view)view.error=String(error);}
  finally{if(state.manageView===view){view.busy=false;render();}}
 }
 return {load,open,perform};
}
