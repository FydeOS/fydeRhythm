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
        reject(error instanceof Error ? error : new Error(String(error)));
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
    alphabet: controller?.schemaAlphabet ?? '',
    numericField: numericFieldFor(controller?.context?.type),
    passwordField: isPasswordField(controller?.context?.type),
  };
}

export function numericFieldFor(type: string | undefined): NumericFieldKind | null {
  return type === 'number' || type === 'tel' ? type : null;
}

export function isPasswordField(type: string | undefined): boolean {
  return type === 'password';
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
    // Re-read: the engine may have finished loading since the fast pass.
    alphabet: controller?.schemaAlphabet ?? base.alphabet,
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

/** Remembers the last state each connection was told about, so a security
 *  change can be pushed on top of it without waiting for the slow reads. */
const lastPosted = new WeakMap<(message: BackgroundToInputView) => void, InputViewState>();

/** Publishes a field-type change on the spot.
 *
 *  The refined post behind it takes as long as schema enumeration and the
 *  ascii-mode read allow — up to three seconds each. Whether the caret sits in
 *  a password box decides whether the microphone is offered, and a session
 *  already running keeps inserting text meanwhile, so that flag cannot wait for
 *  a schema label. Everything else in the snapshot is carried over unchanged,
 *  which is what keeps the label from flashing back to a raw schema id. */
export function postFieldState(
  post: (message: BackgroundToInputView) => void,
  field: { numericField: NumericFieldKind | null; passwordField: boolean },
): void {
  const previous = lastPosted.get(post);
  if (!previous) return;
  const next: InputViewState = { ...previous, ...field };
  lastPosted.set(post, next);
  post({ kind: 'state', state: next });
}

export async function postInputViewState(
  controller: InputController | undefined,
  post: (message: BackgroundToInputView) => void,
): Promise<void> {
  const requestId = beginRequest(post);
  const fast = await buildFastInputViewState(controller);
  if (!isCurrentRequest(post, requestId)) return;
  lastPosted.set(post, fast);
  post({ kind: 'state', state: fast });
  const refined = await refineInputViewState(controller, fast);
  if (isCurrentRequest(post, requestId)
    && JSON.stringify(refined) !== JSON.stringify(fast)) {
    lastPosted.set(post, refined);
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
    lastPosted.set(post, refined);
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
