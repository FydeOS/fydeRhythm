export interface SchemaDescription {
    id: string;
    name: string;
    description: string;
    website: string;
    user?: boolean;
    realName?: string;
    extra_data?: boolean;
    fuzzy_pinyin?: boolean;
}

export interface SchemaListFile {
    schemas: SchemaDescription[];
}
