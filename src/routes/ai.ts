import { Router, Response } from 'express';
import Joi from 'joi';
import { getPrismaClient } from '../utils/database';
import { authenticateToken } from '../middleware/auth';
import { AuthenticatedRequest, ValidationError } from '../types';
import { aiService } from '../services/aiService';
import { logger } from '../utils/logger';

const router = Router();

// Apply authentication to all routes
router.use(authenticateToken);

const generatePlanSchema = Joi.object({
  goalId: Joi.string().uuid().required(),
  promptOptions: Joi.object({
    intensity: Joi.string().valid('low', 'medium', 'high').optional(),
    weeklyHours: Joi.number().min(1).max(168).optional(),
    language: Joi.string().valid('en', 'ar').optional(),
    tone: Joi.string().valid('supportive', 'professional', 'casual').optional(),
  }).optional(),
});

// POST /api/v1/ai/generate-plan
router.post('/generate-plan', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { error, value } = generatePlanSchema.validate(req.body);
    if (error) {
      throw new ValidationError(error.details[0].message);
    }

    const { goalId, promptOptions = {} } = value;
    const userId = req.user!.id;
    const prisma = getPrismaClient();

    // Get the goal
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

    // Generate the plan using AI
    const plan = await aiService.generatePlan(
      goal.title,
      goal.description || '',
      goal.targetDate?.toISOString() || new Date().toISOString(),
      promptOptions
    );

    // Create milestones and tasks in the database
    const createdMilestones = [];
    const createdTasks = [];

    for (const milestoneData of plan.milestones) {
      // 
      const milestone = await prisma.milestone.create({
        data: {
          goalId: goal.id,
          title: milestoneData.title,
          // description: milestoneData.description,
          // durationDays: milestoneData.durationDays,
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

    // Update goal to mark as plan generated
    await prisma.goal.update({
      where: { id: goal.id },
      data: {
        planGenerated: true,
        planSource: 'AI',
      },
    });

    logger.info('AI plan generated successfully', {
      goalId,
      userId,
      milestonesCount: createdMilestones.length,
      tasksCount: createdTasks.length,
    });

  return  res.json({
      success: true,
      data: {
        plan,
        milestones: createdMilestones,
        tasks: createdTasks,
      },
      message: 'Plan generated successfully',
    });
  } catch (error) {
    logger.error('AI plan generation error:', error);
    throw error;
  }
});

// POST /api/v1/ai/generate-simple-plan
router.post('/generate-simple-plan', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { goalTitle } = req.body;

    if (!goalTitle) {
      throw new ValidationError('Goal title is required');
    }

    // Generate a simple plan for testing
    const plan = await aiService.generateSimplePlan(goalTitle);

    return  res.json({
      success: true,
      data: plan,
      message: 'Simple plan generated successfully',
    });
  } catch (error) {
    logger.error('Simple plan generation error:', error);
    throw error;
  }
});

export default router;
