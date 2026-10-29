import './style.css';
import './journal-theme.css';
import './multiplayer.css';
import './custom-theme.css';
import './launch-screen.css';
import './management.css';
import './update.css';
import { createJobManager } from './job-manager.js';
import { version as appVersion } from '../package.json';
import { open as openDialog, save as saveDialog } from '@tauri-apps/plugin-dialog';
import { createIcons, Blocks, Box, ChevronDown, ChevronRight, CircleHelp, Compass, Download, FolderOpen, Gamepad2, Globe2, HardDrive, Layers3, LayoutGrid, Monitor, MoreHorizontal, Play, RefreshCw, Settings2, ShieldCheck, UserRound, X, Zap, Minus, Square, ListChecks } from 'lucide';
import { invoke, isTauri } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';

const icons = { Blocks, Box, ChevronDown, ChevronRight, CircleHelp, Compass, Download, FolderOpen, Gamepad2, Globe2, HardDrive, Layers3, LayoutGrid, Monitor, MoreHorizontal, Play, RefreshCw, Settings2, ShieldCheck, UserRound, X, Zap, Minus, Square, ListChecks };
let saved = {};
try { saved = JSON.parse(localStorage.getItem('ccl-settings') || '{}') || {}; } catch { /* Recover from damaged local settings. */ }
const state = { page: 'home', lanView: 'room', serverCatalog: null, serverLoading: false, serverError: '', serverQuery: '', serverStatus: 'all', serverPage: 0, lanAddresses: [], lanRoom: null, lanBusy: false, lanPort: '', lanTarget: '', lanTest: '', versions: [], selected: saved.selected || '', username: saved.username || 'Player', javaPath: saved.javaPath || 'java', proxyUrl: saved.proxyUrl || '', gameDir: saved.gameDir || '', memory: saved.memory || 4096, memoryMode: saved.memoryMode === 'auto' ? 'auto' : saved.memoryMode === 'manual' || saved.memory != null ? 'manual' : 'auto', memoryInfo: null, memoryInfoError: '', memoryInfoLoading: false, optimize: saved.optimize !== false, jvmArgs: saved.jvmArgs || '', gameArgs: saved.gameArgs || '', contentTarget: '', modDraft: null, archiveDraft: null, launchView: null, crash: null, crashDialog: null, noticeCrash: false, versionQuery: '', accountMode: 'offline', accountKnown: saved.accountKnown===true, accountName: typeof saved.accountName==='string'?saved.accountName:'', accountPreference: saved.accountMode==='offline'?'offline':'microsoft', accountRestoring: false, accountRestoreError: '', restoreAttempt: null, account: null, browserPrompt: null, loginAttempt: null, accountBusy: false, appearance: null, localSkin: null, localCape: null, previewCapeId: '', skinModel: 'classic', loading: false, notice: '', noticeKind: '', online: false, javaRuntimes: [], javaLoading: false, javaDelete: null, versionDelete: null, instanceView: null, manageView: null, themeView: null, profileView: null, versionDeleting: false, contentSource: 'modrinth', contentKind: 'mod', contentQuery: '', contentKey: '', contentSort: 'downloads', contentCategory: '', contentCategories: [], contentCategoriesLoading: false, contentCategoryError: '', contentGameFilter: '', contentLoaderFilter: '', contentEnvironment: '', contentPage: 0, contentHasMore: false, contentLoaded: false, contentError: '', contentResults: [], contentBusy: false, updateState: 'idle', updateInfo: null, updateError: '', updateDismissed: '', localPacks: [], packQuery: '', packLoading: false, packError: '', packWorking: false, packChecking: false, packUpdates: null, packDelete: null, shaderEnv: null, shaderEnvLoading: false, shaderEnvError: '', localMods: [], modQuery: '', modFilter: 'all', selectedMods: new Set(), modWorking: false, modChecking: false, modConflicts: null, modConflictsLoading: false, modUpdates: null, modDelete: null, jobs: [], jobLimit: Math.max(1, Math.min(5, Number(saved.jobLimit) || 3)), installDraft: null };
const appearanceDefaults = { bannerOpacity: 0, bannerFrost: 0, bannerBlur: 0, backgroundOpacity: 35, backgroundFrost: 42, backgroundBlur: 8 };
const clampAppearance = (value, fallback, max = 100) => Number.isFinite(Number(value)) ? Math.max(0, Math.min(max, Number(value))) : fallback;
const theme = { bannerOpacity: clampAppearance(saved.theme?.bannerOpacity, 0), bannerFrost: clampAppearance(saved.theme?.bannerFrost, 0), bannerBlur: clampAppearance(saved.theme?.bannerBlur, 0, 30), backgroundOpacity: clampAppearance(saved.theme?.backgroundOpacity, 35), backgroundFrost: clampAppearance(saved.theme?.backgroundFrost, 42), backgroundBlur: clampAppearance(saved.theme?.backgroundBlur, 8, 30), banner: null, background: null };
const app = document.querySelector('#app');
const instanceColors=['#76956d','#6d91a3','#a68072','#9b83a9','#c29d63','#7f8a78'];
let instanceThemes={};
try{const value=JSON.parse(localStorage.getItem('ccl-instance-themes')||'{}');if(value&&typeof value==='object'&&!Array.isArray(value))instanceThemes=value;}catch{}
const instanceCovers=new Map();
const instanceCoverPending=new Map();
const instanceCoverRevision=new Map();
let instanceCoverRenderTimer=null;
function scheduleInstanceCoverRender(){if(instanceCoverRenderTimer!==null)return;instanceCoverRenderTimer=setTimeout(()=>{instanceCoverRenderTimer=null;if(state.page==='home'||state.page==='versions')render();},50);}
const instanceKey=(gameDir,version)=>JSON.stringify([gameDir,version]);
function getInstanceTheme(gameDir,version){const entry=instanceThemes[instanceKey(gameDir,version)];return {color:instanceColors.includes(entry?.color)?entry.color:instanceColors[0],description:typeof entry?.description==='string'?entry.description.slice(0,180):'',hasCover:entry?.hasCover===true};}
function currentInstanceCover(){return instanceCovers.get(instanceKey(state.gameDir,state.selected))||null;}
async function loadInstanceCover(gameDir,version){
 if(!gameDir||!version)return;
 const key=instanceKey(gameDir,version);if(!getInstanceTheme(gameDir,version).hasCover||instanceCovers.has(key))return;
 if(instanceCoverPending.has(key))return instanceCoverPending.get(key);
 const revision=instanceCoverRevision.get(key)||0;
 const pending=imageStore('get',`instance-cover:${key}`).then(blob=>{if(!blob||revision!==(instanceCoverRevision.get(key)||0)||!getInstanceTheme(gameDir,version).hasCover)return;const old=instanceCovers.get(key);if(old)URL.revokeObjectURL(old);instanceCovers.set(key,URL.createObjectURL(blob));if(state.gameDir===gameDir&&state.selected===version)applyTheme();scheduleInstanceCoverRender();}).catch(()=>{}).finally(()=>instanceCoverPending.delete(key));
 instanceCoverPending.set(key,pending);return pending;
}
function loadInstalledCovers(){for(const v of state.versions.filter(v=>v.installed))void loadInstanceCover(state.gameDir,v.id);}
function themeDialog(){
 const d=state.themeView;if(!d)return '';const cover=d.preview||(!d.removeCover?instanceCovers.get(instanceKey(d.gameDir,d.version)):null);
 return `<div class="install-overlay"><section class="install-dialog instance-theme-dialog" role="dialog" aria-modal="true" aria-labelledby="instance-theme-title"><div class="install-dialog-head"><div><span class="section-index">INSTANCE / APPEARANCE</span><h2 id="instance-theme-title">实例主题</h2><p>${esc(d.name)} · 为这个版本设置封面、颜色和简介。</p></div><button class="icon-button" data-action="close-instance-theme" aria-label="关闭" ${d.saving?'disabled':''}>${icon('x',19)}</button></div><div class="instance-theme-preview" style="--instance-color:${esc(d.color)}">${cover?`<img src="${esc(cover)}" alt="实例封面预览">`:`<span>${icon('layers-3',28)}</span>`}<strong>${esc(d.name)}</strong></div><div class="theme-image-actions"><label class="outline-btn theme-upload">选择封面<input type="file" data-instance-cover accept="image/png,image/jpeg,image/webp" ${d.saving?'disabled':''}></label><button type="button" class="text-link" data-action="remove-instance-cover" ${d.saving?'disabled':''}>移除封面</button></div><p class="manage-note">选中实例后，封面会用于主页横幅和启动唱片；未设置时使用全局横幅。</p><div class="instance-theme-field"><strong>主题颜色</strong><div class="instance-color-options">${instanceColors.map(color=>`<button type="button" class="instance-color ${d.color===color?'selected':''}" data-instance-color="${color}" style="--instance-color:${color}" aria-label="选择 ${color}" aria-pressed="${d.color===color}"></button>`).join('')}</div></div><label class="instance-theme-field"><strong>实例简介</strong><textarea id="instance-description" maxlength="180" placeholder="记录这个世界或整合包的特色" ${d.saving?'disabled':''}>${esc(d.description)}</textarea></label>${d.error?`<p class="manage-error">${esc(d.error)}</p>`:''}<div class="install-actions"><button class="outline-btn" data-action="close-instance-theme" ${d.saving?'disabled':''}>取消</button><button class="save-button" data-action="save-instance-theme" ${d.saving?'disabled':''}>${d.saving?'保存中…':'保存主题'}</button></div></section></div>`;
}

function playTime(seconds){const minutes=Math.floor(Math.max(0,Number(seconds)||0)/60),hours=Math.floor(minutes/60);return hours?`${hours} 小时 ${minutes%60} 分钟`:`${minutes} 分钟`;}
function profileDialog(){
 const d=state.profileView;if(!d)return '';const stats=d.stats||{};
 const date=value=>{const n=Number(value);return value&&Number.isFinite(n)?new Date(n*1000).toLocaleString():'暂无记录';};
 return `<div class="install-overlay"><section class="install-dialog profile-dialog" role="dialog" aria-modal="true" aria-labelledby="profile-title"><div class="install-dialog-head"><div><span class="section-index">INSTANCE / JOURNAL</span><h2 id="profile-title">游戏档案</h2><p>${esc(d.name)} · 游戏进程结束后更新游玩时长。</p></div><button class="icon-button" data-action="close-game-profile" aria-label="关闭">${icon('x',19)}</button></div><div class="profile-stats"><div><small>累计游玩</small><strong>${esc(playTime(stats.seconds))}</strong></div><div><small>启动次数</small><strong>${esc(stats.launches||0)}</strong></div><div><small>最近启动</small><strong>${esc(date(stats.lastStarted))}</strong></div><div><small>上次运行</small><strong>${stats.lastDuration!=null?esc(playTime(stats.lastDuration)):'暂无记录'}</strong></div></div>${d.statsError?`<p class="manage-error">游戏记录读取失败：${esc(d.statsError)}</p>`:''}<div class="profile-gallery-heading"><div><strong>游戏截图</strong><small>${d.isolated?'此实例的截图目录':'共用游戏目录中的截图，可能来自其他版本'}</small></div><div class="profile-gallery-actions"><button class="outline-btn" data-action="refresh-game-profile" ${d.loading?'disabled':''}>刷新</button><button class="outline-btn" data-action="open-screenshot-folder">打开截图文件夹</button></div></div>${d.error?`<p class="manage-error">${esc(d.error)}</p>`:''}<div class="profile-gallery">${d.loading?'<div class="empty-state">正在读取截图…</div>':d.shots.length?d.shots.map((shot,i)=>`<button class="profile-shot" data-profile-shot="${i}" aria-label="查看 ${esc(shot.name)}"><span>加载中…</span><img data-profile-image="${i}" alt="" hidden><small>${esc(shot.name)}</small></button>`).join(''):'<div class="empty-state"><strong>还没有截图</strong><p>在游戏中按 F2 截图后，可在这里查看。</p></div>'}</div><div class="content-pagination"><span>第 ${d.page+1} 页</span><div><button class="outline-btn" data-profile-page="${d.page-1}" ${d.loading||d.page===0?'disabled':''}>上一页</button><button class="outline-btn" data-profile-page="${d.page+1}" ${d.loading||!d.hasMore?'disabled':''}>下一页</button></div></div>${d.preview?`<div class="profile-lightbox" role="dialog" aria-label="截图预览"><button class="icon-button" data-action="close-profile-preview" aria-label="关闭预览">${icon('x',19)}</button><img src="${esc(d.preview.data)}" alt="${esc(d.preview.name)}"><span>${esc(d.preview.name)}</span></div>`:''}<div class="install-actions"><button class="outline-btn" data-action="close-game-profile">关闭</button></div></section></div>`;
}
async function loadProfileScreenshots(d){
 const generation=++d.generation,page=d.page;d.loading=true;d.error='';d.shots=[];d.images={};d.imageErrors={};renderOverlay();
 try{const result=await invoke('list_game_screenshots',{gameDir:d.gameDir,version:d.version,page});if(state.profileView!==d||generation!==d.generation)return;d.shots=Array.isArray(result?.items)?result.items:[];d.hasMore=!!result?.hasMore;d.isolated=!!result?.isolated;}
 catch(e){if(state.profileView===d&&generation===d.generation){d.error=String(e);d.hasMore=false;}}
 finally{if(state.profileView===d&&generation===d.generation){d.loading=false;renderOverlay();void hydrateProfileImages(d,generation);}}
}
function paintProfileImages(d){for(const [i,url] of Object.entries(d.images)){const image=app.querySelector(`[data-profile-image="${i}"]`);if(image){image.src=url;image.hidden=false;image.previousElementSibling.hidden=true;}}for(const i of Object.keys(d.imageErrors||{})){const image=app.querySelector(`[data-profile-image="${i}"]`);d.imageErrors[i]=true;if(image?.previousElementSibling)image.previousElementSibling.textContent='无法预览';}}
async function hydrateProfileImages(d,generation){
 if(d.loadingGeneration===generation)return;d.loadingGeneration=generation;
 let next=0;const worker=async()=>{while(next<d.shots.length){const i=next++,shot=d.shots[i];try{const data=await invoke('game_screenshot',{gameDir:d.gameDir,version:d.version,name:shot.name});if(state.profileView!==d||generation!==d.generation)return;if(typeof data!=='string'||!data.startsWith('data:image/png;base64,'))throw new Error('截图不可用');d.images[i]=data;const image=app.querySelector(`[data-profile-image="${i}"]`);if(image){image.src=data;image.hidden=false;image.previousElementSibling.hidden=true;}}catch{if(state.profileView!==d||generation!==d.generation)return;const image=app.querySelector(`[data-profile-image="${i}"]`);if(image?.previousElementSibling)image.previousElementSibling.textContent='无法预览';}}};await Promise.all(Array.from({length:Math.min(3,d.shots.length)},worker));if(d.loadingGeneration===generation)d.loadingGeneration=null;
}
async function openGameProfile(version){const item=state.versions.find(v=>v.id===version&&v.installed);if(!item)return;const d={version,gameDir:state.gameDir,name:item.name||version,isolated:!!item.isolated,stats:null,statsError:'',page:0,shots:[],images:{},imageErrors:{},generation:0,hasMore:false,loading:true,error:'',preview:null};state.profileView=d;renderOverlay();void invoke('play_stats',{gameDir:d.gameDir,version}).then(stats=>{if(state.profileView===d){d.stats=stats||{};renderOverlay();}}).catch(e=>{if(state.profileView===d){d.statsError=String(e);renderOverlay();}});await loadProfileScreenshots(d);}

function bannerPeriod(date = new Date()) {
 const hour=date.getHours();
 return hour>=6 && hour<17 ? 'day' : hour>=17 && hour<19 ? 'sunset' : 'night';
}
function updateDefaultBanner() {
 document.documentElement.dataset.bannerPeriod=bannerPeriod();
}
function applyTheme() {
 const root=document.documentElement;
 root.style.setProperty('--ccl-instance-accent', getInstanceTheme(state.gameDir,state.selected).color);
 root.style.setProperty('--ccl-banner-opacity', String(1-theme.bannerOpacity/100));
 root.style.setProperty('--ccl-banner-frost', String(theme.bannerFrost/100));
 root.style.setProperty('--ccl-banner-blur', `${theme.bannerBlur}px`);
 root.style.setProperty('--ccl-background-opacity', String(1-theme.backgroundOpacity/100));
 root.style.setProperty('--ccl-background-frost', String(theme.backgroundFrost/100));
 root.style.setProperty('--ccl-background-blur', `${theme.backgroundBlur}px`);
 const banner=currentInstanceCover() || theme.banner;
 root.style.setProperty('--ccl-banner-image', banner ? `url("${banner}")` : 'var(--ccl-default-banner)');
 root.style.setProperty('--ccl-background-image', theme.background ? `url("${theme.background}")` : 'none');
 root.classList.toggle('has-custom-background', !!theme.background);
 root.classList.toggle('has-custom-banner', !!banner);
}
function imageStore(mode, key, value) {
 return new Promise((resolve,reject)=>{
  if(!window.indexedDB) return reject(new Error('本设备不支持保存自定义图片'));
  const open=indexedDB.open('ccl-appearance',1);
  open.onupgradeneeded=()=>open.result.createObjectStore('images');
  open.onerror=()=>reject(open.error || new Error('无法打开图片存储'));
  open.onsuccess=()=>{
   const db=open.result, tx=db.transaction('images', mode==='get'?'readonly':'readwrite'), store=tx.objectStore('images');
   const request=mode==='get'?store.get(key):mode==='put'?store.put(value,key):store.delete(key);
   let result;request.onsuccess=()=>{result=request.result;};
   tx.oncomplete=()=>{db.close();resolve(result);};
   tx.onerror=()=>{db.close();reject(tx.error || new Error('无法保存图片'));};
   tx.onabort=()=>{db.close();reject(tx.error || new Error('图片保存已中止'));};
  };
 });
}
const imageRevision={banner:0,background:0};
function setThemeImage(kind, blob) {
 if(theme[kind]) URL.revokeObjectURL(theme[kind]);
 theme[kind]=blob ? URL.createObjectURL(blob) : null;
 applyTheme();
}
async function restoreThemeImages() {
 await Promise.all(['banner','background'].map(async kind=>{
  const revision=imageRevision[kind];
  try { const blob=await imageStore('get',kind);if(revision===imageRevision[kind] && blob) setThemeImage(kind,blob); }
  catch { /* The default theme remains available when storage is unavailable. */ }
 }));
}
function validateThemeImage(file) {
 if(!['image/png','image/jpeg','image/webp'].includes(file.type)) return Promise.reject(new Error('请选择 PNG、JPEG 或 WebP 图片'));
 if(file.size>20*1024*1024) return Promise.reject(new Error('图片不能超过 20 MB'));
 return new Promise((resolve,reject)=>{
  const url=URL.createObjectURL(file), image=new Image();
  image.onload=()=>{URL.revokeObjectURL(url);image.naturalWidth && image.naturalHeight ? resolve() : reject(new Error('图片无法读取'));};
  image.onerror=()=>{URL.revokeObjectURL(url);reject(new Error('图片无法读取'));};
  image.src=url;
 });
}
function appearanceSettings() {
 const slider=(key,label,max,unit)=>`<div class="theme-control"><label for="theme-${key}">${label}<output>${theme[key]}${unit}</output></label><input id="theme-${key}" data-theme-setting="${key}" type="range" min="0" max="${max}" value="${theme[key]}"></div>`;
 return `<section class="settings-section theme-settings"><div class="settings-heading"><div class="settings-icon">${icon('layout-grid',20)}</div><div><span class="section-index">APPEARANCE</span><h3>界面外观</h3><p>选择本地图片，自定义启动器的视觉效果。</p></div></div><div class="theme-grid"><div class="theme-card"><div class="theme-card-head"><div><strong>主界面横幅</strong><p>建议使用横向图片。</p></div><span>01</span></div><div class="theme-preview theme-preview-banner" aria-label="横幅预览"><span class="theme-preview-underlay"></span><i></i><div class="theme-preview-banner-image"></div></div><div class="theme-image-actions"><label class="outline-btn theme-upload">选择图片<input type="file" data-theme-image="banner" accept="image/png,image/jpeg,image/webp"></label><button type="button" class="text-link" data-theme-reset="banner">恢复默认</button></div>${slider('bannerOpacity','图片透明度',100,'%')}${slider('bannerFrost','磨砂强度',100,'%')}${slider('bannerBlur','图片模糊',30,' px')}</div><div class="theme-card"><div class="theme-card-head"><div><strong>全局背景</strong><p>图片将显示在整个界面底层。</p></div><span>02</span></div><div class="theme-preview theme-preview-background" aria-label="背景预览"><div></div><i></i></div><div class="theme-image-actions"><label class="outline-btn theme-upload">选择图片<input type="file" data-theme-image="background" accept="image/png,image/jpeg,image/webp"></label><button type="button" class="text-link" data-theme-reset="background">恢复默认</button></div>${slider('backgroundOpacity','图片透明度',100,'%')}${slider('backgroundFrost','磨砂强度',100,'%')}${slider('backgroundBlur','背景模糊',30,' px')}</div></div><p class="theme-footnote">调整即时生效并保存在本设备。支持 PNG、JPEG、WebP，单张图片不超过 20 MB。</p></section>`;
}
function memoryInfoMarkup() {
 const info=state.memoryInfo;
 const detail=state.memoryInfoLoading?'正在检测设备内存…':state.memoryInfoError?`内存检测失败：${esc(state.memoryInfoError)}`:info?`设备内存 ${esc(info.totalMb)} MB · 当前可用 ${esc(info.availableMb)} MB<br>${info.recommendedMb?`当前自动上限约 ${esc(info.recommendedMb)} MB`:'可用内存不足，自动模式暂不可用'}`:'尚未检测设备内存';
 return `<div class="memory-info"><span>${detail}</span><button class="text-link" type="button" data-action="refresh-memory-info" ${state.memoryInfoLoading?'disabled':''}>刷新</button></div>`;
}
async function refreshMemoryInfo() {
 if(state.memoryInfoLoading || !isTauri()) return;
 state.memoryInfoLoading=true;state.memoryInfoError='';
 const update=()=>{const el=app.querySelector('#memory-info');if(el)el.innerHTML=memoryInfoMarkup();};
 update();
 try {
  const info=await invoke('memory_info');
  if(!info || !Number.isFinite(info.totalMb) || !Number.isFinite(info.availableMb)) throw new Error('内存信息不可用');
  state.memoryInfo=info;
 } catch(e) { state.memoryInfo=null;state.memoryInfoError=String(e); }
 finally {state.memoryInfoLoading=false;update();}
}
function syncMemoryControls() {
 const mode=app.querySelector('#memory-mode'), manual=app.querySelector('#memory-manual');
 if(mode && manual) manual.hidden=mode.value!=='manual';
 const value=app.querySelector('#memory'), slider=app.querySelector('#memory-range');
 if(mode && value) value.disabled=mode.value!=='manual';
 if(mode && slider) slider.disabled=mode.value!=='manual';
 if(value && slider && value.value) slider.value=value.value;
}

