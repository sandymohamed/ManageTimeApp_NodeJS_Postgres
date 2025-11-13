import { getPrismaClient } from '../utils/database';
import { logger } from '../utils/logger';
import { scheduleReminder } from './queueService';
import { scheduleNotification } from './queueService';

const IMMEDIATE_NOTIFICATION_DELAY_MS = 1000;

function getImmediateScheduleTime(delayMs: number = IMMEDIATE_NOTIFICATION_DELAY_MS): Date {
  return new Date(Date.now() + Math.max(delayMs, 0));
}

type AlarmLike = {
  id: string;
  userId: string;
  title: string;
  time: Date;
  timezone?: string | null;
  recurrenceRule?: string | null;
  enabled: boolean;
};

const ALARM_NOTIFICATION_TYPE = 'ALARM_TRIGGER';

/**
 * Schedule notifications for task due dates
 * Creates reminders for: 1 day before, 1 hour before, and at due time
 * @param taskId - Task ID
 * @param userId - User ID to send notifications to
 * @param dueDate - Due date (may include time if dueTime is null)
 * @param taskTitle - Task title
 * @param dueTime - Optional time string (HH:mm format)
 */
export async function scheduleTaskDueDateNotifications(
  taskId: string,
  userId: string,
  dueDate: Date,
  taskTitle: string,
  dueTime?: string | null
): Promise<void> {
  try {
    logger.info('scheduleTaskDueDateNotifications called', { taskId, userId, dueDate, dueTime });
    const prisma = getPrismaClient();
    
    // Delete existing reminders for this task to avoid duplicates
    await prisma.reminder.deleteMany({
      where: {
        targetType: 'TASK',
        targetId: taskId,
        userId,
      },
    });

    const now = new Date();
    const dueDateTime = new Date(dueDate);
    
    // If dueTime is provided, combine it with dueDate
    if (dueTime) {
      const [hours, minutes] = dueTime.split(':').map(Number);
      dueDateTime.setHours(hours, minutes, 0, 0);
      logger.info('Combined due date with time', { dueDateTime: dueDateTime.toISOString(), hours, minutes });
    } else {
      // If no time specified, use end of day (23:59)
      dueDateTime.setHours(23, 59, 0, 0);
      logger.info('No due time specified, using end of day', { dueDateTime: dueDateTime.toISOString() });
    }
    
    // Only schedule if due date is in the future
    if (dueDateTime <= now) {
      logger.warn(`Task ${taskId} due date is in the past, skipping notification scheduling`, { 
        dueDateTime: dueDateTime.toISOString(), 
        now: now.toISOString() 
      });
      return;
    }

    // Calculate reminder times
    const oneDayBefore = new Date(dueDateTime);
    oneDayBefore.setDate(oneDayBefore.getDate() - 1);
    
    const oneHourBefore = new Date(dueDateTime);
    oneHourBefore.setHours(oneHourBefore.getHours() - 1);

    // Schedule reminders
    const reminders = [];

    // 1 day before (if more than 1 hour away and in the future)
    if (oneDayBefore > now && oneDayBefore < dueDateTime) {
      try {
        const reminder1 = await prisma.reminder.create({
          data: {
            userId,
            targetType: 'TASK',
            targetId: taskId,
            title: `Task Due Tomorrow: ${taskTitle}`,
            note: `Your task "${taskTitle}" is due tomorrow.`,
            triggerType: 'TIME',
            schedule: {
              at: oneDayBefore.toISOString(),
            },
          },
        });
        reminders.push({ reminder: reminder1, time: oneDayBefore, type: 'DUE_DATE_REMINDER' });
        logger.info(`Created 1-day-before reminder for task ${taskId} at ${oneDayBefore.toISOString()}`);
      } catch (error) {
        logger.error(`Failed to create 1-day-before reminder for task ${taskId}:`, error);
      }
    }

    // 1 hour before (if more than now and in the future)
    if (oneHourBefore > now && oneHourBefore < dueDateTime) {
      try {
        const reminder2 = await prisma.reminder.create({
          data: {
            userId,
            targetType: 'TASK',
            targetId: taskId,
            title: `Task Due in 1 Hour: ${taskTitle}`,
            note: `Your task "${taskTitle}" is due in 1 hour.`,
            triggerType: 'TIME',
            schedule: {
              at: oneHourBefore.toISOString(),
            },
          },
        });
        reminders.push({ reminder: reminder2, time: oneHourBefore, type: 'DUE_DATE_REMINDER' });
        logger.info(`Created 1-hour-before reminder for task ${taskId} at ${oneHourBefore.toISOString()}`);
      } catch (error) {
        logger.error(`Failed to create 1-hour-before reminder for task ${taskId}:`, error);
      }
    }

    // Always schedule "at due time" reminder if due date is in the future
    try {
      const reminder3 = await prisma.reminder.create({
        data: {
          userId,
          targetType: 'TASK',
          targetId: taskId,
          title: `Task Due: ${taskTitle}`,
          note: `Your task "${taskTitle}" is due now.`,
          triggerType: 'TIME',
          schedule: {
            at: dueDateTime.toISOString(),
          },
        },
      });
      reminders.push({ reminder: reminder3, time: dueDateTime, type: 'DUE_DATE_REMINDER' });
      logger.info(`Created due-time reminder for task ${taskId} at ${dueDateTime.toISOString()}`);
    } catch (error) {
      logger.error(`Failed to create due-time reminder for task ${taskId}:`, error);
    }

    // Schedule all reminders
    logger.info(`Scheduling ${reminders.length} reminders for task ${taskId}`);
    for (const { reminder, time, type } of reminders) {
      try {
        await scheduleReminder(reminder.id, userId, time, type);
        logger.info(`Successfully scheduled task reminder for ${taskId} at ${time.toISOString()}, type: ${type}`);
      } catch (error: any) {
        logger.error(`Failed to schedule reminder for task ${taskId}:`, error);
        // Clean up reminder if scheduling failed
        await prisma.reminder.delete({ where: { id: reminder.id } }).catch(() => {});
      }
    }
    
    if (reminders.length === 0) {
      logger.warn(`No reminders scheduled for task ${taskId} - all reminder times are in the past`);
    }
  } catch (error) {
    logger.error(`Failed to schedule task due date notifications for ${taskId}:`, error);
    // Don't throw - this shouldn't break task creation
  }
}

