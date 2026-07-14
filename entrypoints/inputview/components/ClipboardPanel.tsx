import React, { useEffect, useState } from 'react';
import { clipboardPreview, type ClipboardHistoryItem, type ClipboardReadResult } from '../clipboard';
import { t } from '../i18n';
import { ClipboardIcon, ClipboardOffIcon, CloseIcon, DeleteIcon, ErrorIcon, RefreshIcon } from './icons';

type ClipboardPanelState = ClipboardReadResult | { status: 'loading' };
type ClipboardStatus = Exclude<ClipboardPanelState['status'], 'items'>;

const kStatusMessages: Record<ClipboardStatus, string> = {
    loading: 'vk_clipboard_loading',
    empty: 'vk_clipboard_empty',
    unavailable: 'vk_clipboard_unavailable',
    error: 'vk_clipboard_error',
};

export function ClipboardPanel({ initialRequest, onRead, onPaste, onDelete, onHistoryChange, onClose }: {
    initialRequest: Promise<ClipboardReadResult>;
    onRead: () => Promise<ClipboardReadResult>;
    onPaste: (item: ClipboardHistoryItem) => Promise<boolean>;
    onDelete: (itemId: string) => Promise<boolean>;
    onHistoryChange: (refresh: () => void) => () => void;
    onClose: () => void;
}) {
    const [request, setRequest] = useState(initialRequest);
    const [state, setState] = useState<ClipboardPanelState>({ status: 'loading' });
    const [deletingIds, setDeletingIds] = useState<ReadonlySet<string>>(() => new Set());
    const [actionError, setActionError] = useState(false);

    useEffect(() => {
        let current = true;
        void request.then((result) => {
            if (current) setState(result);
        }).catch(() => {
            if (current) setState({ status: 'error' });
        });
        return () => { current = false; };
    }, [request]);

    useEffect(() => {
        const closeOnEscape = (event: KeyboardEvent) => {
            if (event.key === 'Escape') onClose();
        };
        window.addEventListener('keydown', closeOnEscape);
        return () => window.removeEventListener('keydown', closeOnEscape);
    }, [onClose]);

    useEffect(() => onHistoryChange(() => {
        void onRead().then((result) => {
            setState(result);
            setActionError(false);
        });
    }), [onHistoryChange, onRead]);

    const retry = () => {
        setState({ status: 'loading' });
        setRequest(onRead());
    };

    const remove = async (itemId: string) => {
        setActionError(false);
        setDeletingIds((ids) => new Set(ids).add(itemId));
        const deleted = await onDelete(itemId);
        setDeletingIds((ids) => {
            const next = new Set(ids);
            next.delete(itemId);
            return next;
        });
        if (!deleted) {
            setActionError(true);
            return;
        }
        const refreshed = await onRead();
        if (refreshed.status === 'error' ||
            (refreshed.status === 'items' && refreshed.items.some(({ id }) => id === itemId))) {
            setActionError(true);
            return;
        }
        setState(refreshed);
    };

    const status = state.status === 'items' ? null : state.status;
    const StatusIcon = status === 'empty' ? ClipboardOffIcon : ErrorIcon;

    return (
        <section
            id="kb-clipboard-panel"
            className={`kb-clipboard-panel ${state.status}`}
            aria-label={t('vk_clipboard_current')}
            aria-busy={state.status === 'loading'}
        >
            <header className="kb-clipboard-header">
                <div className="kb-clipboard-heading">
                    <h2>{t('vk_clipboard')}</h2>
                    {actionError && <span role="status">{t('vk_clipboard_delete_error')}</span>}
                </div>
                <button className="kb-clipboard-close" aria-label={t('vk_clipboard_close')} onClick={onClose}>
                    <CloseIcon />
                </button>
            </header>

            {state.status === 'items' ? (
                <div className="kb-clipboard-grid">
                    {state.items.map((item) => (
                        <div className="kb-clipboard-tile" key={item.id}>
                            <button
                                className="kb-clipboard-tile-paste"
                                aria-label={t('vk_clipboard_paste')}
                                onClick={() => void onPaste(item).then((pasted) => {
                                    if (pasted) onClose();
                                })}
                            >
                                {item.imageData ? (
                                    <img className="kb-clipboard-image" src={item.imageData} alt="" />
                                ) : (
                                    <span className="kb-clipboard-preview">{clipboardPreview(item.textData ?? '')}</span>
                                )}
                                <span className="kb-clipboard-tile-footer" aria-hidden="true">
                                    <ClipboardIcon />
                                    <span>{t('vk_clipboard_paste_short')}</span>
                                </span>
                            </button>
                            {state.canDelete && (
                                <button
                                    className="kb-clipboard-delete"
                                    aria-label={t('vk_clipboard_delete')}
                                    disabled={deletingIds.has(item.id)}
                                    onClick={() => void remove(item.id)}
                                >
                                    <DeleteIcon />
                                </button>
                            )}
                        </div>
                    ))}
                </div>
            ) : (
                <div className="kb-clipboard-status" role="status">
                    <span className="kb-clipboard-status-icon" aria-hidden="true">
                        {state.status === 'loading' ? <span className="kb-clipboard-spinner" /> : <StatusIcon />}
                    </span>
                    <span className="kb-clipboard-status-label">{t(kStatusMessages[state.status])}</span>
                    {(state.status === 'empty' || state.status === 'error') && (
                        <button className="kb-clipboard-retry" onClick={retry}>
                            <RefreshIcon />
                            <span>{t('vk_clipboard_retry')}</span>
                        </button>
                    )}
                </div>
            )}
        </section>
    );
}