function hydrateIcons() { createIcons({ icons }); app.querySelectorAll('svg[data-lucide]').forEach(el => el.removeAttribute('data-lucide')); }
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const icon = (name, size = 18) => `<i data-lucide="${name}" width="${size}" height="${size}"></i>`;
function versionIcon(version, className='row-icon') {
 const badges={Fabric:'F',Forge:'FG',NeoForge:'NF',Quilt:'Q','整合包':'包'};
 const kind=version?.kind || '正式版',badge=badges[kind],instance=version?.id?getInstanceTheme(state.gameDir,version.id):null,cover=version?.id?instanceCovers.get(instanceKey(state.gameDir,version.id)):null;
 return `<div style="--instance-color:${esc(instance?.color || instanceColors[0])}" class="${className} game-version-icon" title="${esc(kind)}" aria-label="${esc(kind)}"><svg viewBox="0 0 32 32" aria-hidden="true"><path fill="#876045" d="M3 9 16 3l13 6v14l-13 7L3 23z"/><path fill="#6c4b38" d="M16 15 29 9v14l-13 7z"/><path fill="#95b86c" d="M3 9 16 3l13 6-13 6z"/><path fill="#779f5d" d="M3 9 16 15v5l-4-2v-2l-3-1v2l-3-2v-2l-3-1z"/><path fill="#658954" d="M16 15 29 9v4l-3 2v-2l-3 2v2l-3 1v-2l-4 2z"/><path fill="#ad8260" d="M6 19h2v2H6zm5 3h2v2h-2z"/><path fill="#8e684a" d="M20 21h2v2h-2zm5-4h2v2h-2z"/></svg>${cover?`<img class="instance-icon-cover" src="${esc(cover)}" alt="">`:''}${badge?`<span class="game-version-badge">${badge}</span>`:''}</div>`;
}
function thumbnail(kind, value, fallback, className) {
 return `<div class="${className} thumbnail"><span class="thumbnail-fallback">${icon(fallback,19)}</span>${value ? `<img class="thumbnail-image" alt="" hidden data-thumbnail-kind="${esc(kind)}" data-thumbnail-value="${esc(value)}">` : ''}</div>`;
}
const thumbnailCache=new Map();
let thumbnailObserver=null;
function loadThumbnail(img) {
 if(!img.isConnected || img.dataset.requested) return;
 img.dataset.requested='1';
 const kind=img.dataset.thumbnailKind,value=img.dataset.thumbnailValue,key=JSON.stringify([kind,value]);
 let cached=thumbnailCache.get(key);
 if(!cached || cached.expires<Date.now()) {
  const promise=invoke('fetch_thumbnail',{kind,value}).catch(()=>null);
  cached={promise,expires:Date.now()+5*60*1000};thumbnailCache.set(key,cached);
  if(thumbnailCache.size>300) thumbnailCache.delete(thumbnailCache.keys().next().value);
 }
 cached.promise.then(data=>{
  if(!img.isConnected || typeof data!=='string' || !/^data:image\/(?:png|jpeg|webp|gif);base64,/.test(data)) return;
  img.onload=()=>{if(img.isConnected){img.hidden=false;img.parentElement.classList.add('has-thumbnail');}};
  img.onerror=()=>{img.hidden=true;img.parentElement?.classList.remove('has-thumbnail');};
  img.src=data;
 });
}
function hydrateThumbnails() {
 const images=app.querySelectorAll('img[data-thumbnail-kind]');
 if(typeof IntersectionObserver==='undefined') { images.forEach(loadThumbnail);return; }
 if(!thumbnailObserver) thumbnailObserver=new IntersectionObserver(entries=>entries.forEach(entry=>{if(entry.isIntersecting){thumbnailObserver.unobserve(entry.target);const image=entry.target.querySelector('img[data-thumbnail-kind]');if(image)loadThumbnail(image);}}),{rootMargin:'120px'});
 thumbnailObserver.disconnect();images.forEach(image=>thumbnailObserver.observe(image.parentElement));
}
const persist = () => localStorage.setItem('ccl-settings', JSON.stringify({ selected: state.selected, username: state.username, javaPath: state.javaPath, proxyUrl: state.proxyUrl, gameDir: state.gameDir, memory: state.memory, memoryMode: state.memoryMode, optimize: state.optimize, jvmArgs: state.jvmArgs, gameArgs: state.gameArgs, accountMode: state.accountPreference, accountKnown: state.accountKnown, accountName: state.accountName, jobLimit: state.jobLimit, theme: {bannerOpacity:theme.bannerOpacity,bannerFrost:theme.bannerFrost,bannerBlur:theme.bannerBlur,backgroundOpacity:theme.backgroundOpacity,backgroundFrost:theme.backgroundFrost,backgroundBlur:theme.backgroundBlur} }));
let launchSequence = 0;
let modEpoch = 0;
const usingOnlineAccount = () => state.accountPreference==='microsoft' && (state.accountKnown || !!state.account);
const playerName = () => usingOnlineAccount() ? (state.account?.name || state.accountName || '正版账户') : state.username;
const playerStatus = () => usingOnlineAccount() ? (state.account ? '微软账户' : state.accountRestoring ? '正在验证正版账户' : '正版账户 · 待验证') : '离线玩家';
const selected = () => state.versions.find(v => v.id === state.selected);
function flash(message, kind = '') { state.notice = message; state.noticeKind = kind; state.noticeCrash=false; renderChrome(); }
function showCrashNotice(crash) {state.crash=crash;state.notice=`游戏 ${crash.version} 异常退出（代码 ${crash.code ?? '未知'}）。`;state.noticeKind='error';state.noticeCrash=true;renderChrome();}
function shell() {
  return `<div class="app-shell"><header class="window-bar"><div class="window-drag" data-tauri-drag-region><span class="window-kicker" data-tauri-drag-region>CCL</span><span class="window-separator" data-tauri-drag-region></span><span class="window-title" data-tauri-drag-region>MINECRAFT LAUNCHER</span></div><div class="window-controls"><button data-window="minimize" aria-label="最小化" title="最小化">${icon('minus',15)}</button><button data-window="maximize" aria-label="最大化或还原" title="最大化或还原">${icon('square',12)}</button><button data-window="close" class="window-close" aria-label="关闭" title="关闭">${icon('x',16)}</button></div></header><aside class="sidebar"><div class="brand"><div class="brand-mark"><span></span><span></span><span></span><span></span></div><div><strong>CCL<span>.</span></strong><small>MINECRAFT 启动器</small></div></div>
  <nav class="nav"><button data-page="home" class="${state.page === 'home' ? 'active' : ''}">${icon('layout-grid')}<span>启动游戏</span></button><button data-page="versions" class="${state.page === 'versions' ? 'active' : ''}">${icon('layers-3')}<span>版本管理</span></button><button data-page="content" class="${state.page === 'content' ? 'active' : ''}">${icon('blocks')}<span>模组与资源</span></button><button data-page="multiplayer" class="${state.page === 'multiplayer' ? 'active' : ''}">${icon('globe-2')}<span>多人联机</span></button><button data-page="downloads" class="${state.page === 'downloads' ? 'active' : ''}">${icon('download')}<span>下载任务</span><b class="job-badge">${activeJobCount() || ''}</b></button><button data-page="java" class="${state.page === 'java' ? 'active' : ''}">${icon('monitor')}<span>Java 管理</span></button><button data-page="account" class="${state.page === 'account' ? 'active' : ''}">${icon('user-round')}<span>账户与外观</span></button><button data-page="settings" class="${state.page === 'settings' ? 'active' : ''}">${icon('settings-2')}<span>启动设置</span></button></nav>
  <div class="side-bottom"><div class="side-footer"><span class="status-dot"></span> ${state.online ? '版本服务已连接' : '本地工作区'} <span>v${esc(appVersion)}</span></div></div></aside>
  <main class="main"><header class="topbar"><div class="breadcrumbs"><strong>${{home:'启动游戏',versions:'版本管理',content:'模组与资源',downloads:'下载任务',multiplayer:'多人联机',java:'Java 管理',account:'账户与外观',settings:'启动设置'}[state.page]}</strong></div><div class="top-right"><div id="update-slot" aria-live="polite"></div><div class="avatar">${esc(playerName().slice(0,1).toUpperCase())}</div><div class="profile"><strong>${esc(playerName())}</strong><small>${playerStatus()}</small></div></div></header>
  <div class="content">${state.page === 'home' ? home() : state.page === 'versions' ? versionsPage() : state.page === 'java' ? javaPage() : state.page === 'content' ? contentPage() : state.page === 'downloads' ? downloadsPage() : state.page === 'account' ? accountPage() : state.page === 'multiplayer' ? multiplayerPage() : settingsPage()}</div></main><div id="modal-root"></div><div id="toast-root"></div><div class="resize-edge resize-n" data-resize="North"></div><div class="resize-edge resize-s" data-resize="South"></div><div class="resize-edge resize-e" data-resize="East"></div><div class="resize-edge resize-w" data-resize="West"></div><div class="resize-edge resize-nw" data-resize="NorthWest"></div><div class="resize-edge resize-ne" data-resize="NorthEast"></div><div class="resize-edge resize-sw" data-resize="SouthWest"></div><div class="resize-edge resize-se" data-resize="SouthEast"></div></div>`;
}
function home() {
 const v = selected();
 return `<section class="hero home-hero"><div class="hero-art"><div class="sun"></div><div class="cloud cloud-a"></div><div class="cloud cloud-b"></div><div class="mountain mountain-back"></div><div class="mountain mountain-mid"></div><div class="mountain mountain-front"></div><div class="ground"></div><div class="tree tree-a"><i></i></div><div class="tree tree-b"><i></i></div><div class="tree tree-c"><i></i></div><div class="art-grid"></div><div class="hero-custom"></div></div><div class="hero-shade"></div><div class="hero-content"><div class="hero-kicker">MINECRAFT · JAVA 版</div><h1>准备好，<em>出发。</em></h1><p>你的世界，在这里继续。</p></div></section>
 <div class="section-title home-title"><h3>开始游戏</h3><button class="row-button log-link" data-action="open-log" ${!v?.installed ? 'disabled' : ''}>启动日志</button></div>
 <section class="launch-panel"><div class="launch-version">${versionIcon(v,'version-cube')}<div><small>当前版本</small><strong>${v ? esc(v.name || v.id) : '选择一个版本'}</strong><span>${v?.installed ? `${esc(v.kind)} · 已安装` : '先在版本管理中安装游戏'}</span>${v?.installed && getInstanceTheme(state.gameDir,v.id).description?`<span class="instance-description-home">${esc(getInstanceTheme(state.gameDir,v.id).description)}</span>`:''}</div></div><button class="change-version" data-page="versions">切换版本 ${icon('chevron-down', 15)}</button><button class="play-button" data-action="launch" ${!v?.installed ? 'disabled' : ''}>${icon('play', 18)} 启动游戏</button></section>`;
}
function multiplayerPage() {
 return `<div class="server-tabs" role="tablist" aria-label="联机功能"><button type="button" data-lan-view="room" role="tab" aria-selected="${state.lanView==='room'}">IPv6 房间</button><button type="button" data-lan-view="servers" role="tab" aria-selected="${state.lanView==='servers'}">公开服务器</button></div>${state.lanView==='room' ? lanRoomPage() : publicServersPage()}`;
}
function lanRoomPage() {
 const room=state.lanRoom;
 return `<div class="page-heading inner-heading"><div><h1>多人联机</h1><p>通过 IPv6 邀请朋友加入你的 Java 版世界。</p></div><button class="outline-btn" data-action="refresh-ipv6" ${state.lanBusy?'disabled':''}>${icon('refresh-cw',16)} 刷新地址</button></div>
 <div class="lan-layout"><section class="lan-card lan-host"><div class="lan-card-head"><div><span class="lan-number">01 / HOST</span><h2>创建联机房间</h2><p>先在游戏内进入世界，选择“对局域网开放”，记下游戏显示的端口。</p></div><span class="lan-status ${room?'is-open':''}"><i></i>${room?'房间开放中':'未开放'}</span></div>
 <form id="lan-host-form"><label for="lan-game-port">游戏局域网端口</label><div class="lan-input-row"><input id="lan-game-port" name="lanGamePort" type="number" min="1" max="65535" required placeholder="例如 51234" value="${esc(state.lanPort)}" ${room||state.lanBusy?'disabled':''}>${room?`<button type="button" class="outline-btn" data-action="stop-ipv6-room" ${state.lanBusy?'disabled':''}>关闭房间</button>`:`<button type="submit" class="save-button" ${state.lanBusy?'disabled':''}>${state.lanBusy?'正在开启…':'开启房间'} ${icon('chevron-right',16)}</button>`}</div></form>
 ${room?`<div class="lan-addresses"><div class="lan-address-title"><strong>分享给朋友</strong><span>中转端口 ${room.port}</span></div>${state.lanAddresses.length?state.lanAddresses.map((a,i)=>`<div class="lan-address"><div><code>[${esc(a.address)}]:${room.port}</code><small>${esc(a.scope)} · ${esc(a.interface)}</small></div><button class="row-button" data-copy-ipv6="${i}">复制</button></div>`).join(''):'<p>未检测到可用的公网或内网 IPv6 地址，请检查网络连接后刷新。</p>'}</div>`:'<div class="lan-hint">创建后，将生成朋友可在游戏中使用的 IPv6 地址。</div>'}
 <p class="lan-footnote">仅分享给可信任的朋友。房间开放时，CCL 会监听网络并转发到本机游戏；关闭 CCL 或房间会断开连接。</p></section>
 <section class="lan-card lan-join"><div class="lan-card-head"><div><span class="lan-number">02 / JOIN</span><h2>加入朋友的世界</h2><p>粘贴房主分享的地址，检查连接后在游戏中加入。</p></div></div><form id="lan-test-form"><label for="lan-target">房间地址</label><div class="lan-input-row"><input id="lan-target" name="lanTarget" value="${esc(state.lanTarget)}" placeholder="[IPv6地址]:端口" required><button class="outline-btn" type="submit" ${state.lanBusy?'disabled':''}>${state.lanBusy?'检测中…':'检测连接'}</button></div></form>${state.lanTest?`<p class="lan-test-result">${esc(state.lanTest)}</p>`:''}<div class="lan-steps"><span>1</span><p>启动相同游戏版本及兼容的模组。</p><span>2</span><p>在游戏中打开“多人游戏 → 直接连接”，粘贴房间地址。</p></div></section></div>
 <p class="lan-network-note">跨网络联机需要双方有可互通的 IPv6，房主的路由器和防火墙需允许入站 TCP。公网候选地址不保证外网可达；内网地址通常只适用于同一网络。</p>`;
}
async function refreshLanAddresses() {
 try { state.lanAddresses=await invoke('ipv6_addresses'); if(state.page==='multiplayer') render(); }
 catch(e) { flash(`读取 IPv6 地址失败：${e}`,'error'); }
}
async function copyText(value) {
 if(navigator.clipboard?.writeText) return navigator.clipboard.writeText(value);
 const input=document.createElement('textarea'); input.value=value; input.style.position='fixed'; input.style.opacity='0'; document.body.appendChild(input); input.select(); const ok=document.execCommand('copy'); input.remove(); if(!ok) throw new Error('复制失败');
}
function filteredServers() {
 const query=state.serverQuery.trim().toLowerCase();
 const list=Array.isArray(state.serverCatalog?.servers)?state.serverCatalog.servers:[];
 return list.filter(s=>s && typeof s.address==='string' && (!query || [s.name,s.address,s.version,s.description,...(Array.isArray(s.tags)?s.tags:[])].some(x=>String(x||'').toLowerCase().includes(query))) && (state.serverStatus==='all' || s.status===state.serverStatus));
}
function publicServersPage() {
 const list=filteredServers(), size=40, maxPage=Math.max(0,Math.ceil(list.length/size)-1), page=Math.min(state.serverPage,maxPage);
 const rawDate=state.serverCatalog?.updatedAt, date=rawDate && !Number.isNaN(Date.parse(rawDate)) ? new Date(rawDate).toLocaleString() : '尚未获取';
 const rows=list.slice(page*size,(page+1)*size);
 return `<div class="page-heading inner-heading"><div><h1>公开服务器</h1><p>浏览 Minecraft Java 版社区服务器，复制地址后在游戏中加入。</p></div><button class="outline-btn" data-action="refresh-public-servers" ${state.serverLoading?'disabled':''}>${icon('refresh-cw',16)} ${state.serverLoading?'获取中':'刷新目录'}</button></div>
 <div class="server-summary"><div><span class="section-index">PUBLIC SERVERS / DAILY SNAPSHOT</span><strong>${state.serverCatalog?`${list.length} 个服务器`:'服务器目录'}</strong><p>目录更新：${esc(date)} · 数据来源 Minecraft Java Servers${state.serverCatalog?.truncated?' · 列表已截取':''}</p></div><span>状态与人数为每日快照，可能已经变化</span></div>
 <div class="server-toolbar"><label class="server-search"><span class="sr-only">搜索服务器</span><input id="server-search" type="search" placeholder="搜索名称、地址、版本或玩法" value="${esc(state.serverQuery)}"></label><label><span class="sr-only">筛选状态</span><select id="server-status"><option value="all" ${state.serverStatus==='all'?'selected':''}>全部状态</option><option value="online" ${state.serverStatus==='online'?'selected':''}>快照在线</option><option value="offline" ${state.serverStatus==='offline'?'selected':''}>快照离线</option></select></label></div>
 ${state.serverError?`<div class="server-warning">目录加载失败：${esc(state.serverError)}${state.serverCatalog?'；当前显示的是上次获取的目录。':''}</div>`:''}<div class="server-list">${rows.length?rows.map((s,i)=>`<article class="server-row">${thumbnail('server',s.address,'globe-2','server-symbol')}<div class="server-details"><div class="server-name"><strong>${esc(s.name||s.address)}</strong><span class="server-state ${s.status==='online'?'online':''}">${s.status==='online'?'快照在线':s.status==='offline'?'快照离线':'状态未知'}</span></div><p>${esc(s.description||'暂无简介')}</p><div class="server-meta"><code>${esc(s.address)}</code><span>${esc(s.version||'版本未知')}</span>${Array.isArray(s.tags)?s.tags.slice(0,3).map(t=>`<span>${esc(t)}</span>`).join(''):''}${s.requiresMods===true?'<span>需要模组</span>':''}</div></div><div class="server-players">${Number.isInteger(s.playersOnline)?esc(s.playersOnline):'—'}<small> / ${Number.isInteger(s.playersMax)?esc(s.playersMax):'—'}</small><span>快照人数</span></div><button class="row-button" data-server-copy="${page*size+i}">复制地址</button></article>`).join(''):`<div class="empty-state">${icon('globe-2',27)}<strong>${state.serverLoading?'正在获取服务器目录…':state.serverCatalog?'没有匹配的服务器':'暂未获取服务器目录'}</strong><p>${state.serverCatalog?'试试其他关键词或状态。':'可点击刷新重试。'}</p></div>`}</div>
 <div class="server-pagination-slot">${maxPage?`<div class="server-pagination"><span>第 ${page+1} / ${maxPage+1} 页</span><div><button class="outline-btn" data-server-page="${page-1}" ${page===0?'disabled':''}>上一页</button><button class="outline-btn" data-server-page="${page+1}" ${page===maxPage?'disabled':''}>下一页</button></div></div>`:''}</div><p class="lan-network-note">服务器由第三方运营，CCL 不保证其安全性或可用性。加入前请核对版本、模组及服务器规则；正版服务器需要正版账户。</p>`;
}
async function refreshPublicServers() {
 if(state.serverLoading) return;
 state.serverLoading=true;state.serverError='';if(state.page==='multiplayer') render();
 try { const data=await invoke('public_servers'); if(!data || !Array.isArray(data.servers)) throw new Error('目录格式无效'); state.serverCatalog=data;state.serverPage=0; }
 catch(e) { state.serverError=String(e); }
 finally { state.serverLoading=false;if(state.page==='multiplayer') render(); }
}
function versionsPage() {
 const query=state.versionQuery.trim().toLowerCase();
 const list=state.versions.filter(v=>!query || `${v.name || ''} ${v.id} ${v.kind}`.toLowerCase().includes(query));
 return `<div class="page-heading inner-heading"><div><h1>版本管理</h1><p>选择游戏版本，安装加载器或管理游戏文件。</p></div><div class="heading-actions"><button class="outline-btn" data-action="import-game">${icon('folder-open',16)} 导入游戏</button><button class="outline-btn" data-action="refresh" ${state.loading ? 'disabled' : ''}>${icon('refresh-cw',16)} ${state.loading ? '正在获取' : '刷新'}</button></div></div>
 <div class="version-toolbar"><div><strong>游戏版本</strong><span class="count">${list.length}</span></div><label class="version-search"><span class="sr-only">搜索版本</span><input id="version-filter" type="search" placeholder="搜索版本" value="${esc(state.versionQuery)}"></label></div>
 <div class="version-list versions-list">${list.length ? list.map(v => `<div class="version-row">${versionIcon(v)}<div class="row-name"><strong>${esc(v.name || v.id)}</strong><span>${esc(v.kind)} ${v.released ? '· '+esc(v.released) : ''}</span></div><div class="row-state ${v.installed ? 'installed' : ''}"><span></span>${v.installed ? '已安装' : '可安装'}</div>${v.installed ? `<button class="row-button ${state.selected === v.id ? 'selected' : ''}" data-select="${esc(v.id)}">${state.selected === v.id ? '当前版本' : '选择版本'}</button><details class="version-menu"><summary aria-label="${esc(v.name || v.id)} 的更多操作" title="更多操作">${icon('more-horizontal',18)}</summary><div class="version-menu-items"><button data-instance-theme="${esc(v.id)}">${icon('layout-grid',15)} 实例主题</button><button data-game-profile="${esc(v.id)}">${icon('gamepad-2',15)} 游戏档案</button><button data-manage-backups="${esc(v.id)}">${icon('hard-drive',15)} 备份与恢复</button><button data-manage-worlds="${esc(v.id)}">${icon('folder-open',15)} 存档管理</button><button data-instance-overview="${esc(v.id)}">${icon('hard-drive',15)} 实例概览</button><button data-open-version-folder="${esc(v.id)}">${icon('folder-open',15)} 游戏目录</button><button data-export-game="${esc(v.id)}">${icon('download',15)} 导出游戏</button><button data-delete-version="${esc(v.id)}">${icon('x',15)} 删除版本</button>${v.kind === '正式版' ? `<button data-install="${esc(v.id)}">${icon('layers-3',15)} 配置安装</button>` : ''}</div></details>` : v.kind === '正式版' ? `<button class="row-button install-choice" data-install="${esc(v.id)}">${icon('download',14)} 安装</button>` : ''}</div>`).join('') : `<div class="empty-state">${icon('box',27)}<strong>${state.loading ? '正在获取版本列表…' : query ? '没有找到匹配的版本' : '还没有可显示的版本'}</strong><p>${query ? '试试其他关键词。' : '检查网络连接后刷新列表。'}</p></div>`}</div>${state.versionDelete ? `<div class="confirm-overlay"><section class="confirm-box" role="dialog" aria-modal="true" aria-labelledby="delete-version-title"><span class="section-index">REMOVE VERSION</span><h3 id="delete-version-title">删除 ${esc(state.versionDelete.name)}？</h3><p>将删除该版本文件。共用资源、Java、存档和模组会保留；被其他版本依赖的游戏本体无法删除。</p>${state.versionDelete.isolated?'<p>保留的实例数据会留在 instances 目录；重新安装相同整合包前，需要先备份或移除旧目录。</p><label class="archive-check"><input type="checkbox" id="delete-instance-data"><span><strong>同时删除此实例的游戏数据</strong><small>包括该实例的存档、模组和配置，无法恢复。</small></span></label>':''}<div><button class="row-button" data-action="cancel-version-delete" ${state.versionDeleting?'disabled':''}>取消</button><button class="row-button danger-button" data-action="confirm-version-delete" ${state.versionDeleting?'disabled':''}>${state.versionDeleting?'正在删除…':'删除版本'}</button></div></section></div>`:''}`;
}
const ADDONS = [
 { id:'fabric-api', title:'Fabric API', desc:'许多 Fabric 模组的基础依赖', loaders:['fabric'] },
 { id:'sodium', title:'Sodium', desc:'改善渲染性能', loaders:['fabric','neoforge'] },
 { id:'jei', title:'Just Enough Items', desc:'查看物品与配方', loaders:['fabric','quilt','forge','neoforge'] },
 { id:'jade', title:'Jade', desc:'查看方块与实体信息', loaders:['fabric','quilt','forge','neoforge'] },
];
function installDialog() {
 const d = state.installDraft; if (!d) return '';
 const choices = [['vanilla','原版','不安装加载器'],['fabric','Fabric','轻量，更新及时'],['quilt','Quilt','基于 Fabric 生态'],['forge','Forge','广泛的模组支持'],['neoforge','NeoForge','Forge 生态分支']];
 return `<div class="install-overlay" data-action="close-install-backdrop"><section class="install-dialog" role="dialog" aria-modal="true" aria-labelledby="install-title"><div class="install-dialog-head"><div><span class="section-index">NEW INSTALL / JAVA EDITION</span><h2 id="install-title">安装 <em>${esc(d.version)}</em></h2><p>先选择运行方式，再按需添加常用模组。</p></div><button class="icon-button" data-action="close-install" aria-label="关闭">${icon('x',19)}</button></div>
 <div class="install-section-heading"><span>01</span><div><strong>模组加载器</strong><small>选择一个与模组兼容的加载器</small></div></div><div class="loader-grid">${choices.map(([id,name,desc]) => `<label class="loader-card ${d.loader===id ? 'chosen' : ''}"><input type="radio" name="draftLoader" value="${id}" ${d.loader===id ? 'checked' : ''}><span class="choice-dot"></span><strong>${name}</strong><small>${desc}</small></label>`).join('')}</div>
 <div class="install-section-heading"><span>02</span><div><strong>附加模组 <small>可选</small></strong><small>从 Modrinth 自动下载兼容版本及必需依赖</small></div></div><div class="addon-grid">${ADDONS.map(a => { const available=a.loaders.includes(d.loader); return `<label class="addon-option ${available ? '' : 'unavailable'}"><input type="checkbox" name="draftAddon" value="${a.id}" ${d.addons.includes(a.id) ? 'checked' : ''} ${available ? '' : 'disabled'}><span><strong>${esc(a.title)}</strong><small>${esc(a.desc)}</small></span></label>`; }).join('')}</div><p class="install-note">${d.loader==='vanilla' ? '选择加载器后即可添加模组。' : '若所选模组没有兼容的版本，任务会显示具体原因。'}</p>
 <div class="install-actions"><button class="outline-btn" data-action="close-install">取消</button><button class="save-button" data-action="confirm-install">加入下载任务 ${icon('chevron-right',16)}</button></div></section></div>`;
}
function updateSettings() {
 const info=state.updateInfo;
 const message=state.updateState==='checking'?'正在检查 GitHub 更新…':state.updateState==='error'?`检查失败：${state.updateError}`:info?.available?`发现新版本 v${info.latestVersion}。`:state.updateState==='success'?'当前已是最新正式版。':'启动后会自动检查新版本。';
 return `<section class="settings-section update-settings"><div class="settings-heading"><div class="settings-icon">${icon('download',20)}</div><div><span class="section-index">CCL / UPDATE</span><h3>启动器更新</h3><p>当前版本 v${esc(appVersion)}</p></div></div><div class="update-settings-row"><p role="status">${esc(message)}</p><div><button class="outline-btn" type="button" data-action="check-update" ${state.updateState==='checking'?'disabled':''}>${state.updateState==='checking'?'检查中…':'检查更新'}</button>${info?.available?'<button class="save-button" type="button" data-action="open-update">前往下载</button>':''}</div></div></section>`;
}
function renderUpdateChrome() {
 const slot=app.querySelector('#update-slot'), info=state.updateInfo;
 const badgeKey=JSON.stringify([info?.available,info?.latestVersion,state.updateDismissed]);
 if(slot && slot.dataset.updateKey!==badgeKey) {slot.dataset.updateKey=badgeKey;slot.innerHTML=info?.available && info.latestVersion!==state.updateDismissed ? `<div class="update-pill"><button type="button" data-action="open-update" title="打开 GitHub 下载页面">${icon('download',14)} <span>新版本 v${esc(info.latestVersion)}</span></button><button type="button" data-action="dismiss-update" aria-label="暂时隐藏更新提示">${icon('x',13)}</button></div>` : '';}
 const panel=app.querySelector('#update-panel'),panelKey=JSON.stringify([state.updateState,state.updateError,info?.available,info?.latestVersion]);
 if(panel && panel.dataset.updateKey!==panelKey){panel.dataset.updateKey=panelKey;panel.innerHTML=updateSettings();}
}
async function checkLauncherUpdate(manual=false) {
 if(state.updateState==='checking')return;
 state.updateState='checking';state.updateError='';renderChrome();
 try {
  const info=await invoke('check_launcher_update');
  if(!info || typeof info.available!=='boolean' || typeof info.latestVersion!=='string')throw new Error('更新信息格式无效');
  state.updateInfo=info;state.updateState='success';
  if(manual && info.available)state.updateDismissed='';
 } catch(e) {state.updateState='error';state.updateError=String(e);}
 renderChrome();
}

