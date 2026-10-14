export declare const pushSupported: () => boolean;
export declare const pushPermission: () => "unsupported" | NotificationPermission;
export declare function deviceId(): string | undefined;
export declare function enablePush(): Promise<void>;
export declare function disablePush(): Promise<void>;
export declare function syncPushSubscription(): Promise<boolean>;
export declare const sendTestPush: () => Promise<any>;
