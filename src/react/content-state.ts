import type { GameVersion, LocalMod } from './types';

interface ContentItem {
  id: string;
  title: string;
  iconUrl?: string;
  localizedDescription?: string;
  description: string;
  author: string;
  downloads: number;
  installed: boolean;
}
interface Update {
  name: string;
  latest: string;
  projectId: string;
  projectUrl?: string;
}
export interface UpdateReport {
  checked: number;
  updates: Update[];
  unknown: number;
  failed: number;
}
interface Environment {
  detected?: string[];
  uncertain?: boolean;
  loader?: string;
}
export interface ContentState {
  versions: GameVersion[];
  contentTarget: string;
  contentKind: string;
  contentView: 'browse' | 'installed';
  contentSource: string;
  contentBusy: boolean;
  contentSort: string;
  contentCategories: { id: string; name: string }[];
  contentCategoriesLoading: boolean;
  contentCategoryError: string;
  contentCategory: string;
  contentGameFilter: string;
  contentLoaderFilter: string;
  contentEnvironment: string;
  contentKey: string;
  contentQuery: string;
  contentResults: ContentItem[];
  contentError: string;
  contentLoaded: boolean;
  contentHasMore: boolean;
  contentPage: number;
  shaderEnv: Environment | null;
  shaderEnvLoading: boolean;
  shaderEnvError: string;
  localPacks: { name: string; directory: boolean; source?: string }[];
  packQuery: string;
  packLoading: boolean;
  packError: string;
  packWorking: boolean;
  packChecking: boolean;
  packUpdates: UpdateReport | null;
  packDelete: { name: string } | null;
  localMods: LocalMod[];
  modQuery: string;
  modFilter: string;
  selectedMods: Set<string>;
  modWorking: boolean;
  modChecking: boolean;
  modUpdates: UpdateReport | null;
  modConflictsLoading: boolean;
  modConflicts: {
    checked: number;
    unknown: number;
    issues?: { message: string; files?: string[] }[];
  } | null;
  modDelete: string[] | null;
}
