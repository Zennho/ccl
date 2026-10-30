import type { LauncherState } from '../../lib/launcher-state';
import type { createAccountActions } from '../../lib/account-actions';
import type { createSkinController } from '../../lib/skin-controller';
import type { ClickHandler } from './types';
interface Options {
  state: LauncherState;
  render: () => void;
  account: ReturnType<typeof createAccountActions>;
  skin: ReturnType<typeof createSkinController>;
  searchContent: (force?: boolean) => Promise<unknown>;
}
export function createAccountHandler({
  state,
  render,
  account,
  skin,
  searchContent,
}: Options): ClickHandler {
  return (target) => {
    const switchAccount = target.closest<HTMLElement>('[data-switch-account]');
    if (switchAccount) {
      const menu = switchAccount.closest('details');
      if (menu) menu.open = false;
      return account.switchTo(switchAccount.dataset.switchAccount || '');
    }
    const previewCape = target.closest<HTMLElement>('[data-preview-cape]');
    if (previewCape) {
      skin.previewCape(Number(previewCape.dataset.previewCape));
      return true;
    }
    const applyCape = target.closest<HTMLElement>('[data-apply-cape]');
    if (applyCape) return skin.applyCape(Number(applyCape.dataset.applyCape));
    const action = target.closest<HTMLElement>('[data-action]')?.dataset.action;
    switch (action) {
      case 'begin-login':
        return account.begin();
      case 'cancel-login':
        return account.cancel();
      case 'retry-save-account':
        return account.retrySave();
      case 'retry-account-restore':
        account.retryRestore();
        return true;
      case 'open-microsoft-login':
        return account.openBrowser();
      case 'use-offline':
      case 'continue-offline':
        {
          const menu = target.closest('details');
          if (menu) menu.open = false;
        }
        account.useOffline();
        return true;
      case 'use-microsoft':
        {
          const menu = target.closest('details');
          if (menu) menu.open = false;
        }
        account.useMicrosoft();
        return true;
      case 'logout-microsoft':
        return account.signOut();
      case 'choose-skin':
      case 'choose-cape':
        return skin.choose(action === 'choose-skin' ? 'skin' : 'cape');
      case 'apply-offline-skin':
        return skin.applyToOffline();
      case 'find-offline-skin-mod':
        state.contentView = 'browse';
        state.contentKind = 'mod';
        state.contentSource = 'modrinth';
        state.contentTarget = state.selected;
        state.contentQuery = 'CustomSkinLoader';
        state.contentPage = 0;
        state.contentLoaded = false;
        state.contentResults = [];
        state.page = 'content';
        render();
        void searchContent(true);
        return true;
      case 'clear-skin':
        skin.clearSkin();
        return true;
      case 'clear-cape':
        skin.clearCape();
        return true;
      case 'upload-skin':
        return skin.upload();
      case 'reset-skin':
        return skin.reset();
      case 'hide-cape':
        return skin.hideCape();
      default:
        return false;
    }
  };
}
