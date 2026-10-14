export declare const KMH_PER_MPH = 1.609344;
/**
 * The unit speeds are shown in: 'kmh' or 'mph'. Until the profile chooses one (Settings →
 * General) it follows the weight unit — a profile in pounds reads mph — so imperial users get
 * miles without looking for a setting, and a kg lifter on an mph treadmill can still pick it.
 */
export declare const speedUnitOf: (S: any) => any;
/** The unit's short label, as the numbers carry it: "km/h" or "mph". */
export declare const speedLabel: (unit: any) => "km/h" | "mph";
export declare function toSpeed(kmh: any, unit: any): any;
export declare function fromSpeed(value: any, unit: any): any;
/** "8 km/h" or "5 mph" — a stored km/h speed, shown in `unit`. */
export declare const fmtSpeed: (kmh: any, unit: any) => string;
