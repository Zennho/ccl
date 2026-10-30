export interface ContentLink {
  label: string;
  url: string;
}
export interface ContentVersion {
  id: string;
  name: string;
  number: string;
  date: string;
  requiredDependencies?: string[] | null;
}
export interface ContentHit {
  id: string;
  title: string;
  projectUrl?: string;
  installed?: boolean;
  description?: string;
}
export interface ContentDraft {
  title: string;
  projectId: string;
  projectUrl?: string;
  installed: boolean;
  kind: string;
  source: string;
  apiKey: string;
  gameDir: string;
  target: string;
  javaPath: string;
  loading: boolean;
  versions: ContentVersion[];
  error: string;
  links: ContentLink[];
  linksLoading: boolean;
  linksError: boolean;
  summary: string;
  description: string;
  descriptionLoading: boolean;
  descriptionError: boolean;
  translation: string;
  translationLoading: boolean;
  showOriginal: boolean;
  encyclopedia: { url: string; summary?: string } | null;
  detailOnly: boolean;
}
interface State {
  modDraft: ContentDraft | null;
  contentKind: string;
  contentSource: string;
  contentKey: string;
  gameDir: string;
  contentTarget: string;
  javaPath: string;
}
interface Options {
  state: State;
  render: () => void;
  lookup: (
    source: string,
    kind: string,
    projectUrl: string,
    title: string,
  ) => Promise<{ url: string; summary?: string } | null>;
  links: (
    source: string,
    projectId: string,
    apiKey: string,
  ) => Promise<{ links?: ContentLink[]; description?: string; summary?: string }>;
  curseDescription: (projectId: string, apiKey: string) => Promise<unknown>;
  versions: (
    kind: string,
    gameDir: string,
    version: string,
    source: string,
    projectId: string,
    apiKey: string,
  ) => Promise<ContentVersion[]>;
  translate: (
    source: string,
    projectId: string,
    description: string,
    summary: string,
  ) => Promise<unknown>;
}
export function createContentDetail({
  state,
  render,
  lookup,
  links,
  curseDescription,
  versions,
  translate,
}: Options) {
  async function open(
    item: ContentHit,
    options?: { kind: string; source: string; detailOnly?: boolean },
  ) {
    const kind = options?.kind || state.contentKind,
      source = options?.source || state.contentSource,
      apiKey = state.contentKey,
      gameDir = state.gameDir,
      target = state.contentTarget,
      javaPath = state.javaPath;
    if (kind !== 'modpack' && !target) return;
    const draft: ContentDraft = {
      title: item.title,
      projectId: item.id,
      projectUrl: item.projectUrl,
      installed: !!item.installed,
      kind,
      source,
      apiKey,
      gameDir,
      target,
      javaPath,
      loading: kind !== 'modpack' && !options?.detailOnly,
      versions: [],
      error: '',
      links: [],
      linksLoading: true,
      linksError: false,
      summary: item.description || '',
      description: '',
      descriptionLoading: true,
      descriptionError: false,
      translation: '',
      translationLoading: true,
      showOriginal: false,
      encyclopedia: null,
      detailOnly: !!options?.detailOnly,
    };
    state.modDraft = draft;
    render();
    if ((kind === 'mod' || kind === 'modpack') && item.projectUrl)
      void lookup(source, kind, item.projectUrl, item.title)
        .then((result) => {
          if (state.modDraft === draft && result?.url) {
            draft.encyclopedia = result;
            render();
          }
        })
        .catch(() => {});
    const linkRequest = links(source, item.id, apiKey)
      .then((info) => {
        if (state.modDraft === draft) {
          draft.links = Array.isArray(info?.links) ? info.links : [];
          draft.linksLoading = false;
          if (!draft.summary && typeof info?.summary === 'string') draft.summary = info.summary;
          if (source === 'modrinth') {
            draft.description = typeof info?.description === 'string' ? info.description : '';
            draft.descriptionLoading = false;
          }
          render();
        }
      })
      .catch(() => {
        if (state.modDraft === draft) {
          draft.linksLoading = false;
          draft.linksError = true;
          if (source === 'modrinth') {
            draft.descriptionLoading = false;
            draft.descriptionError = true;
          }
          render();
        }
      });
    const descriptionRequest =
      source === 'curseforge'
        ? curseDescription(item.id, apiKey)
            .then((description) => {
              if (state.modDraft === draft) {
                draft.description = typeof description === 'string' ? description : '';
                draft.descriptionLoading = false;
                render();
              }
            })
            .catch(() => {
              if (state.modDraft === draft) {
                draft.descriptionLoading = false;
                draft.descriptionError = true;
                render();
              }
            })
        : Promise.resolve();
    const versionRequest =
      kind !== 'modpack' && !options?.detailOnly
        ? versions(kind, gameDir, target, source, item.id, apiKey)
            .then((result) => {
              if (state.modDraft === draft) {
                draft.versions = result;
                draft.loading = false;
                render();
              }
            })
            .catch((error) => {
              if (state.modDraft === draft) {
                draft.error = String(error);
                draft.loading = false;
                render();
              }
            })
        : Promise.resolve();
    void Promise.all([linkRequest, descriptionRequest]).then(async () => {
      if (state.modDraft !== draft) return;
      try {
        const translated = await translate(source, item.id, draft.description, draft.summary);
        if (state.modDraft === draft && typeof translated === 'string')
          draft.translation = translated;
      } catch {
      } finally {
        if (state.modDraft === draft) {
          draft.translationLoading = false;
          render();
        }
      }
    });
    await versionRequest;
  }
  return { open };
}