function settingsPage() {
 const selectedVersion=state.versions.find(v=>v.id===state.selected && v.installed);
 return `<div class="page-heading inner-heading"><div><h1>启动设置</h1><p>调整游戏运行环境与启动参数。</p></div></div>
 <div id="update-panel">${updateSettings()}</div>${appearanceSettings()}<form id="settings-form"><section class="settings-section"><div class="settings-heading"><div class="settings-icon">${icon('user-round', 20)}</div><div><span class="section-index">01 / PLAYER</span><h3>玩家身份</h3><p>设置用于启动游戏的离线玩家名称。</p></div></div><div class="field"><label for="username">玩家名称 <span>1–16 位字母、数字或下划线</span></label><input id="username" name="username" value="${esc(state.username)}" maxlength="16" required pattern="[A-Za-z0-9_]{1,16}"><p>离线玩家名称；正版账户请在“账户与外观”中登录。</p><button class="text-link" type="button" data-page="account">打开账户与外观 →</button></div></section>
 <section class="settings-section"><div class="settings-heading"><div class="settings-icon">${icon('monitor', 20)}</div><div><span class="section-index">02 / ENVIRONMENT</span><h3>游戏环境</h3><p>配置 Java 和游戏文件的存放位置。</p></div></div><div class="field"><label for="javaPath">Java 可执行文件 <span>JAVA PATH</span></label><input id="javaPath" name="javaPath" value="${esc(state.javaPath)}" required><p>使用系统 PATH 中的 java，或填写完整路径。请根据游戏版本选择对应的 Java，或前往 Java 管理下载。</p><button class="text-link" type="button" data-page="java">打开 Java 管理 →</button></div><div class="field"><label for="gameDir">游戏目录 <span>GAME DIRECTORY</span></label><input id="gameDir" name="gameDir" value="${esc(state.gameDir)}" required><p>下载的版本、资源和游戏存档将保存在这里。</p></div><div class="field isolation-field"><label class="option-check"><input id="version-isolation" name="versionIsolation" type="checkbox" ${selectedVersion?.isolated?'checked':''} ${!selectedVersion || selectedVersion.kind==='整合包'?'disabled':''}> 版本隔离</label><p>${selectedVersion ? `当前版本：${esc(selectedVersion.name || selectedVersion.id)}${selectedVersion.kind==='整合包'?' · 整合包始终使用独立目录':''}` : '请先选择已安装的游戏版本。'}</p><p>启用后，此版本的存档、模组与配置使用独立游戏目录。切换不会移动或删除原有文件。</p></div><div class="field memory-field"><label for="memory-mode">最大内存 <span>JAVA 堆上限</span></label><select id="memory-mode" name="memoryMode"><option value="auto" ${state.memoryMode==='auto'?'selected':''}>自动分配</option><option value="manual" ${state.memoryMode==='manual'?'selected':''}>手动设置</option></select><div id="memory-manual" ${state.memoryMode==='auto'?'hidden':''}><div class="memory-value"><label for="memory">手动上限</label><div><input id="memory" name="memory" type="number" min="512" max="32768" step="1" value="${esc(state.memory)}" required><span>MB</span></div></div><input id="memory-range" aria-label="调整最大内存" type="range" min="512" max="32768" step="256" value="${esc(state.memory)}"><div class="range-labels"><span>512 MB</span><span>32 GB</span></div></div><div id="memory-info">${memoryInfoMarkup()}</div><p>自动模式在每次启动时根据总内存和可用内存重新计算，预留系统空间。自定义 JVM 参数中的 -Xmx 会覆盖此设置。</p></div></section><section class="settings-section"><div class="settings-heading"><div class="settings-icon">${icon('zap',20)}</div><div><span class="section-index">03 / LAUNCH OPTIONS</span><h3>启动参数</h3><p>按需调整 Java 和游戏启动方式。</p></div></div><div class="field"><label class="option-check"><input name="optimize" type="checkbox" ${state.optimize ? 'checked' : ''}> 启用 G1 垃圾回收优化</label><p>使用 Java 内置的 G1GC；自定义 JVM 参数可覆盖或补充设置。</p></div><div class="field"><label for="jvmArgs">自定义 JVM 参数 <span>JVM ARGUMENTS</span></label><input id="jvmArgs" name="jvmArgs" value="${esc(state.jvmArgs)}" placeholder="例如 -XX:MaxGCPauseMillis=100"><p>用空格分隔，带空格的值可用引号包裹。</p></div><div class="field"><label for="gameArgs">自定义游戏参数 <span>GAME ARGUMENTS</span></label><input id="gameArgs" name="gameArgs" value="${esc(state.gameArgs)}" placeholder="例如 --width 1280 --height 720"></div></section><section class="settings-section"><div class="settings-heading"><div class="settings-icon">${icon('globe-2', 20)}</div><div><span class="section-index">03 / NETWORK</span><h3>网络代理</h3><p>下载游戏、Java 和模组时使用的连接方式。</p></div></div><div class="field"><label for="proxyUrl">手动代理地址 <span>留空时使用系统代理</span></label><input id="proxyUrl" name="proxyUrl" value="${esc(state.proxyUrl)}" placeholder="例如 http://127.0.0.1:7890"><p>支持 HTTP、HTTPS 和 SOCKS5；使用系统代理时请留空。代理地址不支持填写账号或密码。</p></div></section><div class="settings-actions"><p>设置保存在本设备上。</p><button class="save-button" type="submit">保存设置 ${icon('chevron-right', 16)}</button></div></form>`;
}
function contentPage() {
 const count = n => n >= 1000000 ? (n / 1000000).toFixed(1) + 'm' : n >= 1000 ? (n / 1000).toFixed(1) + 'k' : n;
 return `<div class="page-heading inner-heading"><div><h1>模组与资源</h1><p>浏览并安装与目标版本兼容的内容。</p></div></div>
 <section class="content-search">${state.contentKind!=='modpack' ? `<label class="target-select">安装到已安装的游戏版本<select id="contentTarget" ${state.contentBusy ? 'disabled' : ''}><option value="">选择目标版本</option>${state.versions.filter(v=>v.installed).map(v=>`<option value="${esc(v.id)}" ${state.contentTarget===v.id?'selected':''}>${esc(v.name || v.id)}</option>`).join('')}</select></label>` : ''}<form id="content-form"><div class="content-selects"><label>内容来源<select name="source" ${state.contentBusy ? 'disabled' : ''}><option value="modrinth" ${state.contentSource === 'modrinth' ? 'selected' : ''}>Modrinth</option><option value="curseforge" ${state.contentSource === 'curseforge' ? 'selected' : ''}>CurseForge</option></select></label><label>内容类型<select name="kind" ${state.contentBusy ? 'disabled' : ''}><option value="mod" ${state.contentKind === 'mod' ? 'selected' : ''}>模组</option><option value="modpack" ${state.contentKind === 'modpack' ? 'selected' : ''}>整合包</option><option value="resourcepack" ${state.contentKind === 'resourcepack' ? 'selected' : ''}>材质包</option><option value="shader" ${state.contentKind === 'shader' ? 'selected' : ''}>光影包</option></select></label><label class="content-sort">排序方式<select name="sort" ${state.contentBusy ? 'disabled' : ''}><option value="downloads" ${state.contentSort === 'downloads' ? 'selected' : ''}>下载最多</option><option value="updated" ${state.contentSort === 'updated' ? 'selected' : ''}>最近更新</option><option value="newest" ${state.contentSort === 'newest' ? 'selected' : ''}>最新发布</option><option value="recommended" ${state.contentSort === 'recommended' ? 'selected' : ''}>推荐 / 相关度</option></select></label></div><div class="content-filters"><label>分类<select id="content-category" name="category" ${state.contentCategoriesLoading||!state.contentCategories.length?'disabled':''}><option value="">全部分类</option>${state.contentCategories.map(c=>`<option value="${esc(c.id)}" ${state.contentCategory===c.id?'selected':''}>${esc(c.name)}</option>`).join('')}</select></label>${state.contentKind==='modpack'?`<label>游戏版本<input name="gameFilter" value="${esc(state.contentGameFilter)}" placeholder="例如 1.20.1" maxlength="40" pattern="[A-Za-z0-9._-]*"></label><label>加载器<select name="loaderFilter"><option value="">全部加载器</option>${['fabric','quilt','forge','neoforge'].map(v=>`<option value="${v}" ${state.contentLoaderFilter===v?'selected':''}>${v}</option>`).join('')}</select></label>`:''}${state.contentSource==='modrinth'?`<label>运行环境<select name="environment"><option value="">全部环境</option><option value="client_only" ${state.contentEnvironment==='client_only'?'selected':''}>仅客户端</option><option value="client_and_server" ${state.contentEnvironment==='client_and_server'?'selected':''}>客户端和服务端</option></select></label>`:''}</div>${state.contentSource === 'curseforge' ? `<label class="content-key">CurseForge API Key<input type="password" name="apiKey" ${state.contentBusy ? 'disabled' : ''} value="${esc(state.contentKey)}" placeholder="输入 API Key（仅当前会话保存）" autocomplete="off"></label>` : ''}<div class="content-search-row"><input name="query" value="${esc(state.contentQuery)}" placeholder="搜索模组、整合包、材质包或光影包"><button class="save-button" type="submit" ${state.contentBusy ? 'disabled' : ''}>搜索 ${icon('chevron-right',16)}</button></div></form><p>${state.contentKind === 'mod' ? '只显示与目标版本和加载器兼容的模组。' : state.contentKind === 'modpack' ? '整合包将创建独立游戏目录。' : state.contentKind === 'shader' ? '按游戏版本筛选；使用光影还需在游戏中安装并启用 Iris、OptiFine 等光影支持。' : '按游戏版本筛选；下载后在游戏资源包设置中启用。'}</p><div id="shader-status">${shaderStatus()}</div></section>

 <div class="section-title"><div><span class="section-index">01 / DISCOVER</span><h3>浏览内容 <span class="count">${state.contentResults.length}</span></h3></div><span class="section-note">${state.contentSource === 'modrinth' ? 'Modrinth' : 'CurseForge'}</span></div><div class="version-list">${state.contentResults.length ? state.contentResults.map((hit,i) => `<div class="version-row content-row">${thumbnail('content',hit.iconUrl,state.contentKind === 'mod' ? 'blocks' : 'box','row-icon')}<div class="row-name"><strong>${esc(hit.title)}</strong><span>${esc(hit.description)}</span><span>${esc(hit.author)} · ${count(hit.downloads)} 次下载</span></div><button class="row-button content-details" data-content-details="${i}">详情</button><button class="row-button ${hit.installed ? 'selected' : ''}" data-content-install="${i}" ${state.contentBusy || (state.contentKind!=='modpack' && hit.installed) ? 'disabled' : ''}>${hit.installed && state.contentKind!=='modpack' ? '已安装' : `${icon('download',14)} ${state.contentKind!=='modpack' ? '选择版本' : '安装'}`}</button></div>`).join('') : `<div class="empty-state">${icon('compass',27)}<strong>${state.contentBusy?'正在加载…':state.contentError?'加载失败':state.contentLoaded?'此页没有兼容项目':'选择游戏版本后浏览内容'}</strong><p>${esc(state.contentError || (state.contentLoaded && state.contentHasMore?'可继续浏览下一页。':state.contentSource==='curseforge'&&!state.contentKey?'输入 CurseForge API Key 后即可浏览。':'选择已安装的游戏版本，或切换到整合包浏览。'))}</p></div>`}</div><div class="content-pagination"><span>${state.contentLoaded ? `第 ${state.contentPage+1} 页` : ''}</span><div><button class="outline-btn" data-content-page="${state.contentPage-1}" ${state.contentBusy||state.contentPage===0?'disabled':''}>上一页</button><button class="outline-btn" data-content-page="${state.contentPage+1}" ${state.contentBusy||!state.contentHasMore?'disabled':''}>下一页</button></div></div>
 ${state.contentKind==='mod' ? `<div class="section-title"><div><span class="section-index">02 / INSTALLED MODS</span><h3>当前实例模组 <span class="count" id="local-mod-count">${state.localMods.length}</span></h3></div><span class="section-note" id="local-mod-target">${esc(state.contentTarget || '未选择游戏版本')}</span></div>
 <div class="mod-toolbar"><input id="local-mod-search" value="${esc(state.modQuery)}" placeholder="筛选已安装的模组" aria-label="筛选已安装的模组"><select id="local-mod-filter" aria-label="模组状态"><option value="all" ${state.modFilter==='all'?'selected':''}>全部状态</option><option value="enabled" ${state.modFilter==='enabled'?'selected':''}>已启用</option><option value="disabled" ${state.modFilter==='disabled'?'selected':''}>已停用</option></select><button class="outline-btn" data-action="check-mod-conflicts" ${state.modConflictsLoading||!state.contentTarget||state.modWorking?'disabled':''}>${state.modConflictsLoading?'排查中…':'排查冲突'}</button><button class="outline-btn" data-action="check-mod-updates" ${state.modChecking||!state.contentTarget||state.modWorking?'disabled':''}>${state.modChecking?'检查中…':'检查更新'}</button></div><div id="local-mod-update-summary">${modUpdateSummary()}</div><div id="mod-conflict-report">${conflictSummary()}</div><div id="local-mod-list">${localModList()}</div>
 ${state.modDelete?.length ? `<div class="confirm-overlay"><div class="confirm-box"><span class="section-index">REMOVE MOD</span><h3>删除 ${state.modDelete.length} 个模组？</h3><p>${state.modDelete.map(esc).join('、')} 将从当前实例删除。其他模组可能依赖这些文件；模组配置和存档会保留。</p><div><button class="row-button" data-action="cancel-mod-remove">取消</button><button class="row-button danger-button" data-action="confirm-mod-remove">确认删除</button></div></div></div>` : ''}` : ''}${['resourcepack','shader'].includes(state.contentKind)?localPackSection():''}`;
}
function shaderStatus() {
 if(state.contentKind!=='shader'||!state.contentTarget)return '';
 const env=state.shaderEnv;
 if(state.shaderEnvLoading)return '<div class="shader-status"><strong>正在检测光影环境…</strong></div>';
 if(!env)return `<div class="shader-status warning"><strong>无法确认光影环境</strong><span>${esc(state.shaderEnvError || '请检查目标版本的光影支持组件。')}</span><button class="row-button" data-action="refresh-packs">重新检测</button></div>`;
 if(env.detected?.length)return `<div class="shader-status ready"><strong>已检测到 ${esc(env.detected.join('、'))}</strong><span>请在游戏中启用光影；具体兼容性以游戏内实际运行情况为准。</span></div>`;
 const hint=env.uncertain?'部分模组无法读取，可能存在未识别的光影组件。':'未检测到 Iris、Oculus 或 OptiFine。';
 const suggested=env.loader==='forge'?'Oculus':['fabric','quilt','neoforge'].includes(env.loader)?'Iris':'';
 return `<div class="shader-status warning"><strong>光影环境${env.uncertain?'无法完全确认':'未检测到'}</strong><span>${hint}${suggested?'可浏览与目标版本兼容的 '+suggested+'。':'请先安装支持光影的加载器或组件。'}</span>${suggested?`<button class="row-button" data-action="find-shader-support" data-query="${suggested}">查找 ${suggested}</button>`:''}</div>`;
}
function localPackList() {
 const matches=state.localPacks.map((pack,index)=>({pack,index})).filter(({pack})=>pack.name.toLocaleLowerCase().includes(state.packQuery.trim().toLocaleLowerCase()));
 if(state.packLoading)return '<div class="empty-state"><strong>正在读取资源包…</strong></div>';
 if(state.packError)return `<div class="empty-state"><strong>读取失败</strong><p>${esc(state.packError)}</p></div>`;
 if(!matches.length)return `<div class="empty-state">${icon('box',27)}<strong>${state.localPacks.length?'没有匹配的资源包':'当前游戏目录没有资源包'}</strong><p>${state.localPacks.length?'试试其他关键词。':'在上方浏览下载，或打开文件夹手动添加。'}</p></div>`;
 return `<div class="version-list">${matches.map(({pack:p,index:i})=>{const update=state.packUpdates?.updates?.find(u=>u.name===p.name);return `<div class="version-row"><div class="row-icon">${icon(p.directory?'folder-open':'box',19)}</div><div class="row-name"><strong class="java-path" title="${esc(p.name)}">${esc(p.name)}</strong><span>${p.directory?'文件夹':'ZIP 文件'} · ${p.source ? esc(p.source==='modrinth'?'Modrinth':'CurseForge'):'手动添加或来源未知'}${update?` · 可更新至 ${esc(update.latest)}`:''}</span></div>${update?.projectUrl?`<button class="row-button" data-open-project="${esc(update.projectUrl)}">查看更新</button>`:''}<button class="row-button danger-button" data-pack-remove="${i}" ${state.packWorking?'disabled':''}>删除</button></div>`;}).join('')}</div>`;
}
function packUpdateSummary() { const r=state.packUpdates;return r?`已检查 ${r.checked} 个，发现 ${r.updates.length} 个可更新；${r.unknown} 个无法识别或确认，${r.failed} 个检查失败。`:'更新检查仅覆盖由 CCL 安装且可识别的资源包；CurseForge 需要 API Key。'; }
function localPackSection() {
 const label=state.contentKind==='shader'?'光影包':'材质包';
 const selected=state.versions.find(v=>v.id===state.contentTarget);
 return `<div class="section-title"><div><span class="section-index">02 / INSTALLED PACKS</span><h3>当前游戏目录的${label} <span class="count" id="local-pack-count">${state.localPacks.length}</span></h3></div><span class="section-note">${selected?.isolated?'独立游戏目录':'可能与其他版本共用目录'}</span></div><div class="mod-toolbar"><input id="local-pack-search" value="${esc(state.packQuery)}" placeholder="筛选已安装的${label}" aria-label="筛选已安装的${label}"><button class="outline-btn" data-action="refresh-packs" ${!state.contentTarget||state.packWorking?'disabled':''}>刷新</button><button class="outline-btn" data-action="open-pack-folder" ${!state.contentTarget?'disabled':''}>${icon('folder-open',15)} 打开文件夹</button><button class="outline-btn" data-action="check-pack-updates" ${!state.contentTarget||state.packChecking||state.packWorking?'disabled':''}>${state.packChecking?'检查中…':'检查更新'}</button></div><p class="mod-update-summary" id="pack-update-summary">${esc(packUpdateSummary())}</p><div id="local-pack-list">${localPackList()}</div>${state.packDelete?`<div class="confirm-overlay"><div class="confirm-box" role="dialog" aria-modal="true"><span class="section-index">REMOVE PACK</span><h3>删除${label}？</h3><p>${esc(state.packDelete.name)} 将从游戏目录删除。若多个版本共用此目录，也会影响其他版本；游戏中的启用状态需自行调整。</p><div><button class="row-button" data-action="cancel-pack-remove">取消</button><button class="row-button danger-button" data-action="confirm-pack-remove">确认删除</button></div></div></div>`:''}`;
}
function renderLocalPacks() {
 const list=app.querySelector('#local-pack-list');if(list){list.innerHTML=localPackList();hydrateIcons();}
 const count=app.querySelector('#local-pack-count');if(count)count.textContent=state.localPacks.length;
 const summary=app.querySelector('#pack-update-summary');if(summary)summary.textContent=packUpdateSummary();
 const button=app.querySelector('[data-action=check-pack-updates]');if(button){button.disabled=!state.contentTarget||state.packChecking||state.packWorking;button.textContent=state.packChecking?'检查中…':'检查更新';}
 const status=app.querySelector('#shader-status');if(status)status.innerHTML=shaderStatus();
}
let packEpoch=0;
async function refreshPacks() {
 const kind=state.contentKind,version=state.contentTarget,gameDir=state.gameDir,epoch=++packEpoch;
 state.localPacks=[];state.packUpdates=null;state.packError='';state.shaderEnv=null;state.shaderEnvError='';
 if(!['resourcepack','shader'].includes(kind)||!version){state.packLoading=false;state.shaderEnvLoading=false;renderLocalPacks();return;}
 state.packLoading=true;state.shaderEnvLoading=kind==='shader';renderLocalPacks();
 const current=()=>epoch===packEpoch&&kind===state.contentKind&&version===state.contentTarget&&gameDir===state.gameDir;
 const packs=invoke('list_local_packs',{gameDir,version,kind}).then(result=>{if(current())state.localPacks=Array.isArray(result)?result:[];}).catch(e=>{if(current())state.packError=String(e);}).finally(()=>{if(current()){state.packLoading=false;renderLocalPacks();}});
 const env=kind==='shader'?invoke('shader_environment',{gameDir,version}).then(result=>{if(current())state.shaderEnv=result;}).catch(e=>{if(current())state.shaderEnvError=String(e);}).finally(()=>{if(current()){state.shaderEnvLoading=false;renderLocalPacks();}}):Promise.resolve();
 await Promise.all([packs,env]);
}

