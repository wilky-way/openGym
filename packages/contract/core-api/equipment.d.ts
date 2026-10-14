export declare const ACCESSORIES: string[];
export declare function accessoriesOf(ex: any): string[];
export declare const ALL_EQUIPMENT: string[];
export declare function activeProfile(S: any): any;
export declare function exAvailable(S: any, ex: any): boolean;
export declare const ACC_V = 1;
export declare function profileEquipment(p: any): any;
export declare function eqAvailable(equipment: any, ex: any): boolean;
export declare function newProfile(name: any): {
    id: string;
    name: any;
    equipment: never[];
    accV: number;
};
