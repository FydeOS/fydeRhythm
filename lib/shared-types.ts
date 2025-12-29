
export interface RimeSchema {
    id: string;
    name: string;
}

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

export interface RimeCandidate {
    index: number;
    text: string;
    comment: string;
}