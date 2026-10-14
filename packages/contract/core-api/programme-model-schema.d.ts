export declare const programmeModelSchema: {
    type: string;
    properties: any;
    required: any[];
    $schema: string;
    title: string;
    description: string;
    $defs: {
        slot: {
            type: string;
            properties: any;
            required: any[];
        };
        session: {
            type: string;
            properties: any;
            required: any[];
        };
        day: {
            type: string;
            properties: any;
            required: any[];
        };
        week: {
            type: string;
            properties: any;
            required: any[];
        };
        target: {
            type: string;
            properties: any;
            required: any[];
            additionalProperties: boolean;
        };
        progression: {
            type: string;
            properties: any;
            required: any[];
        };
    };
    'x-opengym-semantic-constraints': string[];
};
/** Small interpreter for the schema keywords above, usable in browser and Node. */
export declare function programmeSchemaIssues(value: any): any[];
