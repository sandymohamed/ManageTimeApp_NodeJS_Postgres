import { Router, Response } from 'express';
import Joi from 'joi';
import { getPrismaClient } from '../utils/database';
import { authenticateToken } from '../middleware/auth';
import { AuthenticatedRequest, ValidationError, NotFoundError } from '../types';
import { logger } from '../utils/logger';

const router = Router();

// Apply authentication to all routes
router.use(authenticateToken);

const createMilestoneSchema = Joi.object({
  title: Joi.string().min(1).max(255).required(),
  description: Joi.string().max(1000).optional(),
  startDate: Joi.date().required(),
  dueDate: Joi.date().required(),
});

const updateMilestoneSchema = Joi.object({
  title: Joi.string().min(1).max(255).optional(),
  description: Joi.string().max(1000).optional(),
  startDate: Joi.date().optional(),
  dueDate: Joi.date().optional(),
  status: Joi.string().valid('TODO', 'IN_PROGRESS', 'DONE', 'CANCELLED').optional(),
  completedAt: Joi.date().optional(),
});

// Helper function to map milestone data from backend to frontend format
const mapMilestoneToFrontend = (milestone: any) => {
  return {
    ...milestone,
    projectId: milestone.projectId || milestone.goalId,
  };
};

// GET /api/v1/milestones/project/:projectId
router.get('/project/:projectId', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { projectId } = req.params;
    const userId = req.user!.id;
    const prisma = getPrismaClient();

    // Verify user has access to the project
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
      throw new NotFoundError('Project');
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
  } catch (error) {
    logger.error('Failed to get project milestones:', error);
    throw error;
  }
});

// POST /api/v1/milestones/project/:projectId
router.post('/project/:projectId', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { projectId } = req.params;
    const { error, value } = createMilestoneSchema.validate(req.body);
    if (error) {
      throw new ValidationError(error.details[0].message);
    }

    const userId = req.user!.id;
    const prisma = getPrismaClient();

    // Verify user has access to the project
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
      throw new NotFoundError('Project');
    }

    // Validate date range
    if (new Date(value.startDate) > new Date(value.dueDate)) {
      throw new ValidationError('Due date must be after start date');
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

    logger.info('Milestone created successfully', { milestoneId: milestone.id, projectId, userId });

    res.status(201).json({
      success: true,
      data: mapMilestoneToFrontend(milestone),
      message: 'Milestone created successfully',
    });
  } catch (error) {
    logger.error('Failed to create milestone:', error);
    throw error;
  }
});

// GET /api/v1/milestones/:id
router.get('/:id', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { id } = req.params;
    const userId = req.user!.id;
    const prisma = getPrismaClient();

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
      throw new NotFoundError('Milestone');
    }

    res.json({
      success: true,
      data: mapMilestoneToFrontend(milestone),
    });
  } catch (error) {
    logger.error('Failed to get milestone:', error);
    throw error;
  }
});

// PUT /api/v1/milestones/:id
router.put('/:id', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { error, value } = updateMilestoneSchema.validate(req.body);
    if (error) {
      throw new ValidationError(error.details[0].message);
    }

    const userId = req.user!.id;
    const prisma = getPrismaClient();

    // Check if user has access to the milestone
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
      throw new NotFoundError('Milestone');
    }

    // Validate date range if dates are being updated
    if (value.startDate && value.dueDate && new Date(value.startDate) > new Date(value.dueDate)) {
      throw new ValidationError('Due date must be after start date');
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

    logger.info('Milestone updated successfully', { milestoneId: id, userId });

    res.json({
      success: true,
      data: mapMilestoneToFrontend(updatedMilestone),
      message: 'Milestone updated successfully',
    });
  } catch (error) {
    logger.error('Failed to update milestone:', error);
    throw error;
  }
});

// DELETE /api/v1/milestones/:id
router.delete('/:id', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { id } = req.params;
    const userId = req.user!.id;
    const prisma = getPrismaClient();

    // Check if user has access to the milestone
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
      throw new NotFoundError('Milestone');
    }

    await prisma.milestone.delete({
      where: { id },
    });

    logger.info('Milestone deleted successfully', { milestoneId: id, userId });

    res.json({
      success: true,
      message: 'Milestone deleted successfully',
    });
  } catch (error) {
    logger.error('Failed to delete milestone:', error);
    throw error;
  }
});

export default router;
