export type ShiftMode = 'off' | 'shift' | 'caps';

export interface ShiftInteractionState {
    mode: ShiftMode;
    lastTap: number;
}

export const kShiftDoubleTapMs = 350;

export function tapShift(state: ShiftInteractionState, now: number): ShiftInteractionState {
    const doubleTap = state.lastTap > 0 && now - state.lastTap < kShiftDoubleTapMs;
    const mode = state.mode === 'caps'
        ? 'off'
        : doubleTap
            ? 'caps'
            : state.mode === 'shift' ? 'off' : 'shift';
    return { mode, lastTap: now };
}

// Typing consumes one-shot Shift and always ends the double-tap gesture. Caps
// Lock itself remains active until the user explicitly turns it off.
export function typeWithShift(state: ShiftInteractionState): ShiftInteractionState {
    return {
        mode: state.mode === 'shift' ? 'off' : state.mode,
        lastTap: 0,
    };
}
