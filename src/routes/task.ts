import { Router, Response } from 'express';
import Joi from 'joi';
import { getPrismaClient } from '../utils/database';
import { authenticateToken } from '../middleware/auth';
import { AuthenticatedRequest, ValidationError, NotFoundError, AuthorizationError } from '../types';
import { logger } from '../utils/logger';

const router = Router();

// Apply authentication to all routes
router.use(authenticateToken);

const createTaskSchema = Joi.object({
  title: Joi.string().min(1).max(255).required(),
  description: Joi.string().max(1000).allow('', null).optional().default(''),
  assigneeId: Joi.string().uuid().allow(null).optional(),
  projectId: Joi.string().uuid().allow(null).optional(),
  goalId: Joi.string().uuid().allow(null).optional(),
  milestoneId: Joi.string().uuid().allow(null).optional(),
  priority: Joi.string().valid('LOW', 'MEDIUM', 'HIGH', 'URGENT').optional(),
  status: Joi.string().valid('TODO', 'IN_PROGRESS', 'DONE', 'ARCHIVED').optional(),
  dueDate: Joi.date().allow(null).optional(),
  dueTime: Joi.string().pattern(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/).allow(null).optional(),
  recurrenceRule: Joi.string().allow(null).optional(),
  // tags: Joi.array().items(Joi.string()).allow(null).optional(),
  metadata: Joi.object().optional(),
});

const updateTaskSchema = Joi.object({
  title: Joi.string().min(1).max(255).optional(),
  description: Joi.string().max(1000).allow('', null).optional(),
  assigneeId: Joi.string().uuid().allow(null).optional(),
  projectId: Joi.string().uuid().allow(null).optional(),
  goalId: Joi.string().uuid().allow(null).optional(),
  milestoneId: Joi.string().uuid().allow(null).optional(),
  priority: Joi.string().valid('LOW', 'MEDIUM', 'HIGH', 'URGENT').optional(),
  status: Joi.string().valid('TODO', 'IN_PROGRESS', 'DONE', 'ARCHIVED').optional(),
  dueDate: Joi.date().allow(null).optional(),
  dueTime: Joi.string().pattern(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/).allow(null).optional(),
  recurrenceRule: Joi.string().allow(null).optional(),
  metadata: Joi.object().optional(),
  tags: Joi.array().items(Joi.string()).optional(), // Allow tags but will be ignored (not in Task model, only Project has tags)
});

const reorderTasksSchema = Joi.object({
  taskOrders: Joi.array().items(
    Joi.object({
      id: Joi.string().uuid().required(),
      order: Joi.number().integer().min(0).required(),
    })
  ).min(1).required(),
});

// GET /api/v1/tasks
router.get('/', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const {
      page = 1,
      limit = 20,
      search,
      status,
      priority,
      projectId,
      goalId,
      assigneeId
    } = req.query;
    const userId = req.user!.id;
    const prisma = getPrismaClient();

    const where: any = {
      AND: [
        {
          OR: [
            { creatorId: userId },
            { assigneeId: userId },
            { project: { members: { some: { userId } } } },
          ],
        },
      ],
    };

    if (search) {
      where.AND.push({
        OR: [
          { title: { contains: search as string, mode: 'insensitive' } },
          { description: { contains: search as string, mode: 'insensitive' } },
        ],
      });
    }

    if (status) {
      where.status = status;
    }

    if (priority) {
      where.priority = priority;
    }

    if (projectId) {
      where.projectId = projectId;
    }

    if (goalId) {
      where.goalId = goalId;
    }

    if (assigneeId) {
      where.assigneeId = assigneeId;
    }

    const tasks = await prisma.task.findMany({
      where,
      include: {
        creator: {
          select: { id: true, name: true, email: true },
        },
        assignee: {
          select: { id: true, name: true, email: true },
        },
        project: {
          select: { id: true, title: true },
        },
        goal: {
          select: { id: true, title: true },
        },
        milestone: {
          select: { id: true, title: true },
        },
      },
      orderBy: { order: 'asc' },
      skip: (Number(page) - 1) * Number(limit),
      take: Number(limit),
    });

    // Get routine tasks as tasks
    const { routineService } = await import('../services/routineService');
    const routineTasks = await routineService.getRoutineTasksAsTasks(userId);

    // Merge routine tasks with regular tasks
    let allTasks = [...tasks, ...routineTasks];

    // Apply filters to routine tasks if needed
    if (status) {
      allTasks = allTasks.filter(t => t.status === status);
    }
    if (priority) {
      allTasks = allTasks.filter(t => t.priority === priority);
    }
    if (search) {
      const searchLower = (search as string).toLowerCase();
      allTasks = allTasks.filter(t => 
        t.title.toLowerCase().includes(searchLower) ||
        (t.description && t.description.toLowerCase().includes(searchLower))
      );
    }

    // Sort all tasks by order
    allTasks.sort((a, b) => (a.order || 0) - (b.order || 0));

    // Apply pagination
    const paginatedTasks = allTasks.slice(
      (Number(page) - 1) * Number(limit),
      Number(page) * Number(limit)
    );
    
    res.json({
      success: true,
      data: paginatedTasks,
      pagination: {
        page: Number(page),
        limit: Number(limit),
        total: allTasks.length,
        totalPages: Math.ceil(allTasks.length / Number(limit)),
      },
    });
  } catch (error) {
    logger.error('Failed to get tasks:', error);
    throw error;
  }
});

