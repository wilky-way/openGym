export declare function useListReorder(count: any, onMove: any): {
    listRef: any;
    drag: any;
    handle: (i: any) => {
        'data-reorder-handle': string;
        onPointerDown: (e: any) => void;
        onPointerMove: (e: any) => void;
        onPointerUp: (e: any) => void;
        onPointerCancel: () => void;
        onClick: (e: any) => any;
        onKeyDown: (e: any) => void;
    };
    rowStyle: (i: any) => {
        transform: string;
        zIndex: number;
        position: string;
        transition: string;
    } | {
        zIndex?: undefined;
        position?: undefined;
        transition?: undefined;
        transform: string;
    } | undefined;
};
/** `list` with the entry at `from` moved to index `to` (a new array). */
export declare const moved: (list: any, from: any, to: any) => any[];
