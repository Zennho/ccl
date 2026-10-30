interface State {page:string;modDraft:unknown;archiveDraft:unknown}
interface Options {
 container:HTMLElement;state:State;beforeRender:(samePage:boolean)=>boolean;mount:()=>void;renderPage:()=>void;syncMemory:()=>void;applyTheme:()=>void;renderChrome:()=>void;renderOverlay:()=>void;hydrateThumbnails:()=>void;refreshPreview:()=>void;
}
type FormControl=HTMLInputElement|HTMLSelectElement;
export function createRenderCycle({container,state,beforeRender,mount,renderPage,syncMemory,applyTheme,renderChrome,renderOverlay,hydrateThumbnails,refreshPreview}:Options){
 let renderedPage:string|null=null;
 function render(){
  if(!beforeRender(renderedPage===state.page))return;
  const first=!container.querySelector('.app-shell');
  if(first){mount();renderPage();}
  else {
   const content=container.querySelector<HTMLElement>('.content');if(!content)throw new Error('React 内容区域不可用');
   const same=renderedPage===state.page,main=container.querySelector<HTMLElement>('.main'),scrollTop=main?.scrollTop,scrollLeft=main?.scrollLeft,docScroll=document.scrollingElement||document.documentElement,docTop=docScroll.scrollTop,docLeft=docScroll.scrollLeft;
   const values=same?[...content.querySelectorAll<FormControl>('form input, form select')].filter(element=>element.name).map(element=>({name:element.name,value:element.value,checked:element instanceof HTMLInputElement&&element.checked,type:element.type})):[];
   const active=same&&content.contains(document.activeElement)?document.activeElement:null;
   const focus=active instanceof HTMLInputElement||active instanceof HTMLSelectElement?{name:active.name,id:active.id,start:active instanceof HTMLInputElement?active.selectionStart:null,end:active instanceof HTMLInputElement?active.selectionEnd:null}:null;
   renderPage();
   for(const saved of values){const element=[...content.querySelectorAll<FormControl>('form input, form select')].find(item=>item.name===saved.name&&item.type===saved.type);if(element){element.value=saved.value;if(element instanceof HTMLInputElement&&(element.type==='checkbox'||element.type==='radio'))element.checked=saved.checked;}}
   if(focus){const element=[...content.querySelectorAll<FormControl>('input, select')].find(item=>focus.id?item.id===focus.id:item.name===focus.name);if(element){element.focus({preventScroll:true});if(focus.start!=null&&element instanceof HTMLInputElement){try{element.setSelectionRange(focus.start,focus.end);}catch{}}}}
   if(same&&main){main.scrollTop=scrollTop||0;main.scrollLeft=scrollLeft||0;docScroll.scrollTop=docTop;docScroll.scrollLeft=docLeft;}
  }
  renderedPage=state.page;syncMemory();applyTheme();renderChrome();
  if(!(state.modDraft&&container.querySelector('#modal-root .mod-dialog'))&&!(state.archiveDraft&&container.querySelector('#modal-root .archive-dialog')))renderOverlay();
  hydrateThumbnails();refreshPreview();
 }
 return {render};
}
