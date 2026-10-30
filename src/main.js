import './style.css';
import './journal-theme.css';
import './multiplayer.css';
import './custom-theme.css';
import './launch-screen.css';
import './management.css';
import './update.css';
import { createJobManager } from './job-manager.ts';
import { appearanceDefaults, clampAppearance, bannerPeriod, imageStore, validateThemeImage } from './lib/appearance.ts';
import { createThumbnailLoader } from './lib/thumbnails.ts';
import { createInputController } from './lib/input-controller.ts';
import { createAccountRestorer } from './lib/account-restore.ts';
import { createContentSearch } from './lib/content-search.ts';
import { createModManager } from './lib/mod-manager.ts';
import { createGameProfile } from './lib/game-profile.ts';
import { createRenderer } from './react/renderer.tsx';
import { HomePage, VersionsPage, JavaPage } from './react/pages.tsx';
import { InstanceSettingsDialog } from './react/instance-settings.tsx';
import { LanRoomPage } from './react/lan-room.tsx';
import { PublicServersPage } from './react/public-servers.tsx';
import { InstanceOverviewDialog } from './react/instance-overview.tsx';
import { LaunchScreen, CrashDialog } from './react/launch.tsx';
import { InstallDialog } from './react/install-dialog.tsx';
import { ArchiveDialog } from './react/archive-dialog.tsx';
import { DownloadsPage } from './react/downloads.tsx';
import { SettingsPage } from './react/settings.tsx';
import { AccountPage } from './react/account.tsx';
import { ManageDialog } from './react/manage-dialog.tsx';
import { InstanceThemeDialog } from './react/instance-theme.tsx';
import { GameProfileDialog } from './react/game-profile.tsx';
import { ContentPage } from './react/content.tsx';
import { ContentDialog } from './react/content-dialog.tsx';
import { Shell } from './react/shell.tsx';
import { normalizeInstanceSettings, resolveInstanceSettings } from './react/instance-settings-model.ts';
import { version as appVersion } from '../package.json';
import { open as openDialog, save as saveDialog } from '@tauri-apps/plugin-dialog';
import { invoke, isTauri } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';

let saved = {};
try { saved = JSON.parse(localStorage.getItem('ccl-settings') || '{}') || {}; } catch { /* Recover from damaged local settings. */ }
const state = { page: 'home', lanView: 'room', serverCatalog: null, serverLoading: false, serverError: '', serverQuery: '', serverStatus: 'all', serverPage: 0, lanAddresses: [], lanRoom: null, lanBusy: false, lanPort: '', lanTarget: '', lanTest: '', versions: [], selected: saved.selected || '', username: saved.username || 'Player', javaPath: saved.javaPath || 'java', proxyUrl: saved.proxyUrl || '', gameDir: saved.gameDir || '', memory: saved.memory || 4096, memoryMode: saved.memoryMode === 'auto' ? 'auto' : saved.memoryMode === 'manual' || saved.memory != null ? 'manual' : 'auto', memoryInfo: null, memoryInfoError: '', memoryInfoLoading: false, optimize: saved.optimize !== false, jvmArgs: saved.jvmArgs || '', gameArgs: saved.gameArgs || '', contentTarget: '', modDraft: null, archiveDraft: null, launchView: null, crash: null, crashDialog: null, noticeCrash: false, versionQuery: '', accountMode: 'offline', accountKnown: saved.accountKnown===true, accountName: typeof saved.accountName==='string'?saved.accountName:'', accountUuid: typeof saved.accountUuid==='string'?saved.accountUuid:'', accountPreference: saved.accountMode==='offline'?'offline':'microsoft', accountRestoring: false, accountRestoreError: '', restoreAttempt: null, account: null, savedAccounts: [], browserPrompt: null, loginAttempt: null, accountBusy: false, appearance: null, localSkin: null, localCape: null, previewCapeId: '', skinModel: 'classic', loading: false, notice: '', noticeKind: '', online: false, javaRuntimes: [], javaLoading: false, javaDelete: null, versionDelete: null, instanceView: null, instanceSettingsView: null, manageView: null, themeView: null, profileView: null, versionDeleting: false, contentSource: 'modrinth', contentKind: 'mod', contentQuery: '', contentKey: '', contentSort: 'downloads', contentCategory: '', contentCategories: [], contentCategoriesLoading: false, contentCategoryError: '', contentGameFilter: '', contentLoaderFilter: '', contentEnvironment: '', contentPage: 0, contentHasMore: false, contentLoaded: false, contentError: '', contentResults: [], contentBusy: false, updateState: 'idle', updateInfo: null, updateError: '', updateDismissed: '', localPacks: [], packQuery: '', packLoading: false, packError: '', packWorking: false, packChecking: false, packUpdates: null, packDelete: null, shaderEnv: null, shaderEnvLoading: false, shaderEnvError: '', localMods: [], modQuery: '', modFilter: 'all', selectedMods: new Set(), modWorking: false, modChecking: false, modConflicts: null, modConflictsLoading: false, modUpdates: null, modDelete: null, jobs: [], jobLimit: Math.max(1, Math.min(5, Number(saved.jobLimit) || 3)), installDraft: null };
const theme = { bannerOpacity: clampAppearance(saved.theme?.bannerOpacity, 0), bannerFrost: clampAppearance(saved.theme?.bannerFrost, 0), bannerBlur: clampAppearance(saved.theme?.bannerBlur, 0, 30), backgroundOpacity: clampAppearance(saved.theme?.backgroundOpacity, 35), backgroundFrost: clampAppearance(saved.theme?.backgroundFrost, 42), backgroundBlur: clampAppearance(saved.theme?.backgroundBlur, 8, 30), banner: null, background: null };
const app = document.querySelector('#app');
const renderer = createRenderer(app);
const instanceColors=['#76956d','#6d91a3','#a68072','#9b83a9','#c29d63','#7f8a78'];
let instanceThemes={};
try{const value=JSON.parse(localStorage.getItem('ccl-instance-themes')||'{}');if(value&&typeof value==='object'&&!Array.isArray(value))instanceThemes=value;}catch{}
const instanceCovers=new Map();
const instanceCoverPending=new Map();
const instanceCoverRevision=new Map();
let instanceCoverRenderTimer=null;
function scheduleInstanceCoverRender(){if(instanceCoverRenderTimer!==null)return;instanceCoverRenderTimer=setTimeout(()=>{instanceCoverRenderTimer=null;if(state.page==='home'||state.page==='versions')render();},50);}
const instanceKey=(gameDir,version)=>JSON.stringify([gameDir,version]);
let offlineSkinInstances={};
try { const value=JSON.parse(localStorage.getItem('ccl-offline-skin-instances')||'{}');if(value && typeof value==='object' && !Array.isArray(value))offlineSkinInstances=value; } catch {}
let instanceLaunchSettings={};
try { const value=JSON.parse(localStorage.getItem('ccl-instance-launch-settings')||'{}');if(value && typeof value==='object' && !Array.isArray(value))instanceLaunchSettings=value; } catch {}
function getLaunchSettings(gameDir,version) {
 return normalizeInstanceSettings(instanceLaunchSettings[instanceKey(gameDir,version)]);
}
function effectiveLaunchSettings(gameDir,version) {
 return resolveInstanceSettings(state,getLaunchSettings(gameDir,version));
}

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
const gameProfile=createGameProfile({state,render:renderOverlay,
 list:(gameDir,version,page)=>invoke('list_game_screenshots',{gameDir,version,page}),
 screenshot:(gameDir,version,name)=>invoke('game_screenshot',{gameDir,version,name}),
 stats:(gameDir,version)=>invoke('play_stats',{gameDir,version})});
