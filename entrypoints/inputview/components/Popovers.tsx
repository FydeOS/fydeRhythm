import React from 'react';

// Confirm chip for deleting a user-learned word (long-press on a candidate).
export function DeleteConfirm({ text, anchor, onConfirm, onCancel }: {
    text: string;
    anchor: DOMRect;
    onConfirm: () => void;
    onCancel: () => void;
}) {
    const top = Math.max(4, anchor.top - 56);
    const left = Math.max(4, Math.min(anchor.left, window.innerWidth - 240));
    return (
        <>
            <div className="kb-scrim" aria-hidden="true" onPointerDown={onCancel} />
            <div className="kb-confirm" style={{ top, left }}>
                <span className="word">删除「{text}」?</span>
                <button className="plain" onClick={onCancel}>取消</button>
                <button onClick={onConfirm}>删除</button>
            </div>
        </>
    );
}

// Schema picker opened by long-pressing the 中/英 key.
export function SchemaMenu({ schemas, activeSchema, anchor, onPick, onClose }: {
    schemas: Array<{ id: string; label: string }>;
    activeSchema: string;
    anchor: DOMRect;
    onPick: (id: string) => void;
    onClose: () => void;
}) {
    const height = schemas.length * 44 + 12;
    // Prefer opening above the anchor (bottom-row 中/英 key); when the anchor
    // sits near the top (toolbar globe button), open below it instead.
    const top = anchor.top - height - 8 >= 4
        ? anchor.top - height - 8
        : Math.min(anchor.bottom + 8, window.innerHeight - height - 4);
    const left = Math.max(4, Math.min(anchor.left, window.innerWidth - 200));
    return (
        <>
            <div className="kb-scrim" aria-hidden="true" onPointerDown={onClose} />
            <div className="kb-menu" style={{ top, left }}>
                {schemas.map((s) => (
                    <button
                        key={s.id}
                        className={`item${s.id === activeSchema ? ' active' : ''}`}
                        onClick={() => {
                            onClose();
                            if (s.id !== activeSchema) onPick(s.id);
                        }}
                    >
                        {s.label}
                    </button>
                ))}
            </div>
        </>
    );
}
