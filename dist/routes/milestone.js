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
const router = (0, express_1.Router)();
router.use(auth_1.authenticateToken);
const createMilestoneSchema = joi_1.default.object({
    title: joi_1.default.string().min(1).max(255).required(),
    description: joi_1.default.string().max(1000).optional(),
    startDate: joi_1.default.date().required(),
    dueDate: joi_1.default.date().required(),
});
const updateMilestoneSchema = joi_1.default.object({
    title: joi_1.default.string().min(1).max(255).optional(),
    description: joi_1.default.string().max(1000).optional(),
    startDate: joi_1.default.date().optional(),
    dueDate: joi_1.default.date().optional(),
    status: joi_1.default.string().valid('TODO', 'IN_PROGRESS', 'DONE', 'CANCELLED').optional(),
    completedAt: joi_1.default.date().optional(),
});
const mapMilestoneToFrontend = (milestone) => {
    return {
        ...milestone,
        projectId: milestone.projectId || milestone.goalId,
    };
};
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
                    { members: { some: { userId } } },
                ],
            },
        });
        if (!project) {
            throw new types_1.NotFoundError('Project');
        }
        const milestones = await prisma.milestone.findMany({
            where: {
                projectId: projectId,
            },
            include: {
                tasks: {
                    select: {
                        id: true,
                        title: true,
                        status: true,
                    },
                },
            },
            orderBy: {
                startDate: 'asc',
            },
        });
        res.json({
            success: true,
            data: milestones.map(mapMilestoneToFrontend),
        });
    }
    catch (error) {
        logger_1.logger.error('Failed to get project milestones:', error);
        throw error;
    }
});
router.post('/project/:projectId', async (req, res) => {
    try {
        const { projectId } = req.params;
        const { error, value } = createMilestoneSchema.validate(req.body);
        if (error) {
            throw new types_1.ValidationError(error.details[0].message);
        }
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
            throw new types_1.NotFoundError('Project');
        }
        if (new Date(value.startDate) > new Date(value.dueDate)) {
            throw new types_1.ValidationError('Due date must be after start date');
        }
        const milestone = await prisma.milestone.create({
            data: {
                title: value.title,
                description: value.description,
                startDate: value.startDate,
                dueDate: value.dueDate,
                projectId: projectId,
                status: 'TODO',
            },
            include: {
                tasks: {
                    select: {
                        id: true,
                        title: true,
                        status: true,
                    },
                },
            },
        });
        logger_1.logger.info('Milestone created successfully', { milestoneId: milestone.id, projectId, userId });
        res.status(201).json({
            success: true,
            data: mapMilestoneToFrontend(milestone),
            message: 'Milestone created successfully',
        });
    }
    catch (error) {
        logger_1.logger.error('Failed to create milestone:', error);
        throw error;
    }
});
router.get('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const userId = req.user.id;
        const prisma = (0, database_1.getPrismaClient)();
        const milestone = await prisma.milestone.findFirst({
            where: {
                id,
                OR: [
                    { project: { ownerId: userId } },
                    { project: { members: { some: { userId } } } },
                    { goal: { userId } },
                ],
            },
            include: {
                project: {
                    select: {
                        id: true,
                        title: true,
                    },
                },
                goal: {
                    select: {
                        id: true,
                        title: true,
                    },
                },
                tasks: {
                    include: {
                        assignee: {
                            select: {
                                id: true,
                                name: true,
                                email: true,
                            },
                        },
                    },
                },
            },
        });
        if (!milestone) {
            throw new types_1.NotFoundError('Milestone');
        }
        res.json({
            success: true,
            data: mapMilestoneToFrontend(milestone),
        });
    }
    catch (error) {
        logger_1.logger.error('Failed to get milestone:', error);
        throw error;
    }
});
router.put('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { error, value } = updateMilestoneSchema.validate(req.body);
        if (error) {
            throw new types_1.ValidationError(error.details[0].message);
        }
        const userId = req.user.id;
        const prisma = (0, database_1.getPrismaClient)();
        const milestone = await prisma.milestone.findFirst({
            where: {
                id,
                OR: [
                    { project: { ownerId: userId } },
                    { project: { members: { some: { userId, role: { in: ['OWNER', 'EDITOR'] } } } } },
                    { goal: { userId } },
                ],
            },
        });
        if (!milestone) {
            throw new types_1.NotFoundError('Milestone');
        }
        if (value.startDate && value.dueDate && new Date(value.startDate) > new Date(value.dueDate)) {
            throw new types_1.ValidationError('Due date must be after start date');
        }
        const updatedMilestone = await prisma.milestone.update({
            where: { id },
            data: value,
            include: {
                project: {
                    select: {
                        id: true,
                        title: true,
                    },
                },
                goal: {
                    select: {
                        id: true,
                        title: true,
                    },
                },
                tasks: {
                    include: {
                        assignee: {
                            select: {
                                id: true,
                                name: true,
                                email: true,
                            },
                        },
                    },
                },
            },
        });
        logger_1.logger.info('Milestone updated successfully', { milestoneId: id, userId });
        res.json({
            success: true,
            data: mapMilestoneToFrontend(updatedMilestone),
            message: 'Milestone updated successfully',
        });
    }
    catch (error) {
        logger_1.logger.error('Failed to update milestone:', error);
        throw error;
    }
});
router.delete('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const userId = req.user.id;
        const prisma = (0, database_1.getPrismaClient)();
        const milestone = await prisma.milestone.findFirst({
            where: {
                id,
                OR: [
                    { project: { ownerId: userId } },
                    { project: { members: { some: { userId, role: { in: ['OWNER', 'EDITOR'] } } } } },
                    { goal: { userId } },
                ],
            },
        });
        if (!milestone) {
            throw new types_1.NotFoundError('Milestone');
        }
        await prisma.milestone.delete({
            where: { id },
        });
        logger_1.logger.info('Milestone deleted successfully', { milestoneId: id, userId });
        res.json({
            success: true,
            message: 'Milestone deleted successfully',
        });
    }
    catch (error) {
        logger_1.logger.error('Failed to delete milestone:', error);
        throw error;
    }
});
exports.default = router;
//# sourceMappingURL=milestone.js.map