const openGameProfile=gameProfile.open,loadProfileScreenshots=gameProfile.loadScreenshots;

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
async function refreshMemoryInfo() {
 if(state.memoryInfoLoading || !isTauri()) return;
 state.memoryInfoLoading=true;state.memoryInfoError='';
 const update=()=>{if(state.page==='settings' && app.querySelector('#memory-info'))renderSettingsPage();};
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
 const instanceMode=app.querySelector('#instance-memory-mode');
 const instanceValue=app.querySelector('#instance-memory'),instanceSlider=app.querySelector('#instance-memory-range');
 const instanceForm=app.querySelector('#instance-settings-form');
 if(instanceForm) {
  instanceForm.querySelector('#instance-java-fields').disabled=!instanceForm.elements.overrideJava.checked;
  instanceForm.querySelector('#instance-memory-fields').disabled=!instanceForm.elements.overrideMemory.checked;
  instanceForm.querySelector('#instance-args-fields').disabled=!instanceForm.elements.overrideArgs.checked;
  const manual=instanceForm.querySelector('#instance-memory-manual');
  manual.hidden=instanceMode.value!=='manual';
  if(instanceValue)instanceValue.disabled=instanceMode.value!=='manual';
 }
 if(instanceMode && instanceSlider)instanceSlider.disabled=instanceMode.value!=='manual';
 if(instanceValue && instanceSlider && instanceValue.value)instanceSlider.value=instanceValue.value;
}

function versionVisual(version) {
 const instance=version?.id?getInstanceTheme(state.gameDir,version.id):null;
 return {color:instance?.color || instanceColors[0],cover:version?.id?instanceCovers.get(instanceKey(state.gameDir,version.id)):null};
}
const hydrateThumbnails=createThumbnailLoader({container:app,fetchThumbnail:(kind,value)=>invoke('fetch_thumbnail',{kind,value})});
const persist = () => localStorage.setItem('ccl-settings', JSON.stringify({ selected: state.selected, username: state.username, javaPath: state.javaPath, proxyUrl: state.proxyUrl, gameDir: state.gameDir, memory: state.memory, memoryMode: state.memoryMode, optimize: state.optimize, jvmArgs: state.jvmArgs, gameArgs: state.gameArgs, accountMode: state.accountPreference, accountKnown: state.accountKnown, accountName: state.accountName, accountUuid: state.accountUuid, jobLimit: state.jobLimit, theme: {bannerOpacity:theme.bannerOpacity,bannerFrost:theme.bannerFrost,bannerBlur:theme.bannerBlur,backgroundOpacity:theme.backgroundOpacity,backgroundFrost:theme.backgroundFrost,backgroundBlur:theme.backgroundBlur} }));
let launchSequence = 0;
const usingOnlineAccount = () => state.accountPreference==='microsoft' && (state.accountKnown || !!state.account);
const playerName = () => usingOnlineAccount() ? (state.account?.name || state.accountName || '正版账户') : state.username;
const playerStatus = () => usingOnlineAccount() ? (state.account ? '微软账户' : state.accountRestoring ? '正在验证正版账户' : '正版账户 · 待验证') : '离线玩家';
const cachedAvatars=new Map(), avatarRevisions=new Map(), avatarWrites=new Map(), avatarLoads=new Map();
const validAvatarAccount = uuid => typeof uuid==='string' && /^[A-Za-z0-9_-]{1,64}$/.test(uuid);
const validAvatarSkin = skin => typeof skin==='string' && skin.length<=3*1024*1024 && skin.startsWith('data:image/png;base64,');
function cacheOnlineAvatar(uuid, skin) {
 if(!validAvatarAccount(uuid))return;
 const valid=validAvatarSkin(skin);avatarRevisions.set(uuid,(avatarRevisions.get(uuid)||0)+1);
 if(valid)cachedAvatars.set(uuid,skin);else cachedAvatars.delete(uuid);
 const pending=(avatarWrites.get(uuid)||Promise.resolve()).catch(()=>{}).then(()=>imageStore(valid?'put':'delete',`online-avatar:${uuid}`,valid?skin:undefined));
 avatarWrites.set(uuid,pending);pending.catch(()=>{}).finally(()=>{if(avatarWrites.get(uuid)===pending)avatarWrites.delete(uuid);});
}
function restoreOnlineAvatar(uuid) {
 if(!validAvatarAccount(uuid) || cachedAvatars.has(uuid))return Promise.resolve();
 if(avatarLoads.has(uuid))return avatarLoads.get(uuid);
 const revision=avatarRevisions.get(uuid)||0;
 const pending=imageStore('get',`online-avatar:${uuid}`).then(skin=>{
  if((avatarRevisions.get(uuid)||0)!==revision || !validAvatarSkin(skin))return;
  cachedAvatars.set(uuid,skin);renderAvatar();
 }).catch(()=>{}).finally(()=>{if(avatarLoads.get(uuid)===pending)avatarLoads.delete(uuid);});
 avatarLoads.set(uuid,pending);return pending;
}
let localSkinRevision=0, localSkinStorage=Promise.resolve();
function saveLocalSkin(skin) {
 ++localSkinRevision;
 localSkinStorage=localSkinStorage.catch(()=>{}).then(()=>imageStore(skin?'put':'delete','local-skin',skin || undefined));
 localSkinStorage.catch(()=>flash('皮肤预览无法保存，重启后需要重新选择。','error'));
}
async function restoreLocalSkin() {
 const revision=localSkinRevision;
 try { const skin=await imageStore('get','local-skin');if(revision===localSkinRevision && skin && typeof skin.data==='string' && skin.data.startsWith('data:image/png;base64,') && typeof skin.path==='string' && typeof skin.name==='string'){state.localSkin=skin;state.skinModel=skin.model==='slim'?'slim':'classic';if(state.page==='account')render();else renderChrome();} } catch { /* Local preview is optional when image storage is unavailable. */ }
}
function renderAvatar() { renderShell(); }

const selected = () => state.versions.find(v => v.id === state.selected);
function flash(message, kind = '') { state.notice = message; state.noticeKind = kind; state.noticeCrash=false; renderChrome(); }
function showCrashNotice(crash) {state.crash=crash;state.notice=`游戏 ${crash.version} 异常退出（代码 ${crash.code ?? '未知'}）。`;state.noticeKind='error';state.noticeCrash=true;renderChrome();}
function shellProps() {
 const uuid=state.account?.uuid || state.accountUuid;
 const skin=usingOnlineAccount() ? (state.appearance?.skin || cachedAvatars.get(uuid)) : state.localSkin?.data;
 return {page:state.page,name:playerName(),status:playerStatus(),skin:typeof skin==='string'&&skin.startsWith('data:image/png;base64,')?skin:'',online:state.online,version:appVersion,installedCount:state.versions.filter(v=>v.installed).length,jobCount:activeJobCount(),updateInfo:state.updateInfo,updateDismissed:state.updateDismissed,notice:state.notice,noticeKind:state.noticeKind,noticeCrash:!!(state.crash&&state.noticeCrash)};
}
function renderShell() { if(app.querySelector('.app-shell')) renderer.chrome(Shell,shellProps()); }
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
async function refreshPublicServers() {
 if(state.serverLoading) return;
 state.serverLoading=true;state.serverError='';if(state.page==='multiplayer') render();
 try { const data=await invoke('public_servers'); if(!data || !Array.isArray(data.servers)) throw new Error('目录格式无效'); state.serverCatalog=data;state.serverPage=0; }
 catch(e) { state.serverError=String(e); }
 finally { state.serverLoading=false;if(state.page==='multiplayer') render(); }
}
const ADDONS = [
 { id:'fabric-api', title:'Fabric API', desc:'许多 Fabric 模组的基础依赖', loaders:['fabric'] },
 { id:'sodium', title:'Sodium', desc:'改善渲染性能', loaders:['fabric','neoforge'] },
 { id:'jei', title:'Just Enough Items', desc:'查看物品与配方', loaders:['fabric','quilt','forge','neoforge'] },
 { id:'jade', title:'Jade', desc:'查看方块与实体信息', loaders:['fabric','quilt','forge','neoforge'] },
];
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

