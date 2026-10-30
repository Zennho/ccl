export interface MicrosoftAccount {
  uuid: string;
  name: string;
  remembered?: boolean;
  rememberError?: string;
}
interface AccountState {
  restoreAttempt: object | null;
  accountRestoring: boolean;
  accountRestoreError: string;
  account: MicrosoftAccount | null;
  accountKnown: boolean;
  accountName: string;
  accountUuid: string;
  accountMode: string;
  accountPreference: string;
  loginAttempt: unknown;
  appearance: unknown;
}
interface AccountRestoreOptions {
  state: AccountState;
  restore: () => Promise<MicrosoftAccount | null>;
  restoreAvatar: (uuid: string) => Promise<unknown>;
  refreshAppearance: () => Promise<unknown>;
  render: () => void;
  persist: () => void;
  flash: (message: string, kind?: string) => void;
}
export function createAccountRestorer({
  state,
  restore,
  restoreAvatar,
  refreshAppearance,
  render,
  persist,
  flash,
}: AccountRestoreOptions) {
  let pending: Promise<MicrosoftAccount | null> | null = null;
  function restoreAccount({
    notify = false,
  }: { notify?: boolean } = {}): Promise<MicrosoftAccount | null> {
    if (pending) return pending;
    const attempt = {};
    state.restoreAttempt = attempt;
    state.accountRestoring = true;
    state.accountRestoreError = '';
    render();
    const task = (async () => {
      try {
        const account = await restore();
        if (state.restoreAttempt !== attempt) return null;
        if (account && !state.loginAttempt) {
          if (state.account?.uuid !== account.uuid) state.appearance = null;
          state.account = account;
          state.accountName = account.name;
          state.accountUuid = account.uuid;
          state.accountKnown = true;
          state.accountMode = state.accountPreference === 'offline' ? 'offline' : 'microsoft';
          void restoreAvatar(account.uuid);
          persist();
          if (account.remembered === false)
            flash(
              `账户已恢复，但无法保存新的登录状态：${account.rememberError || '请检查系统凭据库。'}`,
              'error',
            );
          void refreshAppearance();
          return account;
        }
        if (!account && state.accountKnown)
          state.accountRestoreError = '未找到已保存的账户，请重新登录或使用离线账户。';
      } catch (error) {
        if (state.restoreAttempt === attempt)
          state.accountRestoreError = `账户恢复失败：${error}。可检查网络后重试或重新登录。`;
      } finally {
        if (state.restoreAttempt === attempt) {
          state.restoreAttempt = null;
          state.accountRestoring = false;
          if (state.accountRestoreError && notify) flash(state.accountRestoreError, 'error');
          render();
        }
      }
      return null;
    })();
    pending = task;
    void task.finally(() => {
      if (pending === task) pending = null;
    });
    return task;
  }
  restoreAccount.cancel = () => {
    state.restoreAttempt = null;
    state.accountRestoring = false;
    pending = null;
  };
  return restoreAccount;
}
