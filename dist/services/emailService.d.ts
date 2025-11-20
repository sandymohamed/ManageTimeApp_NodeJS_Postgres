interface EmailOptions {
    to: string;
    subject: string;
    html: string;
    text?: string;
}
interface ProjectInvitationNotificationData {
    email: string;
    inviterName: string;
    projectName: string;
    projectDescription?: string;
    role: string;
    expiresAt: string;
}
declare class EmailService {
    private transporter;
    constructor();
    sendEmail(options: EmailOptions): Promise<boolean>;
    sendProjectInvitationNotification(data: ProjectInvitationNotificationData): Promise<boolean>;
    sendInvitationAcceptedNotification(data: {
        inviterEmail: string;
        inviterName: string;
        projectName: string;
        acceptedBy: string;
    }): Promise<boolean>;
    sendInvitationDeclinedNotification(data: {
        inviterEmail: string;
        inviterName: string;
        projectName: string;
        declinedBy: string;
    }): Promise<boolean>;
    sendPasswordResetOTP(data: {
        email: string;
        otp: string;
        name?: string;
    }): Promise<boolean>;
}
export declare const emailService: EmailService;
export {};
//# sourceMappingURL=emailService.d.ts.map