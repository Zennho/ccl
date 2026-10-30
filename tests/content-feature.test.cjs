const test = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const installRenderer = require('./react-renderer-helper.cjs');

function setup(t, overrides = {}) {
  const dom = new JSDOM('<div id="app"></div>', {
    url: 'http://localhost/',
    runScripts: 'dangerously',
  });
  t.after(() => dom.window.close());
  const window = dom.window;
  installRenderer(window);
  const state = Object.assign(
    window.createInitialState({}),
    {
      page: 'content',
      gameDir: '/game',
      contentTarget: '1.20.1',
      modUpdates: { checked: 1, updates: [] },
      modConflicts: { checked: 1, issues: [] },
    },
    overrides,
  );
  const calls = [];
  window.invoke = async (command, args) => {
    calls.push({ command, args });
    switch (command) {
      case 'list_mods':
        return [{ name: 'iris.jar', enabled: true }];
      case 'list_local_packs':
        return [{ name: 'pack.zip', directory: false }];
      case 'shader_environment':
        return { detected: ['iris'] };
      case 'search_content':
        return { hits: [{ id: 'project', installed: true }], hasMore: false };
      case 'translate_content_summaries':
        return null;
      default:
        throw new Error(`Unexpected command: ${command}`);
    }
  };
  let renders = 0;
  const render = () => {
    renders++;
  };
  const feature = window.createContentFeature({
    state,
    render,
    renderContent: render,
    renderOverlay: render,
    flash: (message) => assert.fail(message),
  });
  return { state, feature, calls, renders: () => renders };
}

function job(overrides = {}) {
  return { kind: 'mod', gameDir: '/game', version: '1.20.1', ...overrides };
}

// Use actual controllers so these cases also exercise cache invalidation and adapters.
test('unrelated completions leave the current library, reports and cache untouched', async (t) => {
  const { state, feature, calls, renders } = setup(t);
  await feature.search.searchContent();
  const reports = [state.modUpdates, state.modConflicts];
  const revision = feature.mods.revision();
  calls.length = 0;
  const renderCount = renders();
  for (const completed of [
    job({ gameDir: '/other' }),
    job({ version: '1.21' }),
    job({ kind: 'java' }),
    job({ kind: 'resourcepack' }),
  ])
    await feature.onJobFinished(completed);

  assert.equal(calls.length, 0);
  assert.equal(renders(), renderCount);
  assert.equal(feature.mods.revision(), revision);
  assert.equal(state.modUpdates, reports[0]);
  assert.equal(state.modConflicts, reports[1]);
  await feature.search.searchContent();
  assert(
    !calls.some(({ command }) => command === 'search_content'),
    'cached results remain usable',
  );
});

test('mod completion clears stale reports and refreshes installed markers', async (t) => {
  const { state, feature, calls } = setup(t);
  await feature.search.searchContent();
  calls.length = 0;
  await feature.onJobFinished(job());
  assert.equal(state.modUpdates, null);
  assert.equal(state.modConflicts, null);
  assert.equal(state.localMods[0].name, 'iris.jar');
  assert.equal(state.contentResults[0].installed, true);
  assert.deepEqual(
    calls.map(({ command }) => command),
    ['list_mods', 'search_content', 'translate_content_summaries'],
  );
  assert.equal(calls[1].args.version, '1.20.1');
  assert.equal(calls[1].args.gameDir, '/game');
});

test('installing a mod while browsing shaders refreshes shader environment too', async (t) => {
  const { state, feature, calls } = setup(t, { contentKind: 'shader' });
  await feature.onJobFinished(job());
  assert.equal(state.shaderEnv.detected[0], 'iris');
  assert.deepEqual(
    calls.map(({ command }) => command),
    [
      'list_mods',
      'list_local_packs',
      'shader_environment',
      'search_content',
      'translate_content_summaries',
    ],
  );
});

for (const kind of ['resourcepack', 'shader']) {
  test(`${kind} completion reloads the matching library and bypasses cached search`, async (t) => {
    const { state, feature, calls } = setup(t, { contentKind: kind });
    await feature.search.searchContent();
    calls.length = 0;
    await feature.onJobFinished(job({ kind }));
    assert.equal(state.localPacks[0].name, 'pack.zip');
    assert.equal(state.contentLoaded, true);
    assert(calls.some(({ command }) => command === 'search_content'));
    assert(calls.some(({ command, args }) => command === 'list_local_packs' && args.kind === kind));
    assert.equal(
      calls.some(({ command }) => command === 'shader_environment'),
      kind === 'shader',
    );
  });
}

test('background completion invalidates content without fetching a hidden page', async (t) => {
  const { state, feature, calls } = setup(t, { contentKind: 'resourcepack' });
  await feature.search.searchContent();
  state.page = 'home';
  calls.length = 0;
  await feature.onJobFinished(job({ kind: 'resourcepack' }));
  assert.equal(state.contentLoaded, false);
  assert.equal(calls.length, 0);
  await feature.onJobFinished(job());
  assert.equal(state.modUpdates, null);
  assert.equal(state.modConflicts, null);
  assert.equal(calls.length, 0);
  state.page = 'content';
  await feature.search.searchContent();
  assert(calls.some(({ command }) => command === 'search_content'));
});