// GET /api/v1/tasks/:id
router.get('/:id', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { id } = req.params;
    const userId = req.user!.id;
    const prisma = getPrismaClient();

    const task = await prisma.task.findFirst({
      where: {
        id,
        OR: [
          { creatorId: userId },
          { assigneeId: userId },
          { project: { members: { some: { userId } } } },
        ],
      },
      include: {
        creator: {
          select: { id: true, name: true, email: true },
        },
        assignee: {
          select: { id: true, name: true, email: true },
        },
        project: {
          select: { id: true, title: true },
        },
        goal: {
          select: { id: true, title: true },
        },
        milestone: {
          select: { id: true, title: true },
        },
      },
    });

    if (!task) {
      throw new NotFoundError('Task');
    }

    res.json({
      success: true,
      data: task,
    });
  } catch (error) {
    logger.error('Failed to get task:', error);
    throw error;
  }
});

// POST /api/v1/tasks
router.post('/', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { error, value } = createTaskSchema.validate(req.body);
    if (error) {
      throw new ValidationError(error.details[0].message);
    }

    const userId = req.user!.id;
    const prisma = getPrismaClient();

    // Check project access if projectId is provided
    if (value.projectId) {
      const project = await prisma.project.findFirst({
        where: {
          id: value.projectId,
          OR: [
            { ownerId: userId },
            { members: { some: { userId } } },
          ],
        },
      });

      if (!project) {
        throw new AuthorizationError('You do not have access to this project');
      }
    }

    // Check goal access if goalId is provided
    if (value.goalId) {
      const goal = await prisma.goal.findFirst({
        where: {
          id: value.goalId,
          userId,
        },
      });

      if (!goal) {
        throw new AuthorizationError('You do not have access to this goal');
      }
    }

    // Get the next order value for this user's tasks
    const lastTask = await prisma.task.findFirst({
      where: {
        OR: [
          { creatorId: userId },
          { assigneeId: userId },
          { project: { members: { some: { userId } } } },
        ],
      },
      orderBy: { order: 'desc' },
      select: { order: true },
    });

    const nextOrder = (lastTask?.order || 0) + 1;

    const task = await prisma.task.create({
      data: {
        ...value,
        creatorId: userId,
        order: nextOrder,
      },
      include: {
        creator: {
          select: { id: true, name: true, email: true },
        },
        assignee: {
          select: { id: true, name: true, email: true },
        },
        project: {
          select: { id: true, title: true },
        },
        goal: {
          select: { id: true, title: true },
        },
        milestone: {
          select: { id: true, title: true },
        },
      },
    });

    const notificationScheduler = await import('../services/notificationScheduler');

    // Schedule notifications for due date if provided
    if (task.dueDate) {
      const taskUserId = task.assigneeId || task.creatorId;
      const dueTime = value.dueTime || task.dueTime || null;
      logger.info('Scheduling task notifications', { 
        taskId: task.id, 
        userId: taskUserId, 
        dueDate: task.dueDate, 
        dueTime 
      });
      notificationScheduler.scheduleTaskDueDateNotifications(task.id, taskUserId, task.dueDate, task.title, dueTime)
        .catch(err => logger.error('Failed to schedule task notifications:', err));
    }

    // Send push notification to creator for task creation (testing)
    notificationScheduler.sendTaskCreatedNotification(
      task.id,
      userId,
      task.title,
      { projectTitle: task.project?.title || undefined }
    ).catch(err => logger.error('Failed to send task created notification:', err));

    // Send assignment notification if task is assigned
    if (task.assigneeId && task.assigneeId !== userId) {
      const creator = task.creator;
      notificationScheduler.sendTaskAssignmentNotification(
        task.id,
        task.assigneeId,
        task.title,
        creator?.name || creator?.email
      ).catch(err => logger.error('Failed to send assignment notification:', err));
    }

    res.status(201).json({
      success: true,
      data: task,
      message: 'Task created successfully',
    });
  } catch (error) {
    logger.error('Failed to create task:', error);
    throw error;
  }
});