function manageDialog() {
 const d=state.manageView;if(!d)return '';
 const backups=d.kind==='backups',label=backups?'备份与恢复':'存档管理';
 const date=value=>{if(!value)return '时间未知';const n=Number(value);return Number.isFinite(n)?new Date(backups?n*1000:n).toLocaleString():'时间未知';};
 const size=value=>Number(value)>=1073741824?`${(value/1073741824).toFixed(2)} GB`:`${(Number(value||0)/1048576).toFixed(1)} MB`;
 const rows=d.items.map((item,i)=>backups?`<div class="version-row manage-row"><div class="row-icon">${icon('hard-drive',18)}</div><div class="row-name"><strong>${item.scope==='world'?`存档备份 · ${esc(item.world)}`:'实例备份'}</strong><span>${esc(date(item.created))} · ${esc(size(item.size))}</span></div><button class="row-button" data-manage-restore="${i}" ${d.busy?'disabled':''}>恢复</button><button class="row-button danger-button" data-manage-delete="${i}" ${d.busy?'disabled':''}>删除</button></div>`:`<div class="version-row manage-row"><div class="row-icon">${icon('box',18)}</div><div class="row-name"><strong>${esc(item.name)}</strong><span>${esc(item.folder)} · ${item.gameVersion?`Minecraft ${esc(item.gameVersion)} · `:''}${esc(date(item.lastPlayed))}${item.metadataError?' · 存档信息暂不可读':''}</span></div><button class="row-button" data-world-open="${i}" ${d.busy?'disabled':''}>文件夹</button><button class="row-button" data-world-backup="${i}" ${d.busy?'disabled':''}>备份</button><button class="row-button danger-button" data-manage-delete="${i}" ${d.busy?'disabled':''}>删除</button></div>`).join('');
 const confirmation=d.confirm?`<div class="manage-confirm" role="alert"><strong>${d.confirm.action==='restore'?'恢复所选备份？':backups?'删除所选备份？':'删除所选存档？'}</strong><p>${d.confirm.action==='restore'?'将替换备份覆盖范围内的当前数据，恢复前会自动备份整个实例；共用游戏目录可能影响其他版本。':backups?'删除后无法从此备份恢复。':'删除前会自动备份此存档；共用游戏目录可能影响其他版本。'}</p><div><button class="outline-btn" data-action="manage-cancel" ${d.busy?'disabled':''}>取消</button><button class="row-button danger-button" data-action="manage-confirm" ${d.busy?'disabled':''}>确认${d.confirm.action==='restore'?'恢复':'删除'}</button></div></div>`:'';
 return `<div class="install-overlay"><section class="install-dialog manage-dialog" role="dialog" aria-modal="true" aria-labelledby="manage-title"><div class="install-dialog-head"><div><span class="section-index">${backups?'INSTANCE / BACKUPS':'INSTANCE / WORLDS'}</span><h2 id="manage-title">${label}</h2><p>${esc(d.name)} · ${d.isolated?'独立游戏目录':'共用游戏目录'}</p></div><button class="icon-button" data-action="close-manage" aria-label="关闭" ${d.busy?'disabled':''}>${icon('x',19)}</button></div><div class="manage-toolbar">${backups?`<button class="save-button" data-action="create-instance-backup" ${d.busy?'disabled':''}>创建实例备份</button><button class="outline-btn" data-action="switch-worlds" ${d.busy?'disabled':''}>存档管理</button>`:`<button class="outline-btn" data-action="open-saves-folder" ${d.busy?'disabled':''}>打开存档目录</button><button class="outline-btn" data-action="switch-backups" ${d.busy?'disabled':''}>查看备份</button>`}<button class="outline-btn" data-action="refresh-manage" ${d.busy?'disabled':''}>刷新</button></div><p class="manage-note">${backups?'备份包含模组、配置、资源包和存档。操作时请先退出游戏，恢复前会自动保存当前实例。':'显示当前游戏目录中的世界；单独备份后可在“查看备份”中恢复。'}</p>${confirmation}${d.busy?'<p class="manage-busy" role="status">正在处理，请稍候…</p>':''}${d.error?`<p class="manage-error">${esc(d.error)}</p>`:''}<div class="manage-list">${d.loading?'<div class="empty-state">正在读取…</div>':rows||`<div class="empty-state"><strong>${backups?'尚无备份':'没有找到存档'}</strong></div>`}</div><div class="install-actions"><button class="outline-btn" data-action="close-manage" ${d.busy?'disabled':''}>关闭</button></div></section></div>`;
}
async function loadManage(view=state.manageView) {
 if(!view)return;view.loading=true;view.error='';renderOverlay();
 try{const items=await invoke(view.kind==='backups'?'list_backups':'list_worlds',{gameDir:view.gameDir,version:view.version});if(state.manageView===view)view.items=Array.isArray(items)?items:[];}catch(e){if(state.manageView===view)view.error=String(e);}finally{if(state.manageView===view){view.loading=false;renderOverlay();}}
}
async function openManage(kind,version,gameDir=state.gameDir){
 const item=state.versions.find(v=>v.id===version&&v.installed);if(!item)return;
 const view={kind,version,gameDir,name:item.name||version,isolated:!!item.isolated,items:[],loading:true,busy:false,error:'',confirm:null};state.instanceView=null;state.manageView=view;renderOverlay();await loadManage(view);
}
async function manageOperation(command,args,success){
 const view=state.manageView;if(!view||view.busy)return;view.busy=true;view.error='';renderOverlay();
 try{await invoke(command,{gameDir:view.gameDir,version:view.version,...args});if(state.manageView===view){view.confirm=null;flash(success);await loadManage(view);}}
 catch(e){if(state.manageView===view)view.error=String(e);}
 finally{if(state.manageView===view){view.busy=false;renderOverlay();}}
}
function conflictSummary(){
 const r=state.modConflicts;if(!r)return '';
 const issues=Array.isArray(r.issues)?r.issues:[];
 return `<div class="conflict-report"><strong>${issues.length?`发现 ${issues.length} 个可能问题`:'未发现可识别的冲突'}</strong><span>已检查 ${esc(r.checked)} 个；${esc(r.unknown)} 个文件无法识别。未识别的版本规则不会被视为冲突。</span>${issues.length?`<ul>${issues.map(i=>`<li>${esc(i.message)}${i.files?.length?` <small>${esc(i.files.join('、'))}</small>`:''}</li>`).join('')}</ul>`:''}</div>`;
}

function modUpdateSummary() { const r=state.modUpdates;if(!r)return '<p class="mod-update-summary">更新检查仅覆盖可识别的 Modrinth 模组，并按当前游戏版本和加载器筛选。</p>';return `<p class="mod-update-summary">已检查 ${r.checked} 个，发现 ${r.updates.length} 个可更新；${r.unknown} 个无法识别或确认，${r.failed} 个检查失败。</p>`; }
function localModList() {
 const matches=state.localMods.map((mod,index)=>({mod,index})).filter(({mod})=>mod.name.toLocaleLowerCase().includes(state.modQuery.trim().toLocaleLowerCase()) && (state.modFilter==='all'||mod.enabled===(state.modFilter==='enabled')));
 const selected=state.selectedMods.size, busy=state.modWorking || state.contentBusy;
 return `<div class="mod-bulk"><label><input type="checkbox" id="mod-select-visible" ${matches.length && matches.every(({mod})=>state.selectedMods.has(mod.name))?'checked':''} ${!matches.length||busy?'disabled':''}> 选择筛选结果</label><span>已选择 ${selected} 个</span><div><button class="row-button" data-action="bulk-mod-enable" ${!selected||busy?'disabled':''}>启用</button><button class="row-button" data-action="bulk-mod-disable" ${!selected||busy?'disabled':''}>停用</button><button class="row-button danger-button" data-action="bulk-mod-delete" ${!selected||busy?'disabled':''}>删除</button></div></div><div class="version-list">${matches.length ? matches.map(({mod:m,index:i})=>`<div class="version-row"><input class="mod-check" type="checkbox" data-mod-select="${i}" aria-label="选择 ${esc(m.name)}" ${state.selectedMods.has(m.name)?'checked':''} ${busy?'disabled':''}><div class="row-icon">${icon('blocks',19)}</div><div class="row-name"><strong class="java-path">${esc(m.name)}</strong><span>${m.enabled ? '已启用' : '已停用'}${state.modUpdates?.updates.find(u=>u.name===m.name) ? ` · 可更新至 ${esc(state.modUpdates.updates.find(u=>u.name===m.name).latest)}` : ''}</span></div>${state.modUpdates?.updates.find(u=>u.name===m.name) ? `<button class="row-button" data-open-project="https://modrinth.com/mod/${esc(state.modUpdates.updates.find(u=>u.name===m.name).projectId)}">查看更新</button>` : ''}<button class="row-button" data-mod-toggle="${i}" ${busy?'disabled':''}>${m.enabled ? '停用' : '启用'}</button><button class="row-button danger-button" data-mod-remove="${i}" ${busy?'disabled':''}>删除</button></div>`).join('') : `<div class="empty-state">${icon('box',27)}<strong>${state.localMods.length?'没有匹配的模组':'当前实例没有模组'}</strong><p>${state.localMods.length?'试试其他筛选条件。':'在上方搜索并安装兼容的模组。'}</p></div>`}</div>`;
}
function renderLocalMods() { const list=app.querySelector('#local-mod-list');if(list){list.innerHTML=localModList();hydrateIcons();}const target=app.querySelector('#contentTarget');if(target)target.disabled=state.modWorking||state.contentBusy;const count=app.querySelector('#local-mod-count');if(count)count.textContent=state.localMods.length;const label=app.querySelector('#local-mod-target');if(label)label.textContent=state.contentTarget||'未选择游戏版本';const summary=app.querySelector('#local-mod-update-summary');if(summary)summary.innerHTML=modUpdateSummary();const conflicts=app.querySelector('#mod-conflict-report');if(conflicts)conflicts.innerHTML=conflictSummary();const conflictButton=app.querySelector('[data-action=check-mod-conflicts]');if(conflictButton){conflictButton.disabled=state.modConflictsLoading||!state.contentTarget||state.modWorking;conflictButton.textContent=state.modConflictsLoading?'排查中…':'排查冲突';}const check=app.querySelector('[data-action=check-mod-updates]');if(check){check.disabled=state.modChecking||!state.contentTarget||state.modWorking;check.textContent=state.modChecking?'检查中…':'检查更新';} }
async function applyModChanges(action, names) {
 if(state.modWorking || !names.length) return;
 const version=state.contentTarget,gameDir=state.gameDir,chosen=state.localMods.filter(m=>names.includes(m.name));
 state.modWorking=true;modEpoch++;state.modUpdates=null;state.modConflicts=null;renderLocalMods();let done=0,failed=[];
 for(const mod of chosen) {
  if(action!=='delete' && mod.enabled===(action==='enable')) continue;
  try { if(action==='delete') await invoke('remove_mod',{gameDir,version,name:mod.name}); else await invoke('set_mod_enabled',{gameDir,version,name:mod.name,enabled:action==='enable'});done++; }
  catch(e) { failed.push(`${mod.name}：${e}`); }
 }
 state.modWorking=false;if(version===state.contentTarget && gameDir===state.gameDir){state.selectedMods.clear();await refreshMods();if(action==='delete' && state.contentResults.length) await searchContent();}
 flash(failed.length?`已处理 ${done} 个，${failed.length} 个失败：${failed.join('；')}`:`已处理 ${done} 个模组。`,failed.length?'error':'');
}
async function refreshMods() {
 const version=state.contentTarget, gameDir=state.gameDir;
 if (!version) { state.localMods = []; if(state.page==='content') renderLocalMods(); return; }
 try { const mods=await invoke('list_mods',{gameDir,version}); if(version===state.contentTarget && gameDir===state.gameDir) {state.localMods=mods;const names=new Set(mods.map(m=>m.name));for(const name of state.selectedMods)if(!names.has(name))state.selectedMods.delete(name);} }
 catch (e) { if(version===state.contentTarget) { state.localMods=[]; state.notice=`读取模组失败：${e}`; state.noticeKind='error'; } }
 if (state.page==='content' && version===state.contentTarget) renderLocalMods();
}
const categoryCache=new Map();
const contentCache=new Map();
let categoryEpoch=0;
function updateCategoryControl() {
 const select=app.querySelector('#content-category');if(!select)return;
 select.innerHTML=`<option value="">全部分类</option>${state.contentCategories.map(c=>`<option value="${esc(c.id)}" ${state.contentCategory===c.id?'selected':''}>${esc(c.name)}</option>`).join('')}`;
 select.disabled=state.contentCategoriesLoading || !state.contentCategories.length;
 select.title=state.contentCategoryError || (state.contentCategoriesLoading?'正在加载分类':'按来源分类筛选');
}
async function loadContentCategories() {
 const source=state.contentSource,kind=state.contentKind,apiKey=state.contentKey,epoch=++categoryEpoch,key=JSON.stringify([source,kind]);
 state.contentCategories=[];state.contentCategoryError='';
 if(source==='curseforge' && !apiKey.trim()){state.contentCategoriesLoading=false;updateCategoryControl();return;}
 const cached=source==='modrinth'?categoryCache.get(key):null;
 if(cached && cached.expires>Date.now()){state.contentCategories=cached.items;state.contentCategoriesLoading=false;updateCategoryControl();return;}
 state.contentCategoriesLoading=true;updateCategoryControl();
 try {const result=await invoke('content_categories',{source,kind,apiKey});if(epoch!==categoryEpoch)return;const items=Array.isArray(result)?result.filter(c=>typeof c?.id==='string'&&typeof c?.name==='string'):[];state.contentCategories=items;if(source==='modrinth')categoryCache.set(key,{items,expires:Date.now()+3600000});}
 catch(e){if(epoch===categoryEpoch)state.contentCategoryError=String(e);}
 finally{if(epoch===categoryEpoch){state.contentCategoriesLoading=false;updateCategoryControl();}}
}

