import type { LocalMod } from '../react/types';
import type { ContentLink } from './content-detail';

export interface LocalModDetail extends LocalMod {
  descriptionText: string;
  translation: string;
  descriptionLoading: boolean;
  descriptionError: boolean;
  translationLoading: boolean;
  showOriginal: boolean;
  sourceMessage: string;
}

interface Options {
  state: {
    localModDetail: LocalModDetail | null;
    gameDir: string;
    contentTarget: string;
    contentKey: string;
  };
  render: () => void;
  resolve: (
    gameDir: string,
    version: string,
    name: string,
  ) => Promise<{ source: string; projectId: string } | null>;
  links: (
    source: string,
    id: string,
    key: string,
  ) => Promise<{ links?: ContentLink[]; description?: string; summary?: string }>;
  curseDescription: (id: string, key: string) => Promise<unknown>;
  translate: (source: string, id: string, description: string, summary: string) => Promise<unknown>;
}

/** Keep local metadata visible while resolving a verified project and its translation. */
export function createLocalModDetail({
  state,
  render,
  resolve,
  links,
  curseDescription,
  translate,
}: Options) {
  async function open(mod: LocalMod) {
    const { gameDir, contentTarget, contentKey } = state;
    const draft: LocalModDetail = {
      ...mod,
      descriptionText: mod.description || '',
      translation: '',
      descriptionLoading: true,
      descriptionError: false,
      translationLoading: false,
      showOriginal: false,
      sourceMessage: '',
    };
    state.localModDetail = draft;
    render();
    try {
      const project = await resolve(gameDir, contentTarget, mod.name);
      if (state.localModDetail !== draft) return;
      if (!project || !['modrinth', 'curseforge'].includes(project.source) || !project.projectId) {
        draft.sourceMessage = '未识别项目来源，显示本地介绍。';
        return;
      }
      if (project.source === 'curseforge' && !contentKey.trim()) {
        draft.sourceMessage = '需要在浏览下载中输入 CurseForge API Key 才能获取项目翻译。';
        return;
      }
      const [linkResult, descriptionResult] = await Promise.allSettled([
        links(project.source, project.projectId, contentKey),
        project.source === 'curseforge'
          ? curseDescription(project.projectId, contentKey)
          : Promise.resolve(null),
      ]);
      if (state.localModDetail !== draft) return;
      const info = linkResult.status === 'fulfilled' ? linkResult.value : null;
      const body =
        project.source === 'modrinth'
          ? info?.description
          : descriptionResult.status === 'fulfilled'
            ? descriptionResult.value
            : null;
      const description = typeof body === 'string' ? body : '';
      const summary = typeof info?.summary === 'string' ? info.summary : '';
      const original = description.trim() ? description : summary;
      if (!original.trim()) {
        draft.sourceMessage =
          linkResult.status === 'rejected' &&
          (project.source === 'modrinth' || descriptionResult.status === 'rejected')
            ? '获取项目介绍失败，显示本地介绍。'
            : '项目没有提供在线介绍，显示本地介绍。';
        return;
      }
      draft.descriptionText = original;
      draft.descriptionLoading = false;
      draft.translationLoading = true;
      render();
      const result = await translate(project.source, project.projectId, description, summary);
      if (state.localModDetail !== draft) return;
      if (typeof result === 'string' && result.trim()) draft.translation = result;
      else draft.sourceMessage = '暂无中文翻译，显示原文。';
    } catch {
      if (state.localModDetail === draft)
        draft.sourceMessage = '获取项目介绍或翻译失败，显示原文。';
    } finally {
      if (state.localModDetail === draft) {
        draft.descriptionLoading = false;
        draft.translationLoading = false;
        render();
      }
    }
  }
  return { open };
}
