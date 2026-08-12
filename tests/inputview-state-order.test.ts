import { describe, expect, it, vi } from 'vitest';

vi.stubGlobal('defineBackground', (def: unknown) => def);

vi.mock('@/lib/messaging', () => ({
  onMessage: vi.fn(),
  sendMessage: vi.fn(),
}));

vi.mock('../entrypoints/background/controller', () => ({
  InputController: vi.fn(),
}));

vi.mock('../entrypoints/background/keepalive', () => ({
  serviceWorkerKeepalive: vi.fn(),
}));

vi.mock('../entrypoints/background/schemas', () => ({
  listEnabledInstalledSchemas: vi.fn(),
}));

vi.mock('@/lib/utils', async importOriginal => ({
  ...(await importOriginal() as Record<string, unknown>),
  getFs: vi.fn(),
}));

vi.mock('@/lib/schema-install', () => ({
  resolveInstalledSchemaId: vi.fn(),
}));

const { postFieldState, postInputViewState, postRefinedInputViewState }
  = await import('../entrypoints/background/inputview-state');
const { listEnabledInstalledSchemas }
  = await import('../entrypoints/background/schemas');

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => { resolve = res; });
  return { promise, resolve };
}

describe('InputView state ordering', () => {
  it('does not let an old refinement overwrite a newer schema state', async () => {
    const oldCatalog = deferred<Array<{ id: string; label: string }>>();
    let oldReadStarted!: () => void;
    const started = new Promise<void>((resolve) => { oldReadStarted = resolve; });
    let catalogRead = 0;
    vi.mocked(listEnabledInstalledSchemas).mockImplementation(async () => {
      catalogRead++;
      if (catalogRead === 1) {
        oldReadStarted();
        return oldCatalog.promise;
      }
      return [{ id: 'schema_b', label: 'Schema B' }];
    });

    const controller = {
      activeSettings: { schema: 'schema_a', pageSize: 5, algebraList: [] },
      context: null,
    };
    const posted: Array<{ kind: string; state: { schemaId: string; schemaName: string } }> = [];
    const post = (message: unknown) => posted.push(message as never);

    const connecting = postInputViewState(controller as never, post as never);
    await started;
    expect(posted.map(({ state }) => state.schemaId)).toEqual(['schema_a']);

    controller.activeSettings = {
      schema: 'schema_b',
      pageSize: 5,
      algebraList: [],
    };
    await postRefinedInputViewState(controller as never, post as never);
    expect(posted.at(-1)?.state.schemaId).toBe('schema_b');

    oldCatalog.resolve([{ id: 'schema_a', label: 'Schema A' }]);
    await connecting;

    expect(posted.at(-1)?.state.schemaId).toBe('schema_b');
    expect(posted.at(-1)?.state.schemaName).toBe('Schema B');
  });
});

function fakeController() {
  return {
    activeSettings: { schema: 'schema_a', pageSize: 5, algebraList: [] },
    context: null,
  };
}

describe('the fast snapshot and traditional output', () => {
  it('repeats the engine’s last answer rather than asserting simplified', async () => {
    // A fast post with the variant absent would route a traditional user's
    // dictation through the simplified path until refinement lands.
    const controller = {
      ...fakeController(),
      getEngineScriptState: vi.fn(async () => ({ asciiMode: false, zhVariant: 'traditional' as const })),
    };
    const posts: { state: { zhVariant?: string } }[] = [];
    const post = (message: unknown) => posts.push(message as never);

    await postInputViewState(controller as never, post as never);
    expect(posts.at(-1)!.state.zhVariant).toBe('traditional');
    const before = posts.length;

    // A reconnect gets a fresh post function; the answer must survive that.
    const reconnected = (message: unknown) => posts.push(message as never);
    await postInputViewState(controller as never, reconnected as never);
    expect(posts.length).toBeGreaterThan(before);
    expect(posts.slice(before).map(({ state }) => state.zhVariant)).not.toContain(undefined);
  });
});

describe('postRefinedInputViewState', () => {
  it('says nothing when refinement changed nothing', async () => {
    const controller = fakeController();
    const posts: unknown[] = [];
    const post = (message: unknown) => posts.push(message);

    await postRefinedInputViewState(controller as never, post as never);
    const before = posts.length;

    await postRefinedInputViewState(controller as never, post as never);
    expect(posts).toHaveLength(before);
  });
});

describe('postFieldState', () => {
  it('publishes a field-type change without waiting for the slow reads', async () => {
    // Whether the caret is in a password box decides whether the microphone is
    // offered; the refined snapshot behind it waits on schema enumeration and
    // the ascii-mode read, each with a three-second timeout, and a running
    // dictation keeps inserting meanwhile.
    const posts: unknown[] = [];
    const post = (message: unknown) => posts.push(message);

    await postInputViewState(fakeController() as never, post as never);
    const before = posts.length;

    postFieldState(post as never, { numericField: null, passwordField: true });

    expect(posts).toHaveLength(before + 1);
    expect(posts.at(-1)).toMatchObject({ state: { passwordField: true } });
  });

  it('carries the rest of the snapshot over, so the schema label does not flash', async () => {
    const posts: { state: { schemaName: string } }[] = [];
    const post = (message: unknown) => posts.push(message as { state: { schemaName: string } });

    await postInputViewState(fakeController() as never, post as never);
    const label = posts.at(-1)!.state.schemaName;

    postFieldState(post as never, { numericField: 'tel', passwordField: false });
    expect(posts.at(-1)!.state.schemaName).toBe(label);
  });

  it('says nothing to a connection that has never been told a state', () => {
    const posts: unknown[] = [];
    postFieldState(((m: unknown) => posts.push(m)) as never, { numericField: null, passwordField: true });
    expect(posts).toHaveLength(0);
  });
});
