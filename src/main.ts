import './style.css';
import './journal-theme.css';
import './multiplayer.css';
import './custom-theme.css';
import './launch-screen.css';
import './management.css';
import './update.css';
import { createJobManager } from './job-manager.ts';
import { imageStore, validateThemeImage } from './lib/appearance.ts';
import { createThumbnailLoader } from './lib/thumbnails.ts';
import { createInputController } from './lib/input-controller.ts';
import { createAccountRestorer } from './lib/account-restore.ts';
import { createContentSearch } from './lib/content-search.ts';
import { createModManager } from './lib/mod-manager.ts';
import { createGameProfile } from './lib/game-profile.ts';
import { createInstanceManage } from './lib/instance-manage.ts';
import { createPackManager } from './lib/pack-manager.ts';
import { createGameEvents } from './lib/game-events.ts';
import { createSystemStatus } from './lib/system-status.ts';
import { syncMemoryControls as syncMemoryFields } from './lib/memory-controls.ts';
import { createMultiplayer, copyText } from './lib/multiplayer.ts';
import { createVersionManager } from './lib/version-manager.ts';
import { createAvatarStore } from './lib/avatar-store.ts';
import { createAccountAppearance } from './lib/account-appearance.ts';
import { createInstanceTheme, instanceColors } from './lib/instance-theme.ts';
import { readSettings, createInitialState, createTheme, persistSettings } from './lib/launcher-state.ts';
import { createAppearanceController } from './lib/appearance-controller.ts';
import { createContentDetail } from './lib/content-detail.ts';
import { createGameLauncher } from './lib/game-launcher.ts';
import { createAccountActions } from './lib/account-actions.ts';
import { createInstanceLaunchSettings } from './lib/instance-launch-settings.ts';
import { createArchiveManager } from './lib/archive-manager.ts';
import { createVersionDelete } from './lib/version-delete.ts';
import { createSkinController } from './lib/skin-controller.ts';
import { createContentInstall } from './lib/content-install.ts';
import { createGlobalSettings } from './lib/global-settings.ts';
import { createContentControls } from './lib/content-controls.ts';
import { createRenderCycle } from './lib/render-cycle.ts';
import { createNavigationHandler } from './app/actions/navigation';
import { createShellHandler, installWindowResize, closeVersionMenus } from './app/actions/shell';
import { createInstanceHandler } from './app/actions/instances';
import { createAccountHandler } from './app/actions/account';
import { createContentHandler } from './app/actions/content';
import { createDownloadHandler } from './app/actions/downloads';
import { createMultiplayerHandler } from './app/actions/multiplayer';
import { createArchiveHandler } from './app/actions/archive';
import { createLauncherHandler } from './app/actions/launcher';
import { installFormEvents } from './app/form-events';
import { startApplication } from './app/startup';
import { installClickDispatcher } from './app/click-dispatcher';
import { createRenderer } from './react/renderer.tsx';
import { Shell } from './react/shell.tsx';
import { createOverlayController } from './react/overlay-controller.tsx';
import { createPageController } from './react/page-controller.tsx';
import { version as appVersion } from '../package.json';
import { open as openDialog, save as saveDialog } from '@tauri-apps/plugin-dialog';
import { invoke, isTauri } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import type {GameVersion} from './react/types';
import type {Crash} from './react/launch';
import type {JobProgress} from './job-manager';
import type {WindowEvent, ExitEvent} from './lib/game-events';

const saved=readSettings(localStorage);
const state=createInitialState(saved);
const theme=createTheme(saved);
const app = document.querySelector<HTMLElement>('#app')!;
const renderer = createRenderer(app);
const instanceLaunch=createInstanceLaunchSettings({state,storage:localStorage,render:renderOverlay,flash});
const getLaunchSettings=instanceLaunch.get,effectiveLaunchSettings=instanceLaunch.effective;

const instanceTheme=createInstanceTheme({state,storage:localStorage,store:imageStore,validate:validateThemeImage,render,renderOverlay,applyTheme,flash});
const getInstanceTheme=instanceTheme.getTheme,loadInstalledCovers=instanceTheme.loadInstalled;
function currentInstanceCover(){return instanceTheme.getCover(state.gameDir,state.selected);}
const gameProfile=createGameProfile({state,render:renderOverlay,
 list:(gameDir,version,page)=>invoke('list_game_screenshots',{gameDir,version,page}),
 screenshot:(gameDir,version,name)=>invoke('game_screenshot',{gameDir,version,name}),
 stats:(gameDir,version)=>invoke('play_stats',{gameDir,version})});

