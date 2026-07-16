import type { RefObject } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import CircularProgress from '@mui/material/CircularProgress';
import FormControl from '@mui/material/FormControl';
import IconButton from '@mui/material/IconButton';
import Link from '@mui/material/Link';
import MenuItem from '@mui/material/MenuItem';
import Radio from '@mui/material/Radio';
import Select from '@mui/material/Select';
import Switch from '@mui/material/Switch';
import TextField from '@mui/material/TextField';
import CloudDownloadIcon from '@mui/icons-material/CloudDownload';
import CloudUploadIcon from '@mui/icons-material/CloudUpload';

import styles from './styles.module.less';
import { $$, resolveSchemaKeys, type ImeSettings, type SchemaKeys } from '@/lib/utils';
import { kScriptLayoutIds } from '@/lib/shared-types';
import type { SchemaDescription } from './schema-types';

interface SchemaSectionProps {
    schemas: SchemaDescription[];
    fetching: boolean;
    localSchemaIds: string[];
    settings: ImeSettings;
    downloadSchemaId: string | null;
    downloadProgress: number;
    fetchError: string | null;
    repoError: string | null;
    importError: string | null;
    personalRepoUrl: string | null;
    personalRepoSchemaId: string | null;
    repoUrlInputRef: RefObject<HTMLInputElement | null>;
    repoSchemaIdInputRef: RefObject<HTMLInputElement | null>;
    userDefinedSchemaId: string;
    showsInputView: boolean;
    schemaKeyNames: Record<SchemaKeys, string>;
    onSettingsChange(change: Partial<ImeSettings>): void;
    onDownloadSchema(id: string, update?: boolean): void;
    onConvertPersonalSchema(repo?: string, schemaId?: string, force?: boolean, convertedId?: string): void;
    onRemoveRequest(schema: SchemaDescription): void;
    isSchemaEnabled(id: string): boolean;
    onToggleSchemaEnabled(id: string, enabled: boolean): void;
    onSetSchemaKeys(id: string, keys: SchemaKeys): void;
    onRepoUrlChange(value: string): void;
    onRepoSchemaIdChange(value: string): void;
    onImportCompiledSchema(file: File): Promise<void>;
}