let contentEpoch = 0;
async function searchContent(force=false) {
 if(state.contentBusy) return;
 if(state.contentKind!=='modpack' && !state.contentTarget) { state.contentLoaded=false;state.contentResults=[];state.contentError='';if(state.page==='content')render();return; }
 if(state.contentSource==='curseforge' && !state.contentKey.trim()) { state.contentLoaded=false;state.contentResults=[];state.contentError='';if(state.page==='content')render();return; }
 const snapshot={source:state.contentSource,kind:state.contentKind,query:state.contentQuery,apiKey:state.contentKey,gameDir:state.gameDir,version:state.contentTarget,page:state.contentPage,sort:state.contentSort,category:state.contentCategory,gameFilter:state.contentKind==='modpack'?state.contentGameFilter:'',loaderFilter:state.contentKind==='modpack'?state.contentLoaderFilter:'',environment:state.contentSource==='modrinth'?state.contentEnvironment:''};
 const key=JSON.stringify([snapshot,contentEpoch,modEpoch]);
 const epoch=contentEpoch;
 state.contentBusy=true;state.contentError=''; render();
 const isCurrent=()=>epoch===contentEpoch && snapshot.version===state.contentTarget && snapshot.kind===state.contentKind && snapshot.source===state.contentSource && snapshot.page===state.contentPage && snapshot.sort===state.contentSort && snapshot.query===state.contentQuery && snapshot.gameDir===state.gameDir && snapshot.category===state.contentCategory && snapshot.gameFilter===(state.contentKind==='modpack'?state.contentGameFilter:'') && snapshot.loaderFilter===(state.contentKind==='modpack'?state.contentLoaderFilter:'') && snapshot.environment===(state.contentSource==='modrinth'?state.contentEnvironment:'');
 try { const entry=!force&&snapshot.source==='modrinth'?contentCache.get(key):null;const cached=entry && entry.expires>Date.now()?entry:null;const result=cached?cached.result:await invoke('search_content',snapshot);if(!cached && snapshot.source==='modrinth'){contentCache.set(key,{result,expires:Date.now()+45000});if(contentCache.size>40)contentCache.delete(contentCache.keys().next().value);} if(isCurrent()) {state.contentResults=result.hits;state.contentHasMore=result.hasMore;state.contentLoaded=true;} }
 catch(e) { if(isCurrent()) {state.contentError=String(e);state.contentLoaded=false;state.contentHasMore=false;state.contentResults=[];} }
 state.contentBusy=false; if(state.page==='content') {if(!isCurrent()) await searchContent();else render();}
}

function projectLinks(d) {
 const links=[];
 if(d.projectUrl) links.push({label:d.source==='modrinth'?'Modrinth':'CurseForge',url:d.projectUrl});
 for(const link of d.links || []) if(link && typeof link.url==='string' && !links.some(x=>x.url===link.url)) links.push(link);
 if(!links.some(x=>x.label==='MC 百科')) links.push({label:'搜索 MC 百科',url:`https://search.mcmod.cn/s?key=${encodeURIComponent(d.title)}`});
 return `<div class="project-links"><strong>相关网址</strong>${links.map(link=>`<button type="button" class="content-project-link" data-open-project="${esc(link.url)}" title="在浏览器中打开"><span>${esc(link.label)}</span><small>${esc(link.url)} ↗</small></button>`).join('')}${d.linksLoading?'<p>正在获取其他网址…</p>':d.linksError?'<p>其他网址暂时不可用，仍可打开上面的链接。</p>':''}</div>`;
}
function updateProjectLinks() {const root=app.querySelector('.mod-project-links');if(root && state.modDraft)root.innerHTML=projectLinks(state.modDraft);}
function descriptionText(value) {
 const template=document.createElement('template');template.innerHTML=String(value || '');
 template.content.querySelectorAll('script,style,iframe,object,embed,svg,video,audio,img').forEach(node=>node.remove());
 template.content.querySelectorAll('br').forEach(node=>node.replaceWith(document.createTextNode('\n')));
 template.content.querySelectorAll('p,div,li,h1,h2,h3,h4,h5,h6,pre,blockquote,tr').forEach(node=>node.append(document.createTextNode('\n')));
 return (template.content.textContent || '').replace(/!\[([^\]]*)\]\([^\n)]*\)/g,'$1').replace(/\[([^\]]+)\]\([^\n)]*\)/g,'$1').replace(/^\s{0,3}#{1,6}\s+/gm,'').replace(/^\s*`{3,}[^\n]*$/gm,'').replace(/\*\*|~~|`/g,'').replace(/\n{3,}/g,'\n\n').trim();
}
function projectDescription(d) {
 const description=descriptionText(d.description) || String(d.summary || '').trim();
 return `<section class="project-description"><div class="project-description-head"><strong>项目介绍</strong>${d.descriptionLoading?'<small>正在获取完整介绍…</small>':d.descriptionError?'<small>完整介绍暂时不可用</small>':''}</div>${description?`<div class="project-description-text" tabindex="0">${esc(description)}</div>`:`<p>${d.descriptionLoading?'正在加载介绍…':d.descriptionError?'暂时无法获取介绍。':'暂无介绍。'}</p>`}</section>`;
}
function updateProjectDescription() {const root=app.querySelector('.mod-project-description');if(root && state.modDraft)root.innerHTML=projectDescription(state.modDraft);}
function modVersionDialog() {
 const d=state.modDraft; if(!d) return '';
 const pack=d.kind==='modpack', label=({mod:'模组',resourcepack:'材质包',shader:'光影包'})[d.kind] || '内容';
 return `<div class="install-overlay" data-action="close-mod-backdrop"><section class="install-dialog mod-dialog" role="dialog" aria-modal="true" aria-labelledby="mod-dialog-title"><div class="install-dialog-head"><div><span class="section-index">${pack?'MODPACK':esc(label)+'版本'} / ${esc(d.source)}</span><h2 id="mod-dialog-title">${esc(d.title)}</h2><p>${pack?'整合包将创建独立游戏目录':`安装到 ${esc(d.target)}${d.kind==='mod'?' · 自动安装必需依赖':d.kind==='shader'?' · 游戏中需支持光影并手动启用':' · 在游戏资源包设置中启用'}`}</p></div><button class="icon-button" data-action="close-mod-dialog" aria-label="关闭">${icon('x',19)}</button></div>${d.kind==='shader'?`<p class="pack-dialog-status">${esc(state.shaderEnvLoading?'正在检测光影环境…':state.shaderEnv?.detected?.length?`已检测到 ${state.shaderEnv.detected.join("、")}；请在游戏中启用光影，具体兼容性以实际运行为准。`:'尚未确认光影环境；下载后仍需 Iris、Oculus 或 OptiFine 等组件。')}</p>`:''}<div class="mod-project-description">${projectDescription(d)}</div><div class="mod-project-links">${projectLinks(d)}</div>${pack?'':`<div class="install-section-heading"><span>01</span><div><strong>选择${esc(label)}版本</strong><small>${d.kind==='mod'?'仅显示兼容目标游戏版本和加载器的版本':'仅显示来源标注支持目标游戏版本的版本'}</small></div></div>${d.loading?'<div class="empty-state">正在获取兼容版本…</div>':d.error?`<div class="empty-state">${esc(d.error)}</div>`:d.versions.length?`<div class="mod-version-list">${d.versions.map((v,i)=>`<label class="mod-version-option"><input type="radio" name="modVersion" value="${esc(v.id)}" ${i===0?'checked':''}><span><strong>${esc(v.name)}</strong><small>${esc(v.number)} · ${esc(v.date)}</small></span></label>`).join('')}</div>`:'<div class="empty-state">没有找到兼容版本</div>'}`}<div class="install-actions"><button class="outline-btn" data-action="close-mod-dialog">取消</button><button class="save-button" data-action="confirm-mod-install" ${d.installed||(!pack&&(d.loading||d.error||!d.versions.length))?'disabled':''}>${d.installed?'已安装':'加入下载任务'} ${icon('chevron-right',16)}</button></div></section></div>`;
}
function archiveDialog() {
 const d=state.archiveDraft; if(!d) return '';
 if(d.kind==='export') return `<div class="install-overlay" data-action="close-archive-backdrop"><section class="install-dialog archive-dialog" role="dialog" aria-modal="true" aria-labelledby="archive-title"><div class="install-dialog-head"><div><span class="section-index">EXPORT / GAME INSTANCE</span><h2 id="archive-title">导出 <em>${esc(d.version)}</em></h2><p>打包游戏数据，选择适合的导出格式。</p></div><button class="icon-button" data-action="close-archive" aria-label="关闭">${icon('x',19)}</button></div><div class="archive-details"><p>包含模组、配置、游戏设置和资源包，导入时联网获取游戏与加载器。</p><label class="archive-check"><input type="radio" name="archiveFormat" value="ccl" checked><span><strong>CCL 游戏包 · ZIP</strong><small>可在 CCL 导入，并保存启动参数。</small></span></label><label class="archive-check"><input type="radio" name="archiveFormat" value="pcl"><span><strong>PCL 兼容整合包 · MRPACK</strong><small>PCL 和 CCL 均可导入；不包含 CCL 启动参数，PCL 不支持 Quilt。</small></span></label><label class="archive-check"><input type="checkbox" id="archive-saves"><span><strong>包含世界存档</strong><small>存档可能较大；未勾选时不会导出 saves 文件夹。</small></span></label><p class="archive-hint">日志、截图和启动器账号不会打包。共用游戏目录的版本会导出该目录中的模组和配置。</p></div><div class="install-actions"><button class="outline-btn" data-action="close-archive">取消</button><button class="save-button" data-action="confirm-export">选择位置并导出 ${icon('chevron-right',16)}</button></div></section></div>`;
 const m=d.manifest;
 return `<div class="install-overlay" data-action="close-archive-backdrop"><section class="install-dialog archive-dialog" role="dialog" aria-modal="true" aria-labelledby="archive-title"><div class="install-dialog-head"><div><span class="section-index">IMPORT / GAME INSTANCE</span><h2 id="archive-title">导入 <em>${esc(m.name)}</em></h2><p>创建独立游戏目录，不覆盖已有版本。</p></div><button class="icon-button" data-action="close-archive" aria-label="关闭">${icon('x',19)}</button></div><div class="archive-details"><div class="archive-summary"><div><small>游戏版本</small><strong>${esc(m.gameVersion)}</strong></div><div><small>加载器</small><strong>${esc(m.loader==='vanilla'?'原版':m.loader)} ${esc(m.loaderVersion || '')}</strong></div><div><small>世界存档</small><strong>${m.includeSaves?'包含':'不包含'}</strong></div></div><p>${m.format==='modrinth'?'将导入 PCL 兼容的 Modrinth 整合包；清单中的文件可能需要联网下载，可选客户端文件将一并安装。':'导入时会联网获取游戏本体和加载器；模组及配置来自导出包。'} Forge 系列需要可用的 Java。</p>${m.launchSettings?`<label class="archive-check"><input type="checkbox" id="archive-settings"><span><strong>同时导入启动参数</strong><small>将覆盖启动器当前的内存、优化和自定义参数设置。</small></span></label>`:''}</div><div class="install-actions"><button class="outline-btn" data-action="close-archive">取消</button><button class="save-button" data-action="confirm-import">加入导入任务 ${icon('chevron-right',16)}</button></div></section></div>`;
}
function instanceDialog() {
 const view=state.instanceView;if(!view)return '';
 const info=view.info;
 const size=n=>n>=1073741824?`${(n/1073741824).toFixed(2)} GB`:`${(n/1048576).toFixed(1)} MB`;
 const date=info?.lastLaunched?new Date(info.lastLaunched*1000).toLocaleString():'暂无启动记录';
 return `<div class="install-overlay"><section class="install-dialog instance-dialog" role="dialog" aria-modal="true" aria-labelledby="instance-title"><div class="install-dialog-head"><div><span class="section-index">GAME / INSTANCE</span><h2 id="instance-title">${esc(view.name)}</h2><p>查看此版本的游戏目录与资源情况。</p></div><button class="icon-button" data-action="close-instance" aria-label="关闭">${icon('x',19)}</button></div>${view.loading?'<div class="empty-state">正在统计实例文件…</div>':view.error?`<div class="empty-state">读取失败：${esc(view.error)}</div>`:info?`<div class="instance-grid"><div><small>游戏版本</small><strong>${esc(info.gameVersion)}</strong></div><div><small>加载器</small><strong>${esc(info.loader==='vanilla'?'原版':info.loader)}</strong></div><div><small>游戏目录</small><strong>${info.isolated?'独立':'共用'}</strong></div><div><small>模组文件</small><strong>${esc(info.mods)}</strong></div><div><small>材质包</small><strong>${esc(info.resourcePacks)}</strong></div><div><small>光影包</small><strong>${esc(info.shaderPacks)}</strong></div><div><small>目录占用${info.sizeIncomplete?' · 不完整':''}</small><strong>${esc(size(info.sizeBytes))}</strong></div><div><small>最近启动</small><strong>${esc(date)}</strong></div></div><p class="instance-note">${info.isolated?'统计独立游戏目录；共享的游戏本体和库文件不计入。':'统计共用游戏目录，其他未隔离的版本也会使用这些数据。'}${info.sizeIncomplete?' 部分文件无法读取或为符号链接，结果可能偏小。':''}</p>`:''}<div class="install-actions"><button class="outline-btn" data-action="close-instance">关闭</button><button class="save-button" data-open-version-folder="${esc(view.version)}">打开游戏目录</button></div></section></div>`;
}

