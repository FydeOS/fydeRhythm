import { kFrameUnits } from './layouts/frame';
import { kMetrics } from './metrics';

export type KeyboardMode = 'docked' | 'floating' | 'onehand';
export type OneHandSide = 'left' | 'right';

export const kFloatingHandleHeight = kMetrics.handleHeight;
export const kFloatingResizeWidth = kMetrics.resizeWidth;
export const kFloatingMargin = 8;
export const kFloatingScaleMin = 0.55;
export const kFloatingScaleMax = 0.85;
export const kFloatingDefaultScale = 0.6;

function minFloatingHeight(rows: number): number {
    const keyPitch = kMetrics.minKeyHeight + 2 * kMetrics.cellPad;
    return rows * keyPitch + kMetrics.handleHeight + kMetrics.barMin + kMetrics.edge;
}

const kMinBoardWidth = 320;
const kOneHandWidthFraction = 0.36;
const kOneHandWidthMax = 420;
export const kOneHandRows = 4;
const kOneHandRowAspect = 1.4;
export const kOneHandBarHeight = kMetrics.onehand.controlBar;

export interface ScreenSize {
    width: number;
    height: number;
}

export interface ContainerGeometry {
    floating: boolean;
    width: number;
    height: number;
    draggable: boolean;
    left?: number;
    top?: number;
}

export interface Placement {
    mode: KeyboardMode;
    scale: number;
    side: OneHandSide;
    left?: number;
    top?: number;
}

export const kDefaultPlacement: Placement = {
    mode: 'docked',
    scale: kFloatingDefaultScale,
    side: 'right',
};

export const kPlacementPrefKey = 'inputViewFloating';

export function dockedHeight(screen: ScreenSize): number {
    return Math.round(Math.min(
        Math.max(372, screen.height * 0.42),
        screen.height * 0.52,
        Math.max(280, screen.width * 0.42),
        440,
    ));
}

export function geometryFor(
    placement: Placement,
    screen: ScreenSize,
    rows: number = kOneHandRows,
): ContainerGeometry {
    if (placement.mode === 'docked') {
        return {
            floating: false,
            draggable: false,
            width: screen.width,
            height: dockedHeight(screen),
        };
    }
    if (placement.mode === 'floating') {
        const scale = Math.min(1, Math.max(placement.scale, kMinBoardWidth / screen.width));
        return {
            floating: true,
            draggable: true,
            width: Math.round(screen.width * scale),
            height: Math.max(Math.round(dockedHeight(screen) * scale), minFloatingHeight(rows)),
            left: placement.left,
            top: placement.top,
        };
    }
    const width = Math.round(
        Math.min(kOneHandWidthMax, Math.max(kMinBoardWidth, screen.width * kOneHandWidthFraction)),
    );
    const oneHandMetrics = kMetrics.onehand;
    const rowHeight = Math.round(
        ((width - 2 * oneHandMetrics.edge) / kFrameUnits) * kOneHandRowAspect,
    );
    const height = rowHeight * rows
        + oneHandMetrics.bar
        + oneHandMetrics.controlBar
        + 2 * oneHandMetrics.edge;
    return {
        floating: true,
        draggable: false,
        width,
        height,
        left: placement.side === 'left'
            ? kFloatingMargin
            : Math.max(0, screen.width - width - kFloatingMargin),
        top: Math.max(0, screen.height - height - kFloatingMargin),
    };
}

export function normalizePlacement(raw: unknown): Placement {
    if (raw === true) return { ...kDefaultPlacement, mode: 'floating' };
    if (!raw || typeof raw !== 'object') return kDefaultPlacement;
    const value = raw as Record<string, unknown>;
    const mode: KeyboardMode = value.mode === 'floating'
        || value.mode === 'onehand'
        || value.mode === 'docked'
        ? value.mode
        : value.floating === true ? 'floating' : 'docked';
    const scale = typeof value.scale === 'number' && Number.isFinite(value.scale)
        ? Math.min(kFloatingScaleMax, Math.max(kFloatingScaleMin, value.scale))
        : kFloatingDefaultScale;
    const coordinate = (candidate: unknown) =>
        typeof candidate === 'number' && Number.isFinite(candidate) ? candidate : undefined;
    return {
        mode,
        scale,
        side: value.side === 'left' ? 'left' : 'right',
        left: coordinate(value.left),
        top: coordinate(value.top),
    };
}
