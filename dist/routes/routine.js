"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const joi_1 = __importDefault(require("joi"));
const auth_1 = require("../middleware/auth");
const logger_1 = require("../utils/logger");
const routineService_1 = require("../services/routineService");
const router = (0, express_1.Router)();
router.use(auth_1.authenticateToken);
const createRoutineSchema = joi_1.default.object({
    title: joi_1.default.string().trim().min(1).required(),
    description: joi_1.default.string().trim().allow('', null).optional(),
    frequency: joi_1.default.string().valid('DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY').required(),
    schedule: joi_1.default.object({
        time: joi_1.default.string().pattern(/^\d{2}:\d{2}$/).optional(),
        days: joi_1.default.array().items(joi_1.default.number().min(0).max(6)).optional(),
        day: joi_1.default.number().min(1).max(31).optional(),
    }).required(),
    timezone: joi_1.default.string().optional().default('UTC'),
});
const updateRoutineSchema = joi_1.default.object({
    title: joi_1.default.string().trim().min(1).optional(),
    description: joi_1.default.string().trim().allow('', null).optional(),
    frequency: joi_1.default.string().valid('DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY').optional(),
    schedule: joi_1.default.object({
        time: joi_1.default.string().pattern(/^\d{2}:\d{2}$/).optional(),
        days: joi_1.default.array().items(joi_1.default.number().min(0).max(6)).optional(),
        day: joi_1.default.number().min(1).max(31).optional(),
    }).optional(),
    timezone: joi_1.default.string().optional(),
    enabled: joi_1.default.boolean().optional(),
});
const createTaskSchema = joi_1.default.object({
    title: joi_1.default.string().required(),
    description: joi_1.default.string().optional(),
    order: joi_1.default.number().optional(),
    reminderTime: joi_1.default.string().optional(),
});
router.get('/', async (req, res) => {
    try {
        const userId = req.user.id;
        const routines = await routineService_1.routineService.getUserRoutines(userId);
        return res.json({
            success: true,
            data: routines,
        });
    }
    catch (error) {
        logger_1.logger.error('Failed to get routines:', error);
        return res.status(500).json({
            success: false,
            message: 'Failed to get routines',
        });
    }
});
router.post('/', async (req, res) => {
    try {
        const userId = req.user.id;
        const { error, value } = createRoutineSchema.validate(req.body);
        if (error) {
            return res.status(400).json({
                success: false,
                message: error.details[0].message,
            });
        }
        if (value.description === '' || value.description === null) {
            value.description = undefined;
        }
        const routine = await routineService_1.routineService.createRoutine(userId, value);
        return res.status(201).json({
            success: true,
            data: routine,
        });
    }
    catch (error) {
        logger_1.logger.error('Failed to create routine:', error);
        return res.status(500).json({
            success: false,
            message: 'Failed to create routine',
        });
    }
});
router.get('/:routineId', async (req, res) => {
    try {
        const userId = req.user.id;
        const { routineId } = req.params;
        const routine = await routineService_1.routineService.getRoutineById(routineId, userId);
        if (!routine) {
            return res.status(404).json({
                success: false,
                message: 'Routine not found',
            });
        }
        return res.json({
            success: true,
            data: routine,
        });
    }
    catch (error) {
        logger_1.logger.error('Failed to get routine:', error);
        return res.status(500).json({
            success: false,
            message: 'Failed to get routine',
        });
    }
});
router.put('/:routineId', async (req, res) => {
    try {
        const userId = req.user.id;
        const { routineId } = req.params;
        const { error, value } = updateRoutineSchema.validate(req.body);
        if (error) {
            return res.status(400).json({
                success: false,
                message: error.details[0].message,
            });
        }
        if (value.description === '' || value.description === null) {
            value.description = undefined;
        }
        const routine = await routineService_1.routineService.updateRoutine(routineId, userId, value);
        return res.json({
            success: true,
            data: routine,
        });
    }
    catch (error) {
        logger_1.logger.error('Failed to update routine:', error);
        return res.status(500).json({
            success: false,
            message: error.message || 'Failed to update routine',
        });
    }
});
router.delete('/:routineId', async (req, res) => {
    try {
        const userId = req.user.id;
        const { routineId } = req.params;
        await routineService_1.routineService.deleteRoutine(routineId, userId);
        return res.json({
            success: true,
            message: 'Routine deleted successfully',
        });
    }
    catch (error) {
        logger_1.logger.error('Failed to delete routine:', error);
        return res.status(500).json({
            success: false,
            message: error.message || 'Failed to delete routine',
        });
    }
});
router.post('/:routineId/tasks', async (req, res) => {
    try {
        const userId = req.user.id;
        const { routineId } = req.params;
        const { error, value } = createTaskSchema.validate(req.body);
        if (error) {
            return res.status(400).json({
                success: false,
                message: error.details[0].message,
            });
        }
        const task = await routineService_1.routineService.addTaskToRoutine(routineId, userId, value);
        return res.status(201).json({
            success: true,
            data: task,
        });
    }
    catch (error) {
        logger_1.logger.error('Failed to add task to routine:', error);
        return res.status(500).json({
            success: false,
            message: error.message || 'Failed to add task',
        });
    }
});
router.put('/tasks/:taskId', async (req, res) => {
    try {
        const userId = req.user.id;
        const { taskId } = req.params;
        const task = await routineService_1.routineService.updateRoutineTask(taskId, userId, req.body);
        return res.json({
            success: true,
            data: task,
        });
    }
    catch (error) {
        logger_1.logger.error('Failed to update task:', error);
        return res.status(500).json({
            success: false,
            message: error.message || 'Failed to update task',
        });
    }
});
router.delete('/tasks/:taskId', async (req, res) => {
    try {
        const userId = req.user.id;
        const { taskId } = req.params;
        await routineService_1.routineService.deleteRoutineTask(taskId, userId);
        return res.json({
            success: true,
            message: 'Task deleted successfully',
        });
    }
    catch (error) {
        logger_1.logger.error('Failed to delete task:', error);
        return res.status(500).json({
            success: false,
            message: error.message || 'Failed to delete task',
        });
    }
});
router.put('/tasks/:taskId/toggle', async (req, res) => {
    try {
        const userId = req.user.id;
        const { taskId } = req.params;
        const { completed } = req.body;
        const task = await routineService_1.routineService.toggleTaskCompletion(taskId, userId, completed);
        return res.json({
            success: true,
            data: task,
        });
    }
    catch (error) {
        logger_1.logger.error('Failed to toggle task:', error);
        return res.status(500).json({
            success: false,
            message: error.message || 'Failed to toggle task',
        });
    }
});
router.post('/:routineId/reset', async (req, res) => {
    try {
        const { routineId } = req.params;
        await routineService_1.routineService.resetRoutineTasks(routineId);
        return res.json({
            success: true,
            message: 'Routine reset successfully',
        });
    }
    catch (error) {
        logger_1.logger.error('Failed to reset routine:', error);
        return res.status(500).json({
            success: false,
            message: error.message || 'Failed to reset routine',
        });
    }
});
exports.default = router;
//# sourceMappingURL=routine.js.map