/**
 * Schedule notifications for milestone due dates
 */
export async function scheduleMilestoneDueDateNotifications(
  milestoneId: string,
  goalId: string,
  userId: string,
  dueDate: Date,
  milestoneTitle: string
): Promise<void> {
  try {
    const prisma = getPrismaClient();
    
    // Delete existing reminders for this milestone
    await prisma.reminder.deleteMany({
      where: {
        targetType: 'GOAL',
        targetId: goalId,
        userId,
        note: {
          contains: milestoneTitle,
        },
      },
    });

    const now = new Date();
    const dueDateTime = new Date(dueDate);
    
    // Only schedule if due date is in the future
    if (dueDateTime <= now) {
      logger.info(`Milestone ${milestoneId} due date is in the past, skipping notification scheduling`);
      return;
    }

    // Calculate reminder times
    const oneDayBefore = new Date(dueDateTime);
    oneDayBefore.setDate(oneDayBefore.getDate() - 1);
    
    const oneHourBefore = new Date(dueDateTime);
    oneHourBefore.setHours(oneHourBefore.getHours() - 1);

    const reminders = [];

    // 1 day before
    if (oneDayBefore > now && oneDayBefore < dueDateTime) {
      const reminder1 = await prisma.reminder.create({
        data: {
          userId,
          targetType: 'GOAL',
          targetId: goalId,
          title: `Milestone Due Tomorrow: ${milestoneTitle}`,
          note: `Your milestone "${milestoneTitle}" is due tomorrow.`,
          triggerType: 'TIME',
          schedule: {
            at: oneDayBefore.toISOString(),
          },
        },
      });
      reminders.push({ reminder: reminder1, time: oneDayBefore, type: 'GOAL_REMINDER' });
    }

    // 1 hour before
    if (oneHourBefore > now && oneHourBefore < dueDateTime) {
      const reminder2 = await prisma.reminder.create({
        data: {
          userId,
          targetType: 'GOAL',
          targetId: goalId,
          title: `Milestone Due in 1 Hour: ${milestoneTitle}`,
          note: `Your milestone "${milestoneTitle}" is due in 1 hour.`,
          triggerType: 'TIME',
          schedule: {
            at: oneHourBefore.toISOString(),
          },
        },
      });
      reminders.push({ reminder: reminder2, time: oneHourBefore, type: 'GOAL_REMINDER' });
    }

    // At due time
    const reminder3 = await prisma.reminder.create({
      data: {
        userId,
        targetType: 'GOAL',
        targetId: goalId,
        title: `Milestone Due Now: ${milestoneTitle}`,
        note: `Your milestone "${milestoneTitle}" is due now.`,
        triggerType: 'TIME',
        schedule: {
          at: dueDateTime.toISOString(),
        },
      },
    });
    reminders.push({ reminder: reminder3, time: dueDateTime, type: 'GOAL_REMINDER' });

    // Schedule all reminders
    for (const { reminder, time, type } of reminders) {
      try {
        await scheduleReminder(reminder.id, userId, time, type);
        logger.info(`Scheduled milestone reminder for ${milestoneId} at ${time.toISOString()}`);
      } catch (error: any) {
        logger.error(`Failed to schedule reminder for milestone ${milestoneId}:`, error);
        await prisma.reminder.delete({ where: { id: reminder.id } }).catch(() => {});
      }
    }
  } catch (error) {
    logger.error(`Failed to schedule milestone due date notifications for ${milestoneId}:`, error);
  }
}

