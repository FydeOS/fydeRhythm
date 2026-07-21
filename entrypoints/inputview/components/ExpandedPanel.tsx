import React, { useCallback, useEffect, useRef } from 'react';

import type { InputViewCandidate } from '@/lib/shared-types';

import { kMaxBatch, kMinBatch } from '../candidate-window';
import { t } from '../i18n';
import { CandidateChip } from './CandidateBar';
import { ExpandLessIcon } from './icons';

export interface ExpandedPanelProps {
  candidates: InputViewCandidate[];
  highlightedIndex: number;
  onSelect: (index: number) => void;
  onDeleteRequest: (candidate: InputViewCandidate, anchor: DOMRect) => void;
  onLoadMore: (count?: number) => void;
  onCollapse: () => void;
}

// Multi-row grid of candidates covering the key area (opened from the bar).
export function ExpandedPanel(props: ExpandedPanelProps) {
  const gridRef = useRef<HTMLDivElement>(null);
  const onLoadMoreRef = useRef(props.onLoadMore); // mirror; see CandidateBar

  const maybeLoadMore = useCallback(() => {
    const el = gridRef.current;
    if (!el || el.scrollTop + el.clientHeight * 2 < el.scrollHeight) return;
    // ~2 viewports of rows, measured off the rendered grid.
    const chips = Array.from(el.children) as HTMLElement[];
    const first = chips[0];
    const below = first ? chips.find(c => c.offsetTop > first.offsetTop) : undefined;
    const rowHeight = first ? (below ? below.offsetTop - first.offsetTop : first.offsetHeight) : 0;
    const perRow = first ? chips.filter(c => c.offsetTop === first.offsetTop).length : 0;
    const count = rowHeight > 0 && perRow > 0
      ? Math.min(kMaxBatch, Math.max(kMinBatch, perRow * Math.ceil(el.clientHeight * 2 / rowHeight)))
      : undefined;
    onLoadMoreRef.current(count);
  }, []);

  // Top up on open: the grid inherits only the strip's load, and a tall panel
  // may not overflow, so the scroll handler alone would never fire.
  useEffect(() => {
    onLoadMoreRef.current = props.onLoadMore;
    maybeLoadMore();
  });

  return (
    <div className="kb-expanded">
      <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
        <div className="grid" ref={gridRef} onScroll={maybeLoadMore}>
          {props.candidates.map(c => (
            <CandidateChip
              key={c.index}
              candidate={c}
              highlighted={c.index === props.highlightedIndex}
              onSelect={props.onSelect}
              onDeleteRequest={props.onDeleteRequest}
            />
          ))}
        </div>
        <div className="side">
          <button className="icon-btn" aria-label={t('vk_collapse_candidates')} onClick={props.onCollapse}><ExpandLessIcon /></button>
        </div>
      </div>
    </div>
  );
}