const appearanceController=createAppearanceController({theme,instanceColor:()=>getInstanceTheme(state.gameDir,state.selected).color,instanceCover:currentInstanceCover,store:imageStore,validate:validateThemeImage,flash});
function applyTheme(){appearanceController.apply();}
const updateDefaultBanner=appearanceController.updateDefaultBanner,restoreThemeImages=appearanceController.restore;
const systemStatus=createSystemStatus({state,isDesktop:isTauri,getMemory:()=>invoke('memory_info'),getUpdate:()=>invoke('check_launcher_update'),
 renderMemory:()=>{if(state.page==='settings'&&app.querySelector('#memory-info'))renderSettingsPage();},renderChrome});
const refreshMemoryInfo=systemStatus.refreshMemoryInfo,checkLauncherUpdate=systemStatus.checkLauncherUpdate;
function syncMemoryControls(){syncMemoryFields(app);}

function versionVisual(version?:GameVersion) {
 const instance=version?.id?getInstanceTheme(state.gameDir,version.id):null;
 return {color:instance?.color || instanceColors[0],cover:version?.id?instanceTheme.getCover(state.gameDir,version.id):null};
}
const hydrateThumbnails=createThumbnailLoader({container:app,fetchThumbnail:(kind,value)=>invoke('fetch_thumbnail',{kind,value})});
const persist=()=>persistSettings(localStorage,state,theme);
const usingOnlineAccount = () => state.accountPreference==='microsoft' && (state.accountKnown || !!state.account);
const playerName = () => usingOnlineAccount() ? (state.account?.name || state.accountName || '正版账户') : state.username;
const playerStatus = () => usingOnlineAccount() ? (state.account ? '微软账户' : state.accountRestoring ? '正在验证正版账户' : '正版账户 · 待验证') : '离线玩家';
const avatarStore=createAvatarStore({state,store:imageStore,render,renderChrome,flash});
const {cacheOnlineAvatar,restoreOnlineAvatar,saveLocalSkin,restoreLocalSkin}=avatarStore;

function flash(message:string, kind = '') { state.notice = message; state.noticeKind = kind; state.noticeCrash=false; renderChrome(); }
function showCrashNotice(crash:Crash & {gameDir:string;logName:string|null}) {state.crash=crash;state.notice=`游戏 ${crash.version} 异常退出（代码 ${crash.code ?? '未知'}）。`;state.noticeKind='error';state.noticeCrash=true;renderChrome();}
function shellProps() {
 const uuid=state.account?.uuid || state.accountUuid;
 const skin=usingOnlineAccount() ? (state.appearance?.skin || avatarStore.get(uuid)) : state.localSkin?.data;
 return {page:state.page,name:playerName(),status:playerStatus(),skin:typeof skin==='string'&&skin.startsWith('data:image/png;base64,')?skin:'',online:state.online,version:appVersion,installedCount:state.versions.filter(v=>v.installed).length,jobCount:activeJobCount(),updateInfo:state.updateInfo,updateDismissed:state.updateDismissed,notice:state.notice,noticeKind:state.noticeKind,noticeCrash:!!(state.crash&&state.noticeCrash)};
}
function renderShell() { if(app.querySelector('.app-shell')) renderer.chrome(Shell,shellProps()); }
const multiplayer=createMultiplayer({state,render,flash,getAddresses:()=>invoke('ipv6_addresses'),getServers:()=>invoke('public_servers'),startRoom:gamePort=>invoke('start_ipv6_room',{gamePort}),stopRoom:()=>invoke('stop_ipv6_room'),testConnection:address=>invoke('test_ipv6_connection',{address})});
const refreshLanAddresses=multiplayer.refreshAddresses,filteredServers=multiplayer.filteredServers,refreshPublicServers=multiplayer.refreshPublicServers;
const ADDONS = [
 { id:'fabric-api', title:'Fabric API', desc:'许多 Fabric 模组的基础依赖', loaders:['fabric'] },
 { id:'sodium', title:'Sodium', desc:'改善渲染性能', loaders:['fabric','neoforge'] },
 { id:'jei', title:'Just Enough Items', desc:'查看物品与配方', loaders:['fabric','quilt','forge','neoforge'] },
 { id:'jade', title:'Jade', desc:'查看方块与实体信息', loaders:['fabric','quilt','forge','neoforge'] },
];
function renderContentPage(){pageController.content();}
function renderLocalPacks() { renderContentPage(); }
const packManager=createPackManager({state,render:renderLocalPacks,renderPage:render,flash,invalidateContent:()=>contentSearch.invalidate(),search:()=>searchContent(),
 remove:draft=>invoke('remove_local_pack',{...draft}),updates:(gameDir,version,kind,apiKey)=>invoke('check_pack_updates',{gameDir,version,kind,apiKey}),
 list:(gameDir,version,kind)=>invoke('list_local_packs',{gameDir,version,kind}),
 environment:(gameDir,version)=>invoke('shader_environment',{gameDir,version})});
