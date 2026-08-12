// PCM collector for voice input.
//
// A standalone file because AudioWorklet.addModule() only takes a URL; it is
// served from the extension package, which `script-src 'self'` admits. Kept in
// public/ rather than bundled for the same reason theme-init.js is.
//
// The graph runs at 16 kHz (the AudioContext is constructed with that rate, so
// the browser resamples the device's native rate for us). process() is called
// with 128 frames — 8 ms — which is far too small to be a network packet, so
// batches are accumulated to kBatchSamples before being posted.

// 200 ms at 16 kHz. The API doc recommends 100–200 ms packets and states that
// 200 ms is where the bidirectional streaming mode performs best, so batches
// map one-to-one onto audio-only requests with no repacking.
const kBatchSamples = 3200;

class PcmCollector extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buf = new Int16Array(kBatchSamples);
    this.n = 0;
    this.sumSquares = 0;
    // Stopping mid-batch would otherwise discard up to 200 ms of audio — the
    // end of the last word, which is exactly what the user just finished
    // saying. The node is disconnected right after this, so the partial batch
    // has to leave now or never.
    this.port.onmessage = (event) => {
      if (event.data === 'flush') this.flush(true);
    };
  }

  // `final` acknowledges a flush request even when there is nothing left, so
  // the caller can stop waiting instead of timing out on silence.
  flush(final = false) {
    if (this.n === 0) {
      if (final) this.port.postMessage({ final, pcm: new Int16Array(0), rms: 0 });
      return;
    }
    const pcm = this.buf.slice(0, this.n);
    this.port.postMessage(
      { final, pcm, rms: Math.sqrt(this.sumSquares / this.n) },
      [pcm.buffer],
    );
    this.n = 0;
    this.sumSquares = 0;
  }

  process(inputs) {
    const channel = inputs[0]?.[0];
    // No input yet (or the node was disconnected): keep the processor alive.
    if (!channel) return true;

    for (let i = 0; i < channel.length; i++) {
      const sample = Math.max(-1, Math.min(1, channel[i]));
      this.sumSquares += sample * sample;
      // Asymmetric scaling: int16 holds -32768..32767, so the negative and
      // positive halves do not share a factor.
      this.buf[this.n++] = sample < 0 ? sample * 0x8000 : sample * 0x7FFF;

      if (this.n === kBatchSamples) this.flush();
    }

    return true;
  }
}

registerProcessor('pcm-collector', PcmCollector);
