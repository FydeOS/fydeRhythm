// Pointer-press state machine for a single key: tap, long-press (alt bubble),
// and hold-to-repeat. Pure logic with injected timing — the caller owns the
// actual setTimeout and pointer events, which keeps this unit-testable without
// a DOM.

export interface PressConfig {
    // Key opens an alt bubble after longPressMs.
    hasAlts: boolean;
    // Key repeats while held (backspace). Repeating keys activate immediately
    // on pointer-down; normal keys activate on pointer-up.
    repeat: boolean;
    longPressMs: number;
    repeatInitialMs: number;
    repeatIntervalMs: number;
}

// Keyline spec, "Interaction & timing": hold 300ms for the alternates bubble;
// backspace deletes once, waits 400ms, then repeats every 50ms.
export const kDefaultPressTiming = {
    longPressMs: 300,
    repeatInitialMs: 400,
    repeatIntervalMs: 50,
};

export type PressEffect =
    // Perform the key's action once.
    | 'activate'
    // Open the alt-character bubble; subsequent pointer events belong to it.
    | 'openBubble'
    // Visual press feedback ended (pointer up or cancelled).
    | 'release';

export interface PressUpdate {
    effects: PressEffect[];
    // Schedule the next timer this many ms from now; null clears any timer.
    timerMs: number | null;
}

type PressState = 'idle' | 'held' | 'bubbling' | 'repeating';

export class KeyPress {
    private state: PressState = 'idle';

    constructor(private readonly config: PressConfig) { }

    get isBubbling(): boolean {
        return this.state === 'bubbling';
    }

    down(): PressUpdate {
        this.state = this.config.repeat ? 'repeating' : 'held';
        if (this.config.repeat) {
            // First activation fires immediately; holding repeats it.
            return { effects: ['activate'], timerMs: this.config.repeatInitialMs };
        }
        return { effects: [], timerMs: this.config.hasAlts ? this.config.longPressMs : null };
    }

    timer(): PressUpdate {
        switch (this.state) {
            case 'repeating':
                return { effects: ['activate'], timerMs: this.config.repeatIntervalMs };
            case 'held':
                if (this.config.hasAlts) {
                    this.state = 'bubbling';
                    return { effects: ['openBubble'], timerMs: null };
                }
                return { effects: [], timerMs: null };
            default:
                return { effects: [], timerMs: null };
        }
    }

    up(): PressUpdate {
        const prev = this.state;
        this.state = 'idle';
        switch (prev) {
            case 'held':
                return { effects: ['activate', 'release'], timerMs: null };
            case 'repeating':
                // Activations already fired on down/timer.
                return { effects: ['release'], timerMs: null };
            case 'bubbling':
                // The bubble owns selection; the key itself just releases.
                return { effects: ['release'], timerMs: null };
            default:
                return { effects: [], timerMs: null };
        }
    }

    cancel(): PressUpdate {
        this.state = 'idle';
        return { effects: ['release'], timerMs: null };
    }
}
