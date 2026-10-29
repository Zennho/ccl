const fs=require('node:fs');
const path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../src/react/renderer.js'),'utf8')
 .replace(/^import .*;\r?\n/gm,'').replace('export function createRenderer','function createRenderer');
module.exports=function installReactRenderer(window) {
 global.window=window;global.document=window.document;global.navigator=window.navigator;
 window.React=require('react');window.createRoot=require('react-dom/client').createRoot;
 window.flushSync=require('react-dom').flushSync;window.parse=require('html-react-parser').default;
 window.eval(source+'\nwindow.createRenderer=createRenderer;');
 const pages=fs.readFileSync(path.join(__dirname,'../src/react/pages.js'),'utf8').replace(/^import .*;\r?\n/gm,'').replace(/export function /g,'function ');
 window.eval(pages+'\nwindow.HomePage=HomePage;window.VersionsPage=VersionsPage;');
};
