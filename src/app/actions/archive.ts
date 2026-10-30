import type { createArchiveManager } from '../../lib/archive-manager';
import type { ClickHandler } from './types';
interface Options {
  container: HTMLElement;
  archive: ReturnType<typeof createArchiveManager>;
}
export function createArchiveHandler({ container, archive }: Options): ClickHandler {
  return (target) => {
    const action = target.closest<HTMLElement>('[data-action]')?.dataset.action;
    switch (action) {
      case 'import-game':
        return archive.openImport();
      case 'close-archive':
        archive.close();
        return true;
      case 'close-archive-backdrop':
        if (target.classList.contains('install-overlay')) archive.close();
        return true;
      case 'confirm-export':
        return archive.confirmExport(
          !!container.querySelector<HTMLInputElement>('#archive-saves')?.checked,
          container.querySelector<HTMLInputElement>('input[name=archiveFormat]:checked')?.value ||
            'ccl',
        );
      case 'confirm-import':
        archive.confirmImport(
          !!container.querySelector<HTMLInputElement>('#archive-settings')?.checked,
        );
        return true;
      default:
        return false;
    }
  };
}
