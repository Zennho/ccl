import React from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import parse from 'html-react-parser';

// The existing Tauri controller continues to own event delegation while pages
// move to components. Each page has its own React tree so existing targeted DOM
// updates cannot invalidate the persistent application shell.
function parsePage(html) {
 return parse(html, {
  transform(element, node) {
   if (node?.name === 'option' && element?.props?.selected !== undefined) {
    return React.cloneElement(element, { selected: undefined });
   }
   if (node?.name === 'select') {
    const selected = (node.children || []).find(child => child.name === 'option' && child.attribs?.selected !== undefined);
    if (selected) return React.cloneElement(element, { defaultValue: selected.attribs.value ?? '' });
   }
   return element;
  },
 });
}
function Shell({ html }) { return React.createElement(React.Fragment, null, parsePage(html)); }
function Page({ html, component, props }) { return React.createElement('div', { className:'react-page-root' }, component ? React.createElement(component, props) : parsePage(html)); }
function Overlay({ html }) { return React.createElement('div', { className:'react-page-root' }, parsePage(html)); }

export function createRenderer(container) {
 const shellRoot=createRoot(container);
 let pageRoot, overlayRoot, revision=0, overlayRevision=0;
 return {
  mount(html) {
   flushSync(()=>shellRoot.render(React.createElement(Shell,{html})));
   pageRoot=createRoot(container.querySelector('.content'));
   overlayRoot=createRoot(container.querySelector('#modal-root'));
  },
  page(html, component=null, props={}) {
   if(!pageRoot)throw new Error('React shell is not mounted');
   flushSync(()=>pageRoot.render(React.createElement(Page,{html,component,props,key:++revision})));
  },
  overlay(html) {
   if(!overlayRoot)throw new Error('React shell is not mounted');
   flushSync(()=>overlayRoot.render(React.createElement(Overlay,{html,key:++overlayRevision})));
  },
 };
}
