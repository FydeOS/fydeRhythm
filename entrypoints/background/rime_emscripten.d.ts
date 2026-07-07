// TypeScript bindings for emscripten-generated code.  Automatically generated at compile time.
interface WasmModule {
  __ZN6google10LogMessage9LogStreamC2EPcix(_0: number, _1: number, _2: number, _3: number, _4: BigInt): number;
  __ZN6google10LogMessage9LogStreamC1EPcix(_0: number, _1: number, _2: number, _3: BigInt): number;
  _main(_0: number, _1: number): number;
  __ZN6google15NullStreamFatalD2Ev(_0: number, _1: number): number;
  __ZN6google15NullStreamFatalD1Ev(_0: number): number;
  __ZN6google15NullStreamFatalD0Ev(_0: number): void;
}

type EmbindString = ArrayBuffer|Uint8Array|Uint8ClampedArray|Int8Array|string;
export interface ClassHandle {
  isAliasOf(other: ClassHandle): boolean;
  delete(): void;
  deleteLater(): this;
  isDeleted(): boolean;
  // @ts-ignore - If targeting lower than ESNext, this symbol might not exist.
  [Symbol.dispose](): void;
  clone(): this;
}
export interface RimeSession extends ClassHandle {
  initialize(_0: EmbindString, _1: EmbindString, _2: any): void;
  hello(): string;
  processKey(_0: number, _1: number): boolean;
  getContext(): any;
  getStatus(): any;
  getCommit(): any;
  clearComposition(): void;
  getCurrentSchema(): any;
  actionCandidate(_0: number, _1: number, _2: boolean): boolean;
  getOption(_0: EmbindString): boolean;
  setOption(_0: EmbindString, _1: boolean): void;
  getOptionLabel(_0: EmbindString, _1: boolean): string;
  iterateCandidates(_0: number): CandidateIterator | null;
}

export interface CandidateIterator extends ClassHandle {
  advance(): void;
  current(): any;
}

interface EmbindModule {
  rimeSetup(_0: EmbindString): void;
  rimeFinalize(): void;
  rimePerformMaintenance(_0: boolean): void;
  rimeGetSchemaList(): any;
  rimeRebuildPrismForSchema(_0: EmbindString, _1: EmbindString): void;
  rimeBuildDictionaryPack(_0: EmbindString, _1: EmbindString, _2: EmbindString, _3: EmbindString, _4: EmbindString): any;
  rimeCollectValidDictionaryEntries(_0: EmbindString, _1: EmbindString, _2: EmbindString): any;
  RimeSession: {
    new(): RimeSession;
  };
  CandidateIterator: {};
}

export type MainModule = WasmModule & EmbindModule;
export default function MainModuleFactory (options?: unknown): Promise<MainModule>;
