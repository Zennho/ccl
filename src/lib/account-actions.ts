import type { MicrosoftAccount } from './account-restore';
interface State {
  account: MicrosoftAccount | null;
  appearance: unknown;
  accountName: string;
  accountUuid: string;
  accountMode: string;
  accountPreference: string;
  accountKnown: boolean;
  accountRestoring: boolean;
  accountRestoreError: string;
  accountBusy: boolean;
  savedAccounts: MicrosoftAccount[];
  loginAttempt: object | null;
  browserPrompt: unknown;
  previewCapeId: string;
}
interface Options {
  state: State;
  render: () => void;
  persist: () => void;
  flash: (message: string, kind?: string) => void;
  restore: ((options?: { notify?: boolean }) => Promise<unknown>) & { cancel: () => void };
  restoreAvatar: (uuid: string) => Promise<unknown>;
  cacheAvatar: (uuid: string, skin: null) => void;
  refreshAppearance: () => Promise<unknown>;
  refreshAccounts: () => Promise<unknown>;
  switchAccount: (
    uuid: string,
  ) => Promise<{ error?: string | null; account?: MicrosoftAccount | null }>;
  beginLogin: () => Promise<unknown>;
  completeLogin: () => Promise<MicrosoftAccount>;
  cancelLogin: () => Promise<unknown>;
  remember: () => Promise<MicrosoftAccount>;
  openLogin: () => Promise<unknown>;
  logout: () => Promise<unknown>;
}
export function createAccountActions({
  state,
  render,
  persist,
  flash,
  restore,
  restoreAvatar,
  cacheAvatar,
  refreshAppearance,
  refreshAccounts,
  switchAccount,
  beginLogin,
  completeLogin,
  cancelLogin,
  remember,
  openLogin,
  logout,
}: Options) {
  async function switchTo(uuid: string) {
    if (state.accountBusy || state.loginAttempt || uuid === state.account?.uuid) return;
    const previous = {
      account: state.account,
      appearance: state.appearance,
      accountName: state.accountName,
      accountUuid: state.accountUuid,
      accountMode: state.accountMode,
      accountPreference: state.accountPreference,
      accountKnown: state.accountKnown,
    };
    restore.cancel();
    state.accountBusy = true;
    state.appearance = null;
    state.account = null;
    state.accountPreference = 'microsoft';
    state.accountKnown = true;
    const target = state.savedAccounts.find((a) => a.uuid === uuid);
    state.accountName = target?.name || '';
    state.accountUuid = uuid;
    state.accountRestoreError = '';
    void restoreAvatar(uuid);
    render();
    try {
      const result = await switchAccount(uuid);
      if (result?.error || !result?.account) {
        state.accountMode = 'offline';
        state.accountRestoreError = `账户恢复失败：${result?.error || '未找到保存的账户'}。可检查网络后重试或重新登录。`;
        persist();
        flash(state.accountRestoreError, 'error');
      } else {
        const account = result.account;
        state.account = account;
        state.accountName = account.name;
        state.accountUuid = account.uuid;
        state.accountMode = state.accountPreference === 'offline' ? 'offline' : 'microsoft';
        persist();
        await refreshAppearance();
      }
    } catch (error) {
      Object.assign(state, previous);
      persist();
      flash(`无法切换账户：${error}`, 'error');
    } finally {
      state.accountBusy = false;
      render();
      void refreshAccounts();
    }
  }
  async function begin() {
    if (state.accountRestoring) return;
    const attempt = {};
    state.loginAttempt = attempt;
    state.browserPrompt = null;
    render();
    try {
      const prompt = await beginLogin();
      if (state.loginAttempt !== attempt) return;
      state.browserPrompt = prompt;
      render();
      const account = await completeLogin();
      if (state.loginAttempt !== attempt) return;
      if (state.account?.uuid !== account.uuid) state.appearance = null;
      state.account = account;
      state.accountName = account.name;
      state.accountUuid = account.uuid;
      state.accountMode = 'microsoft';
      state.accountKnown = true;
      state.accountPreference = 'microsoft';
      state.accountRestoreError = '';
      state.loginAttempt = null;
      state.browserPrompt = null;
      void restoreAvatar(account.uuid);
      persist();
      render();
      if (account.remembered === false)
        flash(
          `登录成功，但无法保存登录状态：${account.rememberError || '请检查系统凭据库。'}`,
          'error',
        );
      await refreshAppearance();
      void refreshAccounts();
    } catch (error) {
      if (state.loginAttempt === attempt) {
        state.loginAttempt = null;
        state.browserPrompt = null;
        render();
        flash(`登录失败：${error}`, 'error');
      }
    }
  }
  async function cancel() {
    state.loginAttempt = null;
    state.browserPrompt = null;
    state.accountBusy = true;
    render();
    try {
      await cancelLogin();
    } catch (error) {
      flash(String(error), 'error');
    } finally {
      state.accountBusy = false;
      render();
    }
  }
  async function retrySave() {
    if (!state.account || state.accountBusy) return;
    const current = state.account;
    state.accountBusy = true;
    render();
    try {
      const account = await remember();
      if (state.account !== current) return;
      Object.assign(current, account);
      if (account.remembered) {
        flash('登录状态已保存。');
        void refreshAccounts();
      } else flash(`仍无法保存登录状态：${account.rememberError || '请检查系统凭据库。'}`, 'error');
    } catch (error) {
      flash(`无法重试保存：${error}`, 'error');
    } finally {
      state.accountBusy = false;
      render();
    }
  }
  function retryRestore() {
    if (!state.accountRestoring) void restore({ notify: true });
  }
  async function openBrowser() {
    try {
      await openLogin();
    } catch (error) {
      flash(String(error), 'error');
    }
  }
  function useOffline() {
    state.accountMode = 'offline';
    state.accountPreference = 'offline';
    persist();
    render();
  }
  function useMicrosoft() {
    if (!state.account && !state.accountKnown) return;
    state.accountMode = state.account ? 'microsoft' : 'offline';
    state.accountPreference = 'microsoft';
    void restoreAvatar(state.account?.uuid || state.accountUuid);
    persist();
    render();
    if (!state.account) void restore({ notify: false });
  }
  async function signOut() {
    const oldUuid = state.account?.uuid || state.accountUuid;
    restore.cancel();
    state.accountBusy = true;
    render();
    try {
      await logout();
    } catch (error) {
      flash(String(error), 'error');
    } finally {
      state.account = null;
      state.accountName = '';
      state.accountUuid = '';
      cacheAvatar(oldUuid, null);
      state.accountMode = 'offline';
      state.accountKnown = false;
      state.accountPreference = 'offline';
      state.accountRestoreError = '';
      state.appearance = null;
      state.previewCapeId = '';
      state.accountBusy = false;
      persist();
      render();
      void refreshAccounts();
    }
  }
  return {
    switchTo,
    begin,
    cancel,
    retrySave,
    retryRestore,
    openBrowser,
    useOffline,
    useMicrosoft,
    signOut,
  };
}
