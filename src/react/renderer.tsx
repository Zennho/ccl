import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { flushSync } from 'react-dom';

// Pages and overlays are independently mounted so background updates preserve
// the current form and animation nodes when their stable key remains unchanged.
type AnyComponent = React.ComponentType<any>;
function View({ component: Component, props }: { component: AnyComponent | null; props: object }) {
  return <div className="react-page-root">{Component && <Component {...props} />}</div>;
}
export function createRenderer(container: HTMLElement) {
  const shellRoot = createRoot(container);
  let pageRoot: Root | undefined, overlayRoot: Root | undefined, revision = 0, overlayRevision = 0;
  return {
    mount(Component: AnyComponent, props: object) {
      flushSync(() => shellRoot.render(<Component {...props} />));
      const content = container.querySelector('.content'), overlay = container.querySelector('#modal-root');
      if (!content || !overlay) throw new Error('React shell is missing its render targets');
      pageRoot = createRoot(content); overlayRoot = createRoot(overlay);
    },
    chrome(Component: AnyComponent, props: object) { flushSync(() => shellRoot.render(<Component {...props} />)); },
    page(component: AnyComponent | null = null, props: object = {}, stableKey?: string) {
      if (!pageRoot) throw new Error('React shell is not mounted');
      flushSync(() => pageRoot!.render(<View component={component} props={props} key={stableKey ?? ++revision} />));
    },
    overlay(component: AnyComponent | null = null, props: object = {}, stableKey?: string) {
      if (!overlayRoot) throw new Error('React shell is not mounted');
      flushSync(() => overlayRoot!.render(<View component={component} props={props} key={stableKey ?? ++overlayRevision} />));
    },
  };
}
