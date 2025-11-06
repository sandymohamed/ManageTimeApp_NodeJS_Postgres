import { Router, Response } from 'express';
import Joi from 'joi';
import { getPrismaClient } from '../utils/database';
import { authenticateToken } from '../middleware/auth';
import { AuthenticatedRequest, ValidationError, NotFoundError } from '../types';
import { logger } from '../utils/logger';

const router = Router();

// Apply authentication to all routes
router.use(authenticateToken);

const createAlarmSchema = Joi.object({
  title: Joi.string().min(1).max(255).required(),
  time: Joi.date().required(),
  timezone: Joi.string().optional(),
  recurrenceRule: Joi.string().optional(),
  toneUrl: Joi.string().optional(),
  smartWakeWindow: Joi.number().min(5).max(60).optional(),
  linkedTaskId: Joi.string().uuid().optional(),
  enabled: Joi.boolean().optional(),
  snoozeConfig: Joi.object({
    duration: Joi.number().min(1).max(60).required(),
    maxSnoozes: Joi.number().min(0).max(10).required(),
    snoozeCount: Joi.number().min(0).optional(),
  }).optional(),
});

const updateAlarmSchema = Joi.object({
  title: Joi.string().min(1).max(255).optional(),
  time: Joi.date().optional(),
  timezone: Joi.string().optional(),
  recurrenceRule: Joi.string().optional(),
  toneUrl: Joi.string().optional(),
  smartWakeWindow: Joi.number().min(5).max(60).optional(),
  linkedTaskId: Joi.string().uuid().optional(),
  enabled: Joi.boolean().optional(),
  snoozeConfig: Joi.object({
    duration: Joi.number().min(1).max(60).required(),
    maxSnoozes: Joi.number().min(0).max(10).required(),
    snoozeCount: Joi.number().min(0).optional(),
  }).optional(),
});

// GET /api/v1/alarms
router.get('/', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { page = 1, limit = 20, enabled } = req.query;
    const userId = req.user!.id;
    const prisma = getPrismaClient();

    const where: any = {
      userId,
    };

    if (enabled !== undefined) {
      where.enabled = enabled === 'true';
    }

    const [alarms, total] = await Promise.all([
      prisma.alarm.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (Number(page) - 1) * Number(limit),
        take: Number(limit),
      }),
      prisma.alarm.count({ where }),
    ]);

    res.json({
      success: true,
      data: alarms,
      pagination: {
        page: Number(page),
        limit: Number(limit),
        total,
        totalPages: Math.ceil(total / Number(limit)),
      },
    });
  } catch (error) {
    logger.error('Failed to get alarms:', error);
    throw error;
  }
});

// GET /api/v1/alarms/:id
router.get('/:id', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { id } = req.params;
    const userId = req.user!.id;
    const prisma = getPrismaClient();

    const alarm = await prisma.alarm.findFirst({
      where: {
        id,
        userId,
      },
    });

    if (!alarm) {
      throw new NotFoundError('Alarm');
    }

    res.json({
      success: true,
      data: alarm,
    });
  } catch (error) {
    logger.error('Failed to get alarm:', error);
    throw error;
  }
});

// POST /api/v1/alarms
router.post('/', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { error, value } = createAlarmSchema.validate(req.body);
    if (error) {
      throw new ValidationError(error.details[0].message);
    }

    const userId = req.user!.id;
    const prisma = getPrismaClient();

    const alarm = await prisma.alarm.create({
      data: {
        ...value,
        userId,
        snoozeConfig: value.snoozeConfig,
      },
    });

    logger.info('Alarm created successfully', { alarmId: alarm.id, userId });

    res.status(201).json({
      success: true,
      data: alarm,
      message: 'Alarm created successfully',
    });
  } catch (error) {
    logger.error('Failed to create alarm:', error);
    throw error;
  }
});

