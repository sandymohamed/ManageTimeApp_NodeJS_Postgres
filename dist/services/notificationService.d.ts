export interface CreateInvitationNotificationData {
    userId: string;
    invitationId: string;
    projectName: string;
    inviterName: string;
    role: string;
}
export interface InvitationNotificationResponse {
    id: string;
    type: string;
    payload: any;
    createdAt: Date;
    isRead: boolean;
}
declare class NotificationService {
    createInvitationNotification(data: CreateInvitationNotificationData): Promise<void>;
    getUserNotifications(userId: string): Promise<InvitationNotificationResponse[]>;
    markNotificationAsRead(notificationId: string): Promise<void>;
    getUnreadNotificationCount(userId: string): Promise<number>;
    deleteNotification(notificationId: string): Promise<void>;
}
export declare const notificationService: NotificationService;
export {};
//# sourceMappingURL=notificationService.d.ts.map