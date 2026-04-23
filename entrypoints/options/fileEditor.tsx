import { useEffect, useRef, useState } from "react";
import { $$, formatBytes, getFileName, getFs } from "@/lib/utils";
import { ExpandMore, ChevronRight } from '@mui/icons-material';
import { AiFillSetting } from '@react-icons/all-files/ai/AiFillSetting'
import { AiFillFileText } from '@react-icons/all-files/ai/AiFillFileText'
import { AiFillFile } from '@react-icons/all-files/ai/AiFillFile'
import { AiFillFolder } from '@react-icons/all-files/ai/AiFillFolder'
import { AiFillHdd } from '@react-icons/all-files/ai/AiFillHdd'
import { AiFillFileMarkdown } from '@react-icons/all-files/ai/AiFillFileMarkdown'
import { SimpleTreeView } from '@mui/x-tree-view/SimpleTreeView';
import { TreeItem } from '@mui/x-tree-view/TreeItem';
import type { IconType } from "@react-icons/all-files";
import _ from "lodash";
import React from "react";
import Editor, { loader, type Monaco } from "@monaco-editor/react";
import type monaco from 'monaco-editor';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import AppBar from '@mui/material/AppBar';
import Toolbar from '@mui/material/Toolbar';
import IconButton from '@mui/material/IconButton';
import Typography from '@mui/material/Typography';
import CloseIcon from '@mui/icons-material/Close';
import Slide from '@mui/material/Slide';
import CircularProgress from '@mui/material/CircularProgress';
import type { TransitionProps } from '@mui/material/transitions';

loader.config({ paths: { vs: "/monaco/vs" } });

const Transition = React.forwardRef(function Transition(
    props: TransitionProps & {
        children: React.ReactElement;
    },
    ref: React.Ref<unknown>,
) {
    return <Slide direction="up" ref={ref} {...props} />;
});

interface FileEditorButtonProps {
    onEdit: () => void;
}

interface FileItem {
    id: string;
    name: string;
    parent: string | null;
    isDir: boolean;
    size: number;
}

const NON_EDITABLE_SUFFIXES = ['.bin', '.gram'];

