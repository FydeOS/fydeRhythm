import React from 'react';

import type { InputViewCandidate } from '@/lib/shared-types';

import { t } from '../i18n';
import { CandidateChip } from './CandidateBar';
import { ExpandLessIcon } from './icons';

export interface ExpandedPanelProps {
  candidates: InputViewCandidate[];
  onSelect: (index: number) => void;
  onDeleteRequest: (candidate: InputViewCandidate, anchor: DOMRect) => void;
  onLoadMore: () => void;
  onCollapse: () => void;
}

// Multi-row grid of candidates covering the key area (opened from the bar).
export function ExpandedPanel(props: ExpandedPanelProps) {
  return (
    <div className="kb-expanded">
      <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
        <div
          className="grid"
          onScroll={(e) => {
            const el = e.currentTarget;
            if (el.scrollTop + el.clientHeight * 2 >= el.scrollHeight) {
              props.onLoadMore();
            }
          }}
        >
          {props.candidates.map(c => (
            <CandidateChip
              key={c.index}
              candidate={c}
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
