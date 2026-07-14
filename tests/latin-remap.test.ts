import { describe, expect, it } from 'vitest';
import { remapPhysicalKey, strokeForChar } from '../lib/latin-remap';

describe('remapPhysicalKey (physical keyboard follows the chosen layout)', () => {
    it('maps positions for colemak and dvorak', () => {
        expect(remapPhysicalKey('colemak', 'KeyS', false)).toBe('r');
        expect(remapPhysicalKey('colemak', 'Semicolon', false)).toBe('o');
        expect(remapPhysicalKey('dvorak', 'KeyS', false)).toBe('o');
        expect(remapPhysicalKey('dvorak', 'KeyQ', false)).toBe("'");
        expect(remapPhysicalKey('dvorak', 'Comma', false)).toBe('w');
    });

    it('applies shift to the OUTPUT char (letters and punctuation)', () => {
        expect(remapPhysicalKey('colemak', 'KeyS', true)).toBe('R');
        expect(remapPhysicalKey('dvorak', 'KeyQ', true)).toBe('"');
        expect(remapPhysicalKey('dvorak', 'KeyZ', true)).toBe(':');
    });

    it('combines Caps Lock with Shift for letters but not punctuation', () => {
        expect(remapPhysicalKey('dvorak', 'KeyS', false, true)).toBe('O');
        expect(remapPhysicalKey('dvorak', 'KeyS', true, true)).toBe('o');
        expect(remapPhysicalKey('dvorak', 'KeyQ', false, true)).toBe("'");
        expect(remapPhysicalKey('dvorak', 'KeyQ', true, true)).toBe('"');
    });

    it('returns null for qwerty and for keys the layouts do not move', () => {
        expect(remapPhysicalKey('qwerty', 'KeyS', false)).toBeNull();
        expect(remapPhysicalKey('colemak', 'Digit2', false)).toBeNull();
        expect(remapPhysicalKey('dvorak', 'Space', false)).toBeNull();
    });
});

describe('strokeForChar (inverse: VK strokes survive the remap)', () => {
    it('round-trips through remapPhysicalKey', () => {
        for (const layout of ['colemak', 'dvorak'] as const) {
            for (const char of ['o', 'R', "'", '"', ':', 'z']) {
                const stroke = strokeForChar(layout, char);
                expect(stroke, `${layout}/${char} must be reachable`).not.toBeNull();
                expect(remapPhysicalKey(layout, stroke!.code, stroke!.shiftKey) ?? char).toBe(char);
            }
        }
    });

    it('returns null for chars off the remapped keys (digits fall back to US codes)', () => {
        expect(strokeForChar('dvorak', '5')).toBeNull();
    });
});
