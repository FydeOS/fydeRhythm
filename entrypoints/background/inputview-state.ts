import {
  type BackgroundToInputView,
  type InputViewState,
  type NumericFieldKind,
} from '@/lib/shared-types';
import {
  guessScriptForSchema,
  type ImeSettings,
  migrateLayoutSettings,
  resolveKeyboardLayout,
  resolveLayoutForSchema,
} from '@/lib/utils';

import type { InputController } from './controller';
import { listEnabledInstalledSchemas } from './schemas';

function withTimeout<T>(promise: Promise<T>, milliseconds: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), milliseconds);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

async function readAsciiMode(controller: InputController | undefined): Promise<boolean> {
  try {
    const read = controller?.getAsciiMode();
    if (!read) return false;
    return (await withTimeout(read, 3000)) ?? false;
  }
  catch {
    return false;
  }
}

export async function readInputViewSettings(
  controller: InputController | undefined,
): Promise<ImeSettings | undefined> {
  let settings: ImeSettings | undefined;
  try {
    const stored = await chrome.storage.sync.get(['settings']) as { settings?: ImeSettings };
    settings = stored.settings ?? controller?.activeSettings;
  }
  catch {
    settings = controller?.activeSettings;
  }
  return settings && migrateLayoutSettings(settings);
}

export async function buildFastInputViewState(
  controller: InputController | undefined,
): Promise<InputViewState> {
  const settings = await readInputViewSettings(controller);
  const schemaId = settings?.schema ?? '';
  const layout = resolveLayoutForSchema(settings, schemaId);
  return {
    asciiMode: false,
    layout,
    latinLayout: resolveKeyboardLayout(settings),
    script: guessScriptForSchema(schemaId, undefined, layout),
    schemaId,
    schemaName: schemaId,
    numericField: numericFieldFor(controller?.context?.type),
  };
}

export function numericFieldFor(type: string | undefined): NumericFieldKind | null {
  return type === 'number' || type === 'tel' ? type : null;
}

export async function refineInputViewState(
  controller: InputController | undefined,
  base: InputViewState,
): Promise<InputViewState> {
  let schemaName = base.schemaName;
  try {
    const settings = await readInputViewSettings(controller);
    const schemas = await withTimeout(
      listEnabledInstalledSchemas(base.schemaId, settings?.enabledSchemas),
      3000,
    );
    schemaName = schemas.find(schema => schema.id === base.schemaId)?.label ?? schemaName;
  }
  catch {
    // The Schema id remains a usable label while the VFS is unavailable.
  }
  return {
    ...base,
    asciiMode: await readAsciiMode(controller),
    schemaName,
    script: guessScriptForSchema(base.schemaId, schemaName, base.layout),
  };
}

const requestIds = new WeakMap<(message: BackgroundToInputView) => void, number>();

function beginRequest(post: (message: BackgroundToInputView) => void): number {
  const requestId = (requestIds.get(post) ?? 0) + 1;
  requestIds.set(post, requestId);
  return requestId;
}

function isCurrentRequest(post: (message: BackgroundToInputView) => void, requestId: number): boolean {
  return requestIds.get(post) === requestId;
}

export async function postInputViewState(
  controller: InputController | undefined,
  post: (message: BackgroundToInputView) => void,
): Promise<void> {
  const requestId = beginRequest(post);
  const fast = await buildFastInputViewState(controller);
  if (!isCurrentRequest(post, requestId)) return;
  post({ kind: 'state', state: fast });
  const refined = await refineInputViewState(controller, fast);
  if (isCurrentRequest(post, requestId)
    && JSON.stringify(refined) !== JSON.stringify(fast)) {
    post({ kind: 'state', state: refined });
  }
}

export async function postRefinedInputViewState(
  controller: InputController | undefined,
  post: (message: BackgroundToInputView) => void,
): Promise<void> {
  const requestId = beginRequest(post);
  const fast = await buildFastInputViewState(controller);
  const refined = await refineInputViewState(controller, fast);
  if (isCurrentRequest(post, requestId)) {
    post({ kind: 'state', state: refined });
  }
}

export function updateVisibleInputViewConnections(
  connections: Set<symbol>,
  connection: symbol,
  visible: boolean,
): boolean | null {
  const wasVisible = connections.size > 0;
  if (visible) connections.add(connection);
  else connections.delete(connection);
  const isVisible = connections.size > 0;
  return wasVisible === isVisible ? null : isVisible;
}

export function settleKeyEventResult(
  result: boolean | Promise<boolean>,
  requestId: string,
  onError: (error: unknown) => void,
): boolean | undefined {
  if (typeof result === 'boolean') return result;
  result.then(
    handled => chrome.input.ime.keyEventHandled(requestId, handled),
    (error) => {
      onError(error);
      chrome.input.ime.keyEventHandled(requestId, false);
    },
  );
  return undefined;
}
