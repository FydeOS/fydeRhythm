// The numbers that BOTH the layout engine and the stylesheet need.
//
// geometryFor() computes the OS window the keyboard asks for; the browser lays
// out the card inside that window from md3.css. If the two disagree by a pixel
// the card no longer fits its window — and nothing short of rendering it would
// say so. They used to be written twice, kept in step by a comment, and every
// change to a bar height meant remembering to edit both.
//
// So they live here once. TypeScript is the source; applyMetrics() publishes
// them to CSS as custom properties before the first paint, and md3.css declares
// only WHERE each one applies, never what it is.
//
// Purely visual values (colors, radii, the type scale, shadows) are NOT here —
// they are CSS's business alone and nothing in TypeScript reasons about them.

export interface Metrics {
    /** Board padding: left, right and bottom of the card. */
    edge: number;
    /** Padding inside each key's cell; the visible gap between keys is 2x this. */
    cellPad: number;
    /** Candidate bar: the floor and ceiling of its card-relative height. */
    barMin: number;
    barMax: number;
    /** Floating card's top strip, and the resize button parked at its right end.
     *  The OS drag region is the strip MINUS the button — a draggable region
     *  swallows the pointer, so anything under it could never be tapped. */
    handleHeight: number;
    resizeWidth: number;
    /** Smallest key a finger can reliably hit. The floating card's height floor
     *  is derived from it, and the audit fails any key that lands under it. */
    minKeyHeight: number;
    /** The one-hand card is tighter, and its bars are fixed rather than
     *  card-relative — it is too small for a percentage to behave. */
    onehand: {
        edge: number;
        cellPad: number;
        /** Candidate bar. */
        bar: number;
        /** Side-swap control bar. */
        controlBar: number;
    };
}

export const kMetrics: Metrics = {
    edge: 5,
    cellPad: 3.5,
    barMin: 34,
    barMax: 52,
    handleHeight: 22,
    resizeWidth: 56,
    minKeyHeight: 32,
    onehand: {
        edge: 4,
        cellPad: 2.5,
        bar: 36,
        controlBar: 34,
    },
};

// Publish the metrics to CSS. Called before the first render, so the keys are
// laid out from these on the very first paint.
export function applyMetrics(root: HTMLElement, m: Metrics = kMetrics): void {
    const set = (name: string, value: number) => root.style.setProperty(name, `${value}px`);
    set('--kb-edge', m.edge);
    set('--kb-cell-pad', m.cellPad);
    set('--kb-bar-min', m.barMin);
    set('--kb-bar-max', m.barMax);
    set('--kb-handle-height', m.handleHeight);
    set('--kb-resize-width', m.resizeWidth);
    set('--kb-onehand-edge', m.onehand.edge);
    set('--kb-onehand-cell-pad', m.onehand.cellPad);
    set('--kb-onehand-bar', m.onehand.bar);
    set('--kb-onehand-control-bar', m.onehand.controlBar);
}
