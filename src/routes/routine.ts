import { Router, Response } from 'express';
import Joi from 'joi';
import { authenticateToken } from '../middleware/auth';
import { AuthenticatedRequest } from '../types';
import { logger } from '../utils/logger';
import { routineService, CreateRoutineData, CreateRoutineTaskData } from '../services/routineService';
import { scheduleRoutineNotifications, cancelRoutineNotifications, cancelRoutineTaskNotifications, scheduleRoutineTaskNotifications } from '../services/notificationScheduler';

const router = Router();

// Apply authentication to all routes
router.use(authenticateToken);

// Validation schemas
const createRoutineSchema = Joi.object({
  title: Joi.string().trim().min(1).required(),
  description: Joi.string().trim().allow('', null).optional(),
  frequency: Joi.string().valid('DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY').required(),
  schedule: Joi.object({
    time: Joi.string().pattern(/^\d{2}:\d{2}$/).optional(),
    days: Joi.array().items(Joi.number().min(0).max(6)).optional(),
    day: Joi.number().min(1).max(31).optional(),
  }).required(),
  timezone: Joi.string().optional().default('UTC'),
});

const updateRoutineSchema = Joi.object({
  title: Joi.string().trim().min(1).optional(),
  description: Joi.string().trim().allow('', null).optional(),
  frequency: Joi.string().valid('DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY').optional(),
  schedule: Joi.object({
    time: Joi.string().pattern(/^\d{2}:\d{2}$/).optional(),
    days: Joi.array().items(Joi.number().min(0).max(6)).optional(),
    day: Joi.number().min(1).max(31).optional(),
  }).optional(),
  timezone: Joi.string().optional(),
  enabled: Joi.boolean().optional(),
});

const createTaskSchema = Joi.object({
  title: Joi.string().required(),
  description: Joi.string().optional(),
  order: Joi.number().optional(),
  reminderTime: Joi.string().optional(),
});

// GET /api/v1/routines
router.get('/', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user!.id;
    const routines = await routineService.getUserRoutines(userId);
    
    return res.json({
      success: true,
      data: routines,
    });
  } catch (error) {
    logger.error('Failed to get routines:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to get routines',
    });
  }
});

// POST /api/v1/routines
router.post('/', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user!.id;
    const { error, value } = createRoutineSchema.validate(req.body);
    
    if (error) {
      return res.status(400).json({
        success: false,
        message: error.details[0].message,
      });
    }
    
    // Convert empty description to undefined/null
    if (value.description === '' || value.description === null) {
      value.description = undefined;
    }
    
    const routine = await routineService.createRoutine(userId, value as CreateRoutineData);
    
    // Schedule notifications for all tasks in the routine
    if (routine.enabled) {
      scheduleRoutineNotifications(routine.id, userId)
        .catch(err => logger.error('Failed to schedule routine notifications:', err));
    }
    
    return res.status(201).json({
      success: true,
      data: routine,
    });
  } catch (error) {
    logger.error('Failed to create routine:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to create routine',
    });
  }
});

// GET /api/v1/routines/:routineId
router.get('/:routineId', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user!.id;
    const { routineId } = req.params;
    
    const routine = await routineService.getRoutineById(routineId, userId);
    
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
  } catch (error) {
    logger.error('Failed to get routine:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to get routine',
    });
  }
});

// PUT /api/v1/routines/:routineId
router.put('/:routineId', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user!.id;
    const { routineId } = req.params;
    const { error, value } = updateRoutineSchema.validate(req.body);
    
    if (error) {
      return res.status(400).json({
        success: false,
        message: error.details[0].message,
      });
    }
    
    // Convert empty description to undefined/null
    if (value.description === '' || value.description === null) {
      value.description = undefined;
    }
    
    const routine = await routineService.updateRoutine(routineId, userId, value);
    
    // Reschedule notifications if routine is enabled, otherwise cancel them
    if (routine.enabled) {
      // Cancel existing notifications first
      await cancelRoutineNotifications(routineId, userId);
      // Schedule new notifications
      scheduleRoutineNotifications(routineId, userId)
        .catch(err => logger.error('Failed to schedule routine notifications:', err));
    } else {
      // Cancel notifications if routine is disabled
      cancelRoutineNotifications(routineId, userId)
        .catch(err => logger.error('Failed to cancel routine notifications:', err));
    }
    
    return res.json({
      success: true,
      data: routine,
    });
  } catch (error: any) {
    logger.error('Failed to update routine:', error);
    return res.status(500).json({
      success: false,
      message: error.message || 'Failed to update routine',
    });
  }
});

