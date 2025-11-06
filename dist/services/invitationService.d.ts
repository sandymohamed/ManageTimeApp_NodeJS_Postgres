interface CreateInvitationData {
    projectId: string;
    email: string;
    role: 'OWNER' | 'EDITOR' | 'VIEWER';
    invitedBy: string;
}
interface InvitationResponse {
    id: string;
    email: string;
    role: string;
    status: string;
    invitedAt: string;
    expiresAt: string;
    project: {
        id: string;
        name: string;
        description?: string;
    };
    inviter: {
        id: string;
        name: string;
        email: string;
    };
}
declare class InvitationService {
    private generateToken;
    private getExpirationDate;
    createInvitation(data: CreateInvitationData): Promise<InvitationResponse>;
    getInvitationByToken(token: string): Promise<InvitationResponse | null>;
    acceptInvitation(token: string, userId: string): Promise<{
        success: boolean;
        message: string;
    }>;
    declineInvitation(token: string): Promise<{
        success: boolean;
        message: string;
    }>;
    getProjectInvitations(projectId: string): Promise<InvitationResponse[]>;
    cancelInvitation(invitationId: string, userId: string): Promise<{
        success: boolean;
        message: string;
    }>;
    private sendInvitationEmail;
    private mapInvitationToResponse;
}
export declare const invitationService: InvitationService;
export {};
//# sourceMappingURL=invitationService.d.ts.map