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
const client_1 = require("@prisma/client");
const router = (0, express_1.Router)();
router.use(auth_1.authenticateToken);
const mapProjectToFrontend = (project) => {
    return {
        ...project,
        name: project.title,
        status: project.status || 'PLANNING',
        members: project.members?.map((member) => ({
            id: member.id,
            userId: member.userId,
            userName: member.user?.name || '',
            userEmail: member.user?.email || '',
            role: member.role,
            joinedAt: member.createdAt,
        })) || [],
        isDeleted: false,
        syncedAt: project.updatedAt,
    };
};
const createProjectSchema = joi_1.default.object({
    name: joi_1.default.string().min(1).max(255).required(),
    description: joi_1.default.string().max(1000).allow('').optional(),
    color: joi_1.default.string().pattern(/^#[0-9A-Fa-f]{6}$/).optional(),
    startDate: joi_1.default.date().allow(null).optional(),
    endDate: joi_1.default.date().allow(null).optional(),
    isPublic: joi_1.default.boolean().optional(),
});
const updateProjectSchema = joi_1.default.object({
    name: joi_1.default.string().min(1).max(255).optional(),
    description: joi_1.default.string().max(1000).allow('').optional(),
    color: joi_1.default.string().pattern(/^#[0-9A-Fa-f]{6}$/).optional(),
    startDate: joi_1.default.date().allow(null).optional(),
    endDate: joi_1.default.date().allow(null).optional(),
    isPublic: joi_1.default.boolean().optional(),
});
const addMemberSchema = joi_1.default.object({
    email: joi_1.default.string().email().required(),
    role: joi_1.default.string().valid('EDITOR', 'VIEWER').required(),
});
router.get('/', async (req, res) => {
    try {
        const { page = 1, limit = 20, search } = req.query;
        const userId = req.user.id;
        const prisma = (0, database_1.getPrismaClient)();
        const where = {
            AND: [
                {
                    OR: [
                        { ownerId: userId },
                        { members: { some: { userId } } },
                    ],
                },
                ...(search
                    ? [
                        {
                            OR: [
                                {
                                    title: {
                                        contains: search,
                                        mode: client_1.Prisma.QueryMode.insensitive,
                                    },
                                },
                                {
                                    description: {
                                        contains: search,
                                        mode: client_1.Prisma.QueryMode.insensitive,
                                    },
                                },
                            ],
                        },
                    ]
                    : []),
            ],
        };
        const [projects, total] = await Promise.all([
            prisma.project.findMany({
                where,
                include: {
                    owner: { select: { id: true, name: true, email: true } },
                    members: {
                        include: {
                            user: { select: { id: true, name: true, email: true } },
                        },
                    },
                    _count: { select: { tasks: true } },
                },
                orderBy: { updatedAt: 'desc' },
                skip: (Number(page) - 1) * Number(limit),
                take: Number(limit),
            }),
            prisma.project.count({ where }),
        ]);
        res.json({
            success: true,
            data: {
                data: projects.map(mapProjectToFrontend),
                pagination: {
                    page: Number(page),
                    limit: Number(limit),
                    total,
                    totalPages: Math.ceil(total / Number(limit)),
                },
            },
        });
    }
    catch (error) {
        logger_1.logger.error('Failed to get projects:', error);
        throw error;
    }
});
router.get('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const userId = req.user.id;
        const prisma = (0, database_1.getPrismaClient)();
        const project = await prisma.project.findFirst({
            where: {
                id,
                OR: [
                    { ownerId: userId },
                    { members: { some: { userId } } },
                ],
            },
            include: {
                owner: {
                    select: { id: true, name: true, email: true },
                },
                members: {
                    include: {
                        user: {
                            select: { id: true, name: true, email: true },
                        },
                    },
                },
                tasks: {
                    include: {
                        creator: {
                            select: { id: true, name: true, email: true },
                        },
                        assignee: {
                            select: { id: true, name: true, email: true },
                        },
                    },
                    orderBy: { createdAt: 'desc' },
                },
                _count: {
                    select: { tasks: true },
                },
            },
        });
        if (!project) {
            throw new types_1.NotFoundError('Project');
        }
        res.json({
            success: true,
            data: mapProjectToFrontend(project),
        });
    }
    catch (error) {
        logger_1.logger.error('Failed to get project:', error);
        throw error;
    }
});
router.post('/', async (req, res) => {
    try {
        const { error, value } = createProjectSchema.validate(req.body);
        if (error) {
            throw new types_1.ValidationError(error.details[0].message);
        }
        const userId = req.user.id;
        const prisma = (0, database_1.getPrismaClient)();
        const project = await prisma.project.create({
            data: {
                title: value.name,
                description: value.description,
                color: value.color,
                startDate: value.startDate,
                endDate: value.endDate,
                isPublic: value.isPublic,
                ownerId: userId,
            },
            include: {
                owner: {
                    select: { id: true, name: true, email: true },
                },
                members: {
                    include: {
                        user: {
                            select: { id: true, name: true, email: true },
                        },
                    },
                },
                _count: {
                    select: { tasks: true },
                },
            },
        });
        await prisma.projectMember.create({
            data: {
                projectId: project.id,
                userId: userId,
                role: 'OWNER',
            },
        });
        logger_1.logger.info('Project created successfully', { projectId: project.id, userId });
        res.status(201).json({
            success: true,
            data: mapProjectToFrontend(project),
            message: 'Project created successfully',
        });
    }
    catch (error) {
        logger_1.logger.error('Failed to create project:', error);
        throw error;
    }
});
router.put('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { error, value } = updateProjectSchema.validate(req.body);
        if (error) {
            throw new types_1.ValidationError(error.details[0].message);
        }
        const userId = req.user.id;
        const prisma = (0, database_1.getPrismaClient)();
        const project = await prisma.project.findFirst({
            where: {
                id,
                OR: [
                    { ownerId: userId },
                    { members: { some: { userId, role: { in: ['OWNER', 'EDITOR'] } } } },
                ],
            },
        });
        if (!project) {
            throw new types_1.NotFoundError('Project');
        }
        const updateData = {};
        if (value.name !== undefined)
            updateData.title = value.name;
        if (value.description !== undefined)
            updateData.description = value.description;
        if (value.color !== undefined)
            updateData.color = value.color;
        if (value.startDate !== undefined)
            updateData.startDate = value.startDate;
        if (value.endDate !== undefined)
            updateData.endDate = value.endDate;
        if (value.isPublic !== undefined)
            updateData.isPublic = value.isPublic;
        const updatedProject = await prisma.project.update({
            where: { id },
            data: updateData,
            include: {
                owner: {
                    select: { id: true, name: true, email: true },
                },
                members: {
                    include: {
                        user: {
                            select: { id: true, name: true, email: true },
                        },
                    },
                },
                _count: {
                    select: { tasks: true },
                },
            },
        });
        logger_1.logger.info('Project updated successfully', { projectId: id, userId });
        res.json({
            success: true,
            data: mapProjectToFrontend(updatedProject),
            message: 'Project updated successfully',
        });
    }
    catch (error) {
        logger_1.logger.error('Failed to update project:', error);
        throw error;
    }
});
router.delete('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const userId = req.user.id;
        const prisma = (0, database_1.getPrismaClient)();
        const project = await prisma.project.findFirst({
            where: { id, ownerId: userId },
        });
        if (!project) {
            throw new types_1.NotFoundError('Project');
        }
        await prisma.project.delete({
            where: { id },
        });
        logger_1.logger.info('Project deleted successfully', { projectId: id, userId });
        res.json({
            success: true,
            message: 'Project deleted successfully',
        });
    }
    catch (error) {
        logger_1.logger.error('Failed to delete project:', error);
        throw error;
    }
});
router.post('/:id/members', async (req, res) => {
    try {
        const { id } = req.params;
        const { error, value } = addMemberSchema.validate(req.body);
        if (error) {
            throw new types_1.ValidationError(error.details[0].message);
        }
        const userId = req.user.id;
        const prisma = (0, database_1.getPrismaClient)();
        const project = await prisma.project.findFirst({
            where: {
                id,
                OR: [
                    { ownerId: userId },
                    { members: { some: { userId, role: { in: ['OWNER', 'EDITOR'] } } } },
                ],
            },
        });
        if (!project) {
            throw new types_1.NotFoundError('Project');
        }
        const user = await prisma.user.findUnique({
            where: { email: value.email },
        });
        if (!user) {
            throw new types_1.NotFoundError('User');
        }
        const existingMember = await prisma.projectMember.findFirst({
            where: {
                projectId: id,
                userId: user.id,
            },
        });
        if (existingMember) {
            throw new types_1.ValidationError('User is already a member of this project');
        }
        const member = await prisma.projectMember.create({
            data: {
                projectId: id,
                userId: user.id,
                role: value.role,
            },
            include: {
                user: {
                    select: { id: true, name: true, email: true },
                },
            },
        });
        logger_1.logger.info('Member added to project', { projectId: id, memberId: user.id, userId });
        res.status(201).json({
            success: true,
            data: member,
            message: 'Member added successfully',
        });
    }
    catch (error) {
        logger_1.logger.error('Failed to add member:', error);
        throw error;
    }
});
router.put('/:id/members/:memberId', async (req, res) => {
    try {
        const { id, memberId } = req.params;
        const { role } = req.body;
        const userId = req.user.id;
        const prisma = (0, database_1.getPrismaClient)();
        const project = await prisma.project.findFirst({
            where: { id, ownerId: userId },
        });
        if (!project) {
            throw new types_1.AuthorizationError('Only project owners can change member roles');
        }
        const member = await prisma.projectMember.update({
            where: {
                id: memberId,
                projectId: id,
            },
            data: { role },
            include: {
                user: {
                    select: { id: true, name: true, email: true },
                },
            },
        });
        logger_1.logger.info('Member role updated', { projectId: id, memberId, userId });
        res.json({
            success: true,
            data: member,
            message: 'Member role updated successfully',
        });
    }
    catch (error) {
        logger_1.logger.error('Failed to update member role:', error);
        throw error;
    }
});
router.delete('/:id/members/:memberId', async (req, res) => {
    try {
        const { id, memberId } = req.params;
        const userId = req.user.id;
        const prisma = (0, database_1.getPrismaClient)();
        const project = await prisma.project.findFirst({
            where: { id, ownerId: userId },
        });
        const member = await prisma.projectMember.findFirst({
            where: {
                id: memberId,
                projectId: id,
            },
        });
        if (!member) {
            throw new types_1.NotFoundError('Member');
        }
        if (!project && member.userId !== userId) {
            throw new types_1.AuthorizationError('Only project owners can remove members');
        }
        await prisma.projectMember.delete({
            where: { id: memberId },
        });
        logger_1.logger.info('Member removed from project', { projectId: id, memberId, userId });
        res.json({
            success: true,
            message: 'Member removed successfully',
        });
    }
    catch (error) {
        logger_1.logger.error('Failed to remove member:', error);
        throw error;
    }
});
exports.default = router;
//# sourceMappingURL=project.js.map