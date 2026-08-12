// Microphone capture: raw 16 kHz mono PCM, batched for the network.
//
// Every constant here was measured on device by the voice probe, not chosen:
// the microphone reports 48 kHz, the graph runs at 16 kHz, and the browser
// resamples in between — so no resampler is written here.

import {
  advance,
  type CapturePolicy,
  type CaptureProgress,
  type CaptureStop,
  kDefaultPolicy,
  kInitialProgress,
} from './capture-policy';
import { micPermission } from './permission';

/** Batch size the worklet posts: 3200 samples at 16 kHz. Matches the packet
 *  size the API doc calls optimal for bidirectional streaming. */
const kBatchMs = 200;
const kSampleRate = 16000;
const kWorkletUrl = '/voice-pcm-worklet.js';
const kProcessor = 'pcm-collector';

/** Why capture ended. 'caller' is stop() — the panel closing, the keyboard
 *  being dismissed, the user tapping stop. */
export type CaptureEnd = Exclude<CaptureStop, null> | 'caller' | 'error';

export interface CaptureCallbacks {
  /** One ~100 ms batch of little-endian int16 PCM, ready for the socket. */
  onBatch: (pcm: Int16Array) => void;
  /** Batch loudness, for the panel's level meter. */
  onLevel: (rms: number) => void;
  onEnd: (reason: CaptureEnd, error?: Error) => void;
  /** Polled between setup's awaits. Once it answers true the microphone is not
   *  opened — or, if getUserMedia already resolved, is released at once — and
   *  startCapture rejects. Without it a caller that gave up mid-setup cannot
   *  act until the handle returns, which is after the light is already on. */
  cancelled?: () => boolean;
}

export interface CaptureHandle {
  stop: () => Promise<void>;
}

/** Thrown instead of calling getUserMedia when the grant is missing, so the
 *  panel can route to the options page rather than render a generic failure.
 *  See permission.ts for why a speculative call is the wrong move. */
export class MicPermissionError extends Error {
  constructor(readonly state: string) {
    super(`microphone permission is "${state}"`);
    this.name = 'MicPermissionError';
  }
}

export async function startCapture(
  callbacks: CaptureCallbacks,
  policy: CapturePolicy = kDefaultPolicy,
): Promise<CaptureHandle> {
  const permission = await micPermission();
  if (permission !== 'granted' && permission !== 'unknown') {
    throw new MicPermissionError(permission);
  }
  if (callbacks.cancelled?.()) throw new Error('capture cancelled');

  // The worklet loads BEFORE the microphone opens. Reversed, a caller that
  // gives up while addModule is still resolving has no handle to stop with —
  // and the stream is already live, so the microphone stays on with nothing
  // holding it.
  const context = new AudioContext({ sampleRate: kSampleRate });
  try {
    await context.audioWorklet.addModule(kWorkletUrl);
  }
  catch (error) {
    await context.close();
    throw error;
  }
  if (callbacks.cancelled?.()) {
    await context.close();
    throw new Error('capture cancelled');
  }

  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
  }).catch(async (error: unknown) => {
    await context.close();
    // An IME window cannot show a permission bubble, so a prompt raised here is
    // dismissed unseen. Reporting it as a permission problem is what routes the
    // user to the page that CAN ask — anything else leaves a button that does
    // nothing with no way to find out why.
    if (error instanceof DOMException && error.name === 'NotAllowedError') {
      throw new MicPermissionError('prompt');
    }
    throw error;
  });
  try {
    // A cancellation during getUserMedia cannot be prevented, only made right:
    // the microphone just opened for nobody, so release it before anything else.
    if (callbacks.cancelled?.()) throw new Error('capture cancelled');

    const node = new AudioWorkletNode(context, kProcessor);
    const source = context.createMediaStreamSource(stream);
    // Source → worklet and no further. Connecting the worklet to the context
    // destination would play the microphone back through the speakers; the
    // graph is pulled by the media stream source without it, which the device
    // probe confirmed by receiving batches from exactly this wiring.
    source.connect(node);

    let progress: CaptureProgress = kInitialProgress;
    let ended = false;

    // The batch-counted ceiling stops advancing when the worklet stalls, so the
    // same number also bounds wall time: it limits how long the microphone may
    // be open, not how much audio is collected.
    const deadline = setTimeout(() => end('timeout'), policy.maxSessionMs);

    // The worklet only posts a full batch, so up to 200 ms — the end of the
    // last word — is still sitting in its buffer when capture stops. Ask for it
    // and wait: port messages are tasks, so unhooking first would lose it, and
    // the ordinary handler drops anything arriving after `ended`.
    const flushTail = () => new Promise<void>((resolve) => {
      const finish = () => {
        clearTimeout(timer);
        node.port.onmessage = null;
        resolve();
      };
      const timer = setTimeout(finish, 200);
      node.port.onmessage = (event: MessageEvent<{ pcm: Int16Array; final?: boolean }>) => {
        if (event.data.pcm.length) callbacks.onBatch(event.data.pcm);
        // Only the acknowledgement ends the wait. A full batch can complete in
        // the gap between asking and being answered, and treating that as the
        // answer would unhook before the tail — losing exactly the audio this
        // exists to save.
        if (event.data.final) finish();
      };
      node.port.postMessage('flush');
    });

    const teardown = async () => {
      clearTimeout(deadline);
      await flushTail();
      source.disconnect();
      node.disconnect();
      // Releasing the tracks is what turns off the system recording indicator.
      stream.getTracks().forEach(track => track.stop());
      await context.close();
    };

    const end = (reason: CaptureEnd, error?: Error) => {
      if (ended) return;
      ended = true;
      void teardown().finally(() => callbacks.onEnd(reason, error));
    };

    // A processor that throws is gone: no further batches, so neither the
    // silence rule nor the ceiling can ever fire.
    node.onprocessorerror = () => end('error', new Error('audio worklet failed'));

    node.port.onmessage = (event: MessageEvent<{ pcm: Int16Array; rms: number }>) => {
      if (ended) return;
      const { pcm, rms } = event.data;

      callbacks.onLevel(rms);
      callbacks.onBatch(pcm);

      const result = advance(progress, { rms, durationMs: kBatchMs }, policy);
      progress = result.progress;
      if (result.stop) end(result.stop);
    };

    return { stop: async () => { end('caller'); } };
  }
  catch (error) {
    stream.getTracks().forEach(track => track.stop());
    await context.close();
    throw error;
  }
}