const refreshPacks=packManager.refresh;

const instanceManage=createInstanceManage({state,render:renderOverlay,flash,
 list:(kind,gameDir,version)=>invoke(kind==='backups'?'list_backups':'list_worlds',{gameDir,version}),
 operation:(command,args)=>invoke(command,args)});
function renderLocalMods() { renderContentPage(); }
const modManager=createModManager({state,render:renderLocalMods,search:()=>searchContent(),flash,
 list:(gameDir,version)=>invoke('list_mods',{gameDir,version}),
 remove:(gameDir,version,name)=>invoke('remove_mod',{gameDir,version,name}),
 setEnabled:(gameDir,version,name,enabled)=>invoke('set_mod_enabled',{gameDir,version,name,enabled}),
 conflicts:(gameDir,version)=>invoke('check_mod_conflicts',{gameDir,version}),updates:(gameDir,version)=>invoke('check_mod_updates',{gameDir,version})});
function refreshMods(){return modManager.refreshMods();}
const contentSearch=createContentSearch({state,modRevision:modManager.revision,render,renderContent:renderContentPage,
 categories:(source,kind,apiKey)=>invoke('content_categories',{source,kind,apiKey}),
 search:snapshot=>invoke('search_content',{...snapshot}),
 translate:(source,items)=>invoke('translate_content_summaries',{source,items})});
const {loadContentCategories,searchContent}=contentSearch;

const contentDetail=createContentDetail({state,render:renderOverlay,
 lookup:(source,kind,projectUrl,title)=>invoke('lookup_mcmod',{source,kind,projectUrl,title}),
 links:(source,projectId,apiKey)=>invoke('content_links',{source,projectId,apiKey}),
 curseDescription:(projectId,apiKey)=>invoke('curseforge_description',{projectId,apiKey}),
 versions:(kind,gameDir,version,source,projectId,apiKey)=>invoke(kind==='mod'?'list_mod_versions':'list_pack_versions',{gameDir,version,source,projectId,apiKey,...(kind==='mod'?{}:{kind})}),
 translate:(source,projectId,description,summary)=>invoke('translate_content',{source,projectId,description,summary})});
const accountAppearance=createAccountAppearance({state,container:app,render,renderChrome,flash,cacheAvatar:cacheOnlineAvatar,
 getAccounts:()=>invoke('list_microsoft_accounts'),getAppearance:()=>invoke('get_appearance'),
 createPreview:(canvas,skin,cape,model)=>import('./appearance-preview.ts').then(m=>m.createAppearancePreview(canvas,skin,cape,model))});
const {refreshAccountList,refreshPreview,refreshAppearance}=accountAppearance;
const versionManager=createVersionManager({state,render,renderChrome,persist,loadCovers:loadInstalledCovers,flash,
 listVersions:gameDir=>invoke('list_versions',{gameDir}),installed:gameDir=>invoke('installed_versions',{gameDir}),listJava:()=>invoke('list_java')});
