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
    // Since targetId is null for GOAL type, match by note content
    await prisma.reminder.deleteMany({
      where: {
        targetType: 'GOAL',
        userId,
        note: {
          contains: milestoneTitle,
        },
      },
    });

    const now = new Date();
    const dueDateTime = new Date(dueDate);
    
    // Set to end of day (23:59) if no specific time is provided
    // This ensures notifications are sent at the end of the milestone due date
    dueDateTime.setHours(23, 59, 0, 0);
    
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
          targetId: null, // Set to null - foreign key constraint only applies to TASK type
          title: `Milestone Due Tomorrow: ${milestoneTitle}`,
          note: `Your milestone "${milestoneTitle}" is due tomorrow.`,
          triggerType: 'TIME',
          schedule: {
            at: oneDayBefore.toISOString(),
            milestoneId: milestoneId, // Store IDs in schedule for reference
            goalId: goalId,
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
          targetId: null, // Set to null - foreign key constraint only applies to TASK type
          title: `Milestone Due in 1 Hour: ${milestoneTitle}`,
          note: `Your milestone "${milestoneTitle}" is due in 1 hour.`,
          triggerType: 'TIME',
          schedule: {
            at: oneHourBefore.toISOString(),
            milestoneId: milestoneId, // Store IDs in schedule for reference
            goalId: goalId,
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
        targetId: null, // Set to null - foreign key constraint only applies to TASK type
        title: `Milestone Due Now: ${milestoneTitle}`,
        note: `Your milestone "${milestoneTitle}" is due now.`,
        triggerType: 'TIME',
        schedule: {
          at: dueDateTime.toISOString(),
          milestoneId: milestoneId, // Store IDs in schedule for reference
          goalId: goalId,
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
 * Check for overdue milestones and send notifications
 * This should be called periodically (e.g., daily cron job)
 */
export async function checkAndNotifyOverdueMilestones(): Promise<void> {
  try {
    const prisma = getPrismaClient();
    const now = new Date();
    
    // Find all overdue milestones that are not completed
    const overdueMilestones = await prisma.milestone.findMany({
      where: {
        dueDate: {
          lt: now,
        },
        status: {
          not: 'DONE',
        },
        goal: {
          status: {
            not: 'DONE',
          },
        },
      },
      include: {
        goal: {
          select: {
            id: true,
            userId: true,
            title: true,
          },
        },
      },
    });

    logger.info(`Found ${overdueMilestones.length} overdue milestones`);

    for (const milestone of overdueMilestones) {
      const goal = milestone.goal;
      if (!goal) {
        logger.warn(`Milestone ${milestone.id} has no associated goal, skipping`);
        continue;
      }
      const userId = goal.userId;
      const goalId = goal.id;
      
      // Check if we've already sent an overdue notification for this milestone today
      const todayStart = new Date(now);
      todayStart.setHours(0, 0, 0, 0);
      
      const existingReminder = await prisma.reminder.findFirst({
        where: {
          userId,
          targetType: 'GOAL',
          title: {
            contains: `Overdue Milestone: ${milestone.title}`,
          },
          createdAt: {
            gte: todayStart,
          },
        },
      });

      if (existingReminder) {
        logger.info(`Overdue notification already sent today for milestone ${milestone.id}`);
        continue;
      }

      // Calculate days overdue
      const daysOverdue = Math.floor((now.getTime() - milestone.dueDate!.getTime()) / (1000 * 60 * 60 * 24));

      // Create reminder for overdue milestone
      const reminder = await prisma.reminder.create({
        data: {
          userId,
          targetType: 'GOAL',
          targetId: null,
          title: `Overdue Milestone: ${milestone.title}`,
          note: `Your milestone "${milestone.title}" for goal "${goal.title}" is ${daysOverdue} day${daysOverdue !== 1 ? 's' : ''} overdue.`,
          triggerType: 'TIME',
          schedule: {
            at: now.toISOString(),
            milestoneId: milestone.id,
            goalId: goalId,
          },
        },
      });

      // Send notification immediately (for overdue milestones, we don't schedule in the past)
      try {
        // Schedule for 1 second in the future to avoid "Cannot schedule reminder in the past" error
        const immediateTime = new Date(Date.now() + 1000);
        await scheduleReminder(reminder.id, userId, immediateTime, 'GOAL_REMINDER');
        logger.info(`Scheduled overdue notification for milestone ${milestone.id} (immediate)`);
      } catch (error: any) {
        logger.error(`Failed to schedule overdue reminder for milestone ${milestone.id}:`, error);
        await prisma.reminder.delete({ where: { id: reminder.id } }).catch(() => {});
      }
    }
  } catch (error) {
    logger.error('Failed to check and notify overdue milestones:', error);
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
    // Since targetId is null for GOAL type (due to FK constraint), we need to match by schedule.goalId
    await prisma.reminder.deleteMany({
      where: {
        targetType: 'GOAL',
        userId,
        note: {
          contains: goalTitle,
        },
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
          targetId: null, // Set to null - foreign key constraint only applies to TASK type
          title: `Goal Deadline in 1 Week: ${goalTitle}`,
          note: `Your goal "${goalTitle}" deadline is in 1 week.`,
          triggerType: 'TIME',
          schedule: {
            at: oneWeekBefore.toISOString(),
            goalId: goalId, // Store goalId in schedule for reference
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
          targetId: null, // Set to null - foreign key constraint only applies to TASK type
          title: `Goal Deadline Tomorrow: ${goalTitle}`,
          note: `Your goal "${goalTitle}" deadline is tomorrow.`,
          triggerType: 'TIME',
          schedule: {
            at: oneDayBefore.toISOString(),
            goalId: goalId, // Store goalId in schedule for reference
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
        targetId: null, // Set to null - foreign key constraint only applies to TASK type
        title: `Goal Deadline Today: ${goalTitle}`,
        note: `Your goal "${goalTitle}" deadline is today.`,
        triggerType: 'TIME',
        schedule: {
          at: targetDateTime.toISOString(),
          goalId: goalId, // Store goalId in schedule for reference
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

  // For recurring alarms, calculate the next valid occurrence if the current time is in the past
  let scheduledAlarmTime = alarmTime;
  if (alarm.recurrenceRule && alarmTime.getTime() <= now.getTime()) {
    // Calculate next occurrence based on recurrence rule
    if (alarm.recurrenceRule.startsWith('FREQ=DAILY')) {
      // For daily alarms, add 1 day if time has passed
      scheduledAlarmTime = new Date(alarmTime);
      while (scheduledAlarmTime.getTime() <= now.getTime()) {
        scheduledAlarmTime.setDate(scheduledAlarmTime.getDate() + 1);
      }
      logger.info(`Alarm ${alarm.id} time is in the past, scheduling for next occurrence: ${scheduledAlarmTime.toISOString()}`);
    } else if (alarm.recurrenceRule.startsWith('FREQ=WEEKLY')) {
      // For weekly alarms, add 1 week if time has passed
      scheduledAlarmTime = new Date(alarmTime);
      while (scheduledAlarmTime.getTime() <= now.getTime()) {
        scheduledAlarmTime.setDate(scheduledAlarmTime.getDate() + 7);
      }
      logger.info(`Alarm ${alarm.id} time is in the past, scheduling for next occurrence: ${scheduledAlarmTime.toISOString()}`);
    } else if (alarm.recurrenceRule.startsWith('FREQ=MONTHLY')) {
      // For monthly alarms, add 1 month if time has passed
      scheduledAlarmTime = new Date(alarmTime);
      while (scheduledAlarmTime.getTime() <= now.getTime()) {
        scheduledAlarmTime.setMonth(scheduledAlarmTime.getMonth() + 1);
      }
      logger.info(`Alarm ${alarm.id} time is in the past, scheduling for next occurrence: ${scheduledAlarmTime.toISOString()}`);
    } else {
      // For other recurrence rules or non-recurring alarms, only skip if more than 1 second in the past
      if (alarmTime.getTime() < now.getTime() - 1000) {
        logger.warn(`Alarm ${alarm.id} time is too far in the past (${alarmTime.toISOString()}), skipping scheduling`);
        await cancelAlarmPushNotifications(alarm.id, alarm.userId);
        return;
      }
    }
  }

  // Only skip if alarm is more than 1 second in the past (allow very soon alarms)
  // Changed from 5 seconds buffer to 1 second to allow alarms even if they're very soon
  if (scheduledAlarmTime.getTime() < now.getTime() - 1000) {
    logger.warn(`Alarm ${alarm.id} time is too far in the past (${scheduledAlarmTime.toISOString()}), skipping scheduling`);
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
        scheduledFor: scheduledAlarmTime,
        status: 'PENDING',
      },
    });

    await scheduleNotification(
      notification.id,
      alarm.userId,
      scheduledAlarmTime,
      ALARM_NOTIFICATION_TYPE,
      {
        title,
        body,
        alarmId: alarm.id,
        notificationType: ALARM_NOTIFICATION_TYPE,
      }
    );

    logger.info(`Scheduled push notification for alarm ${alarm.id} at ${scheduledAlarmTime.toISOString()}`);
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

/**
 * Schedule push notifications for routine tasks
 * Creates recurring reminders based on routine frequency and task reminderTime
 */
export async function scheduleRoutineTaskNotifications(
  routineId: string,
  userId: string,
  routineTitle: string,
  frequency: 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY',
  schedule: { time?: string; days?: number[]; day?: number },
  timezone: string,
  taskId: string,
  taskTitle: string,
  reminderTime?: string | null,
  reminderBefore?: string | null
): Promise<void> {
  try {
    const prisma = getPrismaClient();
    const now = new Date();

    // Cancel existing reminders for this routine task
    // Since targetId is null for CUSTOM type (due to FK constraint), match by note content
    await prisma.reminder.deleteMany({
      where: {
        targetType: 'CUSTOM',
        userId,
        note: {
          contains: taskTitle,
        },
      },
    });

    // Skip if routine doesn't have a time set
    if (!schedule.time) {
      logger.info(`Routine ${routineId} has no time set, skipping notification scheduling`);
      return;
    }

    // Calculate notification time based on routine schedule and task reminderTime
    const [routineHours, routineMinutes] = schedule.time.split(':').map(Number);
    
    // Calculate adjusted notification time based on reminderTime
    // reminderTime can be:
    // - Absolute time: "05:00" (use this time directly)
    // - Relative offset: "-15min", "-1hour", "-30min" (subtract from routine time)
    let notificationHours = routineHours;
    let notificationMinutes = routineMinutes;
    
    if (reminderTime) {
      if (reminderTime.startsWith('-')) {
        // Relative offset: subtract from routine time
        const offsetStr = reminderTime.slice(1).toLowerCase();
        if (offsetStr.includes('min')) {
          const mins = parseInt(offsetStr.replace('min', '').replace('s', ''), 10);
          const totalMinutes = routineHours * 60 + routineMinutes - mins;
          notificationHours = Math.floor(totalMinutes / 60);
          notificationMinutes = totalMinutes % 60;
          // Handle negative hours (previous day)
          if (notificationHours < 0) {
            notificationHours += 24;
          }
        } else if (offsetStr.includes('hour')) {
          const hours = parseInt(offsetStr.replace('hour', '').replace('s', ''), 10);
          notificationHours = routineHours - hours;
          // Handle negative hours (previous day)
          if (notificationHours < 0) {
            notificationHours += 24;
          }
        }
      } else if (reminderTime.includes(':')) {
        // Absolute time - use reminderTime directly
        const [reminderHours, reminderMinutes] = reminderTime.split(':').map(Number);
        notificationHours = reminderHours;
        notificationMinutes = reminderMinutes;
      }
    }

    // Format notification time as HH:mm
    const notificationTimeStr = `${String(notificationHours).padStart(2, '0')}:${String(notificationMinutes).padStart(2, '0')}`;

    // Calculate next occurrence based on frequency
    // Use the notification time for calculations
    let nextOccurrence: Date | null = null;

    if (frequency === 'DAILY') {
      nextOccurrence = new Date(now);
      nextOccurrence.setHours(notificationHours, notificationMinutes, 0, 0);
      if (nextOccurrence <= now) {
        nextOccurrence.setDate(nextOccurrence.getDate() + 1);
      }
    } else if (frequency === 'WEEKLY' && schedule.days && schedule.days.length > 0) {
      // Find soonest upcoming day
      const currentDay = now.getDay();
      let soonest: Date | null = null;
      for (const day of schedule.days) {
        const d = new Date(now);
        const delta = (day - currentDay + 7) % 7;
        d.setDate(d.getDate() + delta);
        d.setHours(notificationHours, notificationMinutes, 0, 0);
        if (d <= now) {
          d.setDate(d.getDate() + 7);
        }
        if (!soonest || d < soonest) soonest = d;
      }
      nextOccurrence = soonest;
    } else if (frequency === 'MONTHLY' && schedule.day) {
      nextOccurrence = new Date(now);
      nextOccurrence.setDate(schedule.day);
      nextOccurrence.setHours(notificationHours, notificationMinutes, 0, 0);
      if (nextOccurrence <= now) {
        nextOccurrence.setMonth(nextOccurrence.getMonth() + 1);
      }
    } else if (frequency === 'YEARLY') {
      // For yearly, we'd need more complex logic - skip for now
      logger.warn(`Yearly frequency not fully supported for routine notifications, skipping ${routineId}`);
      return;
    }

    if (!nextOccurrence || nextOccurrence <= now) {
      logger.warn(`Could not calculate valid next occurrence for routine task ${taskId}, skipping notification`);
      return;
    }

    // Create reminder schedule matching routine frequency
    // Use the notification time (adjusted by reminderTime) for the schedule
    // IMPORTANT: Store timezone in schedule for correct rescheduling
    const reminderSchedule: any = {
      frequency,
      time: notificationTimeStr,
      timezone: timezone || 'UTC', // Store routine timezone for rescheduling
    };

    if (frequency === 'WEEKLY' && schedule.days) {
      reminderSchedule.days = schedule.days;
    } else if (frequency === 'MONTHLY' && schedule.day) {
      reminderSchedule.day = schedule.day;
    }

    logger.info(`Creating reminder for routine task ${taskId}`, {
      reminderSchedule,
      nextOccurrence: nextOccurrence.toISOString(),
      routineId,
      taskId,
    });

    // Store reminder schedule for later use (needed for alarm creation)
    const fullReminderSchedule = {
      ...reminderSchedule,
      routineId: routineId, // Store IDs in schedule for reference
      taskId: taskId,
    };

    // Create reminder record
    const reminder = await prisma.reminder.create({
      data: {
        userId,
        targetType: 'CUSTOM',
        targetId: null, // Set to null - foreign key constraint only applies to TASK type
        title: `Routine: ${routineTitle}`,
        note: `Time to complete "${taskTitle}"`,
        triggerType: 'TIME',
        schedule: fullReminderSchedule as any,
      },
    });

    // Schedule the first reminder
    try {
      const delay = nextOccurrence.getTime() - Date.now();
      if (delay <= 0) {
        logger.warn(`Cannot schedule routine task notification in the past for task ${taskId}`, {
          taskId,
          routineId,
          nextOccurrence: nextOccurrence.toISOString(),
          now: new Date().toISOString(),
          delay,
        });
        return;
      }

      const job = await scheduleReminder(reminder.id, userId, nextOccurrence, 'ROUTINE_REMINDER');
      logger.info(`Scheduled routine task notification for task ${taskId}`, {
        reminderId: reminder.id,
        taskId,
        routineId,
        taskTitle,
        nextOccurrence: nextOccurrence.toISOString(),
        schedule: reminderSchedule,
        frequency,
        jobId: job.id,
        delay,
        delayMinutes: Math.round(delay / 60000),
      });

      // Always create an alarm for the routine task
      // Priority: reminderBefore > reminderTime > routine schedule time
      try {
        let alarmTimeForReminder: string;
        
        // If reminderBefore is set, calculate alarm time as routine time - reminderBefore
        if (reminderBefore) {
          // Parse reminderBefore (e.g., "1h", "2d", "1w")
          const match = reminderBefore.match(/^(\d+)([hdw])$/);
          if (match) {
            const [, valueStr, unit] = match;
            const value = parseInt(valueStr, 10);
            const [routineHours, routineMinutes] = (schedule.time || '00:00').split(':').map(Number);
            
            let alarmHours = routineHours;
            let alarmMinutes = routineMinutes;
            
            if (unit === 'h') {
              // Hours before - subtract hours from routine time
              alarmHours = routineHours - value;
              if (alarmHours < 0) {
                alarmHours += 24; // Wrap to previous day
              }
            } else if (unit === 'd') {
              // Days before - keep same time, will be handled by date calculation in alarm creation
              // For now, use routine time but the date will be adjusted
              alarmHours = routineHours;
              alarmMinutes = routineMinutes;
            } else if (unit === 'w') {
              // Weeks before - keep same time, will be handled by date calculation
              alarmHours = routineHours;
              alarmMinutes = routineMinutes;
            }
            
            // Format as HH:mm
            alarmTimeForReminder = `${String(alarmHours).padStart(2, '0')}:${String(alarmMinutes).padStart(2, '0')}`;
            
            logger.info(`Calculated alarm time from reminderBefore: routine ${schedule.time}, reminderBefore ${reminderBefore}, alarm time ${alarmTimeForReminder}`);
          } else {
            // Invalid reminderBefore format, fall back to reminderTime or routine time
            alarmTimeForReminder = reminderTime || schedule.time || '00:00';
          }
        } else {
          // No reminderBefore, use reminderTime if provided, otherwise use routine schedule time
          alarmTimeForReminder = reminderTime || schedule.time || '00:00';
        }
        
        await createAlarmForRoutineReminder(
          routineId,
          taskId,
          userId,
          routineTitle,
          taskTitle,
          nextOccurrence,
          frequency,
          schedule,
          timezone,
          alarmTimeForReminder,
          fullReminderSchedule,
          reminderBefore // Pass reminderBefore for date adjustments if needed
        );
      } catch (alarmError: any) {
        logger.error(`Failed to create alarm for routine task reminder ${taskId}:`, {
          error: alarmError,
          taskId,
          routineId,
          reminderTime: reminderTime || 'routine time',
          reminderBefore,
        });
        // Don't throw - alarm creation failure shouldn't break reminder scheduling
      }
    } catch (scheduleError: any) {
      logger.error(`Failed to schedule reminder job for routine task ${taskId}:`, {
        error: scheduleError,
        reminderId: reminder.id,
        taskId,
        routineId,
        nextOccurrence: nextOccurrence.toISOString(),
        schedule: reminderSchedule,
      });
      // Don't throw - log the error but continue
    }
  } catch (error) {
    logger.error(`Failed to schedule routine task notifications for task ${taskId}:`, {
      error,
      taskId,
      routineId,
      userId,
    });
  }
}

/**
 * Cancel all notifications for a routine task
 */
export async function cancelRoutineTaskNotifications(
  taskId: string,
  userId: string
): Promise<void> {
  try {
    const prisma = getPrismaClient();
    // Since targetId is null for CUSTOM type, we need to match by schedule.taskId
    const allCustomReminders = await prisma.reminder.findMany({
      where: {
        targetType: 'CUSTOM',
        userId,
      },
    });
    
    // Filter reminders where schedule.taskId matches
    const matchingReminders = allCustomReminders.filter((reminder) => {
      const schedule = reminder.schedule as any;
      return schedule?.taskId === taskId;
    });
    
    // Delete matching reminders
    for (const reminder of matchingReminders) {
      await prisma.reminder.delete({
        where: { id: reminder.id },
      });
    }
    
    logger.info(`Cancelled ${matchingReminders.length} reminders for routine task ${taskId}`);
  } catch (error) {
    logger.warn(`Failed to cancel reminders for routine task ${taskId}:`, error);
  }
}

/**
 * Cancel all notifications for all tasks in a routine
 */
export async function cancelRoutineNotifications(
  routineId: string,
  userId: string
): Promise<void> {
  try {
    const prisma = getPrismaClient();
    
    // Get all tasks for this routine
    const routine = await prisma.routine.findUnique({
      where: { id: routineId },
      include: { routineTasks: true },
    });

    if (!routine) {
      return;
    }

    // Cancel alarms for this routine
    await prisma.alarm.deleteMany({
      where: {
        userId,
        title: {
          contains: `Routine: ${routine.title}`,
        },
      },
    });

    // Cancel notifications for each task
    for (const task of routine.routineTasks) {
      await cancelRoutineTaskNotifications(task.id, userId);
    }

    logger.info(`Cancelled all notifications for routine ${routineId}`);
  } catch (error) {
    logger.warn(`Failed to cancel notifications for routine ${routineId}:`, error);
  }
}

/**
 * Schedule notifications for all tasks in a routine
 */
/**
 * Schedule routine reminder notification based on reminderBefore field
 * This creates a reminder before the routine occurs (e.g., 2 hours before, 1 day before)
 */
export async function scheduleRoutineReminderNotification(
  routineId: string,
  userId: string,
  routineTitle: string,
  frequency: 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY',
  schedule: { time?: string; days?: number[]; day?: number },
  timezone: string,
  reminderBefore: string, // e.g., "2h", "1d", "1w"
  nextOccurrence: Date
): Promise<void> {
  try {
    const prisma = getPrismaClient();
    const now = new Date();

    // Parse reminderBefore (e.g., "2h", "1d", "1w")
    const match = reminderBefore.match(/^(\d+)([hdw])$/);
    if (!match) {
      logger.warn(`Invalid reminderBefore format: ${reminderBefore}, skipping reminder notification`);
      return;
    }

    const [, valueStr, unit] = match;
    const value = parseInt(valueStr, 10);

    // Calculate reminder time by subtracting from next occurrence
    const reminderTime = new Date(nextOccurrence);
    
    if (unit === 'h') {
      // Hours before
      reminderTime.setHours(reminderTime.getHours() - value);
    } else if (unit === 'd') {
      // Days before
      reminderTime.setDate(reminderTime.getDate() - value);
    } else if (unit === 'w') {
      // Weeks before
      reminderTime.setDate(reminderTime.getDate() - (value * 7));
    }

    // Only schedule if reminder time is in the future
    if (reminderTime <= now) {
      logger.info(`Routine reminder time is in the past, skipping: ${reminderTime.toISOString()}`);
      return;
    }

    // Cancel existing routine reminder notifications
    await prisma.reminder.deleteMany({
      where: {
        targetType: 'CUSTOM',
        userId,
        title: {
          contains: `Routine Reminder: ${routineTitle}`,
        },
      },
    });

    // Create reminder schedule
    const reminderSchedule: any = {
      frequency,
      time: schedule.time,
      timezone: timezone || 'UTC',
      routineId,
      reminderBefore,
    };

    if (frequency === 'WEEKLY' && schedule.days) {
      reminderSchedule.days = schedule.days;
    } else if (frequency === 'MONTHLY' && schedule.day) {
      reminderSchedule.day = schedule.day;
    }

    // Create reminder record
    const reminder = await prisma.reminder.create({
      data: {
        userId,
        targetType: 'CUSTOM',
        targetId: null,
        title: `Routine Reminder: ${routineTitle}`,
        note: `Your routine "${routineTitle}" is coming up soon`,
        triggerType: 'TIME',
        schedule: reminderSchedule as any,
      },
    });

    // Schedule the reminder notification
    const delay = reminderTime.getTime() - Date.now();
    if (delay <= 0) {
      logger.warn(`Cannot schedule routine reminder in the past for routine ${routineId}`, {
        reminderTime: reminderTime.toISOString(),
        now: new Date().toISOString(),
        delay,
      });
      return;
    }

    const job = await scheduleReminder(reminder.id, userId, reminderTime, 'ROUTINE_REMINDER');
    logger.info(`Scheduled routine reminder notification for routine ${routineId}`, {
      reminderId: reminder.id,
      routineId,
      reminderTime: reminderTime.toISOString(),
      nextOccurrence: nextOccurrence.toISOString(),
      reminderBefore,
      jobId: job.id,
      delayMs: delay,
      delayMinutes: Math.round(delay / 60000),
    });
  } catch (error) {
    logger.error(`Failed to schedule routine reminder notification for routine ${routineId}:`, error);
  }
}

export async function scheduleRoutineNotifications(
  routineId: string,
  _userId: string
): Promise<void> {
  try {
    const prisma = getPrismaClient();
    
    // Retry logic for connection errors
    let routine;
    let retries = 0;
    const maxRetries = 3;
    
    while (retries < maxRetries) {
      try {
        routine = await prisma.routine.findUnique({
          where: { id: routineId },
          include: { routineTasks: true },
        });
        break; // Success, exit retry loop
      } catch (error: any) {
        const isConnectionError = 
          error?.code === 'P1017' || 
          error?.message?.includes('connection') ||
          error?.message?.includes('closed');
        
        if (isConnectionError && retries < maxRetries - 1) {
          retries++;
          logger.warn(`Database connection error when fetching routine (attempt ${retries}/${maxRetries}), retrying...`, {
            routineId,
            error: error.message,
          });
          await new Promise(resolve => setTimeout(resolve, 1000 * retries));
          continue;
        }
        throw error; // Re-throw if not connection error or max retries reached
      }
    }

    if (!routine || !routine.enabled) {
      logger.info(`Routine ${routineId} not found or disabled, skipping notification scheduling`);
      return;
    }

    const schedule = routine.schedule as any;

    // Calculate next occurrence for the routine
    const now = new Date();
    let nextOccurrence: Date | null = null;
    const [routineHours, routineMinutes] = (schedule.time || '00:00').split(':').map(Number);

    if (routine.frequency === 'DAILY') {
      nextOccurrence = new Date(now);
      nextOccurrence.setHours(routineHours, routineMinutes, 0, 0);
      if (nextOccurrence <= now) {
        nextOccurrence.setDate(nextOccurrence.getDate() + 1);
      }
    } else if (routine.frequency === 'WEEKLY' && schedule.days && schedule.days.length > 0) {
      const currentDay = now.getDay();
      let soonest: Date | null = null;
      for (const day of schedule.days) {
        const d = new Date(now);
        const delta = (day - currentDay + 7) % 7;
        d.setDate(d.getDate() + delta);
        d.setHours(routineHours, routineMinutes, 0, 0);
        if (d <= now) {
          d.setDate(d.getDate() + 7);
        }
        if (!soonest || d < soonest) soonest = d;
      }
      nextOccurrence = soonest;
    } else if (routine.frequency === 'MONTHLY' && schedule.day) {
      nextOccurrence = new Date(now);
      nextOccurrence.setDate(schedule.day);
      nextOccurrence.setHours(routineHours, routineMinutes, 0, 0);
      if (nextOccurrence <= now) {
        nextOccurrence.setMonth(nextOccurrence.getMonth() + 1);
      }
    }

    // Schedule routine reminder if reminderBefore is set
    if (routine.reminderBefore && nextOccurrence) {
      await scheduleRoutineReminderNotification(
        routine.id,
        routine.userId,
        routine.title,
        routine.frequency,
        schedule,
        routine.timezone,
        routine.reminderBefore,
        nextOccurrence
      );
    }

    // Schedule notifications for each task
    for (const task of routine.routineTasks) {
      await scheduleRoutineTaskNotifications(
        routine.id,
        routine.userId,
        routine.title,
        routine.frequency,
        schedule,
        routine.timezone,
        task.id,
        task.title,
        task.reminderTime,
        routine.reminderBefore // Pass reminderBefore so alarm can be created at reminder time
      );
    }

    logger.info(`Scheduled notifications for all tasks in routine ${routineId}`);
  } catch (error) {
    logger.error(`Failed to schedule notifications for routine ${routineId}:`, error);
  }
}

/**
 * Create an alarm for a routine reminder time
 * This creates a recurring alarm that matches the routine frequency
 */
async function createAlarmForRoutineReminder(
  routineId: string,
  taskId: string,
  userId: string,
  routineTitle: string,
  taskTitle: string,
  nextOccurrence: Date,
  frequency: 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY',
  schedule: { time?: string; days?: number[]; day?: number },
  timezone: string,
  reminderTime: string | null | undefined,
  reminderSchedule: any,
  reminderBefore?: string | null
): Promise<void> {
  try {
    const prisma = getPrismaClient();
    
    // Cancel existing alarms for this routine task
    try {
      await prisma.alarm.deleteMany({
        where: {
          userId,
          title: {
            contains: `Routine: ${routineTitle}`,
          },
        },
      });
    } catch (deleteError: any) {
      logger.warn(`Failed to delete existing alarms for routine, continuing anyway:`, {
        error: deleteError,
        routineId,
        routineTitle,
      });
      // Continue - we'll try to create the alarm anyway
    }

    // Calculate alarm time based on reminderTime
    // reminderTime is already the calculated alarm time (e.g., "02:24" when reminderBefore is "1h" and routine is "03:24")
    // If reminderTime is provided and is in HH:mm format, use it directly
    // Otherwise, default to routine schedule time
    let alarmHours: number;
    let alarmMinutes: number;
    
    if (reminderTime && reminderTime.includes(':')) {
      // reminderTime is an absolute time (e.g., "02:24") - use it directly
      [alarmHours, alarmMinutes] = reminderTime.split(':').map(Number);
      logger.info(`Using provided reminderTime as alarm time: ${reminderTime}`);
    } else {
      // Use routine schedule time as default
      const [routineHours, routineMinutes] = (schedule.time || '00:00').split(':').map(Number);
      alarmHours = routineHours;
      alarmMinutes = routineMinutes;
    }

    // Set alarm time to next occurrence with calculated hours/minutes
    // Use setHours (local time) to match nextOccurrence which is also calculated in local time
    // This ensures the alarm time is in the user's timezone, matching the routine schedule
    const alarmTime = new Date(nextOccurrence);
    alarmTime.setHours(alarmHours, alarmMinutes, 0, 0);
    
    // If reminderBefore is set, adjust the date based on it
    if (reminderBefore) {
      const match = reminderBefore.match(/^(\d+)([hdw])$/);
      if (match) {
        const [, valueStr, unit] = match;
        const value = parseInt(valueStr, 10);
        
        if (unit === 'd') {
          // Days before - subtract days from nextOccurrence
          alarmTime.setDate(alarmTime.getDate() - value);
        } else if (unit === 'w') {
          // Weeks before - subtract weeks from nextOccurrence
          alarmTime.setDate(alarmTime.getDate() - (value * 7));
        }
        // For hours ('h'), we already adjusted the time above in the hours calculation
        // If the alarm time is earlier in the day than the routine time, we need to move it back a day
        if (unit === 'h') {
          // Compare alarm time to routine time on the same day
          const routineTimeOnSameDay = new Date(nextOccurrence);
          const [routineH, routineM] = (schedule.time || '00:00').split(':').map(Number);
          routineTimeOnSameDay.setHours(routineH, routineM, 0, 0);
          
          // If alarm time is before routine time, move it to the previous day
          if (alarmTime.getTime() < routineTimeOnSameDay.getTime()) {
            alarmTime.setDate(alarmTime.getDate() - 1);
          }
        }
      }
    }
    
    // If alarm time is before nextOccurrence (for hours offset), it means we need to adjust the date
    // For absolute times, we want the alarm at that time on the same day as nextOccurrence
    // For relative times, the calculation above should be correct

    // Generate recurrence rule based on frequency
    let recurrenceRule: string | null = null;
    if (frequency === 'DAILY') {
      recurrenceRule = 'FREQ=DAILY';
    } else if (frequency === 'WEEKLY' && schedule.days && schedule.days.length > 0) {
      // Convert days to RRULE format (0=Sunday, 1=Monday, etc.)
      // RRULE uses: SU,MO,TU,WE,TH,FR,SA
      const dayNames = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
      const byDay = schedule.days.map(day => dayNames[day]).join(',');
      recurrenceRule = `FREQ=WEEKLY;BYDAY=${byDay}`;
    } else if (frequency === 'MONTHLY' && schedule.day) {
      recurrenceRule = `FREQ=MONTHLY;BYMONTHDAY=${schedule.day}`;
    } else if (frequency === 'YEARLY') {
      // For yearly, we'd need the full date - simplified for now
      recurrenceRule = 'FREQ=YEARLY';
    }

    // Create the alarm with error handling for database connection issues
    let alarm;
    try {
      alarm = await prisma.alarm.create({
        data: {
          userId,
          title: `Routine: ${routineTitle}`,
          time: alarmTime,
          timezone: timezone || 'UTC',
          recurrenceRule,
          enabled: true,
          snoozeConfig: {
            duration: 5, // 5 minutes snooze
            maxSnoozes: 3,
          },
          smartWakeWindow: 5,
        },
      });
      logger.info(`Alarm created successfully in database`, {
        alarmId: alarm.id,
        routineId,
        taskId,
        alarmTime: alarmTime.toISOString(),
      });
    } catch (createError: any) {
      logger.error(`Failed to create alarm in database:`, {
        error: createError,
        routineId,
        taskId,
        alarmTime: alarmTime.toISOString(),
        errorMessage: createError?.message,
        errorCode: createError?.code,
      });
      throw createError; // Re-throw to be caught by outer try-catch
    }

    // Schedule push notification for the alarm
    try {
      await scheduleAlarmPushNotification({
        id: alarm.id,
        userId: alarm.userId,
        title: alarm.title,
        time: alarm.time,
        timezone: alarm.timezone || 'UTC',
        recurrenceRule: alarm.recurrenceRule,
        enabled: alarm.enabled,
      });
      logger.info(`Push notification scheduled for alarm`, {
        alarmId: alarm.id,
      });
    } catch (scheduleError: any) {
      logger.error(`Failed to schedule push notification for alarm, but alarm was created:`, {
        error: scheduleError,
        alarmId: alarm.id,
        errorMessage: scheduleError?.message,
      });
      // Don't throw - alarm creation succeeded, notification scheduling can be retried
    }

    // Store alarm ID in reminder schedule for reference
    // Use try-catch to handle potential database connection issues
    try {
      await prisma.reminder.updateMany({
        where: {
          userId,
          targetType: 'CUSTOM',
          note: {
            contains: taskTitle,
          },
        },
        data: {
          schedule: {
            ...reminderSchedule,
            alarmId: alarm.id,
          } as any,
        },
      });
    } catch (updateError: any) {
      logger.warn(`Failed to update reminder with alarm ID, but alarm was created successfully`, {
        error: updateError,
        alarmId: alarm.id,
        reminderId: reminderSchedule.taskId,
      });
      // Don't throw - alarm creation succeeded, reminder update is optional
    }

    logger.info(`Created alarm for routine task reminder`, {
      alarmId: alarm.id,
      routineId,
      taskId,
      alarmTime: alarmTime.toISOString(),
      recurrenceRule,
      reminderTime,
    });
  } catch (error) {
    logger.error(`Failed to create alarm for routine reminder:`, error);
    throw error;
  }
}

