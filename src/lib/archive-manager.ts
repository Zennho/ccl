import type { JobSpec } from '../job-manager';
import type { MemoryMode } from '../react/types';
export interface ArchiveManifest {
  name: string;
  gameVersion: string;
  loader: string;
  loaderVersion?: string;
  includeSaves: boolean;
  format: string;
  launchSettings?: unknown;
}
export type ArchiveDraft =
  | { kind: 'export'; version: string; gameDir: string }
  | { kind: 'import'; path: string; manifest: ArchiveManifest; gameDir: string; javaPath: string };
interface LaunchSettings {
  memory: number;
  memoryMode: MemoryMode;
  optimize: boolean;
  jvmArgs: string;
  gameArgs: string;
}
interface State extends LaunchSettings {
  gameDir: string;
  javaPath: string;
  selected: string;
  archiveDraft: ArchiveDraft | null;
}
interface Options {
  state: State;
  render: () => void;
  persist: () => void;
  flash: (message: string, kind?: string) => void;
  enqueue: (job: JobSpec) => void;
  chooseImport: () => Promise<string | null>;
  chooseExport: (version: string, format: 'ccl' | 'pcl') => Promise<string | null>;
  inspect: (path: string) => Promise<ArchiveManifest>;
  exportGame: (args: {
    gameDir: string;
    version: string;
    path: string;
    includeSaves: boolean;
    launchSettings: LaunchSettings;
    exportFormat: 'ccl' | 'pcl';
    jobId: string;
  }) => Promise<unknown>;
  importGame: (args: {
    gameDir: string;
    path: string;
    javaPath: string;
    jobId: string;
  }) => Promise<{ version: string; launchSettings?: Partial<LaunchSettings> | null }>;
}
export function createArchiveManager({
  state,
  render,
  persist,
  flash,
  enqueue,
  chooseImport,
  chooseExport,
  inspect,
  exportGame,
  importGame,
}: Options) {
  async function openImport() {
    try {
      const path = await chooseImport();
      if (path) {
        const manifest = await inspect(path);
        state.archiveDraft = {
          kind: 'import',
          path,
          manifest,
          gameDir: state.gameDir,
          javaPath: state.javaPath,
        };
        render();
      }
    } catch (error) {
      flash(`无法读取导入包：${error}`, 'error');
    }
  }
  function openExport(version: string) {
    state.archiveDraft = { kind: 'export', version, gameDir: state.gameDir };
    render();
  }
  function close() {
    state.archiveDraft = null;
    render();
  }
  async function confirmExport(includeSaves: boolean, format: string) {
    const draft = state.archiveDraft;
    if (draft?.kind !== 'export') return;
    const exportFormat = format === 'pcl' ? 'pcl' : 'ccl';
    try {
      const path = await chooseExport(draft.version, exportFormat);
      if (!path) return;
      const launchSettings: LaunchSettings = {
        memory: Number(state.memory),
        memoryMode: state.memoryMode,
        optimize: state.optimize,
        jvmArgs: state.jvmArgs,
        gameArgs: state.gameArgs,
      };
      state.archiveDraft = null;
      render();
      enqueue({
        key: `export:${draft.gameDir}:${draft.version}:${path}`,
        kind: 'export',
        title: `导出 · ${draft.version}`,
        gameDir: draft.gameDir,
        run: (job) =>
          exportGame({
            gameDir: draft.gameDir,
            version: draft.version,
            path,
            includeSaves,
            launchSettings,
            exportFormat,
            jobId: job.id,
          }),
      });
    } catch (error) {
      flash(`导出失败：${error}`, 'error');
    }
  }
  function confirmImport(restoreSettings: boolean) {
    const draft = state.archiveDraft;
    if (draft?.kind !== 'import') return;
    state.archiveDraft = null;
    render();
    enqueue({
      key: `import:${draft.gameDir}:${draft.path}`,
      kind: 'import',
      title: `导入 · ${draft.manifest.name}`,
      gameDir: draft.gameDir,
      run: async (job) => {
        const result = await importGame({
          gameDir: draft.gameDir,
          path: draft.path,
          javaPath: draft.javaPath,
          jobId: job.id,
        });
        if (draft.gameDir === state.gameDir) {
          state.selected = result.version;
          if (restoreSettings && result.launchSettings)
            Object.assign(state, result.launchSettings, {
              memoryMode: result.launchSettings.memoryMode === 'auto' ? 'auto' : 'manual',
            });
          persist();
        }
      },
    });
  }
  return { openImport, openExport, close, confirmExport, confirmImport };
}
