export interface LocalPack {name:string;directory?:boolean;source?:string}
export interface ShaderEnvironment {loader?:string;detected?:string[];uncertain?:boolean}
interface State {
 contentKind:string;contentTarget:string;gameDir:string;localPacks:LocalPack[];packUpdates:unknown;packError:string;
 shaderEnv:ShaderEnvironment|null;shaderEnvError:string;packLoading:boolean;shaderEnvLoading:boolean;
}
interface Options {
 state:State;render:()=>void;
 list:(gameDir:string,version:string,kind:string)=>Promise<unknown>;
 environment:(gameDir:string,version:string)=>Promise<ShaderEnvironment>;
}
export function createPackManager({state,render,list,environment}:Options) {
 let epoch=0;
 async function refresh() {
  const kind=state.contentKind,version=state.contentTarget,gameDir=state.gameDir,request=++epoch;
  state.localPacks=[];state.packUpdates=null;state.packError='';state.shaderEnv=null;state.shaderEnvError='';
  if(!['resourcepack','shader'].includes(kind)||!version){state.packLoading=false;state.shaderEnvLoading=false;render();return;}
  state.packLoading=true;state.shaderEnvLoading=kind==='shader';render();
  const current=()=>request===epoch&&kind===state.contentKind&&version===state.contentTarget&&gameDir===state.gameDir;
  const packs=list(gameDir,version,kind).then(result=>{if(current())state.localPacks=Array.isArray(result)?result:[];}).catch(error=>{if(current())state.packError=String(error);}).finally(()=>{if(current()){state.packLoading=false;render();}});
  const env=kind==='shader'?environment(gameDir,version).then(result=>{if(current())state.shaderEnv=result;}).catch(error=>{if(current())state.shaderEnvError=String(error);}).finally(()=>{if(current()){state.shaderEnvLoading=false;render();}}):Promise.resolve();
  await Promise.all([packs,env]);
 }
 return {refresh,revision:()=>epoch,invalidate:()=>{epoch++;}};
}
