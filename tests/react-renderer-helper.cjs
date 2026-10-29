const fs=require('node:fs');
const path=require('node:path');
const { transformSync }=require('esbuild');
function load(window, filename, exports) {
 const input=fs.readFileSync(path.join(__dirname,'../src/react',filename),'utf8');
 const output=transformSync(input,{loader:filename.endsWith('.tsx')?'tsx':'ts',jsx:'transform',format:'esm',target:'es2022'}).code
  .replace(/^import .*;\r?\n/gm,'').replace(/export\s*\{[^}]*\};/g,'');
 window.eval(`(function(){${output}\n${exports.map(name=>`window.${name}=${name};`).join('')}\n})()`);
}
module.exports=function installReactRenderer(window) {
 global.window=window;global.document=window.document;global.navigator=window.navigator;
 window.React=require('react');window.useState=window.React.useState;window.createRoot=require('react-dom/client').createRoot;
 window.flushSync=require('react-dom').flushSync;
 const icons=require('lucide');for(const name of ['Blocks','Box','ChevronDown','ChevronRight','Compass','Download','FolderOpen','Gamepad2','Globe2','HardDrive','Layers3','LayoutGrid','Monitor','MoreHorizontal','Minus','Play','RefreshCw','Settings2','Square','UserRound','X','Zap'])window[name]=icons[name];
 load(window,'renderer.tsx',['createRenderer']);
 load(window,'pages.tsx',['Icon','HomePage','VersionsPage','JavaPage']);
 load(window,'instance-settings.tsx',['InstanceSettingsDialog']);
 load(window,'lan-room.tsx',['LanRoomPage']);
 load(window,'public-servers.tsx',['PublicServersPage']);
 load(window,'instance-overview.tsx',['InstanceOverviewDialog']);
 load(window,'launch.tsx',['LaunchScreen','CrashDialog']);
 load(window,'install-dialog.tsx',['InstallDialog']);
 load(window,'archive-dialog.tsx',['ArchiveDialog']);
 load(window,'downloads.tsx',['DownloadsPage']);
 load(window,'settings.tsx',['SettingsPage']);
 load(window,'account.tsx',['AccountPage']);
 load(window,'manage-dialog.tsx',['ManageDialog']);
 load(window,'instance-theme.tsx',['InstanceThemeDialog']);
 load(window,'game-profile.tsx',['GameProfileDialog']);
 load(window,'content.tsx',['ContentPage']);
 load(window,'content-dialog.tsx',['ContentDialog']);
 load(window,'shell.tsx',['Shell']);
 load(window,'instance-settings-model.ts',['normalizeInstanceSettings','resolveInstanceSettings']);
};
