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
 window.React=require('react');window.createRoot=require('react-dom/client').createRoot;
 window.flushSync=require('react-dom').flushSync;window.parse=require('html-react-parser').default;
 load(window,'renderer.tsx',['createRenderer']);
 load(window,'pages.tsx',['Icon','HomePage','VersionsPage','JavaPage']);
 load(window,'instance-settings.tsx',['InstanceSettingsDialog']);
 load(window,'lan-room.tsx',['LanRoomPage']);
 load(window,'public-servers.tsx',['PublicServersPage']);
 load(window,'instance-overview.tsx',['InstanceOverviewDialog']);
 load(window,'instance-settings-model.ts',['normalizeInstanceSettings','resolveInstanceSettings']);
};
