"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const joi_1 = __importDefault(require("joi"));
const database_1 = require("../utils/database");
const auth_1 = require("../middleware/auth");
const types_1 = require("../types");
const logger_1 = require("../utils/logger");
const invitationService_1 = require("../services/invitationService");
const client_1 = require("@prisma/client");
const router = (0, express_1.Router)();
router.use((req, res, next) => {
    if (req.path.includes('/accept/') || req.path.includes('/decline/')) {
        return next();
    }
    return (0, auth_1.authenticateToken)(req, res, next);
});
const createInvitationSchema = joi_1.default.object({
    projectId: joi_1.default.string().required(),
    email: joi_1.default.string().email().required(),
    role: joi_1.default.string().valid('OWNER', 'EDITOR', 'VIEWER').required(),
});
router.post('/', async (req, res) => {
    try {
        const { error, value } = createInvitationSchema.validate(req.body);
        if (error) {
            throw new types_1.ValidationError(error.details[0].message);
        }
        const { projectId } = value;
        const userId = req.user.id;
        const prisma = (0, database_1.getPrismaClient)();
        const project = await prisma.project.findFirst({
            where: {
                id: projectId,
                OR: [
                    { ownerId: userId },
                    { members: { some: { userId, role: { in: ['OWNER', 'EDITOR'] } } } },
                ],
            },
        });
        if (!project) {
            throw new types_1.AuthorizationError('You do not have permission to invite members to this project');
        }
        const invitation = await invitationService_1.invitationService.createInvitation({
            projectId: value.projectId,
            email: value.email,
            role: value.role,
            invitedBy: userId,
        });
        logger_1.logger.info('Invitation created', { invitationId: invitation.id, projectId: value.projectId, invitedBy: userId });
        res.status(201).json({
            success: true,
            data: invitation,
            message: 'Invitation sent successfully',
        });
    }
    catch (error) {
        logger_1.logger.error('Failed to create invitation:', error);
        throw error;
    }
});
router.get('/project/:projectId', async (req, res) => {
    try {
        const { projectId } = req.params;
        const userId = req.user.id;
        const prisma = (0, database_1.getPrismaClient)();
        const project = await prisma.project.findFirst({
            where: {
                id: projectId,
                OR: [
                    { ownerId: userId },
                    { members: { some: { userId, role: { in: ['OWNER', 'EDITOR'] } } } },
                ],
            },
        });
        if (!project) {
            throw new types_1.AuthorizationError('You do not have permission to view invitations for this project');
        }
        const invitations = await invitationService_1.invitationService.getProjectInvitations(projectId);
        res.json({
            success: true,
            data: invitations,
        });
    }
    catch (error) {
        logger_1.logger.error('Failed to get project invitations:', error);
        throw error;
    }
});
router.put('/:invitationId/accept', async (req, res) => {
    try {
        const { invitationId } = req.params;
        const userId = req.user.id;
        const prisma = (0, database_1.getPrismaClient)();
        const invitation = await prisma.projectInvitation.findUnique({
            where: { id: invitationId },
        });
        if (!invitation) {
            return res.status(404).json({
                success: false,
                message: 'Invitation not found',
            });
        }
        await prisma.projectInvitation.update({
            where: { id: invitationId },
            data: {
                status: client_1.ProjectInvitationStatus.ACCEPTED,
                respondedAt: new Date(),
            },
        });
        await prisma.projectMember.create({
            data: {
                projectId: invitation.projectId,
                userId: userId,
                role: invitation.role,
            },
        });
        return res.json({
            success: true,
            message: 'Invitation accepted successfully',
        });
    }
    catch (error) {
        logger_1.logger.error('Failed to accept invitation:', error);
        return res.status(500).json({
            success: false,
            message: 'Failed to accept invitation',
        });
    }
});
router.put('/:invitationId/decline', async (req, res) => {
    try {
        const { invitationId } = req.params;
        const prisma = (0, database_1.getPrismaClient)();
        const invitation = await prisma.projectInvitation.findUnique({
            where: { id: invitationId },
        });
        if (!invitation) {
            return res.status(404).json({
                success: false,
                message: 'Invitation not found',
            });
        }
        await prisma.projectInvitation.update({
            where: { id: invitationId },
            data: {
                status: client_1.ProjectInvitationStatus.DECLINED,
                respondedAt: new Date(),
            },
        });
        return res.json({
            success: true,
            message: 'Invitation declined successfully',
        });
    }
    catch (error) {
        logger_1.logger.error('Failed to decline invitation:', error);
        return res.status(500).json({
            success: false,
            message: 'Failed to decline invitation',
        });
    }
});
router.post('/:invitationId/resend', async (req, res) => {
    try {
        const { invitationId } = req.params;
        const userId = req.user.id;
        const prisma = (0, database_1.getPrismaClient)();
        const invitation = await prisma.projectInvitation.findUnique({
            where: { id: invitationId },
        });
        if (!invitation) {
            return res.status(404).json({
                success: false,
                message: 'Invitation not found',
            });
        }
        if (invitation.invitedBy !== userId) {
            return res.status(403).json({
                success: false,
                message: 'You do not have permission to resend this invitation',
            });
        }
        const newExpiresAt = new Date();
        newExpiresAt.setDate(newExpiresAt.getDate() + 7);
        await prisma.projectInvitation.update({
            where: { id: invitationId },
            data: {
                status: client_1.ProjectInvitationStatus.PENDING,
                expiresAt: newExpiresAt,
                respondedAt: null,
            },
        });
        return res.json({
            success: true,
            message: 'Invitation resent successfully',
        });
    }
    catch (error) {
        logger_1.logger.error('Failed to resend invitation:', error);
        return res.status(500).json({
            success: false,
            message: 'Failed to resend invitation',
        });
    }
});
router.get('/:token', async (req, res) => {
    try {
        const { token } = req.params;
        const invitation = await invitationService_1.invitationService.getInvitationByToken(token);
        if (!invitation) {
            throw new types_1.NotFoundError('Invitation');
        }
        res.json({
            success: true,
            data: invitation,
        });
    }
    catch (error) {
        logger_1.logger.error('Failed to get invitation:', error);
        throw error;
    }
});
router.post('/:token/accept', async (req, res) => {
    try {
        const { token } = req.params;
        const userId = req.user?.id;
        if (!userId) {
            return res.status(401).json({
                success: false,
                message: 'Authentication required to accept invitation',
            });
        }
        const result = await invitationService_1.invitationService.acceptInvitation(token, userId);
        if (!result.success) {
            return res.status(400).json({
                success: false,
                message: result.message,
            });
        }
        return res.json({
            success: true,
            message: result.message,
        });
    }
    catch (error) {
        logger_1.logger.error('Failed to accept invitation:', error);
        return res.status(500).json({
            success: false,
            message: 'Failed to accept invitation',
        });
    }
});
router.post('/:token/decline', async (req, res) => {
    try {
        const { token } = req.params;
        const result = await invitationService_1.invitationService.declineInvitation(token);
        if (!result.success) {
            return res.status(400).json({
                success: false,
                message: result.message,
            });
        }
        return res.json({
            success: true,
            message: result.message,
        });
    }
    catch (error) {
        logger_1.logger.error('Failed to decline invitation:', error);
        return res.status(500).json({
            success: false,
            message: 'Failed to decline invitation',
        });
    }
});
router.delete('/:invitationId', async (req, res) => {
    try {
        const { invitationId } = req.params;
        const userId = req.user.id;
        const result = await invitationService_1.invitationService.cancelInvitation(invitationId, userId);
        if (!result.success) {
            return res.status(400).json({
                success: false,
                message: result.message,
            });
        }
        return res.json({
            success: true,
            message: result.message,
        });
    }
    catch (error) {
        logger_1.logger.error('Failed to cancel invitation:', error);
        return res.status(500).json({
            success: false,
            message: 'Failed to cancel invitation',
        });
    }
});
router.get('/user/pending', async (req, res) => {
    try {
        const userId = req.user.id;
        const prisma = (0, database_1.getPrismaClient)();
        const user = await prisma.user.findUnique({
            where: { id: userId },
            select: { email: true },
        });
        if (!user) {
            throw new types_1.NotFoundError('User');
        }
        const invitations = await prisma.projectInvitation.findMany({
            where: {
                email: user.email,
                status: client_1.ProjectInvitationStatus.PENDING,
                expiresAt: { gt: new Date() },
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
            orderBy: { createdAt: 'desc' },
        });
        const mappedInvitations = invitations.map(invitation => ({
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
        }));
        res.json({
            success: true,
            data: mappedInvitations,
        });
    }
    catch (error) {
        logger_1.logger.error('Failed to get pending invitations:', error);
        throw error;
    }
});
router.get('/user/sent', async (req, res) => {
    try {
        const userId = req.user.id;
        const prisma = (0, database_1.getPrismaClient)();
        const invitations = await prisma.projectInvitation.findMany({
            where: {
                invitedBy: userId,
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
            orderBy: { createdAt: 'desc' },
        });
        const mappedInvitations = invitations.map(invitation => ({
            id: invitation.id,
            projectId: invitation.projectId,
            projectName: invitation.project.title,
            inviterId: invitation.invitedBy,
            inviterName: invitation.inviter.name || invitation.inviter.email,
            inviteeEmail: invitation.email,
            role: invitation.role,
            status: invitation.status,
            createdAt: invitation.invitedAt.toISOString(),
            expiresAt: invitation.expiresAt.toISOString(),
            acceptedAt: invitation.respondedAt?.toISOString(),
        }));
        res.json({
            success: true,
            data: mappedInvitations,
        });
    }
    catch (error) {
        logger_1.logger.error('Failed to get sent invitations:', error);
        throw error;
    }
});
router.get('/user/all', async (req, res) => {
    try {
        const userId = req.user.id;
        const prisma = (0, database_1.getPrismaClient)();
        const user = await prisma.user.findUnique({
            where: { id: userId },
            select: { email: true },
        });
        if (!user) {
            throw new types_1.NotFoundError('User');
        }
        const receivedInvitations = await prisma.projectInvitation.findMany({
            where: {
                email: user.email,
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
            orderBy: { createdAt: 'desc' },
        });
        const sentInvitations = await prisma.projectInvitation.findMany({
            where: {
                invitedBy: userId,
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
            orderBy: { createdAt: 'desc' },
        });
        const mappedReceived = receivedInvitations.map(invitation => ({
            id: invitation.id,
            projectId: invitation.projectId,
            projectName: invitation.project.title,
            inviterId: invitation.invitedBy,
            inviterName: invitation.inviter.name || invitation.inviter.email,
            inviterEmail: invitation.inviter.email,
            inviteeEmail: invitation.email,
            role: invitation.role,
            status: invitation.status,
            createdAt: invitation.invitedAt.toISOString(),
            expiresAt: invitation.expiresAt.toISOString(),
            respondedAt: invitation.respondedAt?.toISOString(),
            type: 'received',
        }));
        const mappedSent = sentInvitations.map(invitation => ({
            id: invitation.id,
            projectId: invitation.projectId,
            projectName: invitation.project.title,
            inviterId: invitation.invitedBy,
            inviterName: invitation.inviter.name || invitation.inviter.email,
            inviterEmail: invitation.inviter.email,
            inviteeEmail: invitation.email,
            role: invitation.role,
            status: invitation.status,
            createdAt: invitation.invitedAt.toISOString(),
            expiresAt: invitation.expiresAt.toISOString(),
            respondedAt: invitation.respondedAt?.toISOString(),
            type: 'sent',
        }));
        res.json({
            success: true,
            data: {
                received: mappedReceived,
                sent: mappedSent,
                total: mappedReceived.length + mappedSent.length,
            },
        });
    }
    catch (error) {
        logger_1.logger.error('Failed to get all user invitations:', error);
        throw error;
    }
});
exports.default = router;
//# sourceMappingURL=invitation.js.map