// PUT /api/v1/tasks/:id
router.put('/:id', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { id } = req.params;

    const { error, value } = updateTaskSchema.validate(req.body);
    if (error) {
      throw new ValidationError(error.details[0].message);
    }

    const userId = req.user!.id;
    const prisma = getPrismaClient();

    // Check if this is a routine task - only allow status updates
    if (id.startsWith('routine_')) {
      // Extract routine task ID (handle multiple formats):
      // - routine_taskId_day_X (weekly format from backend)
      // - routine_taskId_yyyy-MM-dd (daily format from calendar)
      // - routine_taskId (simple format)
      let routineTaskId = id.replace('routine_', '');
      
      // Remove _day_X suffix (e.g., "_day_1" -> "")
      if (routineTaskId.includes('_day_')) {
        routineTaskId = routineTaskId.split('_day_')[0];
      }
      // Remove date suffix (e.g., "_2025-11-18" -> "")
      else if (routineTaskId.match(/_\d{4}-\d{2}-\d{2}$/)) {
        routineTaskId = routineTaskId.replace(/_\d{4}-\d{2}-\d{2}$/, '');
      }
      
      const { routineService } = await import('../services/routineService');
      
      // Only allow status updates for routine tasks
      if (value.status === 'DONE') {
        await routineService.toggleTaskCompletion(routineTaskId, userId, true);
      } else if (value.status === 'TODO') {
        await routineService.toggleTaskCompletion(routineTaskId, userId, false);
      }
      
      // Get the updated routine task as a task object
      const routineTasks = await routineService.getRoutineTasksAsTasks(userId);
      
      // Try to find task by exact ID match first
      let updatedTask = routineTasks.find(t => t.id === id);
      
      // If not found, try to find by routineTaskId in metadata (handles ID format mismatches)
      if (!updatedTask) {
        updatedTask = routineTasks.find(t => 
          t.metadata?.routineTaskId === routineTaskId
        );
        
        // If found by metadata, update the ID to match the requested format
        if (updatedTask) {
          updatedTask = {
            ...updatedTask,
            id: id, // Use the requested ID format
          };
        }
      }
      
      if (!updatedTask) {
        throw new NotFoundError('Task not found');
      }

      logger.info('Routine task updated successfully', { taskId: id, routineTaskId, userId });

      return res.json({
        success: true,
        data: updatedTask,
        message: 'Task updated successfully',
      });
    }

    // Check if user can update this task
    const existingTask = await prisma.task.findFirst({
      where: {
        id,
        OR: [
          { creatorId: userId },
          { assigneeId: userId },
          { project: { members: { some: { userId, role: { in: ['OWNER', 'EDITOR'] } } } } },
        ],
      },
    });

    if (!existingTask) {
      throw new NotFoundError('Task');
    }

    // Remove tags from update data since Task model doesn't have tags field (only Project has tags)
    const { tags, ...updateData } = value;
    
    const task = await prisma.task.update({
      where: { id },
      data: updateData,
      include: {
        creator: {
          select: { id: true, name: true, email: true },
        },
        assignee: {
          select: { id: true, name: true, email: true },
        },
        project: {
          select: { id: true, title: true },
        },
        goal: {
          select: { id: true, title: true },
        },
        milestone: {
          select: { id: true, title: true },
        },
      },
    });

    // Reschedule notifications if due date or time changed
    if (value.dueDate !== undefined || value.dueTime !== undefined) {
      const { scheduleTaskDueDateNotifications } = await import('../services/notificationScheduler');
      const taskUserId = task.assigneeId || task.creatorId;
      const dueTime = value.dueTime !== undefined ? value.dueTime : (task.dueTime || null);
      logger.info('Rescheduling task notifications', { 
        taskId: task.id, 
        userId: taskUserId, 
        dueDate: task.dueDate, 
        dueTime 
      });
      if (task.dueDate) {
        scheduleTaskDueDateNotifications(task.id, taskUserId, task.dueDate, task.title, dueTime)
          .catch(err => logger.error('Failed to reschedule task notifications:', err));
      }
    }

    // Send assignment notification if task was just assigned
    if (value.assigneeId && value.assigneeId !== existingTask.assigneeId && value.assigneeId !== userId && task.assigneeId) {
      const { sendTaskAssignmentNotification } = await import('../services/notificationScheduler');
      const creator = task.creator;
      sendTaskAssignmentNotification(
        task.id,
        task.assigneeId,
        task.title,
        creator?.name || creator?.email
      ).catch(err => logger.error('Failed to send assignment notification:', err));
    }

    logger.info('Task updated successfully', { taskId: id, userId });

    return res.json({
      success: true,
      data: task,
      message: 'Task updated successfully',
    });
  } catch (error) {
    logger.error('Failed to update task:', error);
    throw error;
  }
});