function diagnosticContent(crash) {
 const d=crash?.diagnosis;
 const title=typeof d?.title==='string'?d.title:'暂未识别出明确原因';
 const steps=Array.isArray(d?.steps)?d.steps.filter(s=>typeof s==='string').slice(0,4):['打开启动日志查看退出前的错误信息。'];
 const source=typeof d?.source==='string'?d.source:'启动日志';
 return `<div class="crash-diagnosis"><span>可能原因 · ${esc(source)}</span><strong>${esc(title)}</strong><ul>${steps.map(step=>`<li>${esc(step)}</li>`).join('')}</ul><small>诊断结果仅供参考，请结合完整日志确认。</small></div>`;
}
function crashDialog() {
 const crash=state.crashDialog;if(!crash)return '';
 return `<div class="confirm-overlay crash-overlay"><section class="confirm-box crash-dialog" role="dialog" aria-modal="true" aria-labelledby="crash-dialog-title"><span class="section-index">GAME / DIAGNOSIS</span><h3 id="crash-dialog-title">游戏异常退出</h3><p>${esc(crash.version)} · 退出代码 ${esc(crash.code ?? '未知')}</p>${diagnosticContent(crash)}<div><button class="outline-btn" data-action="close-crash-dialog">关闭</button><button class="save-button" data-action="open-crash-log">打开启动日志</button></div></section></div>`;
}
function launchScreen() {
 const v=state.launchView; if(!v) return '';
 const failed=v.phase==='failed',waiting=v.phase==='waiting',authenticating=v.phase==='authenticating';
 return `<div class="launch-screen ${failed?'launch-failed':''}" data-launch-id="${esc(v.id)}" role="status" aria-live="polite"><div class="launch-stage"><div class="launch-album" aria-hidden="true"><div class="launch-disc"><div class="launch-disc-rotor"></div><div class="launch-disc-hub"></div></div><div class="launch-sleeve"><div class="launch-cover"></div><div class="launch-default-art"><i></i><i></i><i></i></div></div></div><div class="launch-screen-copy"><div class="launch-copy-header"><div><span class="launch-eyebrow">CCL / MINECRAFT</span><h2>${failed?'启动遇到问题':authenticating?'正在验证正版账户':waiting?'等待游戏窗口':'正在准备游戏'}</h2></div><span class="launch-version-label">${esc(v.version)}</span></div><p>${failed?esc(v.error):v.warning?esc(v.warning):authenticating?'正在恢复微软账户登录，请稍候。':waiting?'游戏进程已启动，正在等待游戏窗口出现。':'正在准备游戏环境并启动 Java，请稍候。'}</p>${failed&&v.crash?.diagnosis?diagnosticContent(v.crash):''}<div class="launch-progress ${failed?'failed':'preparing'}"><i></i></div><div class="launch-screen-actions">${failed&&v.authError?'<button class="save-button" data-action="launch-account">账户与外观</button>':failed&&v.crash?'<button class="save-button" data-action="open-crash-log">打开启动日志</button>':waiting?'<button class="outline-btn" data-action="open-log">查看启动日志</button>':''}<button class="outline-btn" data-action="close-launch-view">返回主页</button></div></div></div></div>`;
}
function accountPage() {
 const signed=!!state.account, online=state.accountMode==='microsoft' && signed, pendingOnline=usingOnlineAccount() && !signed;
 const localSkin=state.localSkin, localCape=state.localCape, capes=state.appearance?.capes || [];
 const hasSkin=!!(localSkin?.data || state.appearance?.skin);
 return `<div class="page-heading inner-heading"><div><h1>账户与外观</h1><p>登录正版账户，预览和管理角色外观。</p></div></div>
 <div class="identity-layout"><div class="identity-main"><section class="identity-card"><div class="identity-section-head"><div><h2>玩家账户</h2><p>${online ? '当前使用微软正版账户。' : pendingOnline ? '正在使用已选择的正版账户，启动游戏时会验证登录。' : '当前使用离线账户。'}</p></div><span class="identity-status ${online?'online':''}">${online?'正版':pendingOnline?'待验证':'离线'}</span></div>
 <div class="identity-account"><div class="identity-user-icon">${icon('user-round',20)}</div><div><strong>${esc((online||pendingOnline)?playerName():state.username)}</strong><small>${online ? `Minecraft Java · ${esc(state.account.uuid)}` : pendingOnline ? (state.accountRestoring?'正在后台恢复登录':'启动时验证登录') : '离线模式'}</small></div></div>
 <div class="identity-actions">${signed || state.accountKnown ? `<button class="row-button ${!usingOnlineAccount()?'selected':''}" data-action="use-offline">使用离线账户</button><button class="row-button ${usingOnlineAccount()?'selected':''}" data-action="use-microsoft">使用 ${esc(state.account?.name || state.accountName || '正版账户')}</button>${!signed?`<button class="row-button" data-action="begin-login" ${state.accountBusy||state.accountRestoring?'disabled':''}>重新登录</button>`:''}<button class="row-button danger-button" data-action="logout-microsoft" ${state.accountBusy?'disabled':''}>退出登录</button>` : `<button class="save-button" data-action="begin-login" ${state.accountBusy||state.accountRestoring?'disabled':''}>${state.accountRestoring?'正在恢复登录…':'微软账户登录'}</button>`}</div>
 ${!signed && state.accountRestoreError ? `<p class="identity-note">${esc(state.accountRestoreError)} <button class="text-link" data-action="retry-account-restore" ${state.accountRestoring?'disabled':''}>重试恢复</button> <button class="text-link" data-action="continue-offline">使用离线账户</button></p>` : ''}
 ${!signed && state.loginAttempt ? `<div class="browser-login-panel"><div class="browser-login-icon">${icon('globe-2',20)}</div><div><strong>${state.browserPrompt ? (state.browserPrompt.opened?'请在浏览器中登录':'无法自动打开浏览器') : '正在准备登录…'}</strong><p>${state.browserPrompt ? (state.browserPrompt.opened?'完成微软授权后，将自动返回启动器。':'请检查系统默认浏览器，然后重试。') : '正在启动系统浏览器。'}</p><div class="identity-actions">${state.browserPrompt?'<button class="row-button" data-action="open-microsoft-login">重新打开浏览器</button>':''}<button class="row-button" data-action="cancel-login">取消登录</button></div></div></div>` : ''}</section>
 <section class="identity-card"><div class="identity-section-head"><div><h2>皮肤</h2><p>选择 PNG 文件预览，登录后可应用到正版账户。</p></div><button class="row-button" data-action="choose-skin" ${state.accountBusy?'disabled':''}>选择皮肤</button></div><div class="skin-controls"><div class="skin-source"><strong>${esc(localSkin?.name || (state.appearance?.skin ? '当前账户皮肤' : signed ? '账户默认皮肤' : '尚未选择皮肤'))}</strong><small>${localSkin?'本地预览 · 尚未应用':state.appearance?.skin?'已从账户加载':signed?'暂无可预览的纹理':'请选择皮肤图片'}</small></div><label>模型<select id="skin-model"><option value="classic" ${state.skinModel==='classic'?'selected':''}>标准</option><option value="slim" ${state.skinModel==='slim'?'selected':''}>纤细</option></select></label>${localSkin?`<button class="row-button" data-action="clear-skin">清除预览</button><button class="save-button" data-action="upload-skin" ${!signed||state.accountBusy?'disabled':''}>应用到正版账户</button>`:''}</div><p class="identity-note">支持 64×64 或 64×32 PNG。离线模式的本地预览不会改变游戏内皮肤。</p>${signed?`<button class="text-link" data-action="reset-skin" ${state.accountBusy?'disabled':''}>恢复账户默认皮肤</button>`:''}</section>
 <section class="identity-card"><div class="identity-section-head"><div><h2>披风</h2><p>切换账户已有披风，或预览本地图片。</p></div><button class="row-button" data-action="choose-cape" ${state.accountBusy?'disabled':''}>预览本地披风</button></div>${localCape?`<div class="local-cape"><span>${esc(localCape.name)} · 仅预览</span><button class="row-button" data-action="clear-cape">清除预览</button></div>`:''}<div class="cape-list">${signed ? capes.length ? capes.map((cape,i)=>`<div class="cape-row ${state.previewCapeId===cape.id&&!localCape?'cape-previewed':''}"><div><strong>${esc(cape.name)}</strong><small>${cape.active?'当前使用':''}</small></div><button class="row-button" data-preview-cape="${i}" ${!cape.texture?'disabled':''}>预览</button><button class="row-button ${cape.active?'selected':''}" data-apply-cape="${i}" ${cape.active||state.accountBusy?'disabled':''}>${cape.active?'已使用':'使用'}</button></div>`).join('') : '<p class="identity-empty">账户暂无可用披风。</p>' : '<p class="identity-empty">登录后可管理账户拥有的披风。</p>'}</div>${signed && capes.some(c=>c.active)?`<button class="text-link" data-action="hide-cape" ${state.accountBusy?'disabled':''}>不使用披风</button>`:''}<p class="identity-note">正版披风由 Minecraft 账户授予，本地图片仅用于预览。</p></section></div>
 <aside class="identity-preview"><div class="preview-headline"><strong>角色预览</strong><span>${state.skinModel==='slim'?'纤细':'标准'}模型</span></div><div class="preview-stage"><canvas id="skin-preview" aria-label="Minecraft 角色皮肤与披风预览" ${hasSkin?'':'hidden'}></canvas><div class="preview-empty" ${hasSkin?'hidden':''}>${localCape || state.previewCapeId ? '请先选择皮肤以预览披风' : '选择皮肤后显示预览'}</div><div class="preview-fallback" hidden>当前环境无法显示预览</div></div><p class="preview-caption">${hasSkin ? `拖动角色可旋转 · ${state.localCape?'本地披风预览':state.previewCapeId?'账户披风预览':'无披风'}` : '暂无皮肤预览'}</p></aside></div>`;
}
let viewer=null, previewGeneration=0;
function refreshPreview() {
 const generation=++previewGeneration;
 if(viewer) { viewer.dispose(); viewer=null; }
 const canvas=app.querySelector('#skin-preview'); if(!canvas) return;
 const cape=state.localCape?.data || state.appearance?.capes?.find(c=>c.id===state.previewCapeId)?.texture || null;
 const skin=state.localSkin?.data || state.appearance?.skin || null;
 if(!skin) return;
 import('./appearance-preview.js').then(m=>m.createAppearancePreview(canvas,skin,cape,state.skinModel)).then(next=>{if(generation!==previewGeneration) next.dispose(); else { viewer=next; if(next.is2d) { const caption=app.querySelector('.preview-caption'); if(caption) caption.textContent=`2D 预览 · ${state.localCape?'本地披风预览':state.previewCapeId?'账户披风预览':'无披风'}`; } }}).catch(()=>{if(generation===previewGeneration) { const el=app.querySelector('.preview-fallback'); if(el) el.hidden=false; }});
}
let appearanceRequest=null;
function refreshAppearance({reuse=false}={}) {
 const account=state.account; if(!account?.uuid) return Promise.resolve();
 if(reuse && appearanceRequest?.account===account) return appearanceRequest.promise;
 const request={account};appearanceRequest=request;
 request.promise=(async()=>{
  try { const result=await invoke('get_appearance'); if(state.account!==account || appearanceRequest!==request) return; state.appearance=result; state.skinModel=result.model==='slim'?'slim':'classic'; state.previewCapeId=result.capes.find(c=>c.active)?.id || ''; }
  catch(e) { if(state.account!==account || appearanceRequest!==request) return; state.appearance=null; flash(`无法获取账户外观：${e}`,'error'); }
  finally { if(appearanceRequest===request) appearanceRequest=null; }
  if(state.page==='account') render();
 })();
 return request.promise;
}
async function refreshInstalled(dir) {
 if (dir !== state.gameDir) return;
 try {
  const installed=await invoke('installed_versions',{gameDir:dir}); const byId=new Map(installed.map(v=>[v.id,v]));
  if (state.online) { const known=new Set(state.versions.map(v=>v.id)); const extra=installed.filter(v=>!known.has(v.id)); state.versions=[...extra,...state.versions.map(v=>v.kind==='正式版'?{...v,installed:byId.has(v.id),isolated:!!byId.get(v.id)?.isolated,hasInstanceData:!!byId.get(v.id)?.hasInstanceData}:byId.get(v.id)).filter(Boolean)]; }
  else state.versions=installed;
  if (!installed.some(v=>v.id===state.selected)) { state.selected=installed[0]?.id || ''; persist(); }
  loadInstalledCovers();
  if (state.page==='versions' || state.page==='home') render(); else renderChrome();
 } catch (e) { flash(`无法刷新已安装版本：${e}`,'error'); }
}
const { downloadsPage, saveJobs, runnerFor, restoreJobs, renderJobList, hasJob, enqueueJob, pumpJobs, requestJobCancel, jobEvent, queueVersion, activeJobCount } = createJobManager({
 state, app, invoke, persist, esc, icon, hydrateIcons, renderChrome, flash, render, refreshInstalled,
 onJobFinished: async job => {
  if(['resourcepack','shader'].includes(job.kind) && job.version===state.contentTarget && job.gameDir===state.gameDir && state.contentKind===job.kind) { contentEpoch++; state.contentLoaded=false; if(state.page==='content') await Promise.all([refreshPacks(),searchContent()]); }
  if (job.kind==='mod' && job.version===state.contentTarget && job.gameDir===state.gameDir) {
   modEpoch++;state.modUpdates=null;state.modConflicts=null;
   if(state.page==='content'){await refreshMods();if(state.contentKind==='shader')await refreshPacks();await searchContent();}
  }
 }
});
function javaPage() {
 const runtimes = state.javaRuntimes;
 const options = [8, 17, 21, 25];
 const mb = n => (n / 1048576).toFixed(1) + ' MB';
 return `<div class="page-heading inner-heading"><div><h1>Java 管理</h1><p>下载或选择适合游戏版本的 Java。</p></div><button class="outline-btn" data-action="refresh-java" ${state.javaLoading ? 'disabled' : ''}>${icon('refresh-cw',16)} ${state.javaLoading ? '正在检测' : '检测本机 Java'}</button></div>
 <div class="section-title"><div><span class="section-index">01 / DOWNLOAD</span><h3>下载 Java</h3></div><span class="section-note">Eclipse Temurin · JRE · 当前系统和架构</span></div>
 <div class="java-download-grid">${options.map(major => { const installed = runtimes.some(j => j.managed && j.major === major); const desc = {8:'适用于多数旧版本',17:'适用于部分较新版本',21:'适用于较新版本',25:'适用于需要 Java 25 的版本'}[major]; return `<div class="java-download-card"><div class="java-card-top"><span>JAVA</span>${icon('download',16)}</div><strong>${major}</strong><p>${desc}</p><button data-java-install="${major}" ${hasJob(`java:${major}`) || installed || state.javaLoading ? 'disabled' : ''}>${installed ? '已安装' : hasJob(`java:${major}`) ? '任务中' : '下载安装'}</button></div>`; }).join('')}</div>
 <div class="section-title"><div><span class="section-index">02 / INSTALLED</span><h3>可用的 Java <span class="count">${runtimes.length}</span></h3></div><span class="section-note">当前启动路径：${esc(state.javaPath)}</span></div>
 <div class="version-list">${runtimes.length ? runtimes.map((j,i) => `<div class="version-row java-row"><div class="row-icon">${icon('monitor',19)}</div><div class="row-name"><strong>Java ${esc(j.major || '')} <span class="java-version">${esc(j.version)}</span></strong><span class="java-path" title="${esc(j.path)}">${esc(j.path)}</span></div><div class="row-state installed"><span></span>${j.managed ? 'CCL 管理' : '本机环境'}</div><button class="row-button ${state.javaPath === j.path ? 'selected' : ''}" data-java-select="${i}">${state.javaPath === j.path ? '当前使用' : '选择使用'}</button>${j.managed ? `<button class="row-button danger-button" data-java-remove="${i}" ${hasJob(`java:${j.major}`) ? 'disabled' : ''}>删除</button>` : ''}</div>`).join('') : `<div class="empty-state">${icon('monitor',27)}<strong>${state.javaLoading ? '正在检测 Java…' : '尚未检测到 Java 环境'}</strong><p>下载一个版本，或在启动设置中手动填写路径。</p></div>`}</div>
 ${state.javaDelete !== null && runtimes[state.javaDelete] ? `<div class="confirm-overlay"><div class="confirm-box"><span class="section-index">REMOVE RUNTIME</span><h3>删除 Java ${esc(runtimes[state.javaDelete].major)}？</h3><p>将删除由 CCL 下载的此 Java 环境。游戏文件和本机其他 Java 不受影响。</p><div><button class="row-button" data-action="cancel-java-remove">取消</button><button class="row-button danger-button" data-action="confirm-java-remove">确认删除</button></div></div></div>` : ''}`;
}
async function refreshJava() {
 state.javaLoading = true; if (state.page === 'java') render();
 try { state.javaRuntimes = await invoke('list_java'); }
 catch (e) { state.notice = `检测 Java 失败：${e}`; state.noticeKind = 'error'; }
 state.javaLoading = false; if (state.page === 'java') render();
}
let renderedPage = null;
let composingSearch = false;
let pendingCompositionRender = false;
function renderChrome() {
 renderUpdateChrome();
 const root = app.querySelector('#toast-root'); if (!root) return;
 root.innerHTML = state.notice ? `<div class="toast ${state.noticeKind}">${esc(state.notice)}${state.crash && state.noticeCrash ? '<button class="toast-log" data-action="open-crash-diagnosis">查看诊断</button><button class="toast-log" data-action="open-crash-log">查看日志</button>' : ''}<button data-action="dismiss" aria-label="关闭">${icon('x',15)}</button></div>` : '';
 const badge = app.querySelector('.job-badge'); if (badge) { const n = activeJobCount(); badge.textContent = n ? String(n) : ''; badge.classList.toggle('has-jobs', !!n); }
 const cancelAll=app.querySelector('[data-action="cancel-all-jobs"]');if(cancelAll)cancelAll.disabled=!state.jobs.some(j=>j.status==='queued'||j.status==='running');
 const footer = app.querySelector('.side-footer'); if (footer) footer.innerHTML = `<span class="status-dot"></span> ${state.online ? '版本服务已连接' : '本地工作区'} <span>v${esc(appVersion)}</span>`;
 const count = app.querySelector('.side-card strong'); if (count) count.innerHTML = `${String(state.versions.filter(v=>v.installed).length).padStart(2,'0')} <small>个版本</small>`;
 hydrateIcons();
}
function renderOverlay() {
 const root=app.querySelector('#modal-root');if(!root)return;
 const current=root.querySelector('.launch-screen');
 if(state.launchView && current?.dataset.launchId===state.launchView.id) {
  const template=document.createElement('template');template.innerHTML=launchScreen();
  const next=template.content.querySelector('.launch-screen');
  current.classList.toggle('launch-failed',state.launchView.phase==='failed');
  current.querySelector('.launch-screen-copy').innerHTML=next.querySelector('.launch-screen-copy').innerHTML;
 } else root.innerHTML=state.launchView ? launchScreen() : state.crashDialog ? crashDialog() : state.themeView ? themeDialog() : state.profileView ? profileDialog() : state.manageView ? manageDialog() : state.instanceView ? instanceDialog() : state.installDraft ? installDialog() : state.modDraft ? modVersionDialog() : state.archiveDraft ? archiveDialog() : '';
 if(state.profileView)paintProfileImages(state.profileView);
 hydrateIcons();
}
function render() {
 if(composingSearch && renderedPage===state.page) { pendingCompositionRender=true;return; }
 if(composingSearch && renderedPage!==state.page) { composingSearch=false;pendingCompositionRender=false; }
 const first = !app.querySelector('.app-shell');
 if (first) app.innerHTML = shell();
 else {
  const content = app.querySelector('.content');
  const same = renderedPage === state.page;
  const main=app.querySelector('.main'),scrollTop=main?.scrollTop,scrollLeft=main?.scrollLeft,docScroll=document.scrollingElement||document.documentElement,docTop=docScroll.scrollTop,docLeft=docScroll.scrollLeft;
  const values = same ? [...content.querySelectorAll('form input, form select')].filter(x => x.name).map(x => ({name:x.name, value:x.value, checked:x.checked, type:x.type})) : [];
  const active = same && content.contains(document.activeElement) ? document.activeElement : null;
  const focus = active ? { name:active.name, id:active.id, start:active.selectionStart, end:active.selectionEnd } : null;
  content.innerHTML = state.page === 'home' ? home() : state.page === 'versions' ? versionsPage() : state.page === 'java' ? javaPage() : state.page === 'content' ? contentPage() : state.page === 'downloads' ? downloadsPage() : state.page === 'account' ? accountPage() : state.page === 'multiplayer' ? multiplayerPage() : settingsPage();
  for (const saved of values) { const el = [...content.querySelectorAll('form input, form select')].find(x => x.name === saved.name && x.type === saved.type); if (el) { el.value = saved.value; if (el.type === 'checkbox' || el.type === 'radio') el.checked = saved.checked; } }
  if (focus) { const el = [...content.querySelectorAll('input, select')].find(x => focus.id ? x.id === focus.id : x.name === focus.name); if (el) { el.focus({preventScroll:true}); if (focus.start != null && typeof el.setSelectionRange === 'function') { try { el.setSelectionRange(focus.start, focus.end); } catch {} } } }
  if(same && main){main.scrollTop=scrollTop;main.scrollLeft=scrollLeft;docScroll.scrollTop=docTop;docScroll.scrollLeft=docLeft;}
  app.querySelectorAll('.nav [data-page]').forEach(el => el.classList.toggle('active', el.dataset.page === state.page));
  app.querySelector('.breadcrumbs strong').textContent = ({home:'启动游戏',versions:'版本管理',content:'模组与资源',downloads:'下载任务',multiplayer:'多人联机',java:'Java 管理',account:'账户与外观',settings:'启动设置'})[state.page];
  app.querySelector('.avatar').textContent = playerName().slice(0,1).toUpperCase(); app.querySelector('.profile strong').textContent = playerName(); app.querySelector('.profile small').textContent = playerStatus();
 }
 renderedPage = state.page; syncMemoryControls(); applyTheme(); renderChrome(); if(!(state.modDraft && app.querySelector("#modal-root .mod-dialog")) && !(state.archiveDraft && app.querySelector("#modal-root .archive-dialog"))) renderOverlay(); hydrateIcons(); hydrateThumbnails(); refreshPreview();
}
function updateSearchResults(kind) {
 const content=app.querySelector('.content');if(!content)return;
 const preview=document.createElement('div');preview.innerHTML=kind==='server'?publicServersPage():versionsPage();
 const selectors=kind==='server'?['.server-summary','.server-list','.server-pagination-slot']:['.version-list','.version-toolbar .count'];
 for(const selector of selectors) { const old=content.querySelector(selector),next=preview.querySelector(selector);if(old&&next) old.replaceWith(next); }
 hydrateIcons();hydrateThumbnails();
}
async function refresh() {
 state.loading = true; render();
 try { state.versions = await invoke('list_versions', { gameDir: state.gameDir }); state.online = true; }
 catch (e) { state.online = false; try { state.versions = await invoke('installed_versions', { gameDir: state.gameDir }); } catch {} state.notice = `无法获取官方版本列表：${e}`; state.noticeKind = 'error'; }
 if (!state.versions.some(v => v.id === state.selected && v.installed)) state.selected = state.versions.find(v => v.installed)?.id || '';
 state.loading = false; persist(); render();loadInstalledCovers();
}
app.addEventListener('pointerdown', event => { const edge=event.target.closest('[data-resize]'); if (edge && event.button===0 && isTauri()) getCurrentWindow().startResizeDragging(edge.dataset.resize).catch(e=>flash(`无法调整窗口大小：${e}`,'error')); });
app.addEventListener('click', async event => {
 const themeReset=event.target.closest('[data-theme-reset]');
 if(themeReset) { const kind=themeReset.dataset.themeReset,revision=++imageRevision[kind];try { await imageStore('delete',kind);if(revision!==imageRevision[kind])return;setThemeImage(kind,null);flash('已恢复默认图片。'); } catch(e) { flash(`无法恢复默认图片：${e}`,'error'); } return; }
 const menuSummary=event.target.closest('.version-menu summary');
 app.querySelectorAll('.version-menu[open]').forEach(menu=>{ if(!menuSummary || menuSummary.parentElement!==menu) menu.open=false; });
 const windowControl=event.target.closest('[data-window]');
 if (windowControl) { if (isTauri()) { try { const win=getCurrentWindow(); if (windowControl.dataset.window==='minimize') await win.minimize(); else if(windowControl.dataset.window==='maximize') await win.toggleMaximize(); else if(windowControl.dataset.window==='close') await win.close(); } catch(e) { flash(`窗口操作失败：${e}`,'error'); } } return; }
 const page = event.target.closest('[data-page]'); if (page) { state.page = page.dataset.page; render(); if (state.page === 'account' && state.account && !state.appearance) void refreshAppearance({reuse:true}); if (state.page === 'settings') void refreshMemoryInfo(); if (state.page === 'java') await refreshJava(); if (state.page === 'multiplayer' && state.lanView==='room') await refreshLanAddresses(); if (state.page === 'multiplayer' && state.lanView==='servers' && !state.serverCatalog) await refreshPublicServers(); if (state.page === 'content') { if(!state.contentTarget || !state.versions.some(v=>v.installed && v.id===state.contentTarget)) {state.contentTarget=state.selected || '';state.selectedMods.clear();state.modUpdates=null;modEpoch++;state.contentPage=0;state.contentLoaded=false;} await refreshMods();await refreshPacks();void loadContentCategories();if(!state.contentLoaded) await searchContent(); } return; }
 const profileButton=event.target.closest('[data-game-profile]');if(profileButton){await openGameProfile(profileButton.dataset.gameProfile);return;}
 const profilePage=event.target.closest('[data-profile-page]');if(profilePage&&state.profileView&&!state.profileView.loading){const d=state.profileView,n=Number(profilePage.dataset.profilePage);if(n>=0&&(n<d.page||d.hasMore)){d.page=n;d.preview=null;await loadProfileScreenshots(d);}return;}
 const profileShot=event.target.closest('[data-profile-shot]');if(profileShot&&state.profileView){const d=state.profileView,index=Number(profileShot.dataset.profileShot),data=d.images[index];if(data){d.preview={data,name:d.shots[index].name};renderOverlay();}return;}
 const themeButton=event.target.closest('[data-instance-theme]');if(themeButton){const version=themeButton.dataset.instanceTheme,item=state.versions.find(v=>v.id===version&&v.installed);if(item){const original=getInstanceTheme(state.gameDir,version);state.themeView={version,gameDir:state.gameDir,name:item.name||version,...original,file:null,preview:null,removeCover:false,error:'',saving:false};renderOverlay();await loadInstanceCover(state.gameDir,version);if(state.themeView?.version===version)renderOverlay();}return;}
 const colorButton=event.target.closest('[data-instance-color]');if(colorButton&&state.themeView&&!state.themeView.saving&&instanceColors.includes(colorButton.dataset.instanceColor)){state.themeView.color=colorButton.dataset.instanceColor;renderOverlay();return;}
 const manageButton=event.target.closest('[data-manage-backups],[data-manage-worlds]');if(manageButton){await openManage(manageButton.hasAttribute('data-manage-backups')?'backups':'worlds',manageButton.dataset.manageBackups||manageButton.dataset.manageWorlds);return;}
 const restoreButton=event.target.closest('[data-manage-restore]');if(restoreButton&&state.manageView&&!state.manageView.busy){const item=state.manageView.items[Number(restoreButton.dataset.manageRestore)];if(item){state.manageView.confirm={action:'restore',item};renderOverlay();}return;}
 const manageDelete=event.target.closest('[data-manage-delete]');if(manageDelete&&state.manageView&&!state.manageView.busy){const item=state.manageView.items[Number(manageDelete.dataset.manageDelete)];if(item){state.manageView.confirm={action:'delete',item};renderOverlay();}return;}
 const worldOpen=event.target.closest('[data-world-open]');if(worldOpen&&state.manageView){const d=state.manageView,item=d.items[Number(worldOpen.dataset.worldOpen)];if(item){try{await invoke('open_world_folder',{gameDir:d.gameDir,version:d.version,folder:item.folder});}catch(e){d.error=String(e);renderOverlay();}}return;}
 const worldBackup=event.target.closest('[data-world-backup]');if(worldBackup&&state.manageView){const item=state.manageView.items[Number(worldBackup.dataset.worldBackup)];if(item)await manageOperation('create_backup',{scope:'world',world:item.folder},'存档备份已创建。');return;}
 const overviewButton=event.target.closest('[data-instance-overview]');if(overviewButton){const version=overviewButton.dataset.instanceOverview,gameDir=state.gameDir,item=state.versions.find(v=>v.id===version&&v.installed);if(!item)return;const view={version,gameDir,name:item.name||version,loading:true,info:null,error:''};state.instanceView=view;renderOverlay();try{const info=await invoke('instance_overview',{gameDir,version});if(state.instanceView===view)view.info=info;}catch(e){if(state.instanceView===view)view.error=String(e);}finally{if(state.instanceView===view){view.loading=false;renderOverlay();}}return;}
 const openFolder = event.target.closest('[data-open-version-folder]'); if (openFolder) { try { await invoke('open_version_folder',{gameDir:state.instanceView?.version===openFolder.dataset.openVersionFolder?state.instanceView.gameDir:state.gameDir,version:openFolder.dataset.openVersionFolder}); } catch(e) { flash(String(e),'error'); } return; }
 const deleteVersion=event.target.closest('[data-delete-version]');if(deleteVersion) {const version=state.versions.find(v=>v.id===deleteVersion.dataset.deleteVersion&&v.installed);if(version){state.versionDelete={id:version.id,name:version.name||version.id,isolated:!!(version.isolated||version.hasInstanceData),gameDir:state.gameDir};render();}return;}
 const exportButton=event.target.closest('[data-export-game]'); if(exportButton) { state.archiveDraft={kind:'export',version:exportButton.dataset.exportGame,gameDir:state.gameDir}; renderOverlay(); return; }
 const select = event.target.closest('[data-select]'); if (select) { state.selected = select.dataset.select; persist(); render();void loadInstanceCover(state.gameDir,state.selected); flash(`已选择 ${state.selected}`); return; }
 const install = event.target.closest('[data-install]'); if (install) { state.installDraft={version:install.dataset.install,loader:'vanilla',addons:[]}; renderOverlay(); return; }
 const contentPageButton=event.target.closest('[data-content-page]');if(contentPageButton && !state.contentBusy) {const page=Number(contentPageButton.dataset.contentPage);if(page>=0 && page<=332 && (page<=state.contentPage||state.contentHasMore)){state.contentPage=page;await searchContent();}return;}
 const projectLink=event.target.closest('[data-open-project]');
 if(projectLink) {const url=projectLink.dataset.openProject;if(url){try {await invoke('open_content_page',{url});} catch(e) {flash(`无法打开项目网址：${e}`,'error');}}return;}
 const contentInstall = event.target.closest('[data-content-install], [data-content-details]');
 if (contentInstall && !state.contentBusy) {
  const isDetails=contentInstall.hasAttribute('data-content-details');
  const item=state.contentResults[Number(isDetails?contentInstall.dataset.contentDetails:contentInstall.dataset.contentInstall)]; if(!item) return;
  const kind=state.contentKind,source=state.contentSource,apiKey=state.contentKey,gameDir=state.gameDir,target=state.contentTarget,javaPath=state.javaPath;
  if(kind==='modpack' && !isDetails) {enqueueJob({key:`modpack:${source}:${item.id}:${gameDir}`,kind,title:item.title,gameDir,recipe:{type:'modpack',gameDir,source,projectId:item.id,javaPath},run:job=>invoke('install_modpack',{gameDir,source,projectId:item.id,apiKey,javaPath,jobId:job.id})});return;}
  if(kind!=='modpack' && !target) return;
  const draft={title:item.title,projectId:item.id,projectUrl:item.projectUrl,installed:!!item.installed,kind,source,apiKey,gameDir,target,javaPath,loading:kind!=='modpack',versions:[],error:'',links:[],linksLoading:true,linksError:false,summary:item.description||'',description:'',descriptionLoading:true,descriptionError:false};state.modDraft=draft;renderOverlay();
  const linkRequest=invoke('content_links',{source,projectId:item.id,apiKey}).then(info=>{if(state.modDraft===draft){draft.links=Array.isArray(info?.links)?info.links:[];draft.linksLoading=false;if(source==='modrinth'){draft.description=typeof info?.description==='string'?info.description:'';draft.descriptionLoading=false;}updateProjectLinks();updateProjectDescription();}}).catch(()=>{if(state.modDraft===draft){draft.linksLoading=false;draft.linksError=true;if(source==='modrinth'){draft.descriptionLoading=false;draft.descriptionError=true;}updateProjectLinks();updateProjectDescription();}});
  const descriptionRequest=source==='curseforge'?invoke('curseforge_description',{projectId:item.id,apiKey}).then(description=>{if(state.modDraft===draft){draft.description=typeof description==='string'?description:'';draft.descriptionLoading=false;updateProjectDescription();}}).catch(()=>{if(state.modDraft===draft){draft.descriptionLoading=false;draft.descriptionError=true;updateProjectDescription();}}):Promise.resolve();
  const versionRequest=kind!=='modpack' ? invoke(kind==='mod'?'list_mod_versions':'list_pack_versions',{gameDir,version:target,source,projectId:item.id,apiKey,...(kind==='mod'?{}:{kind})}).then(versions=>{if(state.modDraft===draft){draft.versions=versions;draft.loading=false;renderOverlay();}}).catch(e=>{if(state.modDraft===draft){draft.error=String(e);draft.loading=false;renderOverlay();}}) : Promise.resolve();
  await Promise.all([linkRequest,descriptionRequest,versionRequest]);return;
 }
 const packRemove=event.target.closest('[data-pack-remove]');if(packRemove && !state.packWorking){const item=state.localPacks[Number(packRemove.dataset.packRemove)];if(item){state.packDelete={name:item.name,kind:state.contentKind,version:state.contentTarget,gameDir:state.gameDir};render();}return;}
 const modToggle = event.target.closest('[data-mod-toggle]');
 if (modToggle && !state.contentBusy && !state.modWorking) { const m=state.localMods[Number(modToggle.dataset.modToggle)];if(m) await applyModChanges(m.enabled?'disable':'enable',[m.name]);return; }
 const modRemove = event.target.closest('[data-mod-remove]'); if (modRemove && !state.modWorking) { const mod=state.localMods[Number(modRemove.dataset.modRemove)];if(mod){state.modDelete=[mod.name];render();}return; }
 const javaSelect = event.target.closest('[data-java-select]');
 if (javaSelect) { const java = state.javaRuntimes[Number(javaSelect.dataset.javaSelect)]; if (java) { state.javaPath = java.path; persist(); render(); flash(`已选择 Java ${java.version}`); } return; }
 const javaRemove = event.target.closest('[data-java-remove]');
 if (javaRemove) { state.javaDelete = Number(javaRemove.dataset.javaRemove); render(); return; }
 const javaInstall = event.target.closest('[data-java-install]');
 if (javaInstall && !state.javaLoading) {
  const major=Number(javaInstall.dataset.javaInstall);
  const recipe={type:'java',major};enqueueJob({key:`java:${major}`,kind:'java',title:`Java ${major} · Eclipse Temurin`,recipe,run:runnerFor(recipe)}); if(state.page==='java') render(); return;
 }
 const retry=event.target.closest('[data-retry-job]'); if (retry) { const old=state.jobs.find(j=>j.id===retry.dataset.retryJob); if (old?.run) enqueueJob({key:old.key,kind:old.kind,title:old.title,gameDir:old.gameDir,version:old.version,run:old.run,recipe:old.recipe}); return; }
 const removeJob=event.target.closest('[data-remove-job]');if(removeJob){state.jobs=state.jobs.filter(j=>j.id!==removeJob.dataset.removeJob||!['done','failed','cancelled'].includes(j.status));saveJobs();renderJobList();return;}
 const cancelJob=event.target.closest('[data-cancel-job]');if(cancelJob){const job=state.jobs.find(j=>j.id===cancelJob.dataset.cancelJob);if(job){await requestJobCancel(job);pumpJobs();}return;}
 const action = event.target.closest('[data-action]')?.dataset.action;
 if(action==='cancel-all-jobs'){await Promise.all(state.jobs.filter(j=>j.status==='queued'||j.status==='running').map(requestJobCancel));pumpJobs();return;}
 if(action==='cancel-version-delete'){state.versionDelete=null;render();return;}
 if(action==='confirm-version-delete' && state.versionDelete && !state.versionDeleting){const d=state.versionDelete,removeInstance=!!app.querySelector('#delete-instance-data')?.checked;if(state.jobs.some(j=>j.gameDir===d.gameDir&&['queued','running','canceling'].includes(j.status))){flash('该游戏目录有进行中或等待中的任务，请先取消或等待结束。','error');return;}state.versionDeleting=true;render();try{await invoke('delete_version',{gameDir:d.gameDir,version:d.id,removeInstance});state.versionDelete=null;if(state.selected===d.id)state.selected='';if(state.contentTarget===d.id){state.contentTarget='';state.localMods=[];state.contentResults=[];}await refreshInstalled(d.gameDir);persist();flash('版本已删除。');}catch(e){flash(`删除失败：${e}`,'error');}finally{state.versionDeleting=false;render();}return;}
 const lanView=event.target.closest('[data-lan-view]'); if(lanView) { state.lanView=lanView.dataset.lanView;render();if(state.lanView==='servers'&&!state.serverCatalog&&!state.serverLoading) await refreshPublicServers();return; }
 const serverCopy=event.target.closest('[data-server-copy]');if(serverCopy) { const entry=filteredServers()[Number(serverCopy.dataset.serverCopy)];if(entry) { try { await copyText(entry.address);flash('服务器地址已复制，在游戏中选择“多人游戏 → 直接连接”粘贴。'); } catch(e) { flash(`复制失败：${e}`,'error'); } }return; }
 const serverPage=event.target.closest('[data-server-page]');if(serverPage) { state.serverPage=Math.max(0,Number(serverPage.dataset.serverPage));render();return; }
 const copyIpv6=event.target.closest('[data-copy-ipv6]');
 if(copyIpv6 && state.lanRoom) { const address=state.lanAddresses[Number(copyIpv6.dataset.copyIpv6)]; if(address) { try { await copyText(`[${address.address}]:${state.lanRoom.port}`); flash('房间地址已复制。'); } catch(e) { flash(`复制失败，请手动复制地址：${e}`,'error'); } } return; }
 if(action==='refresh-public-servers') { await refreshPublicServers(); return; }
 if(action==='refresh-ipv6') { await refreshLanAddresses(); return; }
 if(action==='stop-ipv6-room' && !state.lanBusy) { state.lanBusy=true;render();try { await invoke('stop_ipv6_room');state.lanRoom=null;flash('房间已关闭。'); } catch(e) { flash(`关闭房间失败：${e}`,'error'); } finally { state.lanBusy=false;render(); } return; }
 if(action==='import-game') { try { const path=await openDialog({multiple:false,directory:false,filters:[{name:'CCL 或 PCL 兼容整合包',extensions:['zip','mrpack']}]}); if(path && typeof path==='string') { const manifest=await invoke('inspect_game_archive',{path}); state.archiveDraft={kind:'import',path,manifest,gameDir:state.gameDir,javaPath:state.javaPath}; renderOverlay(); } } catch(e) { flash(`无法读取导入包：${e}`,'error'); } return; }
 if(action==='close-archive' || (action==='close-archive-backdrop' && event.target.classList.contains('install-overlay'))) { state.archiveDraft=null; renderOverlay(); return; }
 if(action==='confirm-export' && state.archiveDraft?.kind==='export') { const d=state.archiveDraft,includeSaves=!!app.querySelector('#archive-saves')?.checked,exportFormat=app.querySelector('input[name=archiveFormat]:checked')?.value||'ccl'; try { const path=await saveDialog({defaultPath:`CCL-${d.version}.${exportFormat==='pcl'?'mrpack':'zip'}`,filters:[{name:exportFormat==='pcl'?'PCL 兼容整合包':'CCL 游戏导出包',extensions:[exportFormat==='pcl'?'mrpack':'zip']}]}); if(!path) return; const launchSettings={memory:Number(state.memory),memoryMode:state.memoryMode,optimize:state.optimize,jvmArgs:state.jvmArgs,gameArgs:state.gameArgs}; state.archiveDraft=null;renderOverlay(); enqueueJob({key:`export:${d.gameDir}:${d.version}:${path}`,kind:'export',title:`导出 · ${d.version}`,gameDir:d.gameDir,run:job=>invoke('export_game',{gameDir:d.gameDir,version:d.version,path,includeSaves,launchSettings,exportFormat,jobId:job.id})}); } catch(e) { flash(`导出失败：${e}`,'error'); } return; }
 if(action==='confirm-import' && state.archiveDraft?.kind==='import') { const d=state.archiveDraft,restoreSettings=!!app.querySelector('#archive-settings')?.checked; state.archiveDraft=null;renderOverlay();enqueueJob({key:`import:${d.gameDir}:${d.path}`,kind:'import',title:`导入 · ${d.manifest.name}`,gameDir:d.gameDir,run:async job=>{const result=await invoke('import_game',{gameDir:d.gameDir,path:d.path,javaPath:d.javaPath,jobId:job.id}); if(d.gameDir===state.gameDir) { state.selected=result.version; if(restoreSettings && result.launchSettings) Object.assign(state,result.launchSettings,{memoryMode:result.launchSettings.memoryMode==='auto'?'auto':'manual'}); persist(); } }});return; }
 if(action==='close-launch-view') { const crash=state.launchView?.crash;state.launchView=null;if(crash?.diagnosis)showCrashNotice(crash);renderOverlay();return; }
 if(action==='launch-account') {state.launchView=null;state.page='account';render();return;}
 if(action==='begin-login' && !state.accountRestoring) {
  const attempt={}; state.loginAttempt=attempt;state.browserPrompt=null;render();
  try { const prompt=await invoke('begin_microsoft_login'); if(state.loginAttempt!==attempt) return; state.browserPrompt=prompt;render(); const account=await invoke('complete_microsoft_login'); if(state.loginAttempt!==attempt) return; state.account=account;state.accountName=account.name;state.accountMode='microsoft';state.accountKnown=true;state.accountPreference='microsoft';state.accountRestoreError='';state.loginAttempt=null;state.browserPrompt=null;persist();render();if(account.remembered===false)flash('登录成功，但无法保存登录状态；请检查系统凭据库，重启后可能需要重新登录。','error');await refreshAppearance(); }
  catch(e) { if(state.loginAttempt===attempt) { state.loginAttempt=null;state.browserPrompt=null;render();flash(`登录失败：${e}`,'error'); } } return;
 }
 if(action==='cancel-login') { state.loginAttempt=null;state.browserPrompt=null;state.accountBusy=true;render(); try { await invoke('cancel_microsoft_login');if(await invoke('microsoft_account')) await invoke('logout_microsoft'); } catch(e) { flash(String(e),'error'); } finally { state.accountBusy=false;render(); } return; }
 if(action==='retry-account-restore' && !state.accountRestoring) {void restoreAccount({notify:true});return;}
 if(action==='open-microsoft-login') { try { await invoke('open_microsoft_login'); } catch(e) { flash(String(e),'error'); } return; }
 if(action==='use-offline' || action==='continue-offline') { state.accountMode='offline';state.accountPreference='offline';persist();render();return; }
 if(action==='use-microsoft' && (state.account || state.accountKnown)) { state.accountMode=state.account?'microsoft':'offline';state.accountPreference='microsoft';persist();render();if(!state.account)void restoreAccount({notify:false});return; }
 if(action==='logout-microsoft') { state.restoreAttempt=null;restoreTask=null;state.accountRestoring=false;state.accountBusy=true;render();try { await invoke('logout_microsoft'); } catch(e) { flash(String(e),'error'); } finally { state.account=null;state.accountName='';state.accountMode='offline';state.accountKnown=false;state.accountPreference='offline';state.accountRestoreError='';state.appearance=null;state.previewCapeId='';state.accountBusy=false;persist();render(); } return; }
 if(action==='choose-skin' || action==='choose-cape') { const kind=action==='choose-skin'?'skin':'cape';try { const path=await openDialog({multiple:false,directory:false,filters:[{name:'PNG 图片',extensions:['png']}]}); if(typeof path!=='string') return;const data=await invoke('preview_texture',{path,kind});const file={path,data,name:path.split(/[\\/]/).pop()};if(kind==='skin') state.localSkin=file;else state.localCape=file;render(); } catch(e) { flash(`无法预览图片：${e}`,'error'); } return; }
 if(action==='clear-skin') { state.localSkin=null;render();return; }
 if(action==='clear-cape') { state.localCape=null;render();return; }
 if(action==='upload-skin' && state.localSkin && state.account) { state.accountBusy=true;render();try { await invoke('upload_account_skin',{path:state.localSkin.path,model:state.skinModel});state.localSkin=null;await refreshAppearance();flash('皮肤已应用到正版账户。'); } catch(e) { flash(`应用皮肤失败：${e}`,'error'); } state.accountBusy=false;render();return; }
 if(action==='reset-skin' && state.account) { state.accountBusy=true;render();try { await invoke('reset_account_skin');state.localSkin=null;await refreshAppearance();flash('已恢复账户默认皮肤。'); } catch(e) { flash(`恢复皮肤失败：${e}`,'error'); } state.accountBusy=false;render();return; }
 if(action==='hide-cape' && state.account) { state.accountBusy=true;render();try { await invoke('set_account_cape',{capeId:null});state.localCape=null;await refreshAppearance();flash('已隐藏账户披风。'); } catch(e) { flash(`更新披风失败：${e}`,'error'); } state.accountBusy=false;render();return; }
 const previewCape=event.target.closest('[data-preview-cape]'); if(previewCape) { const cape=state.appearance?.capes[Number(previewCape.dataset.previewCape)];if(cape) {state.previewCapeId=cape.id;state.localCape=null;render();}return; }
 const applyCape=event.target.closest('[data-apply-cape]'); if(applyCape && state.account) { const cape=state.appearance?.capes[Number(applyCape.dataset.applyCape)];if(!cape)return;state.accountBusy=true;render();try { await invoke('set_account_cape',{capeId:cape.id});state.localCape=null;await refreshAppearance();flash('已更新账户披风。'); } catch(e) { flash(`更新披风失败：${e}`,'error'); } state.accountBusy=false;render();return; }
 if(action==='check-update') {void checkLauncherUpdate(true);return;}
 if(action==='open-update') {try {await invoke('open_launcher_releases');}catch(e){flash(`无法打开下载页面：${e}`,'error');}return;}
 if(action==='dismiss-update') {state.updateDismissed=state.updateInfo?.latestVersion||'';renderChrome();return;}
 if (action === 'dismiss') { state.notice = '';state.noticeCrash=false; renderChrome(); }
 if(action==='open-crash-diagnosis' && state.crash) {state.crashDialog=state.crash;renderOverlay();}
 if(action==='close-crash-dialog') {state.crashDialog=null;renderOverlay();}
 if(action==='close-instance') {state.instanceView=null;renderOverlay();}
 if(action==='close-game-profile' && state.profileView){state.profileView.generation++;state.profileView=null;renderOverlay();}
 if(action==='close-profile-preview' && state.profileView){const d=state.profileView;d.preview=null;renderOverlay();}
 if(action==='refresh-game-profile' && state.profileView && !state.profileView.loading){const d=state.profileView;void invoke('play_stats',{gameDir:d.gameDir,version:d.version}).then(stats=>{if(state.profileView===d){d.stats=stats||{};d.statsError='';renderOverlay();}}).catch(e=>{if(state.profileView===d){d.statsError=String(e);renderOverlay();}});await loadProfileScreenshots(d);}
 if(action==='open-screenshot-folder' && state.profileView){const d=state.profileView;try{await invoke('open_screenshot_folder',{gameDir:d.gameDir,version:d.version});}catch(e){flash(`无法打开截图目录：${e}`,'error');}}

 if(action==='close-instance-theme' && state.themeView && !state.themeView.saving){if(state.themeView.preview)URL.revokeObjectURL(state.themeView.preview);state.themeView=null;renderOverlay();}
 if(action==='remove-instance-cover' && state.themeView && !state.themeView.saving){const d=state.themeView;if(d.preview)URL.revokeObjectURL(d.preview);d.preview=null;d.file=null;d.removeCover=true;renderOverlay();}
 if(action==='save-instance-theme' && state.themeView && !state.themeView.saving){const d=state.themeView,key=instanceKey(d.gameDir,d.version);instanceCoverRevision.set(key,(instanceCoverRevision.get(key)||0)+1);d.description=String(app.querySelector('#instance-description')?.value||'').slice(0,180);d.saving=true;d.error='';renderOverlay();try{if(d.file)await imageStore('put',`instance-cover:${key}`,d.file);else if(d.removeCover)await imageStore('delete',`instance-cover:${key}`);const old=instanceCovers.get(key);if((d.file||d.removeCover)&&old){URL.revokeObjectURL(old);instanceCovers.delete(key);}if(d.file)instanceCovers.set(key,URL.createObjectURL(d.file));instanceThemes[key]={color:d.color,description:d.description,hasCover:d.file?true:d.removeCover?false:d.hasCover};localStorage.setItem('ccl-instance-themes',JSON.stringify(instanceThemes));if(d.preview)URL.revokeObjectURL(d.preview);state.themeView=null;render();flash('实例主题已保存。');}catch(e){d.error=String(e);d.saving=false;renderOverlay();}}

 if(action==='close-manage' && state.manageView && !state.manageView.busy){state.manageView=null;renderOverlay();}
 if(action==='switch-worlds' && state.manageView && !state.manageView.busy){await openManage('worlds',state.manageView.version,state.manageView.gameDir);}
 if(action==='switch-backups' && state.manageView && !state.manageView.busy){await openManage('backups',state.manageView.version,state.manageView.gameDir);}
 if(action==='refresh-manage' && state.manageView && !state.manageView.busy)await loadManage();
 if(action==='open-saves-folder' && state.manageView){const d=state.manageView;try{await invoke('open_world_folder',{gameDir:d.gameDir,version:d.version,folder:null});}catch(e){d.error=String(e);renderOverlay();}}
 if(action==='create-instance-backup')await manageOperation('create_backup',{scope:'instance',world:null},'实例备份已创建。');
 if(action==='manage-cancel' && state.manageView && !state.manageView.busy){state.manageView.confirm=null;renderOverlay();}
 if(action==='manage-confirm' && state.manageView?.confirm && !state.manageView.busy){const d=state.manageView,choice=d.confirm;if(choice.action==='restore')await manageOperation('restore_backup',{backupId:choice.item.id},'备份已恢复，恢复前的实例也已备份。');else if(d.kind==='backups')await manageOperation('delete_backup',{backupId:choice.item.id},'备份已删除。');else await manageOperation('delete_world',{folder:choice.item.folder},'存档已删除，并已创建备份。');}

 if (action === 'open-log' || action === 'open-crash-log') { const crash=state.crashDialog || state.launchView?.crash || state.crash;const version=action==='open-crash-log' ? crash?.version : state.selected; const gameDir=action==='open-crash-log' ? crash?.gameDir : state.gameDir; if(version) { try { if(action==='open-crash-log' && !crash.logName)throw new Error('无法确定本次启动的日志文件');await invoke('open_game_log',{gameDir,version,logName:action==='open-crash-log' ? crash.logName : null}); } catch(e) { flash(String(e),'error'); } } }
 if(action==='close-mod-dialog' || (action==='close-mod-backdrop' && event.target.classList.contains('install-overlay'))) { state.modDraft=null; renderOverlay(); }
 if(action==='confirm-mod-install' && state.modDraft) { const draft=state.modDraft;if(draft.installed)return;const modVersionId=app.querySelector('input[name=modVersion]:checked')?.value;if(draft.kind!=='modpack'&&!modVersionId)return;state.modDraft=null;renderOverlay();if(draft.kind==='modpack') enqueueJob({key:`modpack:${draft.source}:${draft.projectId}:${draft.gameDir}`,kind:'modpack',title:draft.title,gameDir:draft.gameDir,recipe:{type:'modpack',gameDir:draft.gameDir,source:draft.source,projectId:draft.projectId,javaPath:draft.javaPath},run:job=>invoke('install_modpack',{gameDir:draft.gameDir,source:draft.source,projectId:draft.projectId,apiKey:draft.apiKey,javaPath:draft.javaPath,jobId:job.id})});else if(draft.kind==='mod') enqueueJob({key:`mod:${draft.source}:${draft.projectId}:${draft.gameDir}:${draft.target}`,kind:'mod',title:`${draft.title} · ${draft.target}`,gameDir:draft.gameDir,version:draft.target,recipe:{type:'mod',gameDir:draft.gameDir,version:draft.target,source:draft.source,projectId:draft.projectId,modVersionId},run:job=>invoke('install_mod',{gameDir:draft.gameDir,version:draft.target,source:draft.source,projectId:draft.projectId,apiKey:draft.apiKey,modVersionId,jobId:job.id})});else {const recipe={type:'pack',kind:draft.kind,gameDir:draft.gameDir,version:draft.target,source:draft.source,projectId:draft.projectId,packVersionId:modVersionId};enqueueJob({key:`${draft.kind}:${draft.source}:${draft.projectId}:${draft.gameDir}:${draft.target}`,kind:draft.kind,title:`${draft.title} · ${draft.target}`,gameDir:draft.gameDir,version:draft.target,recipe,run:runnerFor(recipe)});} }
 if (action === 'close-install' || (action === 'close-install-backdrop' && event.target.classList.contains('install-overlay'))) { state.installDraft = null; renderOverlay(); }
 if (action === 'confirm-install' && state.installDraft) { const draft={...state.installDraft,addons:[...state.installDraft.addons]}; state.installDraft=null; renderOverlay(); queueVersion(draft); }
 if (action === 'clear-jobs') { state.jobs=state.jobs.filter(j=>!['done','failed','cancelled'].includes(j.status));saveJobs(); if (state.page==='downloads') render(); else renderChrome(); }
 if (action === 'refresh') await refresh();
 if (action === 'refresh-java') await refreshJava();
 if(action==='refresh-packs') await refreshPacks();
 if(action==='open-pack-folder' && state.contentTarget) {try{await invoke('open_pack_folder',{gameDir:state.gameDir,version:state.contentTarget,kind:state.contentKind});}catch(e){flash(`无法打开文件夹：${e}`,'error');}}
 if(action==='find-shader-support') {state.contentKind='mod';state.contentQuery=event.target.closest('[data-query]')?.dataset.query||'Iris';state.contentPage=0;state.contentLoaded=false;state.contentResults=[];packEpoch++;state.packDelete=null;render();await searchContent();}
 if(action==='cancel-pack-remove') {state.packDelete=null;render();}
 if(action==='confirm-pack-remove' && state.packDelete && !state.packWorking) {const item=state.packDelete;state.packDelete=null;state.packWorking=true;render();try{await invoke('remove_local_pack',item);flash('资源包已删除。');if(item.version===state.contentTarget&&item.gameDir===state.gameDir&&item.kind===state.contentKind){await refreshPacks();contentEpoch++;state.contentLoaded=false;await searchContent();}}catch(e){flash(`删除失败：${e}`,'error');}finally{state.packWorking=false;if(state.page==='content')render();}}
 if(action==='check-pack-updates' && !state.packChecking && !state.packWorking && state.contentTarget) {const version=state.contentTarget,gameDir=state.gameDir,kind=state.contentKind,epoch=packEpoch;state.contentKey=String(app.querySelector('#content-form [name=apiKey]')?.value || state.contentKey).trim();state.packChecking=true;state.packUpdates=null;renderLocalPacks();try{const result=await invoke('check_pack_updates',{gameDir,version,kind,apiKey:state.contentKey});if(epoch===packEpoch && version===state.contentTarget && gameDir===state.gameDir && kind===state.contentKind)state.packUpdates=result;}catch(e){flash(`检查更新失败：${e}`,'error');}finally{state.packChecking=false;renderLocalPacks();}}

 if (action === 'cancel-mod-remove') { state.modDelete = null; render(); }
 if (action === 'confirm-mod-remove') { const names=state.modDelete || [];state.modDelete=null;render();await applyModChanges('delete',names); }
 if (action === 'bulk-mod-enable' || action === 'bulk-mod-disable') await applyModChanges(action==='bulk-mod-enable'?'enable':'disable',[...state.selectedMods]);
 if(action==='check-mod-conflicts' && !state.modConflictsLoading && !state.modWorking && state.contentTarget){const version=state.contentTarget,gameDir=state.gameDir,epoch=modEpoch;state.modConflictsLoading=true;state.modConflicts=null;renderLocalMods();try{const result=await invoke('check_mod_conflicts',{gameDir,version});if(epoch===modEpoch && version===state.contentTarget && gameDir===state.gameDir)state.modConflicts=result;}catch(e){flash(`排查失败：${e}`,'error');}finally{state.modConflictsLoading=false;renderLocalMods();}}
 if (action === 'check-mod-updates' && !state.modChecking && !state.modWorking && state.contentTarget) {const version=state.contentTarget,gameDir=state.gameDir,epoch=modEpoch;state.modChecking=true;state.modUpdates=null;renderLocalMods();try {const result=await invoke('check_mod_updates',{gameDir,version});if(version===state.contentTarget && gameDir===state.gameDir && epoch===modEpoch && !state.modWorking)state.modUpdates=result;}catch(e){flash(`检查更新失败：${e}`,'error');}finally{state.modChecking=false;if(state.page==='content')renderLocalMods();} }
 if (action === 'bulk-mod-delete' && state.selectedMods.size && !state.modWorking) { state.modDelete=[...state.selectedMods];render(); }
 if (action === 'cancel-java-remove') { state.javaDelete = null; render(); }
 if (action === 'confirm-java-remove') { const java = state.javaRuntimes[state.javaDelete]; state.javaDelete = null; if (java?.managed) { try { await invoke('remove_java', { major: java.major }); if (state.javaPath === java.path) { state.javaPath = 'java'; persist(); } state.notice = `Java ${java.major} 已删除。`; state.noticeKind = ''; await refreshJava(); } catch (e) { flash(`删除失败：${e}`, 'error'); } } }
 if (action === 'launch') {
  if(state.launchView)return;
  const online=usingOnlineAccount(),view={id:`${Date.now()}-${++launchSequence}`,version:state.selected,phase:online&&!state.account?'authenticating':'preparing',error:'',warning:'',authError:false};
  state.launchView=view;state.crashDialog=null;renderOverlay();
  try {
   if(online && !state.account) {
    const account=await restoreAccount({notify:false});
    if(state.launchView!==view)return;
    if(state.accountPreference!=='microsoft')throw new Error('账户模式已更改，请重新启动游戏。');
    if(!account){view.authError=true;throw new Error(state.accountRestoreError||'无法恢复正版账户，请前往账户页面重新登录。');}
    view.phase='preparing';renderOverlay();
   }
   if(state.launchView!==view)return;
   await invoke('launch_game', { options: { launchId:view.id,version: state.selected, username: state.username, javaPath: state.javaPath, gameDir: state.gameDir, memory: Number(state.memory), memoryMode:state.memoryMode, optimize:state.optimize, jvmArgs:state.jvmArgs, gameArgs:state.gameArgs, accountMode:online?'microsoft':'offline' } });
   if(state.launchView===view && view.phase==='preparing') { view.phase='waiting';renderOverlay(); }
  } catch (e) { if(state.launchView===view) { view.phase='failed';view.error=String(e);if(online && /微软|Xbox|正版|登录|账户|授权/i.test(view.error))view.authError=true;renderOverlay(); } else flash(`启动失败：${e}`, 'error'); }
 }
});
app.addEventListener('change', async event => {
 if(event.target.matches('[data-instance-cover]') && state.themeView){const d=state.themeView,file=event.target.files?.[0];if(!file)return;try{await validateThemeImage(file);if(state.themeView!==d)return;if(d.preview)URL.revokeObjectURL(d.preview);d.preview=URL.createObjectURL(file);d.file=file;d.removeCover=false;d.error='';renderOverlay();}catch(e){if(state.themeView===d){d.error=String(e);renderOverlay();}}return;}

 if(event.target.dataset.themeImage) {
  const kind=event.target.dataset.themeImage,file=event.target.files?.[0];event.target.value='';if(!file)return;
  const revision=++imageRevision[kind];
  try { await validateThemeImage(file);if(revision!==imageRevision[kind])return;await imageStore('put',kind,file);if(revision!==imageRevision[kind])return;setThemeImage(kind,file);flash('图片已保存。'); }
  catch(e) { flash(`无法使用图片：${e}`,'error'); } return;
 }
 if(event.target.id==='memory-mode') {syncMemoryControls();return;}
 if(event.target.id==='server-status') { state.serverStatus=event.target.value;state.serverPage=0;updateSearchResults('server');return; }
 if(event.target.id==='skin-model') { state.skinModel=event.target.value;render();return; }
 if(event.target.id==='job-limit') { state.jobLimit=Math.max(1,Math.min(5,Number(event.target.value)||3));persist();render();pumpJobs();return; }
 if(event.target.id==='local-mod-filter') {state.modFilter=event.target.value;renderLocalMods();return;}
 if(event.target.id==='mod-select-visible') {const matches=state.localMods.filter(m=>m.name.toLocaleLowerCase().includes(state.modQuery.trim().toLocaleLowerCase()) && (state.modFilter==='all'||m.enabled===(state.modFilter==='enabled')));for(const m of matches) event.target.checked?state.selectedMods.add(m.name):state.selectedMods.delete(m.name);renderLocalMods();return;}
 if(event.target.dataset.modSelect!==undefined) {const m=state.localMods[Number(event.target.dataset.modSelect)];if(m)event.target.checked?state.selectedMods.add(m.name):state.selectedMods.delete(m.name);renderLocalMods();return;}
 if(event.target.id==='contentTarget') { state.selectedMods.clear();modEpoch++;state.modUpdates=null;state.modConflicts=null;state.contentTarget=event.target.value; state.contentResults=[]; state.localMods=[];state.contentPage=0;state.contentLoaded=false;await refreshMods();await refreshPacks();await searchContent(); return; }
 if (event.target.name==='draftLoader' && state.installDraft) { state.installDraft.loader=event.target.value; state.installDraft.addons=state.installDraft.addons.filter(id=>ADDONS.find(a=>a.id===id)?.loaders.includes(state.installDraft.loader)); renderOverlay(); return; }
 if (event.target.name==='draftAddon' && state.installDraft) { const selected=state.installDraft.addons; state.installDraft.addons=event.target.checked ? [...new Set([...selected,event.target.value])] : selected.filter(x=>x!==event.target.value); return; }
 if (event.target.closest('#content-form') && ['source','kind','sort','category','loaderFilter','environment'].includes(event.target.name)) { const form=event.target.closest('form'); const data=new FormData(form);const changedSource=state.contentSource!==data.get('source'),changedKind=state.contentKind!==data.get('kind'); state.contentSource=data.get('source'); state.contentKind=data.get('kind'); state.contentSort=data.get('sort');state.contentQuery=String(data.get('query') || '').trim();state.contentKey=String(data.get('apiKey') || state.contentKey);state.contentCategory=changedSource||changedKind?'':String(data.get('category')||'');state.contentGameFilter=String(data.get('gameFilter')||state.contentGameFilter).trim();state.contentLoaderFilter=String(data.get('loaderFilter')||'');state.contentEnvironment=state.contentSource==='modrinth'?String(data.get('environment')||''):'';state.contentResults=[];state.contentPage=0;state.contentHasMore=false;state.contentLoaded=false;state.contentError='';state.packDelete=null;if(changedSource||changedKind)state.contentCategories=[];render();if(changedSource||changedKind)void loadContentCategories();await Promise.all([refreshPacks(),searchContent()]); }

});
app.addEventListener('compositionstart', event => { if(event.target.matches('input, textarea')) composingSearch=true; });
app.addEventListener('compositionend', event => { if(!composingSearch)return;composingSearch=false; if(event.target.id==='server-search') {state.serverQuery=event.target.value;state.serverPage=0;} else if(event.target.id==='version-filter') state.versionQuery=event.target.value; else if(event.target.id==='local-mod-search') state.modQuery=event.target.value; else if(event.target.id==='local-pack-search') state.packQuery=event.target.value; if(pendingCompositionRender) {pendingCompositionRender=false;render();} else if(event.target.id==='server-search'||event.target.id==='version-filter') updateSearchResults(event.target.id==='server-search'?'server':'version'); else if(event.target.id==='local-mod-search') renderLocalMods(); else if(event.target.id==='local-pack-search') renderLocalPacks(); });
app.addEventListener('input', event => { if(event.target.id==='instance-description' && state.themeView){state.themeView.description=event.target.value;return;} if(event.target.id==='local-pack-search') {if(composingSearch||event.isComposing)return;state.packQuery=event.target.value;renderLocalPacks();return;} if(event.target.id==='local-mod-search') {if(composingSearch||event.isComposing)return;state.modQuery=event.target.value;renderLocalMods();return;} if(event.target.dataset.themeSetting) { const key=event.target.dataset.themeSetting;theme[key]=clampAppearance(event.target.value,appearanceDefaults[key],key.endsWith('Blur')?30:100);event.target.closest('.theme-control').querySelector('output').textContent=`${theme[key]}${key.endsWith('Blur')?' px':'%'}`;applyTheme();persist();return; } if(event.target.id==='server-search') { if(composingSearch || event.isComposing) return; state.serverQuery=event.target.value;state.serverPage=0;updateSearchResults('server');return; } if(event.target.id==='lan-game-port') state.lanPort=event.target.value; if(event.target.id==='lan-target') { state.lanTarget=event.target.value; state.lanTest=''; } if(event.target.id==='version-filter') { if(composingSearch || event.isComposing) return; state.versionQuery=event.target.value; updateSearchResults('version'); return; } if (event.target.id === 'proxyUrl') event.target.setCustomValidity(''); if(event.target.id==='memory-range') {const input=app.querySelector('#memory');if(input)input.value=event.target.value;} else if(event.target.id==='memory') {const slider=app.querySelector('#memory-range');if(slider && event.target.value)slider.value=event.target.value;} });
app.addEventListener('submit', async event => { if(event.target.id==='lan-host-form') { event.preventDefault(); if(state.lanBusy||state.lanRoom) return; const port=Number(event.target.elements.lanGamePort.value); if(!Number.isInteger(port)||port<1||port>65535) { flash('请输入 1–65535 的游戏局域网端口。','error');return; } state.lanPort=String(port);state.lanBusy=true;render();try { const relayPort=await invoke('start_ipv6_room',{gamePort:port});state.lanRoom={port:relayPort};await refreshLanAddresses(); } catch(e) { flash(`创建房间失败：${e}`,'error'); } finally { state.lanBusy=false;render(); } return; } if(event.target.id==='lan-test-form') { event.preventDefault();if(state.lanBusy)return;state.lanTarget=event.target.elements.lanTarget.value.trim();state.lanTest='';state.lanBusy=true;render();try { await invoke('test_ipv6_connection',{address:state.lanTarget});state.lanTest='TCP 连接成功；游戏能否加入还取决于版本、模组和服务器状态。'; } catch(e) { state.lanTest=String(e); } finally { state.lanBusy=false;render(); } return; } if (event.target.id === 'content-form') { event.preventDefault(); const data = new FormData(event.target); state.contentSource = data.get('source'); state.contentKind = data.get('kind'); state.contentSort=data.get('sort');state.contentQuery = String(data.get('query') || '').trim(); state.contentKey = String(data.get('apiKey') || state.contentKey);state.contentCategory=String(data.get('category')||state.contentCategory);state.contentGameFilter=String(data.get('gameFilter')||'').trim();state.contentLoaderFilter=String(data.get('loaderFilter')||'');state.contentEnvironment=String(data.get('environment')||'');state.contentPage=0;state.contentHasMore=false;void loadContentCategories(); await searchContent(true); return; } if (event.target.id !== 'settings-form') return; event.preventDefault(); const data = new FormData(event.target); const proxyUrl = String(data.get('proxyUrl') || '').trim(); const changed = state.gameDir !== data.get('gameDir').trim() || state.proxyUrl !== proxyUrl; const selectedVersion=state.versions.find(v=>v.id===state.selected && v.installed),isolationControl=event.target.querySelector('#version-isolation'),isolationChanged=selectedVersion && isolationControl && !isolationControl.disabled && isolationControl.checked!==!!selectedVersion.isolated; if(isolationChanged && state.gameDir!==data.get('gameDir').trim()) {flash('请先保存游戏目录，再修改版本隔离。','error');return;} if(isolationChanged && state.jobs.some(j=>j.gameDir===state.gameDir && ['queued','running','canceling'].includes(j.status))) {flash('该游戏目录有进行中或等待中的任务，请先取消或等待结束。','error');return;} try { await invoke('configure_proxy', { proxyUrl }); } catch (e) { const input = event.target.querySelector('#proxyUrl'); input.setCustomValidity(String(e)); input.reportValidity(); return; } if(isolationChanged) { try { await invoke('set_version_isolation',{gameDir:state.gameDir,version:selectedVersion.id,isolated:isolationControl.checked});selectedVersion.isolated=isolationControl.checked;state.localMods=[];state.contentResults=[];state.contentLoaded=false;state.modUpdates=null;state.selectedMods.clear();modEpoch++; } catch(e) {flash(`无法修改版本隔离：${e}`,'error');return;} } Object.assign(state, { username: data.get('username').trim(), javaPath: data.get('javaPath').trim(), proxyUrl, gameDir: data.get('gameDir').trim(), memory: Number(data.get('memory') ?? state.memory), memoryMode:data.get('memoryMode')==='auto'?'auto':'manual', optimize:data.has('optimize'), jvmArgs:String(data.get('jvmArgs')||''), gameArgs:String(data.get('gameArgs')||'') }); persist(); if(changed){state.selectedMods.clear();state.modUpdates=null;state.modConflicts=null;modEpoch++;} render(); flash('设置已保存。'); if (changed) await refresh(); });
let restoreTask=null;
function restoreAccount({notify=false}={}) {
 if(restoreTask)return restoreTask;
 const attempt={};state.restoreAttempt=attempt;state.accountRestoring=true;state.accountRestoreError='';render();
 const task=(async()=>{
  try {
   const account=await invoke('restore_microsoft_account');
   if(state.restoreAttempt!==attempt)return null;
   if(account && !state.loginAttempt) {
    state.account=account;state.accountName=account.name;state.accountKnown=true;state.accountMode=state.accountPreference==='offline'?'offline':'microsoft';persist();
    if(account.remembered===false)flash('账户已恢复，但无法保存新的登录状态；请检查系统凭据库。','error');
    void refreshAppearance({reuse:true});
    return account;
   }
   if(!account && state.accountKnown) state.accountRestoreError='未找到已保存的账户，请重新登录或使用离线账户。';
  } catch(e) {
   if(state.restoreAttempt===attempt)state.accountRestoreError=`账户恢复失败：${e}。可检查网络后重试或重新登录。`;
  } finally {
   if(state.restoreAttempt===attempt){state.restoreAttempt=null;state.accountRestoring=false;if(state.accountRestoreError && notify)flash(state.accountRestoreError,'error');render();}
  }
  return null;
 })();
 restoreTask=task;
 void task.finally(()=>{if(restoreTask===task)restoreTask=null;});
 return task;
}
async function init() {
 updateDefaultBanner();
 window.setInterval(updateDefaultBanner,60*1000);
 document.addEventListener('visibilitychange',()=>{if(!document.hidden)updateDefaultBanner();});
 restoreJobs();render();
 restoreThemeImages();
 if (!isTauri()) { state.notice = '请在 Tauri 桌面应用中使用启动器。'; state.noticeKind = 'error'; render(); return; }
 try { await invoke('configure_proxy', { proxyUrl: state.proxyUrl }); if (!state.gameDir) state.gameDir = await invoke('default_game_dir'); await listen('java-progress', e => jobEvent(e.payload)); await listen('install-progress', e => jobEvent(e.payload)); await listen('game-window-ready', e => {const view=state.launchView;if(view && view.phase!=='failed' && e.payload.launchId===view.id){state.launchView=null;state.page='home';render();}}); await listen('game-window-status', e => {const view=state.launchView;if(view && view.phase!=='failed' && e.payload.launchId===view.id){view.warning=e.payload.status==='unavailable'?'当前桌面暂时无法确认游戏窗口；窗口出现后可手动返回主页。':'等待时间较长，可查看启动日志或手动返回主页。';renderOverlay();}}); await listen('game-exit', e => { const payload=e.payload || {},view=state.launchView,profile=state.profileView;if(profile && profile.version===payload.version && profile.gameDir===payload.gameDir)void invoke('play_stats',{gameDir:profile.gameDir,version:profile.version}).then(stats=>{if(state.profileView===profile){profile.stats=stats||{};profile.statsError='';renderOverlay();}}).catch(()=>{});const sameLaunch=view && (payload.launchId ? view.id===payload.launchId : view.version===payload.version);if(!payload.success || sameLaunch) {const crash={version:payload.version,gameDir:payload.gameDir,logName:typeof payload.logPath==='string'?payload.logPath.split(/[\\/]/).pop():null,code:payload.code,diagnosis:payload.success?null:payload.diagnosis};if(sameLaunch){view.crash=crash;view.phase='failed';view.error=payload.success?'游戏进程已退出，未检测到游戏窗口。可以打开启动日志查看详情。':`游戏异常退出（代码 ${payload.code ?? '未知'}），可以打开启动日志查看详情。`;renderOverlay();}else if(!payload.success)showCrashNotice(crash);}  }); void checkLauncherUpdate();window.setInterval(()=>void checkLauncherUpdate(),6*60*60*1000);if(usingOnlineAccount())void restoreAccount({notify:false}); await refresh(); } catch (e) { state.accountRestoring=false;render();flash(String(e), 'error'); }
}
init();
