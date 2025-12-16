"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const joi_1 = __importDefault(require("joi"));
const auth_1 = require("../middleware/auth");
const logger_1 = require("../utils/logger");
const routineService_1 = require("../services/routineService");
const notificationScheduler_1 = require("../services/notificationScheduler");
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
    reminderBefore: joi_1.default.string().pattern(/^\d+[hdw]$/).optional().allow(null, ''),
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
    reminderBefore: joi_1.default.string().pattern(/^\d+[hdw]$/).optional().allow(null, ''),
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
        console.log('Failed to get routines:', error);
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
        if (value.reminderBefore === '' || value.reminderBefore === null) {
            value.reminderBefore = undefined;
        }
        const routine = await routineService_1.routineService.createRoutine(userId, value);
        try {
            await routineService_1.routineService.addTaskToRoutine(routine.id, userId, {
                title: value.title,
                description: value.description,
                order: 0,
            });
            let routineWithTask;
            try {
                routineWithTask = await routineService_1.routineService.getRoutineById(routine.id, userId);
            }
            catch (getError) {
                if (getError?.code === 'P1017' || getError?.message?.includes('connection')) {
                    logger_1.logger.warn('Connection error when getting routine, retrying...', { routineId: routine.id });
                    await new Promise(resolve => setTimeout(resolve, 500));
                    routineWithTask = await routineService_1.routineService.getRoutineById(routine.id, userId);
                }
                else {
                    throw getError;
                }
            }
            if (routineWithTask && routineWithTask.enabled) {
                (0, notificationScheduler_1.scheduleRoutineNotifications)(routine.id, userId)
                    .catch(err => logger_1.logger.error('Failed to schedule routine notifications:', err));
            }
            return res.status(201).json({
                success: true,
                data: routineWithTask || routine,
            });
        }
        catch (taskError) {
            logger_1.logger.error('Failed to create automatic task for routine:', taskError);
            if (routine.enabled) {
                (0, notificationScheduler_1.scheduleRoutineNotifications)(routine.id, userId)
                    .catch(err => logger_1.logger.error('Failed to schedule routine notifications:', err));
            }
            return res.status(201).json({
                success: true,
                data: routine,
                warning: 'Routine created but automatic task creation failed',
            });
        }
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
        if (value.reminderBefore === '' || value.reminderBefore === null) {
            value.reminderBefore = undefined;
        }
        const routine = await routineService_1.routineService.updateRoutine(routineId, userId, value);
        if (value.title !== undefined || value.description !== undefined) {
            try {
                const routineTasks = routine.routineTasks || [];
                if (routineTasks.length > 0) {
                    const taskToUpdate = routineTasks[0];
                    const updateTaskData = {};
                    if (value.title !== undefined) {
                        updateTaskData.title = value.title;
                    }
                    if (value.description !== undefined) {
                        updateTaskData.description = value.description || null;
                    }
                    await routineService_1.routineService.updateRoutineTask(taskToUpdate.id, userId, updateTaskData);
                    const updatedRoutine = await routineService_1.routineService.getRoutineById(routineId, userId);
                    if (updatedRoutine && updatedRoutine.enabled) {
                        await (0, notificationScheduler_1.cancelRoutineNotifications)(routineId, userId);
                        (0, notificationScheduler_1.scheduleRoutineNotifications)(routineId, userId)
                            .catch(err => logger_1.logger.error('Failed to schedule routine notifications:', err));
                    }
                    else {
                        (0, notificationScheduler_1.cancelRoutineNotifications)(routineId, userId)
                            .catch(err => logger_1.logger.error('Failed to cancel routine notifications:', err));
                    }
                    return res.json({
                        success: true,
                        data: updatedRoutine || routine,
                    });
                }
            }
            catch (taskError) {
                logger_1.logger.error('Failed to update routine task:', taskError);
            }
        }
        if (routine.enabled) {
            await (0, notificationScheduler_1.cancelRoutineNotifications)(routineId, userId);
            (0, notificationScheduler_1.scheduleRoutineNotifications)(routineId, userId)
                .catch(err => logger_1.logger.error('Failed to schedule routine notifications:', err));
        }
        else {
            (0, notificationScheduler_1.cancelRoutineNotifications)(routineId, userId)
                .catch(err => logger_1.logger.error('Failed to cancel routine notifications:', err));
        }
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
        (0, notificationScheduler_1.cancelRoutineNotifications)(routineId, userId)
            .catch(err => logger_1.logger.error('Failed to cancel routine notifications:', err));
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
        const routine = await routineService_1.routineService.getRoutineById(routineId, userId);
        if (routine && routine.enabled) {
            const schedule = routine.schedule;
            (0, notificationScheduler_1.scheduleRoutineTaskNotifications)(routineId, userId, routine.title, routine.frequency, schedule, routine.timezone, task.id, task.title, task.reminderTime).catch(err => logger_1.logger.error('Failed to schedule routine task notification:', err));
        }
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
        const { getPrismaClient } = await Promise.resolve().then(() => __importStar(require('../utils/database')));
        const prisma = getPrismaClient();
        const existingTask = await prisma.routineTask.findUnique({
            where: { id: taskId },
            include: { routine: true },
        });
        if (!existingTask || existingTask.routine.userId !== userId) {
            return res.status(404).json({
                success: false,
                message: 'Task not found',
            });
        }
        const task = await routineService_1.routineService.updateRoutineTask(taskId, userId, req.body);
        const routine = existingTask.routine;
        if (routine.enabled) {
            await (0, notificationScheduler_1.cancelRoutineTaskNotifications)(taskId, userId);
            const schedule = routine.schedule;
            (0, notificationScheduler_1.scheduleRoutineTaskNotifications)(routine.id, userId, routine.title, routine.frequency, schedule, routine.timezone, task.id, task.title, task.reminderTime).catch(err => logger_1.logger.error('Failed to schedule routine task notification:', err));
        }
        else {
            (0, notificationScheduler_1.cancelRoutineTaskNotifications)(taskId, userId)
                .catch(err => logger_1.logger.error('Failed to cancel routine task notification:', err));
        }
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
        (0, notificationScheduler_1.cancelRoutineTaskNotifications)(taskId, userId)
            .catch(err => logger_1.logger.error('Failed to cancel routine task notification:', err));
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
        const userId = req.user.id;
        const { routineId } = req.params;
        const routine = await routineService_1.routineService.getRoutineById(routineId, userId);
        if (!routine) {
            return res.status(404).json({
                success: false,
                message: 'Routine not found',
            });
        }
        await routineService_1.routineService.resetRoutineTasks(routineId);
        if (routine.enabled) {
            (0, notificationScheduler_1.scheduleRoutineNotifications)(routineId, userId)
                .catch(err => logger_1.logger.error('Failed to reschedule routine notifications after reset:', err));
        }
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