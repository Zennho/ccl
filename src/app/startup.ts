import type {LauncherState} from '../lib/launcher-state';
import type {JobProgress} from '../job-manager';
import type {WindowEvent,ExitEvent,createGameEvents} from '../lib/game-events';
interface EventPayload<T>{payload:T}
interface Options {
 state:LauncherState;isDesktop:()=>boolean;updateBanner:()=>void;restoreJobs:()=>void;render:()=>void;restoreTheme:()=>Promise<unknown>;restoreSkin:()=>Promise<unknown>;isOnline:()=>boolean;restoreAvatar:(uuid:string)=>Promise<unknown>;
 configureProxy:(proxyUrl:string)=>Promise<unknown>;defaultGameDir:()=>Promise<string>;
 listenProgress:(name:'java-progress'|'install-progress',handler:(event:EventPayload<JobProgress>)=>void)=>Promise<unknown>;
 listenWindow:(name:'game-window-ready'|'game-window-status',handler:(event:EventPayload<WindowEvent>)=>void)=>Promise<unknown>;
 listenExit:(handler:(event:EventPayload<ExitEvent>)=>void)=>Promise<unknown>;
 jobEvent:(payload:JobProgress)=>void;gameEvents:ReturnType<typeof createGameEvents>;checkUpdate:()=>Promise<unknown>;restoreAccount:()=>Promise<unknown>;refresh:()=>Promise<unknown>;flash:(message:string,kind?:string)=>void;
}
export async function startApplication(options:Options):Promise<void> {
 const {state}=options;
 options.updateBanner();window.setInterval(options.updateBanner,60*1000);
 document.addEventListener('visibilitychange',()=>{if(!document.hidden)options.updateBanner();});
 options.restoreJobs();options.render();
 void options.restoreTheme();void options.restoreSkin();if(options.isOnline())void options.restoreAvatar(state.accountUuid);
 if(!options.isDesktop()){state.notice='请在 Tauri 桌面应用中使用启动器。';state.noticeKind='error';options.render();return;}
 try{
  await options.configureProxy(state.proxyUrl);
  if(!state.gameDir)state.gameDir=await options.defaultGameDir();
  await options.listenProgress('java-progress',event=>options.jobEvent(event.payload));
  await options.listenProgress('install-progress',event=>options.jobEvent(event.payload));
  await options.listenWindow('game-window-ready',event=>options.gameEvents.windowReady(event.payload));
  await options.listenWindow('game-window-status',event=>options.gameEvents.windowStatus(event.payload));
  await options.listenExit(event=>options.gameEvents.exit(event.payload));
  void options.checkUpdate();window.setInterval(()=>void options.checkUpdate(),6*60*60*1000);
  if(options.isOnline())void options.restoreAccount();
  await options.refresh();
 }catch(error){state.accountRestoring=false;options.render();options.flash(String(error),'error');}
}
