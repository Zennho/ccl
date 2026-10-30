type JobStatus = 'queued' | 'running' | 'canceling' | 'cancelled' | 'done' | 'failed';
interface InstallDraft { version:string; loader:string; addons:string[] }
export type Recipe = {type:'java';major:number} | {type:'game';draft:InstallDraft;gameDir:string;javaPath:string} | {type:'pack';kind:string;gameDir:string;version:string;source:string;projectId:string;packVersionId:string} | {type:'mod';gameDir:string;version:string;source:string;projectId:string;modVersionId:string} | {type:'modpack';gameDir:string;source:string;projectId:string;javaPath:string};
export interface JobSpec {key:string;kind:string;title:string;gameDir?:string;version?:string;recipe?:Recipe;run:((job:Job)=>Promise<unknown>)|null}
export interface Job extends JobSpec {id:string;status:JobStatus;message:string;current:number;total:number;error:string;metrics?:string;registered?:boolean;cancelRequested?:boolean;resultVersion?:string;lastSample?:{time:number;current:number;total:number}|null}
interface JobState {jobs:Job[];page:string;jobLimit:number;javaPath:string;gameDir:string;contentKey:string;javaRuntimes:unknown[]}
interface Dependencies {state:JobState;invoke:(command:string,args?:Record<string,unknown>)=>Promise<unknown>;persist:()=>void;renderChrome:()=>void;flash:(message:string,kind?:string)=>void;render:()=>void;refreshInstalled:(gameDir:string)=>Promise<unknown>;onJobFinished:(job:Job)=>Promise<unknown>;renderDownloads?:()=>void;storage?:Pick<Storage,'getItem'|'setItem'>}
export interface JobProgress {jobId:string;message:string;current:number;total:number}
// Download queue and persisted retry recipes. UI and Tauri operations are injected
// so the state machine can be exercised without a desktop runtime.
export function createJobManager({state, invoke, persist, renderChrome, flash, render, refreshInstalled, onJobFinished, renderDownloads = () => {}, storage = globalThis.localStorage}: Dependencies) {
function saveJobs() { try { storage.setItem('ccl-job-history',JSON.stringify(state.jobs.slice(-100).map(({id,key,kind,title,status,gameDir,version,recipe})=>({id,key,kind,title,status,gameDir,version,recipe})))); } catch {} }
function runnerFor(recipe:Recipe | undefined): ((job:Job)=>Promise<unknown>) | null {
 if(!recipe || typeof recipe!=='object') return null;
 if(recipe.type==='java') return async job=>{const java=await invoke('install_java',{major:recipe.major,jobId:job.id});if(!java||typeof java!=='object'||!('path' in java)||typeof java.path!=='string')throw new Error('Java 安装结果无效');if(state.javaPath==='java'||!state.javaPath){state.javaPath=java.path;persist();}};
 if(recipe.type==='game') return job=>runGameJob(job,recipe.draft,recipe.gameDir,recipe.javaPath);
 if(recipe.type==='pack' && ['resourcepack','shader'].includes(recipe.kind)) return job=>{const apiKey=recipe.source==='curseforge'?state.contentKey:'';if(recipe.source==='curseforge'&&!apiKey.trim())throw new Error('请先在内容页面重新输入 CurseForge API Key');return invoke('install_pack',{gameDir:recipe.gameDir,version:recipe.version,source:recipe.source,kind:recipe.kind,projectId:recipe.projectId,packVersionId:recipe.packVersionId,apiKey,jobId:job.id});};
 if(recipe.type==='mod' || recipe.type==='modpack') return job=>{const apiKey=recipe.source==='curseforge'?state.contentKey:'';if(recipe.source==='curseforge'&&!apiKey.trim()) throw new Error('请先在模组页面重新输入 CurseForge API Key');const args={gameDir:recipe.gameDir,source:recipe.source,projectId:recipe.projectId,apiKey,jobId:job.id};return recipe.type==='mod'?invoke('install_mod',{...args,version:recipe.version,modVersionId:recipe.modVersionId}):invoke('install_modpack',{...args,javaPath:recipe.javaPath});};
 return null;
}
function restoreJobs() { try { const list=JSON.parse(storage.getItem('ccl-job-history')||'[]');if(!Array.isArray(list))return;state.jobs=list.slice(-100).filter(j=>j && typeof j.title==='string' && typeof j.id==='string').map(j=>({...j,status:['queued','running','canceling'].includes(j.status)?'failed':j.status,message:['queued','running','canceling'].includes(j.status)?(j.recipe?'任务因启动器关闭而中断，请重试。':'任务因启动器关闭而中断，请重新添加。'):'上次运行的任务记录',error:'',current:0,total:0,run:runnerFor(j.recipe)})); } catch {} }
function renderJobList() { if(state.page==='downloads')renderDownloads();renderChrome(); }
function updateJob(job:Job, patch:Partial<Job>) { Object.assign(job,patch);if(state.page==='downloads')renderDownloads(); }

let jobSerial=0;
function hasJob(key:string) { return state.jobs.some(j=>j.key===key && (['queued','running','canceling'].includes(j.status))); }
function enqueueJob(spec:JobSpec) {
 if (hasJob(spec.key)) { flash('该项目已在下载任务中。'); return; }
 const job:Job={...spec,id:`job-${Date.now()}-${++jobSerial}`,status:'queued',message:'等待中',current:0,total:0,error:''};
 state.jobs.push(job); saveJobs();renderJobList(); flash(`已加入下载任务：${job.title}`); pumpJobs();
}
function pumpJobs() {
 while (state.jobs.filter(j=>j.status==='running'||j.status==='canceling').length < state.jobLimit) {
  const job=state.jobs.find(j=>j.status==='queued'); if (!job) break;
  job.status='running'; job.message='正在准备';saveJobs(); renderJobList();
  Promise.resolve().then(async()=>{ await invoke('begin_job',{jobId:job.id,gameDir:job.gameDir||null});job.registered=true;if(job.cancelRequested){await invoke('cancel_job',{jobId:job.id});throw new Error('任务已取消');}if(!job.run)throw new Error('任务不可重试');await job.run(job); }).then(()=>{ job.status='done'; job.message=job.kind==='export'?'导出完成':job.kind==='import'?'导入完成':'安装完成'; job.current=job.total; }).catch(e=>{ if(job.cancelRequested){job.status='cancelled';job.message='已取消';job.error='';} else {job.status='failed'; job.message=job.kind==='export'?'导出失败':job.kind==='import'?'导入失败':'安装失败'; job.error=String(e);} }).finally(async()=>{
   try {
    if(job.registered) {try {await invoke('end_job',{jobId:job.id});} catch(e) {flash(`任务清理失败：${e}`,'error');}}
    if (job.gameDir) await refreshInstalled(job.gameDir);
    if (job.kind==='java') { try { const runtimes=await invoke('list_java');state.javaRuntimes=Array.isArray(runtimes)?runtimes:[]; if(state.page==='java') render(); } catch {} }
    await onJobFinished(job);
   } catch(e) { flash(`任务刷新失败：${e}`,'error'); }
   finally { saveJobs();renderJobList();pumpJobs(); }
  });
 }
}
async function requestJobCancel(job:Job) {
 if(job.status==='queued'){job.status='cancelled';job.message='已取消';saveJobs();renderJobList();return;}
 if(job.status!=='running')return;
 job.cancelRequested=true;job.status='canceling';job.message='正在取消并清理…';saveJobs();renderJobList();
 if(job.registered){try{await invoke('cancel_job',{jobId:job.id});}catch(e){if(job.status==='canceling'){job.cancelRequested=false;job.status='running';job.message='取消失败，任务仍在进行';renderJobList();flash(`取消失败：${e}`,'error');}}}
}
function jobEvent(payload:JobProgress) {
 const job=state.jobs.find(j=>j.id===payload.jobId); if (!job || job.status!=='running') return;
 const current=Number(payload.current)||0,total=Number(payload.total)||0,now=Date.now();let metrics='';
 if((job.kind==='java' && payload.message==='正在下载 Java') || (['resourcepack','shader'].includes(job.kind) && payload.message==='正在下载资源包')) {
  const previous=job.lastSample;
  if(previous && now>previous.time && current>=previous.current && previous.total===total) { const speed=(current-previous.current)*1000/(now-previous.time);if(speed>0){const remaining=Math.max(0,Math.ceil((total-current)/speed));metrics=`${(speed/1048576).toFixed(2)} MB/s${total>0?` · 预计 ${remaining>=60?`${Math.floor(remaining/60)} 分 ${remaining%60} 秒`:`${remaining} 秒`}`:''}`;} }
  job.lastSample={time:now,current,total};
 } else job.lastSample=null;
 updateJob(job,{message:payload.message,current,total,metrics});
}
async function runGameJob(job:Job,draft:InstallDraft,gameDir:string,javaPath:string) {
 const selectedVersion=draft.version;
 await invoke('install_version',{version:selectedVersion,gameDir,jobId:job.id});
 if(job.cancelRequested) throw new Error('任务已取消');
 const result=draft.loader==='vanilla' ? selectedVersion : await invoke('install_loader',{gameVersion:selectedVersion,gameDir,loader:draft.loader,loaderVersion:null,javaPath,jobId:job.id});
 if(typeof result!=='string')throw new Error('游戏加载器安装结果无效');
 job.resultVersion=result;
 for (let i=0;i<draft.addons.length;i++) { if(job.cancelRequested) throw new Error('任务已取消'); updateJob(job,{message:`正在安装附加模组 ${draft.addons[i]}（${i+1}/${draft.addons.length}）`,current:0,total:0}); try { await invoke('install_mod',{gameDir,version:result,source:'modrinth',projectId:draft.addons[i],apiKey:'',modVersionId:null,jobId:job.id}); } catch(e) { if(job.cancelRequested) throw e; if(String(e).includes('该模组已安装到目标实例')) continue; throw `游戏和加载器已安装；附加模组 ${draft.addons[i]} 安装失败：${e}`; } }
}
function queueVersion(draft:InstallDraft) {
 const gameDir=state.gameDir,javaPath=state.javaPath,selectedVersion=draft.version;
 const recipe:Recipe={type:'game',draft,gameDir,javaPath};
 enqueueJob({key:`game:${gameDir}:${selectedVersion}:${draft.loader}`,kind:'game',title:`Minecraft ${selectedVersion}${draft.loader==='vanilla'?'':` · ${draft.loader}`}`,gameDir,recipe,run:runnerFor(recipe)});
}

function activeJobCount() { return state.jobs.filter(j => ['queued','running','canceling'].includes(j.status)).length; }
return { saveJobs, runnerFor, restoreJobs, renderJobList, hasJob, enqueueJob, pumpJobs, requestJobCancel, jobEvent, queueVersion, activeJobCount };
}
