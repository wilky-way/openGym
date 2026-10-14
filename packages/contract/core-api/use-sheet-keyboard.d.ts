export declare function sheetKeyboardInsets(win: any): {
    bottomInset: number;
    visualHeight: number;
};
export declare function useSheetKeyboard(inputRef: any, enabled?: boolean): any;
export declare function revealChip(strip: any, chip: any, pad?: number): boolean;
export declare function useRevealActiveChip(stripRef: any, active: any): void;
export declare function tappable(onClick: any): {
    role?: undefined;
    tabIndex?: undefined;
    onClick?: undefined;
    onKeyDown?: undefined;
} | {
    role: string;
    tabIndex: number;
    onClick: any;
    onKeyDown: (e: any) => void;
};