function FileEditorButton(props: FileEditorButtonProps) {
    const [data, setData] = useState<FileItem[]>([]);
    const [open, setOpen] = useState(false);
    const [expandedItems, setExpandedItems] = useState<string[]>([]);
    const [selectedTreeItem, setSelectedTreeItem] = useState<string | null>(null);
    const [filePath, setFilePath] = useState("");
    const [fileContent, setFileContent] = useState<string | null>(null);
    const [isFileLoading, setIsFileLoading] = useState(false);
    const [editorSessionKey, setEditorSessionKey] = useState(0);
    const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
    const filePathRef = useRef(filePath);
    const hasUnsavedChangesRef = useRef(false);
    const changeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const loadRequestIdRef = useRef(0);

    useEffect(() => {
        filePathRef.current = filePath;
    }, [filePath]);

    function invalidatePendingLoads() {
        loadRequestIdRef.current += 1;
        return loadRequestIdRef.current;
    }

    function clearPendingSave() {
        if (changeTimerRef.current) {
            clearTimeout(changeTimerRef.current);
            changeTimerRef.current = null;
        }
    }

    const resetEditorView = useCallback(() => {
        setFilePath("");
        setFileContent(null);
        setIsFileLoading(false);
    }, []);

    const loadFileForEditor = useCallback(async (path: string, requestId: number) => {
        const isStaleRequest = () => requestId !== loadRequestIdRef.current;

        if (!path) {
            if (!isStaleRequest()) resetEditorView();
            return;
        }

        if (!isStaleRequest()) setIsFileLoading(true);

        if (NON_EDITABLE_SUFFIXES.some(suffix => path.endsWith(suffix))) {
            hasUnsavedChangesRef.current = false;
            if (!isStaleRequest()) resetEditorView();
            return;
        }

        const fs = await getFs();
        try {
            const entry = await fs.readEntry(path);
            if (isStaleRequest()) return;
            if (!entry || entry.isDirectory) {
                hasUnsavedChangesRef.current = false;
                resetEditorView();
                return;
            }
            const buffer = await fs.readWholeFile(path);
            if (isStaleRequest()) return;
            const content = new TextDecoder().decode(buffer);
            hasUnsavedChangesRef.current = false;
            setFilePath(path);
            setFileContent(content);
        } catch (error) {
            if (isStaleRequest()) return;
            console.error(`Failed to load ${path}`, error);
            hasUnsavedChangesRef.current = false;
            resetEditorView();
        } finally {
            if (!isStaleRequest()) setIsFileLoading(false);
        }
    }, [resetEditorView]);

    useEffect(() => {
        if (!open) return;

        setEditorSessionKey((prev) => prev + 1);
        const openRequestId = invalidatePendingLoads();
        if (filePathRef.current) setIsFileLoading(true);

        let isActive = true;

        async function loadTreeAndRestoreFile() {
            const fs = await getFs();
            const content = await fs.readAll();

            const newData: FileItem[] = [];
            for (const entry of content) {
                newData.push({
                    id: entry.fullPath,
                    parent: entry.parent,
                    name: getFileName(entry.fullPath) ?? entry.fullPath,
                    isDir: entry.isDirectory,
                    size: _.sumBy(entry.blobs, b => b.size),
                });
            }

            if (!isActive) return;
            setData(newData);

            if (filePathRef.current) {
                await loadFileForEditor(filePathRef.current, openRequestId);
            }
        }

        void loadTreeAndRestoreFile();

        return () => {
            isActive = false;
        };
    }, [open, loadFileForEditor]);

    const getFileIcon = (item: FileItem): IconType => {
        if (item.isDir) return AiFillFolder;

        const extension = item.name.slice(item.name.lastIndexOf(".") + 1).toLowerCase();
        switch (extension) {
            case "txt": return AiFillFileText;
            case "yaml":
            case "yml": return AiFillSetting;
            case "bin":
            case "gram": return AiFillHdd;
            case "md": return AiFillFileMarkdown;
            default: return AiFillFile;
        }
    };

    const renderTree = (parentId: string | null): React.ReactNode => {
        return data
            .filter(item => item.parent === parentId)
            .map(item => {
                const ItemIcon = getFileIcon(item);
                const sizeLabel = item.isDir ? "" : ` (${formatBytes(item.size)})`;
                const label = (
                    <>
                        <ItemIcon style={{ marginRight: '4px', verticalAlign: 'middle' }} />
                        {item.name}{sizeLabel}
                    </>
                );

                return (
                    <TreeItem key={item.id} itemId={item.id} label={label}>
                        {renderTree(item.id)}
                    </TreeItem>
                );
            });
    };


    async function saveCurrent() {
        clearPendingSave();
        if (!editorRef.current || !filePathRef.current) return;
        if (!hasUnsavedChangesRef.current) return;
        const value = editorRef.current.getValue();
        const path = filePathRef.current;
        const fs = await getFs();
        await fs.writeWholeFile(path, new TextEncoder().encode(value));
        hasUnsavedChangesRef.current = false;
        props.onEdit();
        console.log(`Changes to ${path} is saved!`);
    }
    function handleEditorChange() {
        hasUnsavedChangesRef.current = true;
        clearPendingSave();
        changeTimerRef.current = setTimeout(() => {
            void saveCurrent();
        }, 500);
    }

    // Find root parent - check both "" and null
    const rootParent = data.some(d => d.parent === null) ? null : "";

    async function onSelectFile(_event: React.SyntheticEvent, itemId: string) {
        setSelectedTreeItem(itemId);
        const requestId = invalidatePendingLoads();
        if (changeTimerRef.current || hasUnsavedChangesRef.current) {
            await saveCurrent();
        }
        await loadFileForEditor(itemId, requestId);
    }

    function handleEditorDidMount(editor: monaco.editor.IStandaloneCodeEditor, _monaco: Monaco) {
        editorRef.current = editor;
    }

    function cleanupEditorRuntimeState() {
        invalidatePendingLoads();
        clearPendingSave();
        hasUnsavedChangesRef.current = false;
        setFileContent(null);
        setIsFileLoading(false);
        editorRef.current = null;
        // filePath is kept so the next open restores the last file from disk
    }

    async function handleCloseEditor() {
        if (changeTimerRef.current || hasUnsavedChangesRef.current) {
            await saveCurrent();
        }
        cleanupEditorRuntimeState();
        setOpen(false);
    }

    return <>
        <Button variant="contained" onClick={() => setOpen(true)}>
            {$$("edit_rime_config")}
        </Button>
        <Dialog
            fullScreen
            open={open}
            onClose={handleCloseEditor}
            TransitionComponent={Transition}
        >
            <AppBar sx={{ position: 'relative' }}>
                <Toolbar>
                    <IconButton
                        edge="start"
                        color="inherit"
                        onClick={handleCloseEditor}
                        aria-label="close"
                    >
                        <CloseIcon />
                    </IconButton>
                    <Typography sx={{ ml: 2, flex: 1 }} variant="h6" component="div">
                        {$$("config_editor_title")}
                    </Typography>
                </Toolbar>
            </AppBar>
            <div style={{ display: 'flex' }}>
                <div style={{ height: "calc(100vh - 64px)", overflow: "scroll", minWidth: "250px", borderRight: "solid 1px gray" }}>
                    <SimpleTreeView
                        expandedItems={expandedItems}
                        onExpandedItemsChange={(_event, itemIds) => setExpandedItems(itemIds)}
                        selectedItems={selectedTreeItem ?? undefined}
                        onItemClick={onSelectFile}
                        sx={{ flexGrow: 1, overflowY: 'auto' }}
                        slots={{
                            collapseIcon: ExpandMore,
                            expandIcon: ChevronRight,
                        }}
                    >
                        {renderTree(rootParent)}
                    </SimpleTreeView>
                </div>
                <div style={{ flexGrow: 1 }}>
                    {isFileLoading ?
                        <div style={{ height: "calc(100vh - 64px)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                            <CircularProgress size={30} />
                        </div>
                        : fileContent != null ?
                        <Editor
                            key={`${editorSessionKey}:${filePath}`}
                            defaultValue={fileContent}
                            path={filePath}
                            onMount={handleEditorDidMount}
                            onChange={handleEditorChange}
                            loading={$$("loading_editor")}
                        /> : <div style={{ margin: "20px" }}>{$$("cannot_edit_this_file")}</div>
                    }
                </div>
            </div>
        </Dialog>
    </>
}

export default FileEditorButton;