// DELETE /api/v1/tasks/:id
router.delete('/:id', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { id } = req.params;
    const userId = req.user!.id;
    const prisma = getPrismaClient();

    // Check if user can delete this task
    const task = await prisma.task.findFirst({
      where: {
        id,
        OR: [
          { creatorId: userId },
          { project: { members: { some: { userId, role: { in: ['OWNER', 'EDITOR'] } } } } },
        ],
      },
    });

    if (!task) {
      throw new NotFoundError('Task');
    }

    await prisma.task.delete({
      where: { id },
    });

    logger.info('Task deleted successfully', { taskId: id, userId });

    res.json({
      success: true,
      message: 'Task deleted successfully',
    });
  } catch (error) {
    logger.error('Failed to delete task:', error);
    throw error;
  }
});

// POST /api/v1/tasks/:id/assign
router.post('/:id/assign', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { assigneeId } = req.body;
    const userId = req.user!.id;
    const prisma = getPrismaClient();

    // Check if user can assign this task
    const task = await prisma.task.findFirst({
      where: {
        id,
        OR: [
          { creatorId: userId },
          { project: { members: { some: { userId, role: { in: ['OWNER', 'EDITOR'] } } } } },
        ],
      },
    });

    if (!task) {
      throw new NotFoundError('Task');
    }

    const updatedTask = await prisma.task.update({
      where: { id },
      data: { assigneeId },
      include: {
        creator: {
          select: { id: true, name: true, email: true },
        },
        assignee: {
          select: { id: true, name: true, email: true },
        },
        project: {
          select: { id: true, title: true },
        },
        goal: {
          select: { id: true, title: true },
        },
        milestone: {
          select: { id: true, title: true },
        },
      },
    });

    // Send assignment notification
    if (assigneeId && assigneeId !== userId) {
      const { sendTaskAssignmentNotification } = await import('../services/notificationScheduler');
      const creator = updatedTask.creator;
      sendTaskAssignmentNotification(
        updatedTask.id,
        assigneeId,
        updatedTask.title,
        creator?.name || creator?.email
      ).catch(err => logger.error('Failed to send assignment notification:', err));
    }

    logger.info('Task assigned successfully', { taskId: id, assigneeId, userId });

    res.json({
      success: true,
      data: updatedTask,
      message: 'Task assigned successfully',
    });
  } catch (error) {
    logger.error('Failed to assign task:', error);
    throw error;
  }
});

// PATCH /api/v1/tasks/reorder
router.patch('/reorder', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { error, value } = reorderTasksSchema.validate(req.body);
    if (error) {
      throw new ValidationError(error.details[0].message);
    }

    const { taskOrders } = value;

    const userId = req.user!.id;
    const prisma = getPrismaClient();

    // Verify that all tasks belong to the user
    const taskIds = taskOrders.map((to: any) => to.id).filter((id: any) => id !== null);

    const userTasks = await prisma.task.findMany({
      where: {
        id: { in: taskIds },
        OR: [
          { creatorId: userId },
          { assigneeId: userId },
          { project: { members: { some: { userId } } } },
        ],
      },
      select: { id: true },
    });

    if (userTasks.length !== taskIds.length) {
      throw new AuthorizationError('You do not have access to reorder some of these tasks');
    }

    // Update task orders in a transaction
    await prisma.$transaction(
      taskOrders.map((taskOrder: any) =>
        prisma.task.update({
          where: { id: taskOrder.id },
          data: { order: taskOrder.order },
        })
      )
    );

    logger.info('Tasks reordered successfully', {
      userId,
      taskCount: taskOrders.length,
      taskIds: taskIds
    });

    res.json({
      success: true,
      message: 'Tasks reordered successfully',
    });
  } catch (error) {
    logger.error('Failed to reorder tasks:', error);
    throw error;
  }
});

