import type {ContentDraft,ContentHit} from './content-detail';
import type {Job,JobSpec,Recipe} from '../job-manager';
interface State {modDraft:ContentDraft|null;contentKind:string;contentSource:string;contentKey:string;gameDir:string;javaPath:string}
interface Options {
 state:State;render:()=>void;enqueue:(spec:JobSpec)=>void;runnerFor:(recipe:Recipe)=>((job:Job)=>Promise<unknown>)|null;openDetails:(item:ContentHit)=>Promise<unknown>;
 installModpack:(args:{gameDir:string;source:string;projectId:string;apiKey:string;javaPath:string;jobId:string})=>Promise<unknown>;
 installMod:(args:{gameDir:string;version:string;source:string;projectId:string;apiKey:string;modVersionId:string;jobId:string})=>Promise<unknown>;
}
export function createContentInstall({state,render,enqueue,runnerFor,openDetails,installModpack,installMod}:Options) {
 async function select(item:ContentHit,details:boolean) {
  const kind=state.contentKind,source=state.contentSource,apiKey=state.contentKey,gameDir=state.gameDir,javaPath=state.javaPath;
  if(kind==='modpack'&&!details){enqueue({key:`modpack:${source}:${item.id}:${gameDir}`,kind,title:item.title,gameDir,recipe:{type:'modpack',gameDir,source,projectId:item.id,javaPath},run:job=>installModpack({gameDir,source,projectId:item.id,apiKey,javaPath,jobId:job.id})});return;}
  await openDetails(item);
 }
 function close(){state.modDraft=null;render();}
 function confirm(versionId?:string){
  const draft=state.modDraft;if(!draft||draft.installed||(draft.kind!=='modpack'&&!versionId))return;
  state.modDraft=null;render();
  if(draft.kind==='modpack')enqueue({key:`modpack:${draft.source}:${draft.projectId}:${draft.gameDir}`,kind:'modpack',title:draft.title,gameDir:draft.gameDir,recipe:{type:'modpack',gameDir:draft.gameDir,source:draft.source,projectId:draft.projectId,javaPath:draft.javaPath},run:job=>installModpack({gameDir:draft.gameDir,source:draft.source,projectId:draft.projectId,apiKey:draft.apiKey,javaPath:draft.javaPath,jobId:job.id})});
  else if(draft.kind==='mod'&&versionId)enqueue({key:`mod:${draft.source}:${draft.projectId}:${draft.gameDir}:${draft.target}`,kind:'mod',title:`${draft.title} · ${draft.target}`,gameDir:draft.gameDir,version:draft.target,recipe:{type:'mod',gameDir:draft.gameDir,version:draft.target,source:draft.source,projectId:draft.projectId,modVersionId:versionId},run:job=>installMod({gameDir:draft.gameDir,version:draft.target,source:draft.source,projectId:draft.projectId,apiKey:draft.apiKey,modVersionId:versionId,jobId:job.id})});
  else if(versionId){const recipe:Recipe={type:'pack',kind:draft.kind,gameDir:draft.gameDir,version:draft.target,source:draft.source,projectId:draft.projectId,packVersionId:versionId};enqueue({key:`${draft.kind}:${draft.source}:${draft.projectId}:${draft.gameDir}:${draft.target}`,kind:draft.kind,title:`${draft.title} · ${draft.target}`,gameDir:draft.gameDir,version:draft.target,recipe,run:runnerFor(recipe)});}
 }
 return {select,close,confirm};
}
