import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { flushSync } from 'react-dom';
import parse from 'html-react-parser';

// Legacy pages still use delegated events and selective DOM updates. The keyed
// page boundary isolates those updates while the remaining views are migrated.
function parsePage(html: string): React.ReactNode {
  return parse(html, {
    transform(element, node) {
      if (node.type === 'tag' && node.name === 'option' && React.isValidElement<{ selected?: boolean }>(element) && element.props.selected !== undefined) {
        return React.cloneElement(element, { selected: undefined });
      }
      if (node.type === 'tag' && node.name === 'select' && React.isValidElement<{ defaultValue?: string }>(element)) {
        const selected = node.children.find(child => child.type === 'tag' && child.name === 'option' && child.attribs?.selected !== undefined);
        if (selected?.type === 'tag') return React.cloneElement(element, { defaultValue: selected.attribs.value ?? '' });
      }
      return typeof element === 'string' || React.isValidElement(element) ? element : null;
    },
  });
}
function Shell({ html }: { html: string }) { return <>{parsePage(html)}</>; }
// `any` is confined to this bridge: each native page has typed props, while
// the old controller dynamically selects which component to render.
type AnyComponent = React.ComponentType<any>;
function Page({ html, component: Component, props }: { html: string; component: AnyComponent | null; props: object }) {
  return <div className="react-page-root">{Component ? <Component {...props} /> : parsePage(html)}</div>;
}
function Overlay({ html, component: Component, props }: { html: string; component: AnyComponent | null; props: object }) {
  return <div className="react-page-root">{Component ? <Component {...props} /> : parsePage(html)}</div>;
}

export function createRenderer(container: HTMLElement) {
  const shellRoot = createRoot(container);
  let pageRoot: Root | undefined, overlayRoot: Root | undefined, revision = 0, overlayRevision = 0;
  return {
    mount(html: string) {
      flushSync(() => shellRoot.render(<Shell html={html} />));
      const content = container.querySelector('.content'), overlay = container.querySelector('#modal-root');
      if (!content || !overlay) throw new Error('React shell is missing its render targets');
      pageRoot = createRoot(content); overlayRoot = createRoot(overlay);
    },
    page(html: string, component: AnyComponent | null = null, props: object = {}, stableKey?: string) {
      if (!pageRoot) throw new Error('React shell is not mounted');
      flushSync(() => pageRoot!.render(<Page html={html} component={component} props={props} key={stableKey ?? ++revision} />));
    },
    overlay(html: string, component: AnyComponent | null = null, props: object = {}) {
      if (!overlayRoot) throw new Error('React shell is not mounted');
      flushSync(() => overlayRoot!.render(<Overlay html={html} component={component} props={props} key={++overlayRevision} />));
    },
  };
}