const refreshInstalled=versionManager.refreshInstalled,refreshJava=versionManager.refreshJava,refresh=versionManager.refresh;
const jobs = createJobManager({
 state, invoke, persist, renderChrome, flash, render, refreshInstalled, renderDownloads,
 onJobFinished: async job => {
  if(['resourcepack','shader'].includes(job.kind) && job.version===state.contentTarget && job.gameDir===state.gameDir && state.contentKind===job.kind) { contentSearch.invalidate(); state.contentLoaded=false; if(state.page==='content') await Promise.all([refreshPacks(),searchContent()]); }
  if (job.kind==='mod' && job.version===state.contentTarget && job.gameDir===state.gameDir) {
   modManager.invalidate();state.modUpdates=null;state.modConflicts=null;
   if(state.page==='content'){await refreshMods();if(state.contentKind==='shader')await refreshPacks();await searchContent();}
  }
 }
});
const { runnerFor, restoreJobs, hasJob, enqueueJob, pumpJobs, jobEvent, queueVersion, activeJobCount } = jobs;
const inputController=createInputController({container:app,state,theme,render,renderSettings:renderSettingsPage,renderMods:renderLocalMods,renderPacks:renderLocalPacks,updateSearch:updateSearchResults,applyTheme,persist});
function renderChrome() {
 renderShell();
 if(state.page==='settings' && app.querySelector('#update-panel'))renderSettingsPage();
}
function renderOverlay(){overlayController();}
function renderPage(){pageController.page();}
function render(){renderCycle.render();}
function renderSettingsPage(){pageController.settings();}
function renderDownloads(){pageController.downloads();}
function updateSearchResults(kind:'server'|'version'){pageController.search(kind);}
const shellOptions={container:app,isDesktop:isTauri,getWindow:getCurrentWindow,resetTheme:appearanceController.reset,flash};
installWindowResize(shellOptions);
const handleShell=createShellHandler(shellOptions);
const handleNavigation=createNavigationHandler({state,render,refreshAccounts:refreshAccountList,refreshAppearance:()=>refreshAppearance({reuse:true}),refreshMemory:refreshMemoryInfo,refreshJava,refreshAddresses:refreshLanAddresses,refreshServers:refreshPublicServers,refreshMods,refreshPacks,loadCategories:loadContentCategories,searchContent,invalidateMods:modManager.invalidate});
const pageController=createPageController({container:app,state,renderer,theme,appVersion,versionVisual,getInstanceTheme,hasJob,usingOnline:usingOnlineAccount,playerName,filteredServers,hydrateThumbnails});
const overlayController=createOverlayController({container:app,state,renderer,getLaunchSettings,getCover:instanceTheme.getCover,colors:instanceColors,addons:ADDONS,syncMemory:syncMemoryControls});
const renderCycle=createRenderCycle({container:app,state,beforeRender:inputController.beforeRender,mount:()=>renderer.mount(Shell,shellProps()),renderPage,syncMemory:syncMemoryControls,applyTheme,renderChrome,renderOverlay,hydrateThumbnails,refreshPreview});
const contentControls=createContentControls({state,render,invalidateMods:modManager.invalidate,refreshMods,refreshPacks,loadCategories:loadContentCategories,search:searchContent});
const globalSettings=createGlobalSettings({state,render,persist,flash,invalidateMods:modManager.invalidate,refresh,
 configureProxy:proxyUrl=>invoke('configure_proxy',{proxyUrl}),setIsolation:(gameDir,version,isolated)=>invoke('set_version_isolation',{gameDir,version,isolated})});
const gameEvents=createGameEvents({state,render,renderOverlay,showCrash:showCrashNotice,refreshStats:gameProfile.loadStats});
const restoreAccount=createAccountRestorer({state,restore:()=>invoke('restore_microsoft_account'),restoreAvatar:restoreOnlineAvatar,refreshAppearance:()=>refreshAppearance({reuse:true}),render,persist,flash});
const accountActions=createAccountActions({state,render,persist,flash,restore:restoreAccount,restoreAvatar:restoreOnlineAvatar,cacheAvatar:cacheOnlineAvatar,refreshAppearance,refreshAccounts:refreshAccountList,
 switchAccount:uuid=>invoke('switch_microsoft_account',{uuid}),beginLogin:()=>invoke('begin_microsoft_login'),completeLogin:()=>invoke('complete_microsoft_login'),cancelLogin:()=>invoke('cancel_microsoft_login'),remember:()=>invoke('remember_microsoft_account'),openLogin:()=>invoke('open_microsoft_login'),logout:()=>invoke('logout_microsoft')});
const skinController=createSkinController({state,storage:localStorage,isOnline:usingOnlineAccount,render,flash,saveSkin:saveLocalSkin,refreshAppearance,
 chooseFile:()=>openDialog({multiple:false,directory:false,filters:[{name:'PNG 图片',extensions:['png']}]}),
 previewTexture:(path,kind)=>invoke('preview_texture',{path,kind}),applyOffline:(gameDir,version,username,skin)=>invoke('apply_offline_skin',{gameDir,version,username,skin}),
 uploadSkin:(path,model)=>invoke('upload_account_skin',{path,model}),resetSkin:()=>invoke('reset_account_skin'),setCape:capeId=>invoke('set_account_cape',{capeId})});