/**
 * Schedule notifications for goal target dates
 */
export async function scheduleGoalTargetDateNotifications(
  goalId: string,
  userId: string,
  targetDate: Date,
  goalTitle: string
): Promise<void> {
  try {
    const prisma = getPrismaClient();
    
    // Delete existing reminders for this goal
    await prisma.reminder.deleteMany({
      where: {
        targetType: 'GOAL',
        targetId: goalId,
        userId,
      },
    });

    const now = new Date();
    const targetDateTime = new Date(targetDate);
    
    // Only schedule if target date is in the future
    if (targetDateTime <= now) {
      logger.info(`Goal ${goalId} target date is in the past, skipping notification scheduling`);
      return;
    }

    // Calculate reminder times
    const oneWeekBefore = new Date(targetDateTime);
    oneWeekBefore.setDate(oneWeekBefore.getDate() - 7);
    
    const oneDayBefore = new Date(targetDateTime);
    oneDayBefore.setDate(oneDayBefore.getDate() - 1);

    const reminders = [];

    // 1 week before
    if (oneWeekBefore > now && oneWeekBefore < targetDateTime) {
      const reminder1 = await prisma.reminder.create({
        data: {
          userId,
          targetType: 'GOAL',
          targetId: goalId,
          title: `Goal Deadline in 1 Week: ${goalTitle}`,
          note: `Your goal "${goalTitle}" deadline is in 1 week.`,
          triggerType: 'TIME',
          schedule: {
            at: oneWeekBefore.toISOString(),
          },
        },
      });
      reminders.push({ reminder: reminder1, time: oneWeekBefore, type: 'GOAL_REMINDER' });
    }

    // 1 day before
    if (oneDayBefore > now && oneDayBefore < targetDateTime) {
      const reminder2 = await prisma.reminder.create({
        data: {
          userId,
          targetType: 'GOAL',
          targetId: goalId,
          title: `Goal Deadline Tomorrow: ${goalTitle}`,
          note: `Your goal "${goalTitle}" deadline is tomorrow.`,
          triggerType: 'TIME',
          schedule: {
            at: oneDayBefore.toISOString(),
          },
        },
      });
      reminders.push({ reminder: reminder2, time: oneDayBefore, type: 'GOAL_REMINDER' });
    }

    // At target date
    const reminder3 = await prisma.reminder.create({
      data: {
        userId,
        targetType: 'GOAL',
        targetId: goalId,
        title: `Goal Deadline Today: ${goalTitle}`,
        note: `Your goal "${goalTitle}" deadline is today.`,
        triggerType: 'TIME',
        schedule: {
          at: targetDateTime.toISOString(),
        },
      },
    });
    reminders.push({ reminder: reminder3, time: targetDateTime, type: 'GOAL_REMINDER' });

    // Schedule all reminders
    for (const { reminder, time, type } of reminders) {
      try {
        await scheduleReminder(reminder.id, userId, time, type);
        logger.info(`Scheduled goal reminder for ${goalId} at ${time.toISOString()}`);
      } catch (error: any) {
        logger.error(`Failed to schedule reminder for goal ${goalId}:`, error);
        await prisma.reminder.delete({ where: { id: reminder.id } }).catch(() => {});
      }
    }
  } catch (error) {
    logger.error(`Failed to schedule goal target date notifications for ${goalId}:`, error);
  }
}

/**
 * Cancel all scheduled notifications for an alarm.
 */
export async function cancelAlarmPushNotifications(alarmId: string, userId: string): Promise<void> {
  try {
    const prisma = getPrismaClient();

    const deleted = await prisma.notification.deleteMany({
      where: {
        userId,
        payload: {
          path: ['alarmId'],
          equals: alarmId,
        },
      },
    });

    logger.info(`Cancelled ${deleted.count} scheduled notifications for alarm ${alarmId}`);
  } catch (error) {
    logger.warn(`Failed to cancel scheduled notifications for alarm ${alarmId}:`, error);
  }
}

/**
 * Schedule a push notification to fire at the alarm time.
 * Skips scheduling if the alarm is disabled or the time is in the past.
 */
