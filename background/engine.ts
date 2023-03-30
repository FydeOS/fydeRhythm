import CreateRimeWasm from "./rime_emscripten"
import { getFs } from "../utils"
import { Mutex } from 'async-mutex';
import { openDB, deleteDB, unwrap } from "idb";

export interface RimeContext {
    composition: {
        length: number;
        cursorPosition: number;
        selectionStart: number;
        selectionEnd: number;
        preedit: string;
    };

    menu: {
        pageSize: number;
        pageNumber: number;
        isLastPage: boolean;
        highlightedCandidateIndex: number;
        candidates: Array<{
            text: string;
            comment: string;
        }>
    };

    selectKeys: string;
    commitTextPreview: string;
    selectLabels: string[];
}

export interface RimeCommit {
    text: string;
}

export interface RimeStatus {
    schemaId: string;
    schemaName: string;
    isDisabled: boolean;
    isComposing: boolean;
    isAsciiMode: boolean;
    isFullShape: boolean;
    isSimplified: boolean;
    isTraditional: boolean;
    isAsciiPunct: boolean;
}

export class RimeSession {
    engine: RimeEngine;
    wasmSession: any;

    constructor(session: any, engine: RimeEngine) {
        this.wasmSession = session;
        this.engine = engine;
    }

    async processKey(keyId: number, mask: number): Promise<boolean> {
        return await this.engine.mutex.runExclusive(async () => {
            return await this.wasmSession.processKey(keyId, mask);
        });
    }

    async getContext(): Promise<RimeContext> {
        return await this.engine.mutex.runExclusive(async () => {
            return await this.wasmSession.getContext();
        });
    }

    async getCommit(): Promise<RimeCommit> {
        return await this.engine.mutex.runExclusive(async () => {
            return await this.wasmSession.getCommit();
        });
    }

    async getStatus(): Promise<RimeStatus> {
        return await this.engine.mutex.runExclusive(async () => {
            return await this.wasmSession.getStatus();
        });
    }

    async clearComposition(): Promise<void> {
        return await this.engine.mutex.runExclusive(async () => {
            return await this.wasmSession.clearComposition();
        });
    }
    
    destroy() {
        this.wasmSession.delete();
    }
}

export class RimeEngine {
    wasmObject: any;
    mutex: Mutex;
    initialized: boolean;
    constructor() {
        this.mutex = new Mutex();
        this.initialized = false;
    }

    async initialize() {
        await this.mutex.runExclusive(async () => {
            if (!this.initialized) {
                const fs = await getFs();
                this.wasmObject = await CreateRimeWasm({
                    locateFile: (path, dir) => {
                        return '/assets/' + path;
                    },
                    fsc: fs,
                    idb: { openDB, deleteDB }
                })
                await this.wasmObject.rimeSetup();
                this.initialized = true;
            }
        })
    }

    async createSession(): Promise<RimeSession> {
        return await this.mutex.runExclusive(async () => {
            console.log("Creating session")
            const newSession = new this.wasmObject.RimeSession();
            console.log("Initializing session");
            await newSession.initialize();
            return new RimeSession(newSession, this);
        });
    }

    async performMaintenance(): Promise<void> {
        return await this.mutex.runExclusive(async () => {
            await this.wasmObject.rimePerformMaintenance(true);
        });
    }

    async destroy() {
        this.wasmObject?.rimeFinalize();
        this.wasmObject = null;
    }
}