const launchGame=createGameLauncher({state,isOnline:usingOnlineAccount,restoreAccount:()=>restoreAccount({notify:false}),
 shouldApplySkin:skinController.shouldApply,
 applySkin:(gameDir,version,username,skin)=>invoke('apply_offline_skin',{gameDir,version,username,skin}),
 settings:effectiveLaunchSettings,launch:options=>invoke('launch_game',{options}),render:renderOverlay,flash});
const versionDelete=createVersionDelete({state,render,persist,flash,refreshInstalled,remove:(gameDir,version,removeInstance)=>invoke('delete_version',{gameDir,version,removeInstance})});
const contentInstallManager=createContentInstall({state,render:renderOverlay,enqueue:enqueueJob,runnerFor,openDetails:contentDetail.open,
 installModpack:args=>invoke('install_modpack',args),installMod:args=>invoke('install_mod',args)});
const archiveManager=createArchiveManager({state,render:renderOverlay,persist,flash,enqueue:enqueueJob,
 chooseImport:()=>openDialog({multiple:false,directory:false,filters:[{name:'CCL 或 PCL 兼容整合包',extensions:['zip','mrpack']}]}),
 chooseExport:(version,format)=>saveDialog({defaultPath:`CCL-${version}.${format==='pcl'?'mrpack':'zip'}`,filters:[{name:format==='pcl'?'PCL 兼容整合包':'CCL 游戏导出包',extensions:[format==='pcl'?'mrpack':'zip']}]}),
 inspect:path=>invoke('inspect_game_archive',{path}),exportGame:args=>invoke('export_game',args),importGame:args=>invoke('import_game',args)});
const handleAccount=createAccountHandler({state,render,account:accountActions,skin:skinController,searchContent});
const handleContent=createContentHandler({container:app,state,invoke,render,renderOverlay,flash,search:searchContent,install:contentInstallManager,mods:modManager,packs:packManager});
const handleDownloads=createDownloadHandler({state,invoke,render,renderChrome,persist,flash,refreshJava,jobs});
const handleMultiplayer=createMultiplayerHandler({state,render,flash,copy:copyText,multiplayer});
const handleArchive=createArchiveHandler({container:app,archive:archiveManager});
const handleInstances=createInstanceHandler({container:app,state,invoke,render,renderOverlay,persist,flash,profile:gameProfile,manage:instanceManage,theme:instanceTheme,launchSettings:instanceLaunch,versionDelete,archive:archiveManager});
const handleLauncher=createLauncherHandler({state,invoke,render,renderOverlay,renderChrome,flash,showCrash:showCrashNotice,checkUpdate:checkLauncherUpdate,refresh,launch:launchGame,queueVersion});
installFormEvents({container:app,state,render,renderOverlay,renderMods:renderLocalMods,syncMemory:syncMemoryControls,updateSearch:updateSearchResults,persist,pumpJobs,addons:ADDONS,theme:instanceTheme,appearance:appearanceController,skin:skinController,content:contentControls,instanceSettings:instanceLaunch,settings:globalSettings,multiplayer});
installClickDispatcher({container:app,handlers:[handleShell,handleNavigation,handleInstances,handleContent,handleDownloads,handleMultiplayer,handleArchive,handleAccount,handleLauncher],
 beforeDispatch:target=>{if(!target.closest('[data-theme-reset]'))closeVersionMenus(app,target);},onError:error=>flash(`操作失败：${error}`,'error')});
void startApplication({state,isDesktop:isTauri,updateBanner:updateDefaultBanner,restoreJobs,render,restoreTheme:restoreThemeImages,restoreSkin:restoreLocalSkin,isOnline:usingOnlineAccount,restoreAvatar:restoreOnlineAvatar,
 configureProxy:proxyUrl=>invoke('configure_proxy',{proxyUrl}),defaultGameDir:()=>invoke('default_game_dir'),
 listenProgress:(name,handler)=>listen<JobProgress>(name,handler),listenWindow:(name,handler)=>listen<WindowEvent>(name,handler),listenExit:handler=>listen<ExitEvent>('game-exit',handler),
 jobEvent,gameEvents,checkUpdate:checkLauncherUpdate,restoreAccount:()=>restoreAccount({notify:false}),refresh,flash});
