"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.invitationService = void 0;
const database_1 = require("../utils/database");
const emailService_1 = require("./emailService");
const notificationService_1 = require("./notificationService");
const logger_1 = require("../utils/logger");
const client_1 = require("@prisma/client");
const crypto_1 = __importDefault(require("crypto"));
class InvitationService {
    generateToken() {
        return crypto_1.default.randomBytes(32).toString('hex');
    }
    getExpirationDate() {
        const expirationDays = 7;
        const expirationDate = new Date();
        expirationDate.setDate(expirationDate.getDate() + expirationDays);
        return expirationDate;
    }
    async createInvitation(data) {
        const prisma = (0, database_1.getPrismaClient)();
        try {
            const existingUser = await prisma.user.findUnique({
                where: { email: data.email },
            });
            if (existingUser) {
                const existingMember = await prisma.projectMember.findFirst({
                    where: {
                        projectId: data.projectId,
                        userId: existingUser.id,
                    },
                });
                if (existingMember) {
                    throw new Error('User is already a member of this project');
                }
            }
            const existingInvitation = await prisma.projectInvitation.findFirst({
                where: {
                    projectId: data.projectId,
                    email: data.email,
                    status: client_1.ProjectInvitationStatus.PENDING,
                },
            });
            if (existingInvitation) {
                const updatedInvitation = await prisma.projectInvitation.update({
                    where: { id: existingInvitation.id },
                    data: {
                        role: data.role,
                        token: this.generateToken(),
                        expiresAt: this.getExpirationDate(),
                        invitedBy: data.invitedBy,
                    },
                    include: {
                        project: {
                            select: {
                                id: true,
                                title: true,
                                description: true,
                            },
                        },
                        inviter: {
                            select: {
                                id: true,
                                name: true,
                                email: true,
                            },
                        },
                    },
                });
                try {
                    await this.sendInvitationEmail(updatedInvitation);
                    if (existingUser) {
                        await notificationService_1.notificationService.createInvitationNotification({
                            userId: existingUser.id,
                            invitationId: updatedInvitation.id,
                            projectName: updatedInvitation.project.title,
                            inviterName: updatedInvitation.inviter.name || updatedInvitation.inviter.email,
                            role: updatedInvitation.role,
                        });
                    }
                    return this.mapInvitationToResponse(updatedInvitation);
                }
                catch (emailError) {
                    await prisma.projectInvitation.update({
                        where: { id: existingInvitation.id },
                        data: {
                            role: existingInvitation.role,
                            token: existingInvitation.token,
                            expiresAt: existingInvitation.expiresAt,
                            invitedBy: existingInvitation.invitedBy,
                        },
                    });
                    throw new Error(`Failed to send invitation email: ${emailError.message}`);
                }
            }
            const invitation = await prisma.projectInvitation.create({
                data: {
                    projectId: data.projectId,
                    email: data.email,
                    role: data.role,
                    token: this.generateToken(),
                    invitedBy: data.invitedBy,
                    expiresAt: this.getExpirationDate(),
                },
                include: {
                    project: {
                        select: {
                            id: true,
                            title: true,
                            description: true,
                        },
                    },
                    inviter: {
                        select: {
                            id: true,
                            name: true,
                            email: true,
                        },
                    },
                },
            });
            try {
                await this.sendInvitationEmail(invitation);
                if (existingUser) {
                    await notificationService_1.notificationService.createInvitationNotification({
                        userId: existingUser.id,
                        invitationId: invitation.id,
                        projectName: invitation.project.title,
                        inviterName: invitation.inviter.name || invitation.inviter.email,
                        role: invitation.role,
                    });
                }
                return this.mapInvitationToResponse(invitation);
            }
            catch (emailError) {
                await prisma.projectInvitation.delete({
                    where: { id: invitation.id },
                });
                throw new Error(`Failed to send invitation email: ${emailError.message}`);
            }
        }
        catch (error) {
            logger_1.logger.error('Failed to create invitation:', error);
            throw error;
        }
    }
    async getInvitationByToken(token) {
        const prisma = (0, database_1.getPrismaClient)();
        try {
            const invitation = await prisma.projectInvitation.findUnique({
                where: { token },
                include: {
                    project: {
                        select: {
                            id: true,
                            title: true,
                            description: true,
                        },
                    },
                    inviter: {
                        select: {
                            id: true,
                            name: true,
                            email: true,
                        },
                    },
                },
            });
            if (!invitation) {
                return null;
            }
            if (invitation.expiresAt < new Date()) {
                await prisma.projectInvitation.update({
                    where: { id: invitation.id },
                    data: { status: client_1.ProjectInvitationStatus.EXPIRED },
                });
                return null;
            }
            return this.mapInvitationToResponse(invitation);
        }
        catch (error) {
            logger_1.logger.error('Failed to get invitation by token:', error);
            throw error;
        }
    }
    async acceptInvitation(token, userId) {
        const prisma = (0, database_1.getPrismaClient)();
        try {
            const invitation = await prisma.projectInvitation.findUnique({
                where: { token },
                include: {
                    project: true,
                    inviter: true,
                },
            });
            if (!invitation) {
                return { success: false, message: 'Invitation not found' };
            }
            if (invitation.status !== client_1.ProjectInvitationStatus.PENDING) {
                return { success: false, message: 'Invitation is no longer valid' };
            }
            if (invitation.expiresAt < new Date()) {
                await prisma.projectInvitation.update({
                    where: { id: invitation.id },
                    data: { status: client_1.ProjectInvitationStatus.EXPIRED },
                });
                return { success: false, message: 'Invitation has expired' };
            }
            const existingMember = await prisma.projectMember.findFirst({
                where: {
                    projectId: invitation.projectId,
                    userId: userId,
                },
            });
            if (existingMember) {
                return { success: false, message: 'You are already a member of this project' };
            }
            await prisma.projectMember.create({
                data: {
                    projectId: invitation.projectId,
                    userId: userId,
                    role: invitation.role,
                },
            });
            await prisma.projectInvitation.update({
                where: { id: invitation.id },
                data: {
                    status: client_1.ProjectInvitationStatus.ACCEPTED,
                    respondedAt: new Date(),
                },
            });
            const user = await prisma.user.findUnique({
                where: { id: userId },
                select: { name: true, email: true },
            });
            if (user) {
                await emailService_1.emailService.sendInvitationAcceptedNotification({
                    inviterEmail: invitation.inviter.email,
                    inviterName: invitation.inviter.name || 'Unknown',
                    projectName: invitation.project.title,
                    acceptedBy: user.name || user.email,
                });
            }
            logger_1.logger.info('Invitation accepted', {
                invitationId: invitation.id,
                projectId: invitation.projectId,
                userId,
            });
            return { success: true, message: 'Successfully joined the project!' };
        }
        catch (error) {
            logger_1.logger.error('Failed to accept invitation:', error);
            throw error;
        }
    }
    async declineInvitation(token) {
        const prisma = (0, database_1.getPrismaClient)();
        try {
            const invitation = await prisma.projectInvitation.findUnique({
                where: { token },
                include: {
                    project: true,
                    inviter: true,
                },
            });
            if (!invitation) {
                return { success: false, message: 'Invitation not found' };
            }
            if (invitation.status !== client_1.ProjectInvitationStatus.PENDING) {
                return { success: false, message: 'Invitation is no longer valid' };
            }
            await prisma.projectInvitation.update({
                where: { id: invitation.id },
                data: {
                    status: client_1.ProjectInvitationStatus.DECLINED,
                    respondedAt: new Date(),
                },
            });
            await emailService_1.emailService.sendInvitationDeclinedNotification({
                inviterEmail: invitation.inviter.email,
                inviterName: invitation.inviter.name || 'Unknown',
                projectName: invitation.project.title,
                declinedBy: invitation.email,
            });
            logger_1.logger.info('Invitation declined', {
                invitationId: invitation.id,
                projectId: invitation.projectId,
            });
            return { success: true, message: 'Invitation declined' };
        }
        catch (error) {
            logger_1.logger.error('Failed to decline invitation:', error);
            throw error;
        }
    }
    async getProjectInvitations(projectId) {
        const prisma = (0, database_1.getPrismaClient)();
        try {
            const invitations = await prisma.projectInvitation.findMany({
                where: { projectId },
                include: {
                    project: {
                        select: {
                            id: true,
                            title: true,
                            description: true,
                        },
                    },
                    inviter: {
                        select: {
                            id: true,
                            name: true,
                            email: true,
                        },
                    },
                },
                orderBy: { createdAt: 'desc' },
            });
            return invitations.map(invitation => this.mapInvitationToResponse(invitation));
        }
        catch (error) {
            logger_1.logger.error('Failed to get project invitations:', error);
            throw error;
        }
    }
    async cancelInvitation(invitationId, userId) {
        const prisma = (0, database_1.getPrismaClient)();
        try {
            const invitation = await prisma.projectInvitation.findUnique({
                where: { id: invitationId },
                include: { project: true },
            });
            if (!invitation) {
                return { success: false, message: 'Invitation not found' };
            }
            const project = await prisma.project.findFirst({
                where: {
                    id: invitation.projectId,
                    OR: [
                        { ownerId: userId },
                        { members: { some: { userId, role: { in: ['OWNER', 'EDITOR'] } } } },
                    ],
                },
            });
            if (!project) {
                return { success: false, message: 'You do not have permission to cancel this invitation' };
            }
            await prisma.projectInvitation.update({
                where: { id: invitationId },
                data: { status: client_1.ProjectInvitationStatus.CANCELLED },
            });
            logger_1.logger.info('Invitation cancelled', { invitationId, userId });
            return { success: true, message: 'Invitation cancelled successfully' };
        }
        catch (error) {
            logger_1.logger.error('Failed to cancel invitation:', error);
            throw error;
        }
    }
    async sendInvitationEmail(invitation) {
        const emailSent = await emailService_1.emailService.sendProjectInvitationNotification({
            email: invitation.email,
            inviterName: invitation.inviter.name || invitation.inviter.email,
            projectName: invitation.project.title,
            projectDescription: invitation.project.description,
            role: invitation.role,
            expiresAt: invitation.expiresAt.toLocaleDateString(),
        });
        if (!emailSent) {
            throw new Error('Failed to send invitation notification email');
        }
    }
    mapInvitationToResponse(invitation) {
        return {
            id: invitation.id,
            email: invitation.email,
            role: invitation.role,
            status: invitation.status,
            invitedAt: invitation.invitedAt.toISOString(),
            expiresAt: invitation.expiresAt.toISOString(),
            project: {
                id: invitation.project.id,
                name: invitation.project.title,
                description: invitation.project.description,
            },
            inviter: {
                id: invitation.inviter.id,
                name: invitation.inviter.name || invitation.inviter.email,
                email: invitation.inviter.email,
            },
        };
    }
}
exports.invitationService = new InvitationService();
//# sourceMappingURL=invitationService.js.map