// DELETE /api/v1/routines/:routineId
router.delete('/:routineId', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user!.id;
    const { routineId } = req.params;
    
    await routineService.deleteRoutine(routineId, userId);
    
    // Cancel all notifications for this routine
    cancelRoutineNotifications(routineId, userId)
      .catch(err => logger.error('Failed to cancel routine notifications:', err));
    
    return res.json({
      success: true,
      message: 'Routine deleted successfully',
    });
  } catch (error: any) {
    logger.error('Failed to delete routine:', error);
    return res.status(500).json({
      success: false,
      message: error.message || 'Failed to delete routine',
    });
  }
});

// POST /api/v1/routines/:routineId/tasks
router.post('/:routineId/tasks', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user!.id;
    const { routineId } = req.params;
    const { error, value } = createTaskSchema.validate(req.body);
    
    if (error) {
      return res.status(400).json({
        success: false,
        message: error.details[0].message,
      });
    }
    
    const task = await routineService.addTaskToRoutine(routineId, userId, value as CreateRoutineTaskData);
    
    // Get routine details to schedule notification
    const routine = await routineService.getRoutineById(routineId, userId);
    if (routine && routine.enabled) {
      const schedule = routine.schedule as any;
      scheduleRoutineTaskNotifications(
        routineId,
        userId,
        routine.title,
        routine.frequency,
        schedule,
        routine.timezone,
        task.id,
        task.title,
        task.reminderTime
      ).catch(err => logger.error('Failed to schedule routine task notification:', err));
    }
    
    return res.status(201).json({
      success: true,
      data: task,
    });
  } catch (error: any) {
    logger.error('Failed to add task to routine:', error);
    return res.status(500).json({
      success: false,
      message: error.message || 'Failed to add task',
    });
  }
});

// PUT /api/v1/routines/tasks/:taskId
router.put('/tasks/:taskId', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user!.id;
    const { taskId } = req.params;
    
    // Get task first to get routineId
    const { getPrismaClient } = await import('../utils/database');
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
    
    const task = await routineService.updateRoutineTask(taskId, userId, req.body);
    
    // Get routine details to reschedule notification
    const routine = existingTask.routine;
    if (routine.enabled) {
      // Cancel existing notification
      await cancelRoutineTaskNotifications(taskId, userId);
      // Schedule new notification
      const schedule = routine.schedule as any;
      scheduleRoutineTaskNotifications(
        routine.id,
        userId,
        routine.title,
        routine.frequency,
        schedule,
        routine.timezone,
        task.id,
        task.title,
        task.reminderTime
      ).catch(err => logger.error('Failed to schedule routine task notification:', err));
    } else {
      // Cancel notification if routine is disabled
      cancelRoutineTaskNotifications(taskId, userId)
        .catch(err => logger.error('Failed to cancel routine task notification:', err));
    }
    
    return res.json({
      success: true,
      data: task,
    });
  } catch (error: any) {
    logger.error('Failed to update task:', error);
    return res.status(500).json({
      success: false,
      message: error.message || 'Failed to update task',
    });
  }
});

// DELETE /api/v1/routines/tasks/:taskId
router.delete('/tasks/:taskId', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user!.id;
    const { taskId } = req.params;
    
    await routineService.deleteRoutineTask(taskId, userId);
    
    // Cancel notifications for this task
    cancelRoutineTaskNotifications(taskId, userId)
      .catch(err => logger.error('Failed to cancel routine task notification:', err));
    
    return res.json({
      success: true,
      message: 'Task deleted successfully',
    });
  } catch (error: any) {
    logger.error('Failed to delete task:', error);
    return res.status(500).json({
      success: false,
      message: error.message || 'Failed to delete task',
    });
  }
});

// PUT /api/v1/routines/tasks/:taskId/toggle
router.put('/tasks/:taskId/toggle', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user!.id;
    const { taskId } = req.params;
    const { completed } = req.body;
    
    const task = await routineService.toggleTaskCompletion(taskId, userId, completed);
    
    return res.json({
      success: true,
      data: task,
    });
  } catch (error: any) {
    logger.error('Failed to toggle task:', error);
    return res.status(500).json({
      success: false,
      message: error.message || 'Failed to toggle task',
    });
  }
});

// POST /api/v1/routines/:routineId/reset
router.post('/:routineId/reset', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user!.id;
    const { routineId } = req.params;
    
    // Get routine first to check if it exists and is enabled
    const routine = await routineService.getRoutineById(routineId, userId);
    if (!routine) {
      return res.status(404).json({
        success: false,
        message: 'Routine not found',
      });
    }
    
    await routineService.resetRoutineTasks(routineId);
    
    // Reschedule notifications for the next occurrence after reset if routine is enabled
    if (routine.enabled) {
      scheduleRoutineNotifications(routineId, userId)
        .catch(err => logger.error('Failed to reschedule routine notifications after reset:', err));
    }
    
    return res.json({
      success: true,
      message: 'Routine reset successfully',
    });
  } catch (error: any) {
    logger.error('Failed to reset routine:', error);
    return res.status(500).json({
      success: false,
      message: error.message || 'Failed to reset routine',
    });
  }
});

export default router;