function renderContentPage() { if(state.page==='content' && app.querySelector('.content')) { renderer.page(ContentPage,{state},'content'); hydrateThumbnails(); } }
function renderLocalPacks() { renderContentPage(); }
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
function renderLocalMods() { renderContentPage(); }
const modManager=createModManager({state,render:renderLocalMods,search:()=>searchContent(),flash,
 list:(gameDir,version)=>invoke('list_mods',{gameDir,version}),
 remove:(gameDir,version,name)=>invoke('remove_mod',{gameDir,version,name}),
 setEnabled:(gameDir,version,name,enabled)=>invoke('set_mod_enabled',{gameDir,version,name,enabled})});
function applyModChanges(action,names){return modManager.applyModChanges(action,names);}
function refreshMods(){return modManager.refreshMods();}
const contentSearch=createContentSearch({state,modRevision:modManager.revision,render,renderContent:renderContentPage,
 categories:(source,kind,apiKey)=>invoke('content_categories',{source,kind,apiKey}),
 search:snapshot=>invoke('search_content',snapshot),
 translate:(source,items)=>invoke('translate_content_summaries',{source,items})});
const {loadContentCategories,searchContent}=contentSearch;

function updateProjectLinks() { if(state.modDraft && app.querySelector('.mod-dialog')) renderOverlay(); }
function updateProjectDescription() { if(state.modDraft && app.querySelector('.mod-dialog')) renderOverlay(); }
let accountListRevision=0;
async function refreshAccountList() {
 const revision=++accountListRevision;
 try { const accounts=await invoke('list_microsoft_accounts');if(revision!==accountListRevision)return;state.savedAccounts=Array.isArray(accounts)?accounts.filter(a=>typeof a?.uuid==='string' && typeof a?.name==='string'):[];if(state.page==='account')render(); } catch { /* Existing account remains usable when the credential store is unavailable. */ }
}
let viewer=null, previewGeneration=0;
function refreshPreview() {
 const generation=++previewGeneration;
 if(viewer) { viewer.dispose(); viewer=null; }
 const canvas=app.querySelector('#skin-preview'); if(!canvas) return;
 const cape=state.localCape?.data || state.appearance?.capes?.find(c=>c.id===state.previewCapeId)?.texture || null;
 const skin=state.localSkin?.data || state.appearance?.skin || null;
 if(!skin) return;
 import('./appearance-preview.ts').then(m=>m.createAppearancePreview(canvas,skin,cape,state.skinModel)).then(next=>{if(generation!==previewGeneration) next.dispose(); else { viewer=next; if(next.is2d) { const caption=app.querySelector('.preview-caption'); if(caption) caption.textContent=`2D 预览 · ${state.localCape?'本地披风预览':state.previewCapeId?'账户披风预览':'无披风'}`; } }}).catch(()=>{if(generation===previewGeneration) { const el=app.querySelector('.preview-fallback'); if(el) el.hidden=false; }});
}
let appearanceRequest=null;
function refreshAppearance({reuse=false}={}) {
 const account=state.account; if(!account?.uuid) return Promise.resolve();
 if(reuse && appearanceRequest?.account===account) return appearanceRequest.promise;
 const request={account};appearanceRequest=request;
 request.promise=(async()=>{
  try { const result=await invoke('get_appearance'); if(state.account!==account || appearanceRequest!==request) return; state.appearance=result;cacheOnlineAvatar(account.uuid,result.skin); if(!state.localSkin)state.skinModel=result.model==='slim'?'slim':'classic'; state.previewCapeId=result.capes.find(c=>c.active)?.id || ''; }
  catch(e) { if(state.account!==account || appearanceRequest!==request) return; state.appearance=null; flash(`无法获取账户外观：${e}`,'error'); }
  finally { if(appearanceRequest===request) appearanceRequest=null; }
  if(state.page==='account') render(); else renderChrome();
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
const { saveJobs, runnerFor, restoreJobs, renderJobList, hasJob, enqueueJob, pumpJobs, requestJobCancel, jobEvent, queueVersion, activeJobCount } = createJobManager({
 state, invoke, persist, renderChrome, flash, render, refreshInstalled, renderDownloads,
 onJobFinished: async job => {
  if(['resourcepack','shader'].includes(job.kind) && job.version===state.contentTarget && job.gameDir===state.gameDir && state.contentKind===job.kind) { contentSearch.invalidate(); state.contentLoaded=false; if(state.page==='content') await Promise.all([refreshPacks(),searchContent()]); }
  if (job.kind==='mod' && job.version===state.contentTarget && job.gameDir===state.gameDir) {
   modManager.invalidate();state.modUpdates=null;state.modConflicts=null;
   if(state.page==='content'){await refreshMods();if(state.contentKind==='shader')await refreshPacks();await searchContent();}
  }
 }
});
async function refreshJava() {
 state.javaLoading = true; if (state.page === 'java') render();
 try { state.javaRuntimes = await invoke('list_java'); }
 catch (e) { state.notice = `检测 Java 失败：${e}`; state.noticeKind = 'error'; }
 state.javaLoading = false; if (state.page === 'java') render();
}
let renderedPage = null;
const inputController=createInputController({container:app,state,theme,render,renderSettings:renderSettingsPage,renderMods:renderLocalMods,renderPacks:renderLocalPacks,updateSearch:updateSearchResults,applyTheme,persist});
function renderChrome() {
 renderShell();
 if(state.page==='settings' && app.querySelector('#update-panel'))renderSettingsPage();
}
function renderOverlay() {
 const root=app.querySelector('#modal-root');if(!root)return;
 if(state.launchView) {
  renderer.overlay(LaunchScreen,{view:state.launchView},`launch:${state.launchView.id}`);
 } else if(state.crashDialog) {
  renderer.overlay(CrashDialog,{crash:state.crashDialog}); } else if(state.instanceSettingsView && !state.launchView && !state.crashDialog) {
  const d=state.instanceSettingsView,savedSettings=getLaunchSettings(d.gameDir,d.version);
  renderer.overlay(InstanceSettingsDialog,{name:d.name,values:{...state,...savedSettings},saved:savedSettings,runtimes:Array.isArray(state.javaRuntimes)?state.javaRuntimes:[]},`instance-settings:${d.version}`);
 } else if(state.themeView) {
  const d=state.themeView,cover=d.preview||(!d.removeCover?instanceCovers.get(instanceKey(d.gameDir,d.version)):null)||null;
  renderer.overlay(InstanceThemeDialog,{draft:d,cover,colors:instanceColors});
 } else if(state.profileView) {
  renderer.overlay(GameProfileDialog,{view:state.profileView},`profile:${state.profileView.version}`);
 } else if(state.manageView) {
  renderer.overlay(ManageDialog,{view:state.manageView});
 } else if(state.instanceView && !state.launchView && !state.crashDialog && !state.themeView && !state.profileView && !state.manageView) {
  renderer.overlay(InstanceOverviewDialog,{view:state.instanceView});
 } else if(state.installDraft && !state.themeView && !state.profileView && !state.manageView && !state.instanceView) {
  renderer.overlay(InstallDialog,{draft:state.installDraft,addons:ADDONS});
 } else if(state.archiveDraft && !state.themeView && !state.profileView && !state.manageView && !state.instanceView && !state.modDraft) {
  renderer.overlay(ArchiveDialog,{draft:state.archiveDraft});
 } else if(state.modDraft) {
  renderer.overlay(ContentDialog,{draft:state.modDraft,shaderEnv:state.shaderEnv,shaderEnvLoading:state.shaderEnvLoading},`content:${state.modDraft.source}:${state.modDraft.projectId}`);
 } else renderer.overlay();
 syncMemoryControls();

}
function renderPage() {
 if(state.page==='home'){const v=selected();renderer.page(HomePage,{version:v,visual:versionVisual(v),description:v?.installed?getInstanceTheme(state.gameDir,v.id).description:''});return;}
 if(state.page==='versions'){renderVersionsPage();return;}
 if(state.page==='java'){renderer.page(JavaPage,{runtimes:state.javaRuntimes,javaPath:state.javaPath,loading:state.javaLoading,deleteIndex:state.javaDelete,hasJob});return;}
 if(state.page==='content'){renderContentPage();return;}
 if(state.page==='downloads'){renderDownloads();return;}
 if(state.page==='settings'){renderSettingsPage();return;}
 if(state.page==='account'){renderer.page(AccountPage,{state,usingOnline:usingOnlineAccount(),playerName:playerName(),selected:selected()});return;}
 if(state.page==='multiplayer' && state.lanView==='room'){renderer.page(LanRoomPage,{room:state.lanRoom,busy:state.lanBusy,addresses:state.lanAddresses,port:state.lanPort,target:state.lanTarget,test:state.lanTest});return;}
 if(state.page==='multiplayer' && state.lanView==='servers'){renderServerPage();return;}
 renderer.page();
}
function render() {
 if(!inputController.beforeRender(renderedPage===state.page))return;
 const first = !app.querySelector('.app-shell');
 if (first) { renderer.mount(Shell,shellProps()); renderPage(); }
 else {
  const content = app.querySelector('.content');
  const same = renderedPage === state.page;
  const main=app.querySelector('.main'),scrollTop=main?.scrollTop,scrollLeft=main?.scrollLeft,docScroll=document.scrollingElement||document.documentElement,docTop=docScroll.scrollTop,docLeft=docScroll.scrollLeft;
  const values = same ? [...content.querySelectorAll('form input, form select')].filter(x => x.name).map(x => ({name:x.name, value:x.value, checked:x.checked, type:x.type})) : [];
  const active = same && content.contains(document.activeElement) ? document.activeElement : null;
  const focus = active ? { name:active.name, id:active.id, start:active.selectionStart, end:active.selectionEnd } : null;
  renderPage();
  for (const saved of values) { const el = [...content.querySelectorAll('form input, form select')].find(x => x.name === saved.name && x.type === saved.type); if (el) { el.value = saved.value; if (el.type === 'checkbox' || el.type === 'radio') el.checked = saved.checked; } }
  if (focus) { const el = [...content.querySelectorAll('input, select')].find(x => focus.id ? x.id === focus.id : x.name === focus.name); if (el) { el.focus({preventScroll:true}); if (focus.start != null && typeof el.setSelectionRange === 'function') { try { el.setSelectionRange(focus.start, focus.end); } catch {} } } }
  if(same && main){main.scrollTop=scrollTop;main.scrollLeft=scrollLeft;docScroll.scrollTop=docTop;docScroll.scrollLeft=docLeft;}
 }
 renderedPage = state.page; syncMemoryControls(); applyTheme(); renderChrome(); if(!(state.modDraft && app.querySelector("#modal-root .mod-dialog")) && !(state.archiveDraft && app.querySelector("#modal-root .archive-dialog"))) renderOverlay(); hydrateThumbnails(); refreshPreview();
}
function renderSettingsPage() {
 renderer.page(SettingsPage,{...state,version:appVersion,selectedVersion:state.versions.find(v=>v.id===state.selected && v.installed),theme},'settings');
}
function renderDownloads() {
 if(!app.querySelector('#job-list') && state.page!=='downloads')return;
 renderer.page(DownloadsPage,{jobs:state.jobs,limit:state.jobLimit},'downloads');
}
function renderServerPage() {
 renderer.page(PublicServersPage,{catalog:state.serverCatalog,filtered:filteredServers(),query:state.serverQuery,status:state.serverStatus,page:state.serverPage,loading:state.serverLoading,error:state.serverError},'public-servers');
}
function renderVersionsPage() { renderer.page(VersionsPage,{versions:state.versions,query:state.versionQuery,selected:state.selected,loading:state.loading,versionVisual,deleteVersion:state.versionDelete,deleting:state.versionDeleting},'versions'); }
function updateSearchResults(kind) {
 if(kind==='server') {renderServerPage();hydrateThumbnails();return;}
 renderVersionsPage();
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
 const page = event.target.closest('[data-page]'); if (page) { state.page = page.dataset.page; render(); if (state.page === 'account') {void refreshAccountList();if(state.account && !state.appearance)void refreshAppearance({reuse:true});} if (state.page === 'settings') void refreshMemoryInfo(); if (state.page === 'java') await refreshJava(); if (state.page === 'multiplayer' && state.lanView==='room') await refreshLanAddresses(); if (state.page === 'multiplayer' && state.lanView==='servers' && !state.serverCatalog) await refreshPublicServers(); if (state.page === 'content') { if(!state.contentTarget || !state.versions.some(v=>v.installed && v.id===state.contentTarget)) {state.contentTarget=state.selected || '';state.selectedMods.clear();state.modUpdates=null;modManager.invalidate();state.contentPage=0;state.contentLoaded=false;} await refreshMods();await refreshPacks();void loadContentCategories();if(!state.contentLoaded) await searchContent(); } return; }
 const profileButton=event.target.closest('[data-game-profile]');if(profileButton){await openGameProfile(profileButton.dataset.gameProfile);return;}
 const profilePage=event.target.closest('[data-profile-page]');if(profilePage&&state.profileView&&!state.profileView.loading){const d=state.profileView,n=Number(profilePage.dataset.profilePage);if(n>=0&&(n<d.page||d.hasMore)){d.page=n;d.preview=null;await loadProfileScreenshots(d);}return;}
 const profileShot=event.target.closest('[data-profile-shot]');if(profileShot&&state.profileView){const d=state.profileView,index=Number(profileShot.dataset.profileShot),data=d.images[index];if(data){d.preview={data,name:d.shots[index].name};renderOverlay();}return;}
 const instanceSettingsButton=event.target.closest('[data-instance-settings]');
 if(instanceSettingsButton){const version=instanceSettingsButton.dataset.instanceSettings,item=state.versions.find(v=>v.id===version&&v.installed);if(!item)return;const menu=instanceSettingsButton.closest('details');if(menu)menu.open=false;const view={version,gameDir:state.gameDir,name:item.name||version};state.instanceSettingsView=view;renderOverlay();void invoke('list_java').then(runtimes=>{if(state.instanceSettingsView!==view || !Array.isArray(runtimes))return;state.javaRuntimes=runtimes;renderOverlay();}).catch(()=>{});return;}
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
 if(event.target.closest('[data-action="toggle-content-language"]') && state.modDraft){state.modDraft.showOriginal=!state.modDraft.showOriginal;updateProjectDescription();return;}
 const contentInstall = event.target.closest('[data-content-install], [data-content-details]');
 if (contentInstall && !state.contentBusy) {
  const isDetails=contentInstall.hasAttribute('data-content-details');
  const item=state.contentResults[Number(isDetails?contentInstall.dataset.contentDetails:contentInstall.dataset.contentInstall)]; if(!item) return;
  const kind=state.contentKind,source=state.contentSource,apiKey=state.contentKey,gameDir=state.gameDir,target=state.contentTarget,javaPath=state.javaPath;
  if(kind==='modpack' && !isDetails) {enqueueJob({key:`modpack:${source}:${item.id}:${gameDir}`,kind,title:item.title,gameDir,recipe:{type:'modpack',gameDir,source,projectId:item.id,javaPath},run:job=>invoke('install_modpack',{gameDir,source,projectId:item.id,apiKey,javaPath,jobId:job.id})});return;}
  if(kind!=='modpack' && !target) return;
  const draft={title:item.title,projectId:item.id,projectUrl:item.projectUrl,installed:!!item.installed,kind,source,apiKey,gameDir,target,javaPath,loading:kind!=='modpack',versions:[],error:'',links:[],linksLoading:true,linksError:false,summary:item.description||'',description:'',descriptionLoading:true,descriptionError:false,translation:'',translationLoading:true,showOriginal:false,encyclopedia:null};state.modDraft=draft;renderOverlay();
  if((kind==='mod'||kind==='modpack') && item.projectUrl)void invoke('lookup_mcmod',{source,kind,projectUrl:item.projectUrl,title:item.title}).then(result=>{if(state.modDraft===draft && result?.url){draft.encyclopedia=result;updateProjectLinks();updateProjectDescription();}}).catch(()=>{});
  const linkRequest=invoke('content_links',{source,projectId:item.id,apiKey}).then(info=>{if(state.modDraft===draft){draft.links=Array.isArray(info?.links)?info.links:[];draft.linksLoading=false;if(source==='modrinth'){draft.description=typeof info?.description==='string'?info.description:'';draft.descriptionLoading=false;}updateProjectLinks();updateProjectDescription();}}).catch(()=>{if(state.modDraft===draft){draft.linksLoading=false;draft.linksError=true;if(source==='modrinth'){draft.descriptionLoading=false;draft.descriptionError=true;}updateProjectLinks();updateProjectDescription();}});
  const descriptionRequest=source==='curseforge'?invoke('curseforge_description',{projectId:item.id,apiKey}).then(description=>{if(state.modDraft===draft){draft.description=typeof description==='string'?description:'';draft.descriptionLoading=false;updateProjectDescription();}}).catch(()=>{if(state.modDraft===draft){draft.descriptionLoading=false;draft.descriptionError=true;updateProjectDescription();}}):Promise.resolve();
  const versionRequest=kind!=='modpack' ? invoke(kind==='mod'?'list_mod_versions':'list_pack_versions',{gameDir,version:target,source,projectId:item.id,apiKey,...(kind==='mod'?{}:{kind})}).then(versions=>{if(state.modDraft===draft){draft.versions=versions;draft.loading=false;renderOverlay();}}).catch(e=>{if(state.modDraft===draft){draft.error=String(e);draft.loading=false;renderOverlay();}}) : Promise.resolve();
  void Promise.all([linkRequest,descriptionRequest]).then(async()=>{if(state.modDraft!==draft)return;try{const translated=await invoke('translate_content',{source,projectId:item.id,description:draft.description,summary:draft.summary});if(state.modDraft===draft && typeof translated==='string')draft.translation=translated;}catch{}finally{if(state.modDraft===draft){draft.translationLoading=false;updateProjectDescription();}}});
  await versionRequest;return;
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
 const switchAccount=event.target.closest('[data-switch-account]');
 if(switchAccount && !state.accountBusy && !state.loginAttempt) {const uuid=switchAccount.dataset.switchAccount;if(uuid===state.account?.uuid)return;const previous={account:state.account,appearance:state.appearance,accountName:state.accountName,accountUuid:state.accountUuid,accountMode:state.accountMode,accountPreference:state.accountPreference,accountKnown:state.accountKnown};state.restoreAttempt=null;restoreTask=null;state.accountRestoring=false;state.accountBusy=true;state.appearance=null;state.account=null;state.accountPreference='microsoft';state.accountKnown=true;const target=state.savedAccounts.find(a=>a.uuid===uuid);state.accountName=target?.name||'';state.accountUuid=uuid;state.accountRestoreError='';void restoreOnlineAvatar(uuid);render();try{const result=await invoke('switch_microsoft_account',{uuid});if(result?.error || !result?.account){state.accountMode='offline';state.accountRestoreError=`账户恢复失败：${result?.error||'未找到保存的账户'}。可检查网络后重试或重新登录。`;persist();flash(state.accountRestoreError,'error');}else{const account=result.account;state.account=account;state.accountName=account.name;state.accountUuid=account.uuid;state.accountMode=state.accountPreference==='offline'?'offline':'microsoft';persist();await refreshAppearance();}}catch(e){Object.assign(state,previous);persist();flash(`无法切换账户：${e}`,'error');}finally{state.accountBusy=false;render();void refreshAccountList();}return;}
 if(action==='begin-login' && !state.accountRestoring) {
  const attempt={}; state.loginAttempt=attempt;state.browserPrompt=null;render();
  try { const prompt=await invoke('begin_microsoft_login'); if(state.loginAttempt!==attempt) return; state.browserPrompt=prompt;render(); const account=await invoke('complete_microsoft_login'); if(state.loginAttempt!==attempt) return; if(state.account?.uuid!==account.uuid)state.appearance=null;state.account=account;state.accountName=account.name;state.accountUuid=account.uuid;state.accountMode='microsoft';state.accountKnown=true;state.accountPreference='microsoft';state.accountRestoreError='';state.loginAttempt=null;state.browserPrompt=null;void restoreOnlineAvatar(account.uuid);persist();render();if(account.remembered===false)flash(`登录成功，但无法保存登录状态：${account.rememberError || '请检查系统凭据库。'}`,'error');await refreshAppearance();void refreshAccountList(); }
  catch(e) { if(state.loginAttempt===attempt) { state.loginAttempt=null;state.browserPrompt=null;render();flash(`登录失败：${e}`,'error'); } } return;
 }
 if(action==='cancel-login') { state.loginAttempt=null;state.browserPrompt=null;state.accountBusy=true;render(); try { await invoke('cancel_microsoft_login'); } catch(e) { flash(String(e),'error'); } finally { state.accountBusy=false;render(); } return; }
 if(action==='retry-save-account' && state.account && !state.accountBusy) {const current=state.account;state.accountBusy=true;render();try{const account=await invoke('remember_microsoft_account');if(state.account!==current)return;Object.assign(current,account);if(account.remembered){flash('登录状态已保存。');void refreshAccountList();}else flash(`仍无法保存登录状态：${account.rememberError || '请检查系统凭据库。'}`,'error');}catch(e){flash(`无法重试保存：${e}`,'error');}finally{state.accountBusy=false;render();}return;}
 if(action==='retry-account-restore' && !state.accountRestoring) {void restoreAccount({notify:true});return;}
 if(action==='open-microsoft-login') { try { await invoke('open_microsoft_login'); } catch(e) { flash(String(e),'error'); } return; }
 if(action==='use-offline' || action==='continue-offline') { state.accountMode='offline';state.accountPreference='offline';persist();render();return; }
 if(action==='use-microsoft' && (state.account || state.accountKnown)) { state.accountMode=state.account?'microsoft':'offline';state.accountPreference='microsoft';void restoreOnlineAvatar(state.account?.uuid||state.accountUuid);persist();render();if(!state.account)void restoreAccount({notify:false});return; }
 if(action==='logout-microsoft') { const oldUuid=state.account?.uuid||state.accountUuid;state.restoreAttempt=null;restoreTask=null;state.accountRestoring=false;state.accountBusy=true;render();try { await invoke('logout_microsoft'); } catch(e) { flash(String(e),'error'); } finally { state.account=null;state.accountName='';state.accountUuid='';cacheOnlineAvatar(oldUuid,null);state.accountMode='offline';state.accountKnown=false;state.accountPreference='offline';state.accountRestoreError='';state.appearance=null;state.previewCapeId='';state.accountBusy=false;persist();render();void refreshAccountList(); } return; }
 if(action==='choose-skin' || action==='choose-cape') { const kind=action==='choose-skin'?'skin':'cape';try { const path=await openDialog({multiple:false,directory:false,filters:[{name:'PNG 图片',extensions:['png']}]}); if(typeof path!=='string') return;const data=await invoke('preview_texture',{path,kind});const file={path,data,name:path.split(/[\\/]/).pop(),...(kind==='skin'?{model:state.skinModel}:{})};if(kind==='skin') {state.localSkin=file;saveLocalSkin(file);}else state.localCape=file;render(); } catch(e) { flash(`无法预览图片：${e}`,'error'); } return; }
 if(action==='apply-offline-skin' && state.localSkin && !usingOnlineAccount() && selected()?.installed) {const version=state.selected,gameDir=state.gameDir,skin=state.localSkin.data,username=state.username;state.accountBusy=true;render();try{await invoke('apply_offline_skin',{gameDir,version,username,skin});offlineSkinInstances[instanceKey(gameDir,version)]=true;localStorage.setItem('ccl-offline-skin-instances',JSON.stringify(offlineSkinInstances));flash('皮肤已保存到实例；请确保已安装 CustomSkinLoader。');}catch(e){flash(`无法应用离线皮肤：${e}`,'error');}finally{state.accountBusy=false;render();}return;}
 if(action==='find-offline-skin-mod') {state.contentKind='mod';state.contentSource='modrinth';state.contentTarget=state.selected;state.contentQuery='CustomSkinLoader';state.contentPage=0;state.contentLoaded=false;state.contentResults=[];state.page='content';render();void searchContent(true);return;}
 if(action==='clear-skin') { state.localSkin=null;saveLocalSkin(null);render();return; }
 if(action==='clear-cape') { state.localCape=null;render();return; }
 if(action==='upload-skin' && state.localSkin && state.account) { state.accountBusy=true;render();try { await invoke('upload_account_skin',{path:state.localSkin.path,model:state.skinModel});state.localSkin=null;saveLocalSkin(null);await refreshAppearance();flash('皮肤已应用到正版账户。'); } catch(e) { flash(`应用皮肤失败：${e}`,'error'); } state.accountBusy=false;render();return; }
 if(action==='reset-skin' && state.account) { state.accountBusy=true;render();try { await invoke('reset_account_skin');state.localSkin=null;saveLocalSkin(null);await refreshAppearance();flash('已恢复账户默认皮肤。'); } catch(e) { flash(`恢复皮肤失败：${e}`,'error'); } state.accountBusy=false;render();return; }
 if(action==='hide-cape' && state.account) { state.accountBusy=true;render();try { await invoke('set_account_cape',{capeId:null});state.localCape=null;await refreshAppearance();flash('已隐藏账户披风。'); } catch(e) { flash(`更新披风失败：${e}`,'error'); } state.accountBusy=false;render();return; }
 const previewCape=event.target.closest('[data-preview-cape]'); if(previewCape) { const cape=state.appearance?.capes[Number(previewCape.dataset.previewCape)];if(cape) {state.previewCapeId=cape.id;state.localCape=null;render();}return; }
 const applyCape=event.target.closest('[data-apply-cape]'); if(applyCape && state.account) { const cape=state.appearance?.capes[Number(applyCape.dataset.applyCape)];if(!cape)return;state.accountBusy=true;render();try { await invoke('set_account_cape',{capeId:cape.id});state.localCape=null;await refreshAppearance();flash('已更新账户披风。'); } catch(e) { flash(`更新披风失败：${e}`,'error'); } state.accountBusy=false;render();return; }
 if(action==='close-instance-settings'){state.instanceSettingsView=null;renderOverlay();return;}
 if(action==='reset-instance-settings' && state.instanceSettingsView) {const view=state.instanceSettingsView,key=instanceKey(view.gameDir,view.version),previous=instanceLaunchSettings[key];delete instanceLaunchSettings[key];try{localStorage.setItem('ccl-instance-launch-settings',JSON.stringify(instanceLaunchSettings));state.instanceSettingsView=null;renderOverlay();flash('此实例已恢复使用全局设置。');}catch(e){if(previous)instanceLaunchSettings[key]=previous;flash(`无法保存实例设置：${e}`,'error');}return;}
 if(action==='check-update') {void checkLauncherUpdate(true);return;}
 if(action==='open-update') {try {await invoke('open_launcher_releases');}catch(e){flash(`无法打开下载页面：${e}`,'error');}return;}
 if(action==='dismiss-update') {state.updateDismissed=state.updateInfo?.latestVersion||'';renderChrome();return;}
 if (action === 'dismiss') { state.notice = '';state.noticeCrash=false; renderChrome(); }
 if(action==='open-crash-diagnosis' && state.crash) {state.crashDialog=state.crash;renderOverlay();}
 if(action==='close-crash-dialog') {state.crashDialog=null;renderOverlay();}
 if(action==='close-instance') {state.instanceView=null;renderOverlay();}
 if(action==='close-game-profile' && state.profileView){state.profileView.generation++;state.profileView=null;renderOverlay();}
 if(action==='close-profile-preview' && state.profileView){const d=state.profileView;d.preview=null;renderOverlay();}
 if(action==='refresh-game-profile' && state.profileView && !state.profileView.loading){const d=state.profileView;void gameProfile.loadStats(d);await loadProfileScreenshots(d);}
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
 if(action==='find-shader-support') {state.contentKind='mod';state.contentQuery=event.target.closest('[data-query]')?.dataset.query||'Iris';state.contentPage=0;state.contentLoaded=false;state.contentResults=[];packEpoch++;state.packDelete=null;const query=app.querySelector('#content-form [name=query]');if(query)query.value=state.contentQuery;render();await searchContent();}
 if(action==='cancel-pack-remove') {state.packDelete=null;render();}
 if(action==='confirm-pack-remove' && state.packDelete && !state.packWorking) {const item=state.packDelete;state.packDelete=null;state.packWorking=true;render();try{await invoke('remove_local_pack',item);flash('资源包已删除。');if(item.version===state.contentTarget&&item.gameDir===state.gameDir&&item.kind===state.contentKind){await refreshPacks();contentSearch.invalidate();state.contentLoaded=false;await searchContent();}}catch(e){flash(`删除失败：${e}`,'error');}finally{state.packWorking=false;if(state.page==='content')render();}}
 if(action==='check-pack-updates' && !state.packChecking && !state.packWorking && state.contentTarget) {const version=state.contentTarget,gameDir=state.gameDir,kind=state.contentKind,epoch=packEpoch;state.contentKey=String(app.querySelector('#content-form [name=apiKey]')?.value || state.contentKey).trim();state.packChecking=true;state.packUpdates=null;renderLocalPacks();try{const result=await invoke('check_pack_updates',{gameDir,version,kind,apiKey:state.contentKey});if(epoch===packEpoch && version===state.contentTarget && gameDir===state.gameDir && kind===state.contentKind)state.packUpdates=result;}catch(e){flash(`检查更新失败：${e}`,'error');}finally{state.packChecking=false;renderLocalPacks();}}

 if (action === 'cancel-mod-remove') { state.modDelete = null; render(); }
 if (action === 'confirm-mod-remove') { const names=state.modDelete || [];state.modDelete=null;render();await applyModChanges('delete',names); }
 if (action === 'bulk-mod-enable' || action === 'bulk-mod-disable') await applyModChanges(action==='bulk-mod-enable'?'enable':'disable',[...state.selectedMods]);
 if(action==='check-mod-conflicts' && !state.modConflictsLoading && !state.modWorking && state.contentTarget){const version=state.contentTarget,gameDir=state.gameDir,epoch=modManager.revision();state.modConflictsLoading=true;state.modConflicts=null;renderLocalMods();try{const result=await invoke('check_mod_conflicts',{gameDir,version});if(epoch===modManager.revision() && version===state.contentTarget && gameDir===state.gameDir)state.modConflicts=result;}catch(e){flash(`排查失败：${e}`,'error');}finally{state.modConflictsLoading=false;renderLocalMods();}}
 if (action === 'check-mod-updates' && !state.modChecking && !state.modWorking && state.contentTarget) {const version=state.contentTarget,gameDir=state.gameDir,epoch=modManager.revision();state.modChecking=true;state.modUpdates=null;renderLocalMods();try {const result=await invoke('check_mod_updates',{gameDir,version});if(version===state.contentTarget && gameDir===state.gameDir && epoch===modManager.revision() && !state.modWorking)state.modUpdates=result;}catch(e){flash(`检查更新失败：${e}`,'error');}finally{state.modChecking=false;if(state.page==='content')renderLocalMods();} }
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
   if(!online && state.localSkin?.data && offlineSkinInstances[instanceKey(state.gameDir,view.version)]===true) await invoke('apply_offline_skin',{gameDir:state.gameDir,version:view.version,username:state.username,skin:state.localSkin.data});
   if(state.launchView!==view)return;
   const launchSettings=effectiveLaunchSettings(state.gameDir,view.version);
   await invoke('launch_game', { options: { launchId:view.id,version: view.version, username: state.username, javaPath: launchSettings.javaPath, gameDir: state.gameDir, memory: Number(launchSettings.memory), memoryMode:launchSettings.memoryMode, optimize:launchSettings.optimize, jvmArgs:launchSettings.jvmArgs, gameArgs:launchSettings.gameArgs, accountMode:online?'microsoft':'offline' } });
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
 if(event.target.id==='memory-mode' || event.target.id==='instance-memory-mode' || ['overrideJava','overrideMemory','overrideArgs'].includes(event.target.name)) {syncMemoryControls();return;}
 if(event.target.id==='server-status') { state.serverStatus=event.target.value;state.serverPage=0;updateSearchResults('server');return; }
 if(event.target.id==='server-page-jump'){const max=Math.max(0,Math.ceil(filteredServers().length/40)-1),n=Number(event.target.value);if(Number.isInteger(n)){state.serverPage=Math.max(0,Math.min(max,n-1));updateSearchResults('server');}return;}
 if(event.target.id==='skin-model') { state.skinModel=event.target.value;if(state.localSkin){state.localSkin.model=state.skinModel;saveLocalSkin(state.localSkin);}render();return; }
 if(event.target.id==='job-limit') { state.jobLimit=Math.max(1,Math.min(5,Number(event.target.value)||3));persist();render();pumpJobs();return; }
 if(event.target.id==='local-mod-filter') {state.modFilter=event.target.value;renderLocalMods();return;}
 if(event.target.id==='mod-select-visible') {const matches=state.localMods.filter(m=>m.name.toLocaleLowerCase().includes(state.modQuery.trim().toLocaleLowerCase()) && (state.modFilter==='all'||m.enabled===(state.modFilter==='enabled')));for(const m of matches) event.target.checked?state.selectedMods.add(m.name):state.selectedMods.delete(m.name);renderLocalMods();return;}
 if(event.target.dataset.modSelect!==undefined) {const m=state.localMods[Number(event.target.dataset.modSelect)];if(m)event.target.checked?state.selectedMods.add(m.name):state.selectedMods.delete(m.name);renderLocalMods();return;}
 if(event.target.id==='contentTarget') { state.selectedMods.clear();modManager.invalidate();state.modUpdates=null;state.modConflicts=null;state.contentTarget=event.target.value; state.contentResults=[]; state.localMods=[];state.contentPage=0;state.contentLoaded=false;await refreshMods();await refreshPacks();await searchContent(); return; }
 if (event.target.name==='draftLoader' && state.installDraft) { state.installDraft.loader=event.target.value; state.installDraft.addons=state.installDraft.addons.filter(id=>ADDONS.find(a=>a.id===id)?.loaders.includes(state.installDraft.loader)); renderOverlay(); return; }
 if (event.target.name==='draftAddon' && state.installDraft) { const selected=state.installDraft.addons; state.installDraft.addons=event.target.checked ? [...new Set([...selected,event.target.value])] : selected.filter(x=>x!==event.target.value); return; }
 if (event.target.closest('#content-form') && ['source','kind','sort','category','loaderFilter','environment'].includes(event.target.name)) { const form=event.target.closest('form'); const data=new FormData(form);const changedSource=state.contentSource!==data.get('source'),changedKind=state.contentKind!==data.get('kind'); state.contentSource=data.get('source'); state.contentKind=data.get('kind'); state.contentSort=data.get('sort');state.contentQuery=String(data.get('query') || '').trim();state.contentKey=String(data.get('apiKey') || state.contentKey);state.contentCategory=changedSource||changedKind?'':String(data.get('category')||'');state.contentGameFilter=String(data.get('gameFilter')||state.contentGameFilter).trim();state.contentLoaderFilter=String(data.get('loaderFilter')||'');state.contentEnvironment=state.contentSource==='modrinth'?String(data.get('environment')||''):'';state.contentResults=[];state.contentPage=0;state.contentHasMore=false;state.contentLoaded=false;state.contentError='';state.packDelete=null;if(changedSource||changedKind)state.contentCategories=[];render();if(changedSource||changedKind)void loadContentCategories();await Promise.all([refreshPacks(),searchContent()]); }

});
app.addEventListener('submit', async event => { if(event.target.id==='instance-settings-form') {
 event.preventDefault();const form=event.target,view=state.instanceSettingsView;if(!view)return;
 if(view.gameDir!==state.gameDir || !state.versions.some(v=>v.id===view.version && v.installed)){flash('实例已变更或不存在，请重新打开设置。','error');return;}
 const overrideJava=form.elements.overrideJava.checked,overrideMemory=form.elements.overrideMemory.checked,overrideArgs=form.elements.overrideArgs.checked;
 const javaPath=form.elements.javaPath.value.trim(),memory=Number(form.elements.memory.value),memoryMode=form.elements.memoryMode.value==='manual'?'manual':'auto';
 if((overrideJava && !javaPath) || (overrideMemory && memoryMode==='manual' && (!Number.isInteger(memory)||memory<512||memory>32768))){flash('请填写有效的 Java 路径和内存上限。','error');return;}
 const key=instanceKey(view.gameDir,view.version),previous=instanceLaunchSettings[key];
 if(overrideJava||overrideMemory||overrideArgs)instanceLaunchSettings[key]={overrideJava,overrideMemory,overrideArgs,javaPath:javaPath||state.javaPath,memory:Number.isInteger(memory)&&memory>=512&&memory<=32768?memory:state.memory,memoryMode,optimize:form.elements.optimize.checked,jvmArgs:form.elements.jvmArgs.value,gameArgs:form.elements.gameArgs.value};else delete instanceLaunchSettings[key];
 try{localStorage.setItem('ccl-instance-launch-settings',JSON.stringify(instanceLaunchSettings));state.instanceSettingsView=null;renderOverlay();flash('实例启动设置已保存。');}catch(e){if(previous)instanceLaunchSettings[key]=previous;else delete instanceLaunchSettings[key];flash(`无法保存实例设置：${e}`,'error');}return;
} if(event.target.id==='lan-host-form') { event.preventDefault(); if(state.lanBusy||state.lanRoom) return; const port=Number(event.target.elements.lanGamePort.value); if(!Number.isInteger(port)||port<1||port>65535) { flash('请输入 1–65535 的游戏局域网端口。','error');return; } state.lanPort=String(port);state.lanBusy=true;render();try { const relayPort=await invoke('start_ipv6_room',{gamePort:port});state.lanRoom={port:relayPort};await refreshLanAddresses(); } catch(e) { flash(`创建房间失败：${e}`,'error'); } finally { state.lanBusy=false;render(); } return; } if(event.target.id==='lan-test-form') { event.preventDefault();if(state.lanBusy)return;state.lanTarget=event.target.elements.lanTarget.value.trim();state.lanTest='';state.lanBusy=true;render();try { await invoke('test_ipv6_connection',{address:state.lanTarget});state.lanTest='TCP 连接成功；游戏能否加入还取决于版本、模组和服务器状态。'; } catch(e) { state.lanTest=String(e); } finally { state.lanBusy=false;render(); } return; } if (event.target.id === 'content-form') { event.preventDefault(); const data = new FormData(event.target); state.contentSource = data.get('source'); state.contentKind = data.get('kind'); state.contentSort=data.get('sort');state.contentQuery = String(data.get('query') || '').trim(); state.contentKey = String(data.get('apiKey') || state.contentKey);state.contentCategory=String(data.get('category')||state.contentCategory);state.contentGameFilter=String(data.get('gameFilter')||'').trim();state.contentLoaderFilter=String(data.get('loaderFilter')||'');state.contentEnvironment=String(data.get('environment')||'');state.contentPage=0;state.contentHasMore=false;void loadContentCategories(); await searchContent(true); return; } if (event.target.id !== 'settings-form') return; event.preventDefault(); const data = new FormData(event.target); const proxyUrl = String(data.get('proxyUrl') || '').trim(); const changed = state.gameDir !== data.get('gameDir').trim() || state.proxyUrl !== proxyUrl; const selectedVersion=state.versions.find(v=>v.id===state.selected && v.installed),isolationControl=event.target.querySelector('#version-isolation'),isolationChanged=selectedVersion && isolationControl && !isolationControl.disabled && isolationControl.checked!==!!selectedVersion.isolated; if(isolationChanged && state.gameDir!==data.get('gameDir').trim()) {flash('请先保存游戏目录，再修改版本隔离。','error');return;} if(isolationChanged && state.jobs.some(j=>j.gameDir===state.gameDir && ['queued','running','canceling'].includes(j.status))) {flash('该游戏目录有进行中或等待中的任务，请先取消或等待结束。','error');return;} try { await invoke('configure_proxy', { proxyUrl }); } catch (e) { const input = event.target.querySelector('#proxyUrl'); input.setCustomValidity(String(e)); input.reportValidity(); return; } if(isolationChanged) { try { await invoke('set_version_isolation',{gameDir:state.gameDir,version:selectedVersion.id,isolated:isolationControl.checked});selectedVersion.isolated=isolationControl.checked;state.localMods=[];state.contentResults=[];state.contentLoaded=false;state.modUpdates=null;state.selectedMods.clear();modManager.invalidate(); } catch(e) {flash(`无法修改版本隔离：${e}`,'error');return;} } Object.assign(state, { username: data.get('username').trim(), javaPath: data.get('javaPath').trim(), proxyUrl, gameDir: data.get('gameDir').trim(), memory: Number(data.get('memory') ?? state.memory), memoryMode:data.get('memoryMode')==='auto'?'auto':'manual', optimize:data.has('optimize'), jvmArgs:String(data.get('jvmArgs')||''), gameArgs:String(data.get('gameArgs')||'') }); persist(); if(changed){state.selectedMods.clear();state.modUpdates=null;state.modConflicts=null;modManager.invalidate();} render(); flash('设置已保存。'); if (changed) await refresh(); });
const restoreAccount=createAccountRestorer({state,restore:()=>invoke('restore_microsoft_account'),restoreAvatar:restoreOnlineAvatar,refreshAppearance:()=>refreshAppearance({reuse:true}),render,persist,flash});
async function init() {
 updateDefaultBanner();
 window.setInterval(updateDefaultBanner,60*1000);
 document.addEventListener('visibilitychange',()=>{if(!document.hidden)updateDefaultBanner();});
 restoreJobs();render();
 restoreThemeImages();void restoreLocalSkin();if(usingOnlineAccount())void restoreOnlineAvatar(state.accountUuid);
 if (!isTauri()) { state.notice = '请在 Tauri 桌面应用中使用启动器。'; state.noticeKind = 'error'; render(); return; }
 try { await invoke('configure_proxy', { proxyUrl: state.proxyUrl }); if (!state.gameDir) state.gameDir = await invoke('default_game_dir'); await listen('java-progress', e => jobEvent(e.payload)); await listen('install-progress', e => jobEvent(e.payload)); await listen('game-window-ready', e => {const view=state.launchView;if(view && view.phase!=='failed' && e.payload.launchId===view.id){state.launchView=null;state.page='home';render();}}); await listen('game-window-status', e => {const view=state.launchView;if(view && view.phase!=='failed' && e.payload.launchId===view.id){view.warning=e.payload.status==='unavailable'?'当前桌面暂时无法确认游戏窗口；窗口出现后可手动返回主页。':'等待时间较长，可查看启动日志或手动返回主页。';renderOverlay();}}); await listen('game-exit', e => { const payload=e.payload || {},view=state.launchView,profile=state.profileView;if(profile && profile.version===payload.version && profile.gameDir===payload.gameDir)void gameProfile.loadStats(profile);const sameLaunch=view && (payload.launchId ? view.id===payload.launchId : view.version===payload.version);if(!payload.success || sameLaunch) {const crash={version:payload.version,gameDir:payload.gameDir,logName:typeof payload.logPath==='string'?payload.logPath.split(/[\\/]/).pop():null,code:payload.code,diagnosis:payload.success?null:payload.diagnosis};if(sameLaunch){view.crash=crash;view.phase='failed';view.error=payload.success?'游戏进程已退出，未检测到游戏窗口。可以打开启动日志查看详情。':`游戏异常退出（代码 ${payload.code ?? '未知'}），可以打开启动日志查看详情。`;renderOverlay();}else if(!payload.success)showCrashNotice(crash);}  }); void checkLauncherUpdate();window.setInterval(()=>void checkLauncherUpdate(),6*60*60*1000);if(usingOnlineAccount())void restoreAccount({notify:false}); await refresh(); } catch (e) { state.accountRestoring=false;render();flash(String(e), 'error'); }
}
init();
