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
const aiService_1 = require("../services/aiService");
const logger_1 = require("../utils/logger");
const router = (0, express_1.Router)();
router.use(auth_1.authenticateToken);
const generatePlanSchema = joi_1.default.object({
    goalId: joi_1.default.string().uuid().required(),
    promptOptions: joi_1.default.object({
        intensity: joi_1.default.string().valid('low', 'medium', 'high').optional(),
        weeklyHours: joi_1.default.number().min(1).max(168).optional(),
        language: joi_1.default.string().valid('en', 'ar').optional(),
        tone: joi_1.default.string().valid('supportive', 'professional', 'casual').optional(),
    }).optional(),
});
router.post('/generate-plan', async (req, res) => {
    try {
        const { error, value } = generatePlanSchema.validate(req.body);
        if (error) {
            throw new types_1.ValidationError(error.details[0].message);
        }
        const { goalId, promptOptions = {} } = value;
        const userId = req.user.id;
        const prisma = (0, database_1.getPrismaClient)();
        const goal = await prisma.goal.findFirst({
            where: {
                id: goalId,
                userId,
            },
        });
        if (!goal) {
            return res.status(404).json({
                success: false,
                error: 'Goal not found',
            });
        }
        const plan = await aiService_1.aiService.generatePlan(goal.title, goal.description || '', goal.targetDate?.toISOString() || new Date().toISOString(), promptOptions);
        const createdMilestones = [];
        const createdTasks = [];
        for (const milestoneData of plan.milestones) {
            const milestone = await prisma.milestone.create({
                data: {
                    goalId: goal.id,
                    title: milestoneData.title,
                    status: 'TODO',
                },
            });
            createdMilestones.push(milestone);
        }
        for (const taskData of plan.tasks) {
            const milestone = createdMilestones[taskData.milestoneIndex];
            const dueDate = new Date();
            dueDate.setDate(dueDate.getDate() + taskData.dueOffsetDays);
            const task = await prisma.task.create({
                data: {
                    title: taskData.title,
                    description: taskData.description,
                    creatorId: userId,
                    goalId: goal.id,
                    milestoneId: milestone?.id,
                    priority: 'MEDIUM',
                    status: 'TODO',
                    dueDate: dueDate,
                    recurrenceRule: taskData.recurrence,
                    metadata: {
                        durationMinutes: taskData.durationMinutes,
                        aiGenerated: true,
                    },
                },
            });
            createdTasks.push(task);
        }
        await prisma.goal.update({
            where: { id: goal.id },
            data: {
                planGenerated: true,
                planSource: 'AI',
            },
        });
        logger_1.logger.info('AI plan generated successfully', {
            goalId,
            userId,
            milestonesCount: createdMilestones.length,
            tasksCount: createdTasks.length,
        });
        return res.json({
            success: true,
            data: {
                plan,
                milestones: createdMilestones,
                tasks: createdTasks,
            },
            message: 'Plan generated successfully',
        });
    }
    catch (error) {
        logger_1.logger.error('AI plan generation error:', error);
        throw error;
    }
});
router.post('/generate-simple-plan', async (req, res) => {
    try {
        const { goalTitle } = req.body;
        if (!goalTitle) {
            throw new types_1.ValidationError('Goal title is required');
        }
        const plan = await aiService_1.aiService.generateSimplePlan(goalTitle);
        return res.json({
            success: true,
            data: plan,
            message: 'Simple plan generated successfully',
        });
    }
    catch (error) {
        logger_1.logger.error('Simple plan generation error:', error);
        throw error;
    }
});
exports.default = router;
//# sourceMappingURL=ai.js.map