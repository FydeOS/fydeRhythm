import { useEffect, useRef, useState } from "react";
import { $$, formatBytes, getFileName, getFs } from "~utils";
import { ExpandMore, ChevronRight } from '@mui/icons-material';
import { AiFillSetting } from '@react-icons/all-files/ai/AiFillSetting'
import { AiFillFileText } from '@react-icons/all-files/ai/AiFillFileText'
import { AiFillFile } from '@react-icons/all-files/ai/AiFillFile'
import { AiFillFolder } from '@react-icons/all-files/ai/AiFillFolder'
import { AiFillHdd } from '@react-icons/all-files/ai/AiFillHdd'
import { AiFillFileMarkdown } from '@react-icons/all-files/ai/AiFillFileMarkdown'
import TreeView from '@mui/lab/TreeView';
import TreeItem from '@mui/lab/TreeItem';
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
import type { TransitionProps } from '@mui/material/transitions';

loader.config({ paths: { vs: "/assets/monaco/vs" } });

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

function FileEditorButton(props: FileEditorButtonProps) {
    const [data, setData] = useState([{ name: "", id: "", parent: null, isDir: true, size: 0 }]);
    const [open, setOpen] = useState(false);
    useEffect(() => {
        async function load() {
            const fs = await getFs();
            const content = await fs.readAll();

            const newData = [];
            for (const entry of content) {
                newData.push({
                    id: entry.fullPath,
                    parent: entry.parent,
                    name: getFileName(entry.fullPath),
                    isDir: entry.isDirectory,
                    size: _.sumBy(entry.blobs, b => b.size),
                });
            }
            setData(newData);
        }
        if (open) {
            load();
        }
    }, [open]);

    function RenderDirectory(id: string) {
        return data.filter(d => d.parent === id).map(function (d) {
            const extension = d.name.slice(d.name.lastIndexOf(".") + 1);
            let ItemIcon: IconType;
            if (d.isDir) {
                ItemIcon = AiFillFolder;
            } else {
                switch (extension.toLowerCase()) {
                    case "txt":
                        ItemIcon = AiFillFileText;
                        break;
                    case "yaml":
                    case "yml":
                        ItemIcon = AiFillSetting;
                        break;
                    case "bin":
                    case "gram":
                        ItemIcon = AiFillHdd;
                        break;
                    case "md":
                        ItemIcon = AiFillFileMarkdown;
                        break;
                    default:
                        ItemIcon = AiFillFile;
                        break;
                }
            }
            const sizeLabel = d.isDir ? "" : ` (${formatBytes(d.size)})`;
            return <TreeItem key={d.id}
                nodeId={d.id}
                label={<><ItemIcon /> {d.name}{sizeLabel}</>}
            >{RenderDirectory(d.id)}</TreeItem>
        });
    }

    async function saveCurrent() {
        if (currentChangeTimer) {
            clearTimeout(currentChangeTimer);
            setCurrentChangeTimer(null);
        }
        const value = editorRef.current.getValue();
        const path = filePath;
        const fs = await getFs();
        await fs.writeWholeFile(path, new TextEncoder().encode(value));
        props.onEdit();
        console.log(`Changes to ${path} is saved!`);
    }
    function handleEditorChange() {
        if (currentChangeTimer) {
            clearTimeout(currentChangeTimer);
            setCurrentChangeTimer(null);
        }
        // Create a timer to save the changes after a while
        // If new changes happen within this period, timer is reset
        const timer = setTimeout(saveCurrent, 500);
        setCurrentChangeTimer(timer);
    }

    const [filePath, setFilePath] = useState("");
    const [fileContent, setFileContent] = useState(null);
    function onSelectFile(event: React.SyntheticEvent, path: string) {
        (async () => {

            if (currentChangeTimer) {
                // has pending unsaved changes, save it now
                saveCurrent();
            }

            const uneditable = ['.bin', '.gram'];
            if (uneditable.some(suffix => path.endsWith(suffix))) {
                setFileContent(null);
                return;
            }
            const fs = await getFs();
            const entry = await fs.readEntry(path);
            if (entry.isDirectory) {
                setFileContent(null);
                return;
            }
            const buffer = await fs.readWholeFile(path);
            const content = new TextDecoder().decode(buffer);
            setFileContent(content);
            setFilePath(path);
        })();
    }

    const editorRef = useRef<monaco.editor.IStandaloneCodeEditor>(null);
    function handleEditorDidMount(editor: monaco.editor.IStandaloneCodeEditor, monaco: Monaco) {
        editorRef.current = editor;
    }

    const [currentChangeTimer, setCurrentChangeTimer] = useState(null);

    return <>
        <Button variant="contained" onClick={() => setOpen(true)}>
            {$$("edit_rime_config")}
        </Button>
        <Dialog
            fullScreen
            open={open}
            onClose={() => setOpen(false)}
            TransitionComponent={Transition}
        >
            <AppBar sx={{ position: 'relative' }}>
                <Toolbar>
                    <IconButton
                        edge="start"
                        color="inherit"
                        onClick={() => setOpen(false)}
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
                    <TreeView
                        aria-label="multi-select"
                        defaultCollapseIcon={<ExpandMore />}
                        defaultExpandIcon={<ChevronRight />}
                        onNodeSelect={onSelectFile}
                        sx={{ flexGrow: 1, overflowY: 'auto' }}
                    >
                        {RenderDirectory("")}
                    </TreeView>
                </div>
                <div style={{ flexGrow: 1 }}>
                    {fileContent != null ?
                        <Editor
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