export declare const MEASUREMENT_FIELDS: ({
    key: string;
    label: string;
    group: string;
    kind?: undefined;
    optional?: undefined;
} | {
    key: string;
    label: string;
    group: string;
    optional: boolean;
    kind?: undefined;
} | {
    key: string;
    label: string;
    group: string;
    kind: string;
    optional: boolean;
})[];
export declare const MEASUREMENT_KEYS: string[];
export declare const DEFAULT_MEASUREMENT_KEYS: string[];
export declare const measurementUnit: (unit: any) => "cm" | "in";
export declare const toMeasurementDisplay: (cm: any, unit: any) => number | null;
export declare const fromMeasurementDisplay: (value: any, unit: any) => number | null;
export declare function emptyMeasurement(date: any, custom?: any[]): {
    d: any;
    t: number;
};
export declare function normalizeMeasurementEntry(raw?: {}, custom?: any[]): {
    d: any;
    t: number;
};
export declare function normalizeMeasurementsState(state: any): any;
export declare function measurementValue(entry: any, key: any): number | null;
export declare function measurementLabel(key: any, custom?: any[]): any;
export declare function enabledMeasurementFields(state: any): any[];
export declare function measurementSeries(state: any, key: any, range?: number, now?: number): any;
export declare function latestMeasurement(state: any, key: any): {
    entry: any;
    value: number;
} | null;
export declare function measurementEntryHasValues(entry: any): any;
