import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { flushSync } from 'react-dom';

// Pages and overlays are independently mounted so background updates preserve
// the current form and animation nodes when their stable key remains unchanged.
function View<P extends object>({ component: Component, props }: { component: React.ComponentType<P> | null; props: P }) {
  return <div className="react-page-root">{Component && <Component {...props} />}</div>;
}
export function createRenderer(container: HTMLElement) {
  const shellRoot = createRoot(container);
  let pageRoot: Root | undefined, overlayRoot: Root | undefined, revision = 0, overlayRevision = 0;
  return {
    mount<P extends object>(Component: React.ComponentType<P>, props: P) {
      flushSync(() => shellRoot.render(<Component {...props} />));
      const content = container.querySelector('.content'), overlay = container.querySelector('#modal-root');
      if (!content || !overlay) throw new Error('React shell is missing its render targets');
      pageRoot = createRoot(content); overlayRoot = createRoot(overlay);
    },
    chrome<P extends object>(Component: React.ComponentType<P>, props: P) { flushSync(() => shellRoot.render(<Component {...props} />)); },
    page<P extends object>(component: React.ComponentType<P> | null = null, props: P = {} as P, stableKey?: string) {
      if (!pageRoot) throw new Error('React shell is not mounted');
      flushSync(() => pageRoot!.render(<View component={component} props={props} key={stableKey ?? ++revision} />));
    },
    overlay<P extends object>(component: React.ComponentType<P> | null = null, props: P = {} as P, stableKey?: string) {
      if (!overlayRoot) throw new Error('React shell is not mounted');
      flushSync(() => overlayRoot!.render(<View component={component} props={props} key={stableKey ?? ++overlayRevision} />));
    },
  };
}
