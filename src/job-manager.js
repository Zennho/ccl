// Download queue and persisted retry recipes. UI and Tauri operations are injected
// so the state machine can be exercised without a desktop runtime.
export function createJobManager({state, app, invoke, persist, esc, icon, hydrateIcons, renderChrome, flash, render, refreshInstalled, onJobFinished, storage = globalThis.localStorage}) {
function downloadsPage() {
 const running = state.jobs.filter(j=>j.status==='running'||j.status==='canceling').length;
 return `<div class="page-heading inner-heading"><div><h1>下载任务</h1><p class="job-summary">${running} 个任务进行中，最多同时运行 ${state.jobLimit} 个。</p></div><div class="heading-actions"><button class="outline-btn" data-action="cancel-all-jobs" ${activeJobCount()?'':'disabled'}>取消全部</button><button class="outline-btn" data-action="clear-jobs">清除已结束</button></div></div>
 <div class="job-settings"><label for="job-limit">同时运行任务</label><select id="job-limit">${[1,2,3,4,5].map(n=>`<option value="${n}" ${n===state.jobLimit?'selected':''}>${n} 个</option>`).join('')}</select><span>修改后对等待中的任务生效</span></div><div class="section-title"><div><h3>任务列表 <span class="count">${state.jobs.length}</span></h3></div></div><div id="job-list">${jobList()}</div>`;
}
function jobList() {
 if (!state.jobs.length) return `<div class="empty-state job-empty">${icon('download',27)}<strong>还没有下载任务</strong><p>选择游戏、Java 或模组后即可加入任务列表。</p></div>`;
 return state.jobs.slice().reverse().map(job => {
  const labels={queued:'等待中',running:'进行中',canceling:'正在取消',cancelled:'已取消',done:'已完成',failed:'失败'};
  const percent=job.total ? Math.min(100,Math.round(job.current/job.total*100)) : 0;
  return `<article class="job-card ${job.status}" data-job-id="${esc(job.id)}"><div class="job-top"><div class="job-icon">${icon(job.kind==='java' ? 'monitor' : job.kind==='mod' ? 'blocks' : 'box',18)}</div><div class="job-info"><strong>${esc(job.title)}</strong><small class="job-message">${esc(job.message || labels[job.status])}</small></div><span class="job-state">${labels[job.status]}</span></div><div class="job-progress-line"><div class="progress-track"><i class="job-track" style="width:${job.status==='done' ? 100 : percent}%"></i></div><span class="job-count">${jobCount(job)}</span></div><div class="job-metrics">${esc(job.metrics || '')}</div>${job.error ? `<p class="job-error">${esc(job.error)}</p>` : ''}${['queued','running','canceling','failed','cancelled','done'].includes(job.status) ? `<div class="job-actions">${['queued','running','canceling'].includes(job.status)?`<button class="row-button" data-cancel-job="${esc(job.id)}" ${job.status==='canceling'?'disabled':''}>${job.status==='canceling'?'正在取消…':'取消任务'}</button>`:''}${['failed','cancelled'].includes(job.status)&&job.run?`<button class="row-button" data-retry-job="${esc(job.id)}">${icon('refresh-cw',14)} 重试</button>`:''}${['failed','cancelled','done'].includes(job.status)?`<button class="row-button" data-remove-job="${esc(job.id)}">移除记录</button>`:''}</div>` : ''}</article>`;
 }).join('');
}
function jobCount(job) { if(!job.total) return job.status==='queued'?'排队中':job.status==='done'?'完成':'—'; return job.kind==='java' ? `${(job.current/1048576).toFixed(1)} / ${(job.total/1048576).toFixed(1)} MB` : `${job.current} / ${job.total} 项`; }
function saveJobs() { try { storage.setItem('ccl-job-history',JSON.stringify(state.jobs.slice(-100).map(({id,key,kind,title,status,gameDir,version,recipe})=>({id,key,kind,title,status,gameDir,version,recipe})))); } catch {} }
function runnerFor(recipe) {
 if(!recipe || typeof recipe!=='object') return null;
 if(recipe.type==='java') return async job=>{const java=await invoke('install_java',{major:recipe.major,jobId:job.id});if(state.javaPath==='java'||!state.javaPath){state.javaPath=java.path;persist();}};
 if(recipe.type==='game') return job=>runGameJob(job,recipe.draft,recipe.gameDir,recipe.javaPath);
 if(recipe.type==='mod' || recipe.type==='modpack') return job=>{const apiKey=recipe.source==='curseforge'?state.contentKey:'';if(recipe.source==='curseforge'&&!apiKey.trim()) throw new Error('请先在模组页面重新输入 CurseForge API Key');const args={gameDir:recipe.gameDir,source:recipe.source,projectId:recipe.projectId,apiKey,jobId:job.id};return recipe.type==='mod'?invoke('install_mod',{...args,version:recipe.version,modVersionId:recipe.modVersionId}):invoke('install_modpack',{...args,javaPath:recipe.javaPath});};
 return null;
}
function restoreJobs() { try { const list=JSON.parse(storage.getItem('ccl-job-history')||'[]');if(!Array.isArray(list))return;state.jobs=list.slice(-100).filter(j=>j && typeof j.title==='string' && typeof j.id==='string').map(j=>({...j,status:['queued','running','canceling'].includes(j.status)?'failed':j.status,message:['queued','running','canceling'].includes(j.status)?(j.recipe?'任务因启动器关闭而中断，请重试。':'任务因启动器关闭而中断，请重新添加。'):'上次运行的任务记录',error:'',current:0,total:0,run:runnerFor(j.recipe)})); } catch {} }
function renderJobList() { const summary=app.querySelector('.job-summary');if(summary)summary.textContent=`${state.jobs.filter(j=>j.status==='running'||j.status==='canceling').length} 个任务进行中，最多同时运行 ${state.jobLimit} 个。`;const list=app.querySelector('#job-list'); if (list) { list.innerHTML=jobList(); hydrateIcons(); } renderChrome(); }
function updateJob(job, patch) {
 Object.assign(job,patch);
 const card=app.querySelector(`[data-job-id="${job.id}"]`);
 if (card) { const message=card.querySelector('.job-message'); if (message) message.textContent=job.message || ''; const count=card.querySelector('.job-count'); if (count) count.textContent=jobCount(job); const metrics=card.querySelector('.job-metrics');if(metrics)metrics.textContent=job.metrics||''; const track=card.querySelector('.job-track'); if (track) track.style.width=job.total ? `${Math.min(100,Math.round(job.current/job.total*100))}%` : '0%'; }
}

let jobSerial=0;
function hasJob(key) { return state.jobs.some(j=>j.key===key && (['queued','running','canceling'].includes(j.status))); }
function enqueueJob(spec) {
 if (hasJob(spec.key)) { flash('该项目已在下载任务中。'); return; }
 const job={...spec,id:`job-${Date.now()}-${++jobSerial}`,status:'queued',message:'等待中',current:0,total:0,error:''};
 state.jobs.push(job); saveJobs();renderJobList(); flash(`已加入下载任务：${job.title}`); pumpJobs();
}
function pumpJobs() {
 while (state.jobs.filter(j=>j.status==='running'||j.status==='canceling').length < state.jobLimit) {
  const job=state.jobs.find(j=>j.status==='queued'); if (!job) break;
  job.status='running'; job.message='正在准备';saveJobs(); renderJobList();
  Promise.resolve().then(async()=>{ await invoke('begin_job',{jobId:job.id,gameDir:job.gameDir||null});job.registered=true;if(job.cancelRequested){await invoke('cancel_job',{jobId:job.id});throw new Error('任务已取消');}await job.run(job); }).then(()=>{ job.status='done'; job.message=job.kind==='export'?'导出完成':job.kind==='import'?'导入完成':'安装完成'; job.current=job.total; }).catch(e=>{ if(job.cancelRequested){job.status='cancelled';job.message='已取消';job.error='';} else {job.status='failed'; job.message=job.kind==='export'?'导出失败':job.kind==='import'?'导入失败':'安装失败'; job.error=String(e);} }).finally(async()=>{
   try {
    if(job.registered) {try {await invoke('end_job',{jobId:job.id});} catch(e) {flash(`任务清理失败：${e}`,'error');}}
    if (job.gameDir) await refreshInstalled(job.gameDir);
    if (job.kind==='java') { try { state.javaRuntimes=await invoke('list_java'); if(state.page==='java') render(); } catch {} }
    await onJobFinished(job);
   } catch(e) { flash(`任务刷新失败：${e}`,'error'); }
   finally { saveJobs();renderJobList();pumpJobs(); }
  });
 }
}
async function requestJobCancel(job) {
 if(job.status==='queued'){job.status='cancelled';job.message='已取消';saveJobs();renderJobList();return;}
 if(job.status!=='running')return;
 job.cancelRequested=true;job.status='canceling';job.message='正在取消并清理…';saveJobs();renderJobList();
 if(job.registered){try{await invoke('cancel_job',{jobId:job.id});}catch(e){if(job.status==='canceling'){job.cancelRequested=false;job.status='running';job.message='取消失败，任务仍在进行';renderJobList();flash(`取消失败：${e}`,'error');}}}
}
function jobEvent(payload) {
 const job=state.jobs.find(j=>j.id===payload.jobId); if (!job || job.status!=='running') return;
 const current=Number(payload.current)||0,total=Number(payload.total)||0,now=Date.now();let metrics='';
 if(job.kind==='java' && payload.message==='正在下载 Java' && total>0) {
  const previous=job.lastSample;
  if(previous && now>previous.time && current>=previous.current && previous.total===total) { const speed=(current-previous.current)*1000/(now-previous.time);if(speed>0){const remaining=Math.max(0,Math.ceil((total-current)/speed));metrics=`${(speed/1048576).toFixed(2)} MB/s · 预计 ${remaining>=60?`${Math.floor(remaining/60)} 分 ${remaining%60} 秒`:`${remaining} 秒`}`;} }
  job.lastSample={time:now,current,total};
 } else job.lastSample=null;
 updateJob(job,{message:payload.message,current,total,metrics});
}
async function runGameJob(job,draft,gameDir,javaPath) {
 const selectedVersion=draft.version;
 await invoke('install_version',{version:selectedVersion,gameDir,jobId:job.id});
 if(job.cancelRequested) throw new Error('任务已取消');
 const result=draft.loader==='vanilla' ? selectedVersion : await invoke('install_loader',{gameVersion:selectedVersion,gameDir,loader:draft.loader,loaderVersion:null,javaPath,jobId:job.id});
 job.resultVersion=result;
 for (let i=0;i<draft.addons.length;i++) { if(job.cancelRequested) throw new Error('任务已取消'); updateJob(job,{message:`正在安装附加模组 ${draft.addons[i]}（${i+1}/${draft.addons.length}）`,current:0,total:0}); try { await invoke('install_mod',{gameDir,version:result,source:'modrinth',projectId:draft.addons[i],apiKey:'',modVersionId:null,jobId:job.id}); } catch(e) { if(job.cancelRequested) throw e; if(String(e).includes('该模组已安装到目标实例')) continue; throw `游戏和加载器已安装；附加模组 ${draft.addons[i]} 安装失败：${e}`; } }
}
function queueVersion(draft) {
 const gameDir=state.gameDir,javaPath=state.javaPath,selectedVersion=draft.version;
 const recipe={type:'game',draft,gameDir,javaPath};
 enqueueJob({key:`game:${gameDir}:${selectedVersion}:${draft.loader}`,kind:'game',title:`Minecraft ${selectedVersion}${draft.loader==='vanilla'?'':` · ${draft.loader}`}`,gameDir,recipe,run:runnerFor(recipe)});
}

function activeJobCount() { return state.jobs.filter(j => ['queued','running','canceling'].includes(j.status)).length; }
return { downloadsPage, saveJobs, runnerFor, restoreJobs, renderJobList, hasJob, enqueueJob, pumpJobs, requestJobCancel, jobEvent, queueVersion, activeJobCount };
}
