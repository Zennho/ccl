import type { ClickHandler } from './types';
interface WindowControls {
  minimize(): Promise<void>;
  toggleMaximize(): Promise<void>;
  close(): Promise<void>;
  startResizeDragging(direction: ResizeDirection): Promise<void>;
}
type ResizeDirection =
  | 'East'
  | 'North'
  | 'NorthEast'
  | 'NorthWest'
  | 'South'
  | 'SouthEast'
  | 'SouthWest'
  | 'West';
interface Options {
  container: HTMLElement;
  isDesktop: () => boolean;
  getWindow: () => WindowControls;
  resetTheme: (kind: string) => Promise<void>;
  flash: (message: string, kind?: string) => void;
}
export function installWindowResize({ container, isDesktop, getWindow, flash }: Options): void {
  container.addEventListener('pointerdown', (event) => {
    if (!(event.target instanceof Element)) return;
    const edge = event.target.closest<HTMLElement>('[data-resize]');
    const direction = edge?.dataset.resize;
    const directions: ResizeDirection[] = [
      'East',
      'North',
      'NorthEast',
      'NorthWest',
      'South',
      'SouthEast',
      'SouthWest',
      'West',
    ];
    if (
      direction &&
      directions.includes(direction as ResizeDirection) &&
      event.button === 0 &&
      isDesktop()
    ) {
      void getWindow()
        .startResizeDragging(direction as ResizeDirection)
        .catch((error) => flash(`无法调整窗口大小：${error}`, 'error'));
    }
  });
}
export function closeVersionMenus(container: HTMLElement, target: Element): void {
  const summary = target.closest('.version-menu summary');
  container.querySelectorAll<HTMLDetailsElement>('.version-menu[open]').forEach((menu) => {
    if (!summary || summary.parentElement !== menu) menu.open = false;
  });
}
export function createShellHandler({
  isDesktop,
  getWindow,
  resetTheme,
  flash,
}: Options): ClickHandler {
  return (target) => {
    const reset = target.closest<HTMLElement>('[data-theme-reset]');
    if (reset) return resetTheme(reset.dataset.themeReset || '');
    const button = target.closest<HTMLElement>('[data-window]');
    if (!button) return false;
    if (!isDesktop()) return true;
    return (async () => {
      try {
        const win = getWindow();
        if (button.dataset.window === 'minimize') await win.minimize();
        else if (button.dataset.window === 'maximize') await win.toggleMaximize();
        else if (button.dataset.window === 'close') await win.close();
      } catch (error) {
        flash(`窗口操作失败：${error}`, 'error');
      }
    })();
  };
}
