import {LaunchScreen,CrashDialog} from './launch';
import {InstanceSettingsDialog} from './instance-settings';
import {InstanceThemeDialog} from './instance-theme';
import {GameProfileDialog} from './game-profile';
import {ManageDialog} from './manage-dialog';
import {InstanceOverviewDialog} from './instance-overview';
import {InstallDialog} from './install-dialog';
import {ArchiveDialog} from './archive-dialog';
import {LocalModDialog} from './local-mod-dialog';
import {ContentDialog} from './content-dialog';
import type {createRenderer} from './renderer';
import type {LauncherState} from '../lib/launcher-state';
import type {InstanceSettings} from './types';
interface Addon {id:string;title:string;desc:string;loaders:string[]}
interface Options {container:HTMLElement;state:LauncherState;renderer:ReturnType<typeof createRenderer>;getLaunchSettings:(gameDir:string,version:string)=>InstanceSettings|null;getCover:(gameDir:string,version:string)=>string|null;colors:string[];addons:Addon[];syncMemory:()=>void}
export function createOverlayController({container,state,renderer,getLaunchSettings,getCover,colors,addons,syncMemory}:Options){
 return function renderOverlay(){
  if(!container.querySelector('#modal-root'))return;
  if(state.launchView)renderer.overlay(LaunchScreen,{view:state.launchView},`launch:${state.launchView.id}`);
  else if(state.crashDialog)renderer.overlay(CrashDialog,{crash:state.crashDialog});
  else if(state.instanceSettingsView){const draft=state.instanceSettingsView,saved=getLaunchSettings(draft.gameDir,draft.version);renderer.overlay(InstanceSettingsDialog,{name:draft.name,values:{...state,...saved},saved,runtimes:state.javaRuntimes},`instance-settings:${draft.version}`);}
  else if(state.themeView){const draft=state.themeView,cover=draft.preview||(!draft.removeCover?getCover(draft.gameDir,draft.version):null)||null;renderer.overlay(InstanceThemeDialog,{draft,cover,colors});}
  else if(state.profileView)renderer.overlay(GameProfileDialog,{view:state.profileView},`profile:${state.profileView.version}`);
  else if(state.manageView)renderer.overlay(ManageDialog,{view:state.manageView});
  else if(state.instanceView)renderer.overlay(InstanceOverviewDialog,{view:state.instanceView});
  else if(state.installDraft)renderer.overlay(InstallDialog,{draft:state.installDraft,addons});
  else if(state.archiveDraft&&!state.modDraft)renderer.overlay(ArchiveDialog,{draft:state.archiveDraft});
  else if(state.localModDetail)renderer.overlay(LocalModDialog,{mod:state.localModDetail});
  else if(state.modDraft)renderer.overlay(ContentDialog,{draft:state.modDraft,shaderEnv:state.shaderEnv,shaderEnvLoading:state.shaderEnvLoading},`content:${state.modDraft.source}:${state.modDraft.projectId}`);
  else renderer.overlay();
  syncMemory();
 };
}
