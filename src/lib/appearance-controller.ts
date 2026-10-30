import {bannerPeriod,type AppearanceImageKind} from './appearance';
interface Theme {bannerOpacity:number;bannerFrost:number;bannerBlur:number;backgroundOpacity:number;backgroundFrost:number;backgroundBlur:number;banner:string|null;background:string|null}
interface Options {theme:Theme;instanceColor:()=>string;instanceCover:()=>string|null;store:(mode:'get'|'put'|'delete',key:string,value?:unknown)=>Promise<unknown>;validate:(file:File)=>Promise<void>;flash:(message:string,kind?:string)=>void}
function isKind(kind:string):kind is AppearanceImageKind{return kind==='banner'||kind==='background';}
export function createAppearanceController({theme,instanceColor,instanceCover,store,validate,flash}:Options) {
 const revision:Record<AppearanceImageKind,number>={banner:0,background:0};
 function updateDefaultBanner(){document.documentElement.dataset.bannerPeriod=bannerPeriod();}
 function apply() {
  const root=document.documentElement;
  root.style.setProperty('--ccl-instance-accent',instanceColor());
  root.style.setProperty('--ccl-banner-opacity',String(1-theme.bannerOpacity/100));root.style.setProperty('--ccl-banner-frost',String(theme.bannerFrost/100));root.style.setProperty('--ccl-banner-blur',`${theme.bannerBlur}px`);
  root.style.setProperty('--ccl-background-opacity',String(1-theme.backgroundOpacity/100));root.style.setProperty('--ccl-background-frost',String(theme.backgroundFrost/100));root.style.setProperty('--ccl-background-blur',`${theme.backgroundBlur}px`);
  const banner=instanceCover()||theme.banner;
  root.style.setProperty('--ccl-banner-image',banner?`url("${banner}")`:'var(--ccl-default-banner)');root.style.setProperty('--ccl-background-image',theme.background?`url("${theme.background}")`:'none');
  root.classList.toggle('has-custom-background',!!theme.background);root.classList.toggle('has-custom-banner',!!banner);
 }
 function setImage(kind:AppearanceImageKind,blob:Blob|null){if(theme[kind])URL.revokeObjectURL(theme[kind]!);theme[kind]=blob?URL.createObjectURL(blob):null;apply();}
 async function restore(){await Promise.all((['banner','background'] as const).map(async kind=>{const current=revision[kind];try{const blob=await store('get',kind);if(current===revision[kind]&&blob)setImage(kind,blob as Blob);}catch{}}));}
 async function reset(kind:string){if(!isKind(kind))return;const current=++revision[kind];try{await store('delete',kind);if(current!==revision[kind])return;setImage(kind,null);flash('已恢复默认图片。');}catch(error){flash(`无法恢复默认图片：${error}`,'error');}}
 async function choose(kind:string,file:File){if(!isKind(kind))return;const current=++revision[kind];try{await validate(file);if(current!==revision[kind])return;await store('put',kind,file);if(current!==revision[kind])return;setImage(kind,file);flash('图片已保存。');}catch(error){flash(`无法使用图片：${error}`,'error');}}
 return {updateDefaultBanner,apply,restore,reset,choose};
}