// PATCH /api/v1/tasks/:id/complete
router.patch('/:id/complete', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { id } = req.params;
    const userId = req.user!.id;
    const prisma = getPrismaClient();

    // Check if this is a routine task
    if (id.startsWith('routine_')) {
      // Extract routine task ID (handle both formats: routine_taskId and routine_taskId_day_X)
      const routineTaskId = id.replace('routine_', '').split('_day_')[0];
      const { routineService } = await import('../services/routineService');
      
      // Toggle routine task completion
      await routineService.toggleTaskCompletion(routineTaskId, userId, true);
      
      // Get the updated routine task as a task object
      const routineTasks = await routineService.getRoutineTasksAsTasks(userId);
      const updatedTask = routineTasks.find(t => t.id === id);
      
      if (!updatedTask) {
        throw new NotFoundError('Task');
      }

      logger.info('Routine task completed successfully', { taskId: id, userId });

      return res.json({
        success: true,
        data: updatedTask,
        message: 'Task completed successfully',
      });
    }

    // Check if user can complete this task
    const task = await prisma.task.findFirst({
      where: {
        id,
        OR: [
          { creatorId: userId },
          { assigneeId: userId },
          { project: { members: { some: { userId } } } },
        ],
      },
    });

    if (!task) {
      throw new NotFoundError('Task');
    }

    const updatedTask = await prisma.task.update({
      where: { id },
      data: {
        status: 'DONE',
        completedAt: new Date(),
      },
      include: {
        creator: {
          select: { id: true, name: true, email: true },
        },
        assignee: {
          select: { id: true, name: true, email: true },
        },
        project: {
          select: { id: true, title: true },
        },
        goal: {
          select: { id: true, title: true },
        },
        milestone: {
          select: { id: true, title: true },
        },
      },
    });

    logger.info('Task completed successfully', { taskId: id, userId });

    return res.json({
      success: true,
      data: updatedTask,
      message: 'Task completed successfully',
    });
  } catch (error) {
    logger.error('Failed to complete task:', error);
    throw error;
  }
});

// PATCH /api/v1/tasks/:id/uncomplete
router.patch('/:id/uncomplete', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { id } = req.params;
    const userId = req.user!.id;
    const prisma = getPrismaClient();

    // Check if this is a routine task
    if (id.startsWith('routine_')) {
      // Extract routine task ID (handle both formats: routine_taskId and routine_taskId_day_X)
      const routineTaskId = id.replace('routine_', '').split('_day_')[0];
      const { routineService } = await import('../services/routineService');
      
      // Toggle routine task completion
      await routineService.toggleTaskCompletion(routineTaskId, userId, false);
      
      // Get the updated routine task as a task object
      const routineTasks = await routineService.getRoutineTasksAsTasks(userId);
      const updatedTask = routineTasks.find(t => t.id === id);
      
      if (!updatedTask) {
        throw new NotFoundError('Task');
      }

      logger.info('Routine task uncompleted successfully', { taskId: id, userId });

      return res.json({
        success: true,
        data: updatedTask,
        message: 'Task uncompleted successfully',
      });
    }

    // Check if user can uncomplete this task
    const task = await prisma.task.findFirst({
      where: {
        id,
        OR: [
          { creatorId: userId },
          { assigneeId: userId },
          { project: { members: { some: { userId } } } },
        ],
      },
    });

    if (!task) {
      throw new NotFoundError('Task');
    }

    const updatedTask = await prisma.task.update({
      where: { id },
      data: {
        status: 'TODO',
        completedAt: null,
      },
      include: {
        creator: {
          select: { id: true, name: true, email: true },
        },
        assignee: {
          select: { id: true, name: true, email: true },
        },
        project: {
          select: { id: true, title: true },
        },
        goal: {
          select: { id: true, title: true },
        },
        milestone: {
          select: { id: true, title: true },
        },
      },
    });

    logger.info('Task uncompleted successfully', { taskId: id, userId });

    return res.json({
      success: true,
      data: updatedTask,
      message: 'Task uncompleted successfully',
    });
  } catch (error) {
    logger.error('Failed to uncomplete task:', error);
    throw error;
  }
});

export default router;