export async function scheduleAlarmPushNotification(alarm: AlarmLike): Promise<void> {
  const now = new Date();
  const alarmTime = new Date(alarm.time);

  if (!alarm.enabled) {
    logger.info(`Alarm ${alarm.id} is disabled, skipping push notification scheduling`);
    await cancelAlarmPushNotifications(alarm.id, alarm.userId);
    return;
  }

  if (Number.isNaN(alarmTime.getTime())) {
    logger.warn(`Invalid alarm time provided for alarm ${alarm.id}, skipping scheduling`);
    await cancelAlarmPushNotifications(alarm.id, alarm.userId);
    return;
  }

  // Add a small buffer (5 seconds) to avoid scheduling jobs that would run immediately
  if (alarmTime.getTime() <= now.getTime() + 5000) {
    logger.warn(`Alarm ${alarm.id} time is in the past or too soon (${alarmTime.toISOString()}), skipping scheduling`);
    await cancelAlarmPushNotifications(alarm.id, alarm.userId);
    return;
  }

  const prisma = getPrismaClient();

  // Remove existing scheduled notifications for this alarm before creating new ones
  await cancelAlarmPushNotifications(alarm.id, alarm.userId);

  const title = `Alarm: ${alarm.title}`;
  const body = `It's time for "${alarm.title}".`;

  try {
    const notification = await prisma.notification.create({
      data: {
        userId: alarm.userId,
        type: 'IN_APP',
        payload: {
          title,
          body,
          alarmId: alarm.id,
          notificationType: ALARM_NOTIFICATION_TYPE,
        },
        scheduledFor: alarmTime,
        status: 'PENDING',
      },
    });

    await scheduleNotification(
      notification.id,
      alarm.userId,
      alarmTime,
      ALARM_NOTIFICATION_TYPE,
      {
        title,
        body,
        alarmId: alarm.id,
        notificationType: ALARM_NOTIFICATION_TYPE,
      }
    );

    logger.info(`Scheduled push notification for alarm ${alarm.id} at ${alarmTime.toISOString()}`);
  } catch (error) {
    logger.error(`Failed to schedule push notification for alarm ${alarm.id}:`, error);
    // Clean up notification record if scheduling failed
    try {
      await prisma.notification.deleteMany({
        where: {
          userId: alarm.userId,
          payload: {
            path: ['alarmId'],
            equals: alarm.id,
          },
        },
      });
    } catch (cleanupError) {
      logger.warn(`Failed to clean up notification record for alarm ${alarm.id}:`, cleanupError);
    }
  }
}

/**
 * Send notification when task is assigned to a user
 */
export async function sendTaskAssignmentNotification(
  taskId: string,
  assigneeId: string,
  taskTitle: string,
  assignerName?: string
): Promise<void> {
  try {
    const prisma = getPrismaClient();
    
    // Create notification record
    const notification = await prisma.notification.create({
      data: {
        userId: assigneeId,
        type: 'IN_APP',
        payload: {
          taskId,
          title: taskTitle,
          assignerName: assignerName || 'Someone',
          notificationType: 'TASK_ASSIGNMENT',
        },
        scheduledFor: new Date(), // Send immediately
        status: 'PENDING',
      },
    });

    // Schedule immediate notification
    await scheduleNotification(
      notification.id,
      assigneeId,
      getImmediateScheduleTime(),
      'TASK_ASSIGNMENT',
      {
        title: `New Task Assigned: ${taskTitle}`,
        body: assignerName 
          ? `${assignerName} assigned you a task: ${taskTitle}`
          : `You have been assigned a new task: ${taskTitle}`,
      }
    );

    logger.info(`Sent task assignment notification for task ${taskId} to user ${assigneeId}`);
  } catch (error) {
    logger.error(`Failed to send task assignment notification for ${taskId}:`, error);
  }
}

/**
 * Send notification when a task is created.
 * Primarily used for testing push notification flow.
 */
export async function sendTaskCreatedNotification(
  taskId: string,
  userId: string,
  taskTitle: string,
  context?: { projectTitle?: string }
): Promise<void> {
  try {
    const prisma = getPrismaClient();

    const notification = await prisma.notification.create({
      data: {
        userId,
        type: 'IN_APP',
        payload: {
          taskId,
          title: `Task Created: ${taskTitle}`,
          body: context?.projectTitle
            ? `You created "${taskTitle}" in project ${context.projectTitle}.`
            : `You created a new task: "${taskTitle}".`,
          notificationType: 'TASK_CREATED',
        },
        scheduledFor: new Date(),
        status: 'PENDING',
      },
    });

    await scheduleNotification(
      notification.id,
      userId,
      getImmediateScheduleTime(),
      'TASK_CREATED',
      {
        title: `Task Created: ${taskTitle}`,
        body: context?.projectTitle
          ? `Task "${taskTitle}" was created in ${context.projectTitle}.`
          : `Task "${taskTitle}" was created successfully.`,
      }
    );

    logger.info(`Sent task created notification for task ${taskId} to user ${userId}`);
  } catch (error) {
    logger.error(`Failed to send task created notification for ${taskId}:`, error);
  }
}

