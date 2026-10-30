import { clampAppearance } from './appearance';
import type { GameVersion, JavaRuntime, MemoryMode, LocalMod } from '../react/types';
import type { ServerCatalog } from '../react/public-servers';
import type { NetworkAddress } from '../react/lan-room';
import type { InstanceOverviewView } from '../react/instance-overview';
import type { LaunchView, Crash } from '../react/launch';
import type { MemoryInfo, UpdateInfo } from './system-status';
import type { ContentDraft } from './content-detail';
import type { LocalModDetail } from './local-mod-detail';
import type { ArchiveDraft } from './archive-manager';
import type { MicrosoftAccount } from './account-restore';
import type { LocalSkin } from './avatar-store';
import type { ThemeDraft } from './instance-theme';
import type { ManageView } from './instance-manage';
import type { ProfileView } from './game-profile';
import type { VersionDelete } from './version-delete';
import type { Job } from '../job-manager';
interface ContentItem {
  id: string;
  title: string;
  description: string;
  localizedDescription?: string;
  author: string;
  downloads: number;
  installed: boolean;
  iconUrl?: string;
  projectUrl?: string;
}
interface ResourceUpdate {
  name: string;
  latest: string;
  projectId: string;
  projectUrl?: string;
}
interface UpdateReport {
  checked: number;
  unknown: number;
  failed: number;
  updates: ResourceUpdate[];
}
interface SkinAppearance {
  skin?: string | null;
  model: string;
  capes: { id: string; name: string; active: boolean; texture?: string | null }[];
}
export interface LauncherState {
  page: string;
  lanView: string;
  serverCatalog: ServerCatalog | null;
  serverLoading: boolean;
  serverError: string;
  serverQuery: string;
  serverStatus: string;
  serverPage: number;
  lanAddresses: NetworkAddress[];
  lanRoom: { port: number } | null;
  lanBusy: boolean;
  lanPort: string;
  lanTarget: string;
  lanTest: string;
  versions: GameVersion[];
  selected: string;
  username: string;
  javaPath: string;
  proxyUrl: string;
  gameDir: string;
  memory: number;
  memoryMode: MemoryMode;
  memoryInfo: MemoryInfo | null;
  memoryInfoError: string;
  memoryInfoLoading: boolean;
  optimize: boolean;
  jvmArgs: string;
  gameArgs: string;
  contentTarget: string;
  modDraft: ContentDraft | null;
  archiveDraft: ArchiveDraft | null;
  launchView: LaunchView | null;
  crash: (Crash & { gameDir: string; logName: string | null }) | null;
  crashDialog: (Crash & { gameDir: string; logName: string | null }) | null;
  noticeCrash: boolean;
  versionQuery: string;
  accountMode: string;
  accountKnown: boolean;
  accountName: string;
  accountUuid: string;
  accountPreference: string;
  accountRestoring: boolean;
  accountRestoreError: string;
  restoreAttempt: object | null;
  account: MicrosoftAccount | null;
  savedAccounts: MicrosoftAccount[];
  browserPrompt: { opened: boolean } | null;
  loginAttempt: object | null;
  accountBusy: boolean;
  appearance: SkinAppearance | null;
  localSkin: LocalSkin | null;
  localCape: LocalSkin | null;
  previewCapeId: string;
  skinModel: string;
  loading: boolean;
  notice: string;
  noticeKind: string;
  jobNotices: string[];
  online: boolean;
  javaRuntimes: JavaRuntime[];
  javaLoading: boolean;
  javaRequirement: number | null;
  javaRequirementLoading: boolean;
  javaDelete: number | null;
  versionDelete: VersionDelete | null;
  instanceView: (InstanceOverviewView & { gameDir: string }) | null;
  instanceSettingsView: { version: string; gameDir: string; name: string } | null;
  manageView: ManageView | null;
  themeView: ThemeDraft | null;
  profileView: ProfileView | null;
  versionDeleting: boolean;
  contentView: 'browse' | 'installed';
  contentSource: string;
  contentKind: string;
  contentQuery: string;
  contentKey: string;
  contentSort: string;
  contentCategory: string;
  contentCategories: { id: string; name: string }[];
  contentCategoriesLoading: boolean;
  contentCategoryError: string;
  contentGameFilter: string;
  contentLoaderFilter: string;
  contentEnvironment: string;
  contentPage: number;
  contentHasMore: boolean;
  contentLoaded: boolean;
  contentError: string;
  contentResults: ContentItem[];
  contentBusy: boolean;
  updateState: string;
  updateInfo: UpdateInfo | null;
  updateError: string;
  updateDismissed: string;
  localPacks: { name: string; directory: boolean; source?: string; projectId?: string }[];
  packQuery: string;
  packLoading: boolean;
  packError: string;
  packWorking: boolean;
  packChecking: boolean;
  packUpdates: UpdateReport | null;
  packDelete: { name: string; kind: string; version: string; gameDir: string } | null;
  shaderEnv: { detected?: string[]; uncertain?: boolean; loader?: string } | null;
  shaderEnvLoading: boolean;
  shaderEnvError: string;
  localMods: LocalMod[];
  localModDetail: LocalModDetail | null;
  modQuery: string;
  modFilter: string;
  selectedMods: Set<string>;
  modWorking: boolean;
  modChecking: boolean;
  modConflicts: {
    checked: number;
    unknown: number;
    issues?: { message: string; files?: string[] }[];
  } | null;
  modConflictsLoading: boolean;
  modUpdates: UpdateReport | null;
  modDelete: string[] | null;
  jobs: Job[];
  foregroundJobId: string | null;
  jobLimit: number;
  installDraft: {
    version: string;
    loader: string;
    addons: string[];
    compatibility: Record<string, 'checking' | 'available' | 'unavailable' | 'unknown'>;
  } | null;
}
interface SavedTheme {
  bannerOpacity?: number;
  bannerFrost?: number;
  bannerBlur?: number;
  backgroundOpacity?: number;
  backgroundFrost?: number;
  backgroundBlur?: number;
}
export interface SavedSettings {
  selected?: string;
  username?: string;
  javaPath?: string;
  proxyUrl?: string;
  gameDir?: string;
  memory?: number;
  memoryMode?: string;
  optimize?: boolean;
  jvmArgs?: string;
  gameArgs?: string;
  accountMode?: string;
  accountKnown?: boolean;
  accountName?: string;
  accountUuid?: string;
  jobLimit?: number;
  theme?: SavedTheme;
}
interface PersistedState {
  selected: string;
  username: string;
  javaPath: string;
  proxyUrl: string;
  gameDir: string;
  memory: number;
  memoryMode: string;
  optimize: boolean;
  jvmArgs: string;
  gameArgs: string;
  accountPreference: string;
  accountKnown: boolean;
  accountName: string;
  accountUuid: string;
  jobLimit: number;
}
interface Theme extends Required<SavedTheme> {
  banner: string | null;
  background: string | null;
}
export function readSettings(storage: Pick<Storage, 'getItem'>): SavedSettings {
  try {
    const value = JSON.parse(storage.getItem('ccl-settings') || '{}');
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  } catch {
    return {};
  }
}
export function createInitialState(saved: SavedSettings): LauncherState {
  return {
    page: 'home',
    lanView: 'room',
    serverCatalog: null,
    serverLoading: false,
    serverError: '',
    serverQuery: '',
    serverStatus: 'all',
    serverPage: 0,
    lanAddresses: [],
    lanRoom: null,
    lanBusy: false,
    lanPort: '',
    lanTarget: '',
    lanTest: '',
    versions: [],
    selected: saved.selected || '',
    username: saved.username || 'Player',
    javaPath: saved.javaPath || 'java',
    proxyUrl: saved.proxyUrl || '',
    gameDir: saved.gameDir || '',
    memory: saved.memory || 4096,
    memoryMode:
      saved.memoryMode === 'auto'
        ? 'auto'
        : saved.memoryMode === 'manual' || saved.memory != null
          ? 'manual'
          : 'auto',
    memoryInfo: null,
    memoryInfoError: '',
    memoryInfoLoading: false,
    optimize: saved.optimize !== false,
    jvmArgs: saved.jvmArgs || '',
    gameArgs: saved.gameArgs || '',
    contentTarget: '',
    modDraft: null,
    archiveDraft: null,
    launchView: null,
    crash: null,
    crashDialog: null,
    noticeCrash: false,
    versionQuery: '',
    accountMode: 'offline',
    accountKnown: saved.accountKnown === true,
    accountName: typeof saved.accountName === 'string' ? saved.accountName : '',
    accountUuid: typeof saved.accountUuid === 'string' ? saved.accountUuid : '',
    accountPreference: saved.accountMode === 'offline' ? 'offline' : 'microsoft',
    accountRestoring: false,
    accountRestoreError: '',
    restoreAttempt: null,
    account: null,
    savedAccounts: [],
    browserPrompt: null,
    loginAttempt: null,
    accountBusy: false,
    appearance: null,
    localSkin: null,
    localCape: null,
    previewCapeId: '',
    skinModel: 'classic',
    loading: false,
    notice: '',
    noticeKind: '',
    jobNotices: [],
    online: false,
    javaRuntimes: [],
    javaLoading: false,
    javaRequirement: null,
    javaRequirementLoading: false,
    javaDelete: null,
    versionDelete: null,
    instanceView: null,
    instanceSettingsView: null,
    manageView: null,
    themeView: null,
    profileView: null,
    versionDeleting: false,
    contentView: 'browse',
    contentSource: 'modrinth',
    contentKind: 'mod',
    contentQuery: '',
    contentKey: '',
    contentSort: 'downloads',
    contentCategory: '',
    contentCategories: [],
    contentCategoriesLoading: false,
    contentCategoryError: '',
    contentGameFilter: '',
    contentLoaderFilter: '',
    contentEnvironment: '',
    contentPage: 0,
    contentHasMore: false,
    contentLoaded: false,
    contentError: '',
    contentResults: [],
    contentBusy: false,
    updateState: 'idle',
    updateInfo: null,
    updateError: '',
    updateDismissed: '',
    localPacks: [],
    packQuery: '',
    packLoading: false,
    packError: '',
    packWorking: false,
    packChecking: false,
    packUpdates: null,
    packDelete: null,
    shaderEnv: null,
    shaderEnvLoading: false,
    shaderEnvError: '',
    localMods: [],
    localModDetail: null,
    modQuery: '',
    modFilter: 'all',
    selectedMods: new Set(),
    modWorking: false,
    modChecking: false,
    modConflicts: null,
    modConflictsLoading: false,
    modUpdates: null,
    modDelete: null,
    jobs: [],
    foregroundJobId: null,
    jobLimit: Math.max(1, Math.min(5, Number(saved.jobLimit) || 3)),
    installDraft: null,
  };
}
export function createTheme(saved: SavedSettings): Theme {
  return {
    bannerOpacity: clampAppearance(saved.theme?.bannerOpacity, 0),
    bannerFrost: clampAppearance(saved.theme?.bannerFrost, 0),
    bannerBlur: clampAppearance(saved.theme?.bannerBlur, 0, 30),
    backgroundOpacity: clampAppearance(saved.theme?.backgroundOpacity, 35),
    backgroundFrost: clampAppearance(saved.theme?.backgroundFrost, 42),
    backgroundBlur: clampAppearance(saved.theme?.backgroundBlur, 8, 30),
    banner: null,
    background: null,
  };
}
export function persistSettings(
  storage: Pick<Storage, 'setItem'>,
  state: PersistedState,
  theme: Theme,
) {
  storage.setItem(
    'ccl-settings',
    JSON.stringify({
      selected: state.selected,
      username: state.username,
      javaPath: state.javaPath,
      proxyUrl: state.proxyUrl,
      gameDir: state.gameDir,
      memory: state.memory,
      memoryMode: state.memoryMode,
      optimize: state.optimize,
      jvmArgs: state.jvmArgs,
      gameArgs: state.gameArgs,
      accountMode: state.accountPreference,
      accountKnown: state.accountKnown,
      accountName: state.accountName,
      accountUuid: state.accountUuid,
      jobLimit: state.jobLimit,
      theme: {
        bannerOpacity: theme.bannerOpacity,
        bannerFrost: theme.bannerFrost,
        bannerBlur: theme.bannerBlur,
        backgroundOpacity: theme.backgroundOpacity,
        backgroundFrost: theme.backgroundFrost,
        backgroundBlur: theme.backgroundBlur,
      },
    }),
  );
}
