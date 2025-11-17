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
  reminderTime?: string | null
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

    // Create reminder record
    const reminder = await prisma.reminder.create({
      data: {
        userId,
        targetType: 'CUSTOM',
        targetId: null, // Set to null - foreign key constraint only applies to TASK type
        title: `Routine: ${routineTitle}`,
        note: `Time to complete "${taskTitle}"`,
        triggerType: 'TIME',
          schedule: {
            ...reminderSchedule,
            routineId: routineId, // Store IDs in schedule for reference
            taskId: taskId,
          } as any,
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
  userId: string
): Promise<void> {
  try {
    const prisma = getPrismaClient();
    
    const routine = await prisma.routine.findUnique({
      where: { id: routineId },
      include: { routineTasks: true },
    });

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
        task.reminderTime
      );
    }

    logger.info(`Scheduled notifications for all tasks in routine ${routineId}`);
  } catch (error) {
    logger.error(`Failed to schedule notifications for routine ${routineId}:`, error);
  }
}

