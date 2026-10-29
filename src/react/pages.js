import React from 'react';
import parse from 'html-react-parser';
const h=React.createElement;
const Icon=({name,size=18})=>h('i',{'data-lucide':name,width:size,height:size});
const button=(label,props,children)=>h('button',props,...(children||[label]));

export function HomePage({version,versionIcon,description}) {
 const v=version;
 return h(React.Fragment,null,
  h('section',{className:'hero home-hero'},
   h('div',{className:'hero-art'},...['sun','cloud cloud-a','cloud cloud-b','mountain mountain-back','mountain mountain-mid','mountain mountain-front','ground'].map(className=>h('div',{className,key:className})),...['tree tree-a','tree tree-b','tree tree-c'].map(className=>h('div',{className,key:className},h('i'))),h('div',{className:'art-grid'}),h('div',{className:'hero-custom'})),
   h('div',{className:'hero-shade'}),h('div',{className:'hero-content'},h('div',{className:'hero-kicker'},'MINECRAFT · JAVA 版'),h('h1',null,'准备好，',h('em',null,'出发。')),h('p',null,'你的世界，在这里继续。'))),
  h('div',{className:'section-title home-title'},h('h3',null,'开始游戏'),button('启动日志',{className:'row-button log-link','data-action':'open-log',disabled:!v?.installed})),
  h('section',{className:'launch-panel'},h('div',{className:'launch-version'},parse(versionIcon),h('div',null,h('small',null,'当前版本'),h('strong',null,v?(v.name||v.id):'选择一个版本'),h('span',null,v?.installed?`${v.kind} · 已安装`:'先在版本管理中安装游戏'),v?.installed&&description?h('span',{className:'instance-description-home'},description):null)),
   button(null,{className:'change-version','data-page':'versions'},['切换版本 ',h(Icon,{key:'icon',name:'chevron-down',size:15})]),
   button(null,{className:'play-button','data-action':'launch',disabled:!v?.installed},[h(Icon,{key:'icon',name:'play',size:18}),' 启动游戏'])));
}
const actions=[['instance-settings','settings-2','实例设置'],['instance-theme','layout-grid','实例主题'],['game-profile','gamepad-2','游戏档案'],['manage-backups','hard-drive','备份与恢复'],['manage-worlds','folder-open','存档管理'],['instance-overview','hard-drive','实例概览'],['open-version-folder','folder-open','游戏目录'],['export-game','download','导出游戏'],['delete-version','x','删除版本']];
function VersionRow({version:v,selected,versionIcon}) {
 const menu=actions.map(([key,name,title])=>h('button',{key,[`data-${key}`]:v.id},h(Icon,{name,size:15}),' ',title));
 if(v.kind==='正式版')menu.push(h('button',{key:'install','data-install':v.id},h(Icon,{name:'layers-3',size:15}),' 配置安装'));
 return h('div',{className:'version-row'},parse(versionIcon),h('div',{className:'row-name'},h('strong',null,v.name||v.id),h('span',null,v.kind,v.released?` · ${v.released}`:'')),h('div',{className:`row-state ${v.installed?'installed':''}`},h('span'),v.installed?'已安装':'可安装'),v.installed?h(React.Fragment,null,
  button(selected===v.id?'当前版本':'选择版本',{className:`row-button ${selected===v.id?'selected':''}`,'data-select':v.id}),
  h('details',{className:'version-menu'},h('summary',{'aria-label':`${v.name||v.id} 的更多操作`,title:'更多操作'},h(Icon,{name:'more-horizontal'})),h('div',{className:'version-menu-items'},menu))):v.kind==='正式版'?button(null,{className:'row-button install-choice','data-install':v.id},[h(Icon,{key:'icon',name:'download',size:14}),' 安装']):null);
}
export function VersionsPage({versions,query,selected,loading,versionIcon}) {
 const search=query.trim().toLowerCase(),list=versions.filter(v=>!search||`${v.name||''} ${v.id} ${v.kind}`.toLowerCase().includes(search));
 return h(React.Fragment,null,
  h('div',{className:'page-heading inner-heading'},h('div',null,h('h1',null,'版本管理'),h('p',null,'选择游戏版本，安装加载器或管理游戏文件。')),h('div',{className:'heading-actions'},button(null,{className:'outline-btn','data-action':'import-game'},[h(Icon,{key:'icon',name:'folder-open',size:16}),' 导入游戏']),button(null,{className:'outline-btn','data-action':'refresh',disabled:loading},[h(Icon,{key:'icon',name:'refresh-cw',size:16}),loading?' 正在获取':' 刷新']))),
  h('div',{className:'version-toolbar'},h('div',null,h('strong',null,'游戏版本'),h('span',{className:'count'},list.length)),h('label',{className:'version-search'},h('span',{className:'sr-only'},'搜索版本'),h('input',{id:'version-filter',type:'search',placeholder:'搜索版本',defaultValue:query}))),
  h('div',{className:'version-list versions-list'},list.length?list.map(v=>h(VersionRow,{key:v.id,version:v,selected,versionIcon:versionIcon(v)})):h('div',{className:'empty-state'},h(Icon,{name:'box',size:27}),h('strong',null,loading?'正在获取版本列表…':search?'没有找到匹配的版本':'还没有可显示的版本'),h('p',null,search?'试试其他关键词。':'检查网络连接后刷新列表。'))));
}
