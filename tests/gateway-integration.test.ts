// 网关联通集成测试：用真实 transport 层连 one-api 网关（其背后是真实火山上游）。
// 需要 GATEWAY_WS / GATEWAY_TOKEN / SPEECH_WAV 环境变量，缺省时整组跳过（CI 无感）。
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { openTransport, type SocketLike } from '../entrypoints/inputview/voice/transport';

const GATEWAY = process.env.GATEWAY_WS;
const TOKEN = process.env.GATEWAY_TOKEN;
const WAV = process.env.SPEECH_WAV;

describe.skipIf(!GATEWAY || !TOKEN || !WAV)('gateway integration', () => {
  it('streams real speech through the gateway and receives the final result', async () => {
    const wav = readFileSync(WAV!);
    const data = wav.subarray(wav.indexOf('data') + 8);
    const pcm = new Int16Array(data.buffer, data.byteOffset, Math.floor(data.byteLength / 2));

    const results: { text: string; last: boolean }[] = [];
    let done!: () => void;
    let fail!: (e: unknown) => void;
    const finished = new Promise<void>((res, rej) => { done = res; fail = rej; });

    const transport = openTransport({
      uid: 'gateway-integration-test',
      callbacks: {
        onReady: () => {},
        onResult: (result, last) => {
          if (result?.text) results.push({ text: result.text, last });
          if (last) done();
        },
        onError: (reason, detail) => fail(new Error(`${reason}: ${detail}`)),
        onClosed: () => {},
      },
      // 接入网关时 transport 唯一要变的点：网关地址 + 子协议携带网关令牌
      // （替代现在的 kEndpoint 直连 + declarativeNetRequest 注入火山头）
      connect: () =>
        new WebSocket(GATEWAY!, ['asr', `api-key.${TOKEN}`]) as unknown as SocketLike,
    });

    const chunk = 3200; // 200ms @ 16k mono s16，规范建议的分包大小
    for (let at = 0; at < pcm.length; at += chunk) {
      await transport.sendAudio(pcm.subarray(at, at + chunk), at + chunk >= pcm.length);
      await new Promise(r => setTimeout(r, 50));
    }
    await finished;
    transport.close();

    const final = results.at(-1)!;
    expect(final.last).toBe(true);
    expect(final.text.length).toBeGreaterThan(0);
    // eslint-disable-next-line no-console
    console.log('gateway integration FINAL TEXT:', final.text);
  }, 60_000);
});