// PUT /api/v1/alarms/:id
router.put('/:id', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { error, value } = updateAlarmSchema.validate(req.body);
    if (error) {
      throw new ValidationError(error.details[0].message);
    }

    const userId = req.user!.id;
    const prisma = getPrismaClient();

    const alarm = await prisma.alarm.findFirst({
      where: { id, userId },
    });

    if (!alarm) {
      throw new NotFoundError('Alarm');
    }

    const updatedAlarm = await prisma.alarm.update({
      where: { id },
      data: {
        ...value,
        snoozeConfig: value.snoozeConfig,
      },
    });

    logger.info('Alarm updated successfully', { alarmId: id, userId });

    res.json({
      success: true,
      data: updatedAlarm,
      message: 'Alarm updated successfully',
    });
  } catch (error) {
    logger.error('Failed to update alarm:', error);
    throw error;
  }
});

// DELETE /api/v1/alarms/:id
router.delete('/:id', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { id } = req.params;
    const userId = req.user!.id;
    const prisma = getPrismaClient();

    // Check if alarm exists and belongs to user
    const alarm = await prisma.alarm.findFirst({
      where: { id, userId },
    });

    if (!alarm) {
      // Alarm doesn't exist or already deleted - return success (idempotent)
      logger.info('Alarm not found or already deleted', { alarmId: id, userId });
      return res.json({
        success: true,
        message: 'Alarm deleted successfully',
      });
    }

    // Delete the alarm
    await prisma.alarm.delete({
      where: { id },
    });

    // Cancel any scheduled notifications
    try {
      const { notificationService } = await import('../services/notificationService');
      notificationService.cancelAlarm(id);
    } catch (notifError) {
      // Ignore notification cancellation errors
      logger.warn('Failed to cancel alarm notification', { alarmId: id, error: notifError });
    }

    logger.info('Alarm deleted successfully', { alarmId: id, userId });

    res.json({
      success: true,
      message: 'Alarm deleted successfully',
    });
  } catch (error: any) {
    // Handle Prisma error for record not found (P2025)
    if (error.code === 'P2025') {
      logger.info('Alarm already deleted', { alarmId: req.params.id, userId: req.user!.id });
      return res.json({
        success: true,
        message: 'Alarm deleted successfully',
      });
    }
    
    logger.error('Failed to delete alarm:', error);
    throw error;
  }
});

// POST /api/v1/alarms/:id/snooze
router.post('/:id/snooze', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { duration } = req.body;
    const userId = req.user!.id;
    const prisma = getPrismaClient();

    const alarm = await prisma.alarm.findFirst({
      where: { id, userId },
    });

    if (!alarm) {
      throw new NotFoundError('Alarm');
    }

    // TODO: Implement snooze logic
    logger.info('Alarm snoozed', { alarmId: id, duration, userId });

    res.json({
      success: true,
      message: 'Alarm snoozed successfully',
    });
  } catch (error) {
    logger.error('Failed to snooze alarm:', error);
    throw error;
  }
});

// POST /api/v1/alarms/:id/dismiss
router.post('/:id/dismiss', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { id } = req.params;
    const userId = req.user!.id;
    const prisma = getPrismaClient();

    const alarm = await prisma.alarm.findFirst({
      where: { id, userId },
    });

    if (!alarm) {
      // Alarm doesn't exist or already deleted - return success (idempotent)
      logger.info('Alarm not found or already deleted for dismiss', { alarmId: id, userId });
      return res.json({
        success: true,
        message: 'Alarm dismissed successfully',
      });
    }

    // TODO: Implement dismiss logic (e.g., mark as dismissed, update last dismissed time)
    logger.info('Alarm dismissed', { alarmId: id, userId });

    res.json({
      success: true,
      message: 'Alarm dismissed successfully',
    });
  } catch (error: any) {
    // Handle Prisma error for record not found (P2025)
    if (error.code === 'P2025') {
      logger.info('Alarm already deleted during dismiss', { alarmId: req.params.id, userId: req.user!.id });
      return res.json({
        success: true,
        message: 'Alarm dismissed successfully',
      });
    }
    
    logger.error('Failed to dismiss alarm:', error);
    throw error;
  }
});

export default router;