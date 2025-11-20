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
const analyticsQuerySchema = joi_1.default.object({
    period: joi_1.default.string().valid('7d', '30d', '90d', '1y').optional(),
    startDate: joi_1.default.date().optional(),
    endDate: joi_1.default.date().optional(),
});
router.get('/summary', async (req, res) => {
    try {
        const { error, value } = analyticsQuerySchema.validate(req.query);
        if (error) {
            throw new types_1.ValidationError(error.details[0].message);
        }
        const { period = '30d', startDate, endDate } = value;
        const userId = req.user.id;
        const prisma = (0, database_1.getPrismaClient)();
        const now = new Date();
        let dateFrom;
        if (startDate && endDate) {
            dateFrom = new Date(startDate);
        }
        else {
            switch (period) {
                case '7d':
                    dateFrom = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
                    break;
                case '30d':
                    dateFrom = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
                    break;
                case '90d':
                    dateFrom = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
                    break;
                case '1y':
                    dateFrom = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);
                    break;
                default:
                    dateFrom = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
            }
        }
        const dateTo = endDate ? new Date(endDate) : now;
        const [tasksCompleted, tasksCreated, goalsCompleted, goalsCreated, totalTasks,] = await Promise.all([
            prisma.task.count({
                where: {
                    OR: [
                        { creatorId: userId },
                        { assigneeId: userId },
                        { project: { members: { some: { userId } } } },
                    ],
                    status: 'DONE',
                    updatedAt: { gte: dateFrom, lte: dateTo },
                },
            }),
            prisma.task.count({
                where: {
                    OR: [
                        { creatorId: userId },
                        { assigneeId: userId },
                        { project: { members: { some: { userId } } } },
                    ],
                    createdAt: { gte: dateFrom, lte: dateTo },
                },
            }),
            prisma.goal.count({
                where: {
                    userId,
                    planGenerated: true,
                    updatedAt: { gte: dateFrom, lte: dateTo },
                },
            }),
            prisma.goal.count({
                where: {
                    userId,
                    createdAt: { gte: dateFrom, lte: dateTo },
                },
            }),
            prisma.task.count({
                where: {
                    OR: [
                        { creatorId: userId },
                        { assigneeId: userId },
                        { project: { members: { some: { userId } } } },
                    ],
                },
            }),
        ]);
        const productivityScore = totalTasks > 0 ? Math.round((tasksCompleted / totalTasks) * 100) : 0;
        const averageTaskCompletionTime = 2.5;
        const mostProductiveDay = 'Tuesday';
        const mostProductiveTime = '10:00';
        const categoryBreakdown = await prisma.task.groupBy({
            by: ['priority'],
            where: {
                OR: [
                    { creatorId: userId },
                    { assigneeId: userId },
                    { project: { members: { some: { userId } } } },
                ],
                createdAt: { gte: dateFrom, lte: dateTo },
            },
            _count: {
                priority: true,
            },
        });
        const totalTasksInPeriod = categoryBreakdown.reduce((sum, item) => sum + item._count.priority, 0);
        const categoryBreakdownFormatted = categoryBreakdown.map((item) => ({
            category: item.priority,
            count: item._count.priority,
            percentage: totalTasksInPeriod > 0 ? Math.round((item._count.priority / totalTasksInPeriod) * 100) : 0,
        }));
        const analyticsSummary = {
            period,
            tasksCompleted,
            tasksCreated,
            goalsCompleted,
            goalsCreated,
            productivityScore,
            averageTaskCompletionTime,
            mostProductiveDay,
            mostProductiveTime,
            categoryBreakdown: categoryBreakdownFormatted,
        };
        res.json({
            success: true,
            data: analyticsSummary,
        });
    }
    catch (error) {
        logger_1.logger.error('Failed to get analytics summary:', error);
        throw error;
    }
});
router.get('/productivity', async (req, res) => {
    try {
        const { period = '30d' } = req.query;
        const userId = req.user.id;
        const prisma = (0, database_1.getPrismaClient)();
        const now = new Date();
        let dateFrom;
        switch (period) {
            case '7d':
                dateFrom = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
                break;
            case '30d':
                dateFrom = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
                break;
            case '90d':
                dateFrom = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
                break;
            case '1y':
                dateFrom = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);
                break;
            default:
                dateFrom = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        }
        const dailyProductivity = await prisma.task.groupBy({
            by: ['createdAt'],
            where: {
                OR: [
                    { creatorId: userId },
                    { assigneeId: userId },
                    { project: { members: { some: { userId } } } },
                ],
                createdAt: { gte: dateFrom, lte: now },
                status: 'DONE',
            },
            _count: {
                id: true,
            },
        });
        const productivityData = dailyProductivity.map((item) => ({
            date: item.createdAt.toISOString().split('T')[0],
            completed: item._count.id,
        }));
        res.json({
            success: true,
            data: {
                period,
                dailyProductivity: productivityData,
            },
        });
    }
    catch (error) {
        logger_1.logger.error('Failed to get productivity data:', error);
        throw error;
    }
});
router.get('/goals', async (req, res) => {
    try {
        const { period = '30d' } = req.query;
        const userId = req.user.id;
        const prisma = (0, database_1.getPrismaClient)();
        const now = new Date();
        let dateFrom;
        switch (period) {
            case '7d':
                dateFrom = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
                break;
            case '30d':
                dateFrom = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
                break;
            case '90d':
                dateFrom = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
                break;
            case '1y':
                dateFrom = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);
                break;
            default:
                dateFrom = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        }
        const goals = await prisma.goal.findMany({
            where: {
                userId,
                createdAt: { gte: dateFrom, lte: now },
            },
            include: {
                milestones: true,
                _count: {
                    select: { milestones: true, tasks: true },
                },
            },
        });
        const goalProgress = goals.map((goal) => {
            const completedMilestones = goal.milestones.filter((m) => m.status === 'DONE').length;
            const totalMilestones = goal.milestones.length;
            const progressPercentage = totalMilestones > 0 ? Math.round((completedMilestones / totalMilestones) * 100) : 0;
            return {
                id: goal.id,
                title: goal.title,
                progress: progressPercentage,
                completedMilestones,
                totalMilestones,
                createdAt: goal.createdAt,
                targetDate: goal.targetDate,
            };
        });
        res.json({
            success: true,
            data: {
                period,
                goals: goalProgress,
            },
        });
    }
    catch (error) {
        logger_1.logger.error('Failed to get goal analytics:', error);
        throw error;
    }
});
router.get('/tasks', async (req, res) => {
    try {
        const { period = '30d' } = req.query;
        const userId = req.user.id;
        const prisma = (0, database_1.getPrismaClient)();
        const now = new Date();
        let dateFrom;
        switch (period) {
            case '7d':
                dateFrom = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
                break;
            case '30d':
                dateFrom = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
                break;
            case '90d':
                dateFrom = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
                break;
            case '1y':
                dateFrom = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);
                break;
            default:
                dateFrom = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        }
        const taskTrends = await prisma.task.groupBy({
            by: ['status', 'priority'],
            where: {
                OR: [
                    { creatorId: userId },
                    { assigneeId: userId },
                    { project: { members: { some: { userId } } } },
                ],
                createdAt: { gte: dateFrom, lte: now },
            },
            _count: {
                id: true,
            },
        });
        const taskData = taskTrends.map((item) => ({
            status: item.status,
            priority: item.priority,
            count: item._count.id,
        }));
        res.json({
            success: true,
            data: {
                period,
                tasks: taskData,
            },
        });
    }
    catch (error) {
        logger_1.logger.error('Failed to get task analytics:', error);
        throw error;
    }
});
exports.default = router;
//# sourceMappingURL=analytics.js.map