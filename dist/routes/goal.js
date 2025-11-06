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
const createGoalSchema = joi_1.default.object({
    title: joi_1.default.string().min(1).max(255).required(),
    description: joi_1.default.string().max(1000).optional(),
    status: joi_1.default.string().valid('DRAFT', 'ACTIVE', 'PAUSED', 'DONE', 'CANCELLED').optional(),
    priority: joi_1.default.string().valid('LOW', 'MEDIUM', 'HIGH', 'URGENT').optional(),
    category: joi_1.default.string().max(100).optional(),
    targetDate: joi_1.default.date().optional(),
    progress: joi_1.default.number().min(0).max(100).optional(),
    metadata: joi_1.default.object().optional(),
});
const updateGoalSchema = joi_1.default.object({
    title: joi_1.default.string().min(1).max(255).optional(),
    description: joi_1.default.string().max(1000).optional(),
    status: joi_1.default.string().valid('DRAFT', 'ACTIVE', 'PAUSED', 'DONE', 'CANCELLED').optional(),
    priority: joi_1.default.string().valid('LOW', 'MEDIUM', 'HIGH', 'URGENT').optional(),
    category: joi_1.default.string().max(100).optional(),
    targetDate: joi_1.default.date().optional(),
    progress: joi_1.default.number().min(0).max(100).optional(),
    completedAt: joi_1.default.date().optional(),
    metadata: joi_1.default.object().optional(),
});
router.get('/', async (req, res) => {
    try {
        const { page = 1, limit = 20, search, status } = req.query;
        const userId = req.user.id;
        const prisma = (0, database_1.getPrismaClient)();
        const where = {
            userId,
        };
        if (search) {
            where.OR = [
                { title: { contains: search, mode: 'insensitive' } },
                { description: { contains: search, mode: 'insensitive' } },
            ];
        }
        if (status) {
            where.status = status;
        }
        const [goals, total] = await Promise.all([
            prisma.goal.findMany({
                where,
                include: {
                    milestones: {
                        orderBy: { createdAt: 'asc' },
                    },
                    _count: {
                        select: { milestones: true, tasks: true },
                    },
                },
                orderBy: { createdAt: 'desc' },
                skip: (Number(page) - 1) * Number(limit),
                take: Number(limit),
            }),
            prisma.goal.count({ where }),
        ]);
        res.json({
            success: true,
            data: goals,
            pagination: {
                page: Number(page),
                limit: Number(limit),
                total,
                totalPages: Math.ceil(total / Number(limit)),
            },
        });
    }
    catch (error) {
        logger_1.logger.error('Failed to get goals:', error);
        throw error;
    }
});
router.get('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const userId = req.user.id;
        const prisma = (0, database_1.getPrismaClient)();
        const goal = await prisma.goal.findFirst({
            where: {
                id,
                userId,
            },
            include: {
                milestones: {
                    orderBy: { createdAt: 'asc' },
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
                    select: { milestones: true, tasks: true },
                },
            },
        });
        if (!goal) {
            throw new types_1.NotFoundError('Goal');
        }
        res.json({
            success: true,
            data: goal,
        });
    }
    catch (error) {
        logger_1.logger.error('Failed to get goal:', error);
        throw error;
    }
});
router.post('/', async (req, res) => {
    try {
        const { error, value } = createGoalSchema.validate(req.body);
        if (error) {
            throw new types_1.ValidationError(error.details[0].message);
        }
        const userId = req.user.id;
        const prisma = (0, database_1.getPrismaClient)();
        const goal = await prisma.goal.create({
            data: {
                ...value,
                userId,
            },
            include: {
                milestones: true,
                _count: {
                    select: { milestones: true, tasks: true },
                },
            },
        });
        logger_1.logger.info('Goal created successfully', { goalId: goal.id, userId });
        res.status(201).json({
            success: true,
            data: goal,
            message: 'Goal created successfully',
        });
    }
    catch (error) {
        logger_1.logger.error('Failed to create goal:', error);
        throw error;
    }
});
router.put('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { error, value } = updateGoalSchema.validate(req.body);
        if (error) {
            throw new types_1.ValidationError(error.details[0].message);
        }
        const userId = req.user.id;
        const prisma = (0, database_1.getPrismaClient)();
        const goal = await prisma.goal.findFirst({
            where: { id, userId },
        });
        if (!goal) {
            throw new types_1.NotFoundError('Goal');
        }
        const updatedGoal = await prisma.goal.update({
            where: { id },
            data: value,
            include: {
                milestones: {
                    orderBy: { createdAt: 'asc' },
                },
                _count: {
                    select: { milestones: true, tasks: true },
                },
            },
        });
        logger_1.logger.info('Goal updated successfully', { goalId: id, userId });
        res.json({
            success: true,
            data: updatedGoal,
            message: 'Goal updated successfully',
        });
    }
    catch (error) {
        logger_1.logger.error('Failed to update goal:', error);
        throw error;
    }
});
router.delete('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const userId = req.user.id;
        const prisma = (0, database_1.getPrismaClient)();
        const goal = await prisma.goal.findFirst({
            where: { id, userId },
        });
        if (!goal) {
            throw new types_1.NotFoundError('Goal');
        }
        await prisma.goal.delete({
            where: { id },
        });
        logger_1.logger.info('Goal deleted successfully', { goalId: id, userId });
        res.json({
            success: true,
            message: 'Goal deleted successfully',
        });
    }
    catch (error) {
        logger_1.logger.error('Failed to delete goal:', error);
        throw error;
    }
});
router.post('/:id/milestones/:milestoneId/complete', async (req, res) => {
    try {
        const { id, milestoneId } = req.params;
        const { status, } = req.body;
        const userId = req.user.id;
        const prisma = (0, database_1.getPrismaClient)();
        const goal = await prisma.goal.findFirst({
            where: { id, userId },
        });
        if (!goal) {
            throw new types_1.NotFoundError('Goal');
        }
        const milestone = await prisma.milestone.update({
            where: { id: milestoneId },
            data: {
                status: 'DONE',
                completedAt: status === 'DONE' ? new Date() : null,
            },
        });
        res.json({
            success: true,
            data: milestone,
            message: 'Milestone Completed successfully',
        });
    }
    catch (error) {
        logger_1.logger.error('Failed to update milestone:', error);
        throw error;
    }
});
router.post('/:id/milestones', async (req, res) => {
    try {
        const { id } = req.params;
        const { title, description, dueDate, weight } = req.body;
        const userId = req.user.id;
        const prisma = (0, database_1.getPrismaClient)();
        const goal = await prisma.goal.findFirst({
            where: { id, userId },
        });
        if (!goal) {
            throw new types_1.NotFoundError('Goal');
        }
        const milestone = await prisma.milestone.create({
            data: {
                goalId: id,
                title,
                dueDate: dueDate ? new Date(dueDate) : null,
                weight: weight || 0,
                status: 'TODO',
            },
        });
        res.status(201).json({
            success: true,
            data: milestone,
            message: 'Milestone created successfully',
        });
    }
    catch (error) {
        logger_1.logger.error('Failed to create milestone:', error);
        throw error;
    }
});
router.put('/:id/milestones/:milestoneId', async (req, res) => {
    try {
        const { id, milestoneId } = req.params;
        const { title, description, dueDate, weight, status, completedAt } = req.body;
        const userId = req.user.id;
        const prisma = (0, database_1.getPrismaClient)();
        const goal = await prisma.goal.findFirst({
            where: { id, userId },
        });
        if (!goal) {
            throw new types_1.NotFoundError('Goal');
        }
        const milestone = await prisma.milestone.update({
            where: { id: milestoneId },
            data: {
                title,
                description,
                dueDate: dueDate ? new Date(dueDate) : null,
                weight,
                status,
                completedAt: completedAt ? new Date(completedAt) : null,
            },
        });
        logger_1.logger.info('Milestone updated successfully', { goalId: id, milestoneId, userId });
        res.json({
            success: true,
            data: milestone,
            message: 'Milestone updated successfully',
        });
    }
    catch (error) {
        logger_1.logger.error('Failed to update milestone:', error);
        throw error;
    }
});
router.delete('/:id/milestones/:milestoneId', async (req, res) => {
    try {
        const { id, milestoneId } = req.params;
        const userId = req.user.id;
        const prisma = (0, database_1.getPrismaClient)();
        const goal = await prisma.goal.findFirst({
            where: { id, userId },
        });
        if (!goal) {
            throw new types_1.NotFoundError('Goal');
        }
        await prisma.milestone.delete({
            where: { id: milestoneId },
        });
        logger_1.logger.info('Milestone deleted successfully', { goalId: id, milestoneId, userId });
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
//# sourceMappingURL=goal.js.map