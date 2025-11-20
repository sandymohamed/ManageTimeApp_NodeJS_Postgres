interface PushNotificationPayload {
    title: string;
    body: string;
    data?: any;
    sound?: string;
    badge?: number;
    imageUrl?: string;
}
interface UserPushToken {
    token: string;
    platform: 'android' | 'ios';
    registeredAt: Date;
}
declare class PushNotificationService {
    private static instance;
    private constructor();
    static getInstance(): PushNotificationService;
    getUserPushTokens(userId: string): Promise<UserPushToken[]>;
    sendPushNotification(userId: string, payload: PushNotificationPayload, checkPreferences?: boolean): Promise<boolean>;
    sendPushNotificationToUsers(userIds: string[], payload: PushNotificationPayload, checkPreferences?: boolean): Promise<number>;
    isAvailable(): boolean;
}
export declare const pushNotificationService: PushNotificationService;
export {};
//# sourceMappingURL=pushNotificationService.d.ts.map