export function SchemaSection({
    schemas,
    fetching,
    localSchemaIds,
    settings,
    downloadSchemaId,
    downloadProgress,
    fetchError,
    repoError,
    importError,
    personalRepoUrl,
    personalRepoSchemaId,
    repoUrlInputRef,
    repoSchemaIdInputRef,
    userDefinedSchemaId,
    showsInputView,
    schemaKeyNames,
    onSettingsChange,
    onDownloadSchema,
    onConvertPersonalSchema,
    onRemoveRequest,
    isSchemaEnabled,
    onToggleSchemaEnabled,
    onSetSchemaKeys,
    onRepoUrlChange,
    onRepoSchemaIdChange,
    onImportCompiledSchema,
}: SchemaSectionProps) {
    return (
        <div className={styles.formGroup}>
            <div className={styles.formBox}>
                <FormControl className={styles.formControl}>
                    <Box sx={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', mb: 2 }}>
                        <h2 className={styles.formLabel} style={{ marginBottom: 0 }}>{$$('select_schema')}</h2>
                        {fetching && schemas.length === 0 ? (
                            <Box sx={{ fontSize: '0.8rem', color: 'text.secondary' }}>{$$('fetching_schema_list')}</Box>
                        ) : null}
                    </Box>

                    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                        {schemas.map(schema => {
                            const isInstalled = localSchemaIds.includes(schema.id);
                            const isActive = schema.id === settings.schema;
                            return (
                                <Box
                                    key={schema.id}
                                    sx={{
                                        display: 'flex',
                                        alignItems: 'flex-start',
                                        gap: 1.5,
                                        px: 2,
                                        py: 1.5,
                                        borderRadius: '12px',
                                        border: '1px solid',
                                        borderColor: isActive ? 'rgba(228, 0, 70, 0.18)' : 'divider',
                                        bgcolor: isActive ? 'rgba(228, 0, 70, 0.02)' : 'transparent',
                                        cursor: isInstalled && !isActive ? 'pointer' : 'default',
                                        transition: 'background-color 0.15s',
                                        position: 'relative',
                                        overflow: 'hidden',
                                        '&::after': isInstalled && !isActive ? {
                                            content: '""',
                                            position: 'absolute',
                                            inset: 0,
                                            borderRadius: '12px',
                                            bgcolor: 'transparent',
                                            transition: 'background-color 0.15s',
                                            pointerEvents: 'none',
                                        } : {},
                                        '&:hover::after': isInstalled && !isActive ? { bgcolor: 'action.hover' } : {},
                                        '&:active::after': isInstalled && !isActive ? { bgcolor: 'action.selected' } : {},
                                    }}
                                    onClick={isInstalled && !isActive
                                        ? () => onSettingsChange({ schema: schema.id })
                                        : undefined}
                                >
                                    <Box sx={{ width: 36, height: 36, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, mt: 0.25 }}>
                                        {downloadSchemaId === schema.id
                                            ? <CircularProgress variant="determinate" value={downloadProgress} size={22} />
                                            : isInstalled
                                                ? <Radio
                                                    checked={isActive}
                                                    onChange={() => onSettingsChange({ schema: schema.id })}
                                                    onClick={event => event.stopPropagation()}
                                                    size="small"
                                                    sx={{ p: 0 }}
                                                    inputProps={{ 'aria-label': `${schema.id} ${schema.name}` }}
                                                />
                                                : <IconButton
                                                    size="small"
                                                    onClick={event => {
                                                        event.stopPropagation();
                                                        onDownloadSchema(schema.id);
                                                    }}
                                                    disabled={downloadSchemaId !== null}
                                                    sx={{ p: 0.5 }}
                                                    aria-label={`${$$('download_schema')} ${schema.name}`}
                                                >
                                                    <CloudDownloadIcon fontSize="small" />
                                                </IconButton>}
                                    </Box>

                                    <Box sx={{ flex: 1, minWidth: 0 }}>
                                        <Box sx={{ display: 'flex', alignItems: 'baseline', flexWrap: 'wrap', gap: '4px 10px', mb: 0.5 }}>
                                            <Box sx={{ fontSize: '0.9375rem', fontWeight: isInstalled ? 500 : 400, color: 'text.primary' }}>
                                                {schema.user ? schema.realName : schema.id} {schema.name}
                                            </Box>
                                            {isInstalled && (!schema.user || schema.website) ? (
                                                <Link
                                                    component="button"
                                                    underline="hover"
                                                    onClick={event => {
                                                        event.stopPropagation();
                                                        if (schema.user) {
                                                            onConvertPersonalSchema(schema.website, schema.realName, true, schema.id);
                                                        } else {
                                                            onDownloadSchema(schema.id, true);
                                                        }
                                                    }}
                                                    sx={{ fontSize: '0.8rem' }}
                                                    disabled={downloadSchemaId !== null}
                                                >
                                                    {$$('update_schema')}
                                                </Link>
                                            ) : null}
                                            {isInstalled ? (
                                                <Link
                                                    component="button"
                                                    underline="hover"
                                                    onClick={event => {
                                                        event.stopPropagation();
                                                        onRemoveRequest(schema);
                                                    }}
                                                    sx={{
                                                        fontSize: '0.8rem',
                                                        opacity: isActive ? 0.4 : 1,
                                                        cursor: isActive ? 'not-allowed' : undefined,
                                                        color: isActive ? 'primary.main' : 'error.main',
                                                    }}
                                                    disabled={downloadSchemaId !== null || isActive}
                                                >
                                                    {$$('remove_schema')}
                                                </Link>
                                            ) : null}
                                        </Box>

                                        <Box sx={{ fontSize: '0.85rem', color: 'text.secondary', lineHeight: 1.45, mb: isInstalled ? 1.25 : 0 }}>
                                            {schema.description}
                                            {schema.website ? (
                                                <Link
                                                    href={schema.website}
                                                    target="_blank"
                                                    underline="hover"
                                                    onClick={event => event.stopPropagation()}
                                                    sx={{ ml: 1 }}
                                                >
                                                    {$$('schema_home_page')}
                                                </Link>
                                            ) : null}
                                        </Box>

                                        {isInstalled ? (
                                            <Box
                                                sx={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '6px 20px' }}
                                                onClick={event => event.stopPropagation()}
                                            >
                                                <Box component="label" sx={{ display: 'flex', alignItems: 'center', gap: 0.5, cursor: isActive ? 'default' : 'pointer' }}>
                                                    <Switch
                                                        size="small"
                                                        checked={isSchemaEnabled(schema.id)}
                                                        disabled={isActive}
                                                        onChange={(_, checked) => onToggleSchemaEnabled(schema.id, checked)}
                                                        color="primary"
                                                        sx={{ ml: -0.75 }}
                                                    />
                                                    <Box sx={{ fontSize: '0.8rem', color: 'text.secondary', whiteSpace: 'nowrap' }}>
                                                        {$$('enable_schema_hint')}
                                                    </Box>
                                                </Box>
                                                {showsInputView ? (
                                                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                                        <Box sx={{ fontSize: '0.8rem', color: 'text.secondary', whiteSpace: 'nowrap' }}>
                                                            {$$('vk_keys')}
                                                        </Box>
                                                        <Select
                                                            size="small"
                                                            variant="standard"
                                                            disableUnderline
                                                            value={resolveSchemaKeys(settings, schema.id, schema.name) ?? 'latin'}
                                                            onChange={event => onSetSchemaKeys(schema.id, event.target.value as SchemaKeys)}
                                                            inputProps={{ 'aria-label': `${$$('vk_keys')} — ${schema.name || schema.id}` }}
                                                            sx={{ fontSize: '0.8rem', color: 'text.secondary', '& .MuiSelect-select': { py: 0.25 } }}
                                                        >
                                                            <MenuItem value="latin">{schemaKeyNames.latin}</MenuItem>
                                                            {kScriptLayoutIds.map(id => (
                                                                <MenuItem key={id} value={id}>{schemaKeyNames[id]}</MenuItem>
                                                            ))}
                                                        </Select>
                                                    </Box>
                                                ) : null}
                                            </Box>
                                        ) : null}
                                    </Box>
                                </Box>
                            );
                        })}
                    </Box>

                    {fetchError ? (
                        <Box role="alert" sx={{ mt: 1.5, color: 'error.main', fontSize: '0.85rem' }}>{fetchError}</Box>
                    ) : null}

                    <Box sx={{
                        mt: 2,
                        pt: 2,
                        borderTop: '1px solid',
                        borderColor: 'divider',
                        display: 'flex',
                        flexDirection: { xs: 'column', sm: 'row' },
                        alignItems: { xs: 'stretch', sm: 'stretch' },
                        gap: 1.5,
                    }}>
                        {downloadSchemaId === userDefinedSchemaId ? (
                            <CircularProgress variant="determinate" value={downloadProgress} size={22} sx={{ flexShrink: 0 }} />
                        ) : null}
                        <TextField
                            label="GitHub Repo URL"
                            variant="filled"
                            type="url"
                            name="repoUrl"
                            autoComplete="off"
                            spellCheck={false}
                            inputRef={repoUrlInputRef}
                            error={repoError !== null && !personalRepoUrl}
                            onChange={event => onRepoUrlChange(event.target.value)}
                            sx={{ flex: 1, minWidth: 0 }}
                        />
                        <Box sx={{ display: 'flex', alignItems: 'stretch', gap: 1.5, flexWrap: 'wrap' }}>
                            <TextField
                                label="Schema Id"
                                variant="filled"
                                name="schemaId"
                                autoComplete="off"
                                spellCheck={false}
                                inputRef={repoSchemaIdInputRef}
                                error={repoError !== null && !personalRepoSchemaId}
                                onChange={event => onRepoSchemaIdChange(event.target.value)}
                                sx={{ width: { xs: '100%', sm: '150px' } }}
                            />
                            <Button
                                variant="outlined"
                                onClick={() => onConvertPersonalSchema()}
                                disabled={downloadSchemaId !== null}
                            >
                                {$$('add_schema')}
                            </Button>
                        </Box>
                    </Box>

                    {repoError ? (
                        <Box role="alert" sx={{ mt: 1, color: 'error.main', fontSize: '0.85rem' }}>{repoError}</Box>
                    ) : null}

                    <Box sx={{ mt: 1.5, display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap' }}>
                        {downloadSchemaId === 'importing' ? (
                            <CircularProgress variant="determinate" value={downloadProgress} size={22} sx={{ flexShrink: 0 }} />
                        ) : null}
                        <input
                            type="file"
                            accept=".zip"
                            id="schema-import-input"
                            style={{ display: 'none' }}
                            onChange={async event => {
                                if (event.target.files?.[0]) {
                                    await onImportCompiledSchema(event.target.files[0]);
                                    event.target.value = '';
                                }
                            }}
                        />
                        <Button
                            variant="outlined"
                            startIcon={<CloudUploadIcon />}
                            onClick={() => document.getElementById('schema-import-input')?.click()}
                            disabled={downloadSchemaId !== null}
                            size="small"
                        >
                            {$$('import_compiled_schema')}
                        </Button>
                        <Box sx={{ fontSize: '0.85rem', color: 'text.secondary' }}>
                            {$$('import_compiled_schema_hint')}
                        </Box>
                    </Box>

                    {importError ? (
                        <Box role="alert" sx={{ mt: 1, color: 'error.main', fontSize: '0.85rem' }}>{importError}</Box>
                    ) : null}
                </FormControl>
            </div>
        </div>
    );
}
