import type {ClickHandler} from './actions/types';
interface Options {
 container:HTMLElement;
 handlers:ClickHandler[];
 beforeDispatch:(target:Element)=>void;
 onError:(error:unknown)=>void;
}
/** Dispatch immediately so form and dialog changes remain synchronous. */
export function installClickDispatcher({container,handlers,beforeDispatch,onError}:Options):void {
 container.addEventListener('click',event=>{
  if(!(event.target instanceof Element))return;
  const target=event.target;
  try{
   beforeDispatch(target);
   for(const handle of handlers){
    const result=handle(target);
    if(result===false)continue;
    if(result instanceof Promise)void result.catch(onError);
    return;
   }
  }catch(error){onError(error);}
 });
}
