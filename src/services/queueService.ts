import { Queue, Worker, Job } from 'bullmq';
import { getRedisClient } from '../utils/redis';
import { logger } from '../utils/logger';

// Queue names
export const QUEUE_NAMES = {
  REMINDERS: 'reminders',
  NOTIFICATIONS: 'notifications',
  AI_PLAN_GENERATION: 'ai-plan-generation',
  EMAIL: 'email',
  CLEANUP: 'cleanup',
} as const;

// Job types
export const JOB_TYPES = {
  SEND_REMINDER: 'send-reminder',
  SEND_NOTIFICATION: 'send-notification',
  GENERATE_PLAN: 'generate-plan',
  SEND_EMAIL: 'send-email',
  CLEANUP_OLD_DATA: 'cleanup-old-data',
} as const;

// Queue instances
const queues: { [key: string]: Queue } = {};

// Worker instances
const workers: { [key: string]: Worker } = {};

export const initializeQueues = async (): Promise<void> => {
  const redis = getRedisClient();

  // Initialize queues
  Object.values(QUEUE_NAMES).forEach(queueName => {
    queues[queueName] = new Queue(queueName, {
      connection: redis,
      defaultJobOptions: {
        removeOnComplete: 100,
        removeOnFail: 50,
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 2000,
        },
      },
    });
  });

  // Initialize workers
  await initializeWorkers();

  logger.info('All queues and workers initialized');
};

const initializeWorkers = async (): Promise<void> => {
  const redis = getRedisClient();

  // Reminder worker
  workers[QUEUE_NAMES.REMINDERS] = new Worker(
    QUEUE_NAMES.REMINDERS,
    async (job: Job) => {
      await processReminderJob(job);
    },
    {
      connection: redis,
      concurrency: 10,
    }
  );

  // Notification worker
  workers[QUEUE_NAMES.NOTIFICATIONS] = new Worker(
    QUEUE_NAMES.NOTIFICATIONS,
    async (job: Job) => {
      await processNotificationJob(job);
    },
    {
      connection: redis,
      concurrency: 20,
    }
  );

  // AI Plan Generation worker
  workers[QUEUE_NAMES.AI_PLAN_GENERATION] = new Worker(
    QUEUE_NAMES.AI_PLAN_GENERATION,
    async (job: Job) => {
      await processAIPlanGenerationJob(job);
    },
    {
      connection: redis,
      concurrency: 5,
    }
  );

  // Email worker
  workers[QUEUE_NAMES.EMAIL] = new Worker(
    QUEUE_NAMES.EMAIL,
    async (job: Job) => {
      await processEmailJob(job);
    },
    {
      connection: redis,
      concurrency: 10,
    }
  );

  // Cleanup worker
  workers[QUEUE_NAMES.CLEANUP] = new Worker(
    QUEUE_NAMES.CLEANUP,
    async (job: Job) => {
      await processCleanupJob(job);
    },
    {
      connection: redis,
      concurrency: 1,
    }
  );

  // Set up error handling for all workers
  Object.values(workers).forEach(worker => {
    worker.on('error', (error) => {
      logger.error('Worker error:', error);
    });

    worker.on('failed', (job, error) => {
      logger.error(`Job ${job?.id} failed:`, error);
    });
  });
};

// Job processing functions

// --- Helper: compute next occurrence for simple schedules ---
function computeNextOccurrence(schedule: any, timezone: string): Date | null {
  try {
    if (!schedule || typeof schedule !== 'object') return null;

    // One-off at a specific ISO date: do not reschedule
    if (schedule.at) return null;

    const now = new Date();

    if (schedule.frequency === 'DAILY' && schedule.time) {
      const [hh, mm] = String(schedule.time).split(':').map((v: string) => parseInt(v, 10));
      const next = new Date(now);
      next.setHours(hh || 0, mm || 0, 0, 0);
      if (next <= now) {
        next.setDate(next.getDate() + 1);
      }
      return next;
    }

    if (schedule.frequency === 'WEEKLY' && schedule.time) {
      const [hh, mm] = String(schedule.time).split(':').map((v: string) => parseInt(v, 10));
      const days: number[] = Array.isArray(schedule.days) && schedule.days.length > 0 ? schedule.days : [new Date().getDay()];
      // Find soonest upcoming day/time
      let soonest: Date | null = null;
      for (const day of days) {
        const d = new Date(now);
        const delta = (day - d.getDay() + 7) % 7;
        d.setDate(d.getDate() + delta);
        d.setHours(hh || 0, mm || 0, 0, 0);
        if (d <= now) {
          d.setDate(d.getDate() + 7);
        }
        if (!soonest || d < soonest) soonest = d;
      }
      return soonest;
    }

    return null;
  } catch {
    return null;
  }
}

async function processReminderJob(job: Job): Promise<void> {
  const { reminderId, userId, type } = job.data;

  logger.info(`Processing reminder job: ${reminderId}`);

  try {
    const { pushNotificationService } = await import('./pushNotificationService');
    const { getPrismaClient } = await import('../utils/database');
    const prisma = getPrismaClient();

    // Get reminder record
    const reminder = await prisma.reminder.findUnique({
      where: { id: reminderId },
    });

    if (!reminder) {
      logger.warn(`Reminder ${reminderId} not found`);
      return;
    }

    // Check user notification preferences
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { settings: true },
    });

    const settings = (user?.settings as any) || {};
    const notificationSettings = settings.notifications || {};

    // Check if push notifications are enabled and if reminder type is enabled
    let shouldSendPush = notificationSettings.pushNotifications !== false;

    if (type === 'TASK_REMINDER' && notificationSettings.taskReminders === false) {
      shouldSendPush = false;
    } else if (type === 'GOAL_REMINDER' && notificationSettings.goalReminders === false) {
      shouldSendPush = false;
    } else if (type === 'DUE_DATE_REMINDER' && notificationSettings.dueDateReminders === false) {
      shouldSendPush = false;
    }

    // Send push notification if enabled
    if (shouldSendPush && pushNotificationService.isAvailable()) {
      await pushNotificationService.sendPushNotification(
        userId,
        {
          title: reminder.title,
          body: reminder.note || 'Reminder',
          data: {
            reminderId,
            type,
            targetType: reminder.targetType,
            targetId: reminder.targetId,
          },
          sound: 'default',
        },
        false // Already checked preferences above
      );
    }

    // Schedule next occurrence if recurring-like schedule is present
    try {
      const schedule: any = reminder.schedule as any;
      // Expected minimal schedule formats:
      // { frequency: 'DAILY', time: 'HH:mm' }
      // { frequency: 'WEEKLY', time: 'HH:mm', days: [0-6] } // 0=Sunday
      // { at: 'ISO_DATE' } // one-off (no reschedule)
      const next = computeNextOccurrence(schedule, (user?.settings as any)?.timezone || 'UTC');
      if (next) {
        await scheduleReminder(reminderId, userId, next, type);
        logger.info(`Rescheduled recurring reminder ${reminderId} for ${next.toISOString()}`);
      }
    } catch (rescheduleError) {
      logger.warn(`Could not reschedule reminder ${reminderId}:`, rescheduleError);
    }

    logger.info(`Reminder job completed: ${reminderId}`);
  } catch (error) {
    logger.error(`Reminder job failed: ${reminderId}`, error);
    throw error;
  }
}

async function processNotificationJob(job: Job): Promise<void> {
  const { notificationId, userId, type, payload } = job.data;

  logger.info(`Processing notification job: ${notificationId}`);

  try {
    const { pushNotificationService } = await import('./pushNotificationService');
    const { getPrismaClient } = await import('../utils/database');
    const prisma = getPrismaClient();

    // Get notification record from database
    const notification = await prisma.notification.findUnique({
      where: { id: notificationId },
    });

    if (!notification) {
      logger.warn(`Notification ${notificationId} not found`);
      return;
    }

    // Check notification settings for this type
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { settings: true },
    });

    const settings = (user?.settings as any) || {};
    const notificationSettings = settings.notifications || {};

    // Determine if push notification should be sent based on type
    let shouldSendPush = notificationSettings.pushNotifications !== false;

    if (type === 'PROJECT_INVITATION' && notificationSettings.projectInvitations === false) {
      shouldSendPush = false;
    } else if (type === 'TASK_ASSIGNMENT' && notificationSettings.taskAssignments === false) {
      shouldSendPush = false;
    } else if (type === 'TASK_COMMENT' && notificationSettings.taskComments === false) {
      shouldSendPush = false;
    } else if (type === 'TASK_REMINDER' && notificationSettings.taskReminders === false) {
      shouldSendPush = false;
    } else if (type === 'GOAL_REMINDER' && notificationSettings.goalReminders === false) {
      shouldSendPush = false;
    } else if (type === 'DUE_DATE_REMINDER' && notificationSettings.dueDateReminders === false) {
      shouldSendPush = false;
    }

    // Send push notification if enabled
    if (shouldSendPush && pushNotificationService.isAvailable()) {
      const notificationPayload = notification.payload as any;
      const title = notificationPayload.title || 'New Notification';
      const body = notificationPayload.body || 'You have a new notification';

      await pushNotificationService.sendPushNotification(
        userId,
        {
          title,
          body,
          data: {
            notificationId,
            type,
            ...notificationPayload,
          },
          sound: 'default',
        },
        false // Already checked preferences above
      );
    }

    // Update notification status to SENT
    await prisma.notification.update({
      where: { id: notificationId },
      data: {
        status: 'SENT',
        sentAt: new Date(),
      },
    });

    logger.info(`Notification job completed: ${notificationId}`);
  } catch (error) {
    logger.error(`Notification job failed: ${notificationId}`, error);
    
    // Update notification status to FAILED
    try {
      const { getPrismaClient } = await import('../utils/database');
      const prisma = getPrismaClient();
      await prisma.notification.update({
        where: { id: notificationId },
        data: {
          status: 'FAILED',
        },
      });
    } catch (updateError) {
      logger.error(`Failed to update notification status: ${notificationId}`, updateError);
    }
    
    throw error;
  }
}

async function processAIPlanGenerationJob(job: Job): Promise<void> {
  const { goalId, userId, promptOptions } = job.data;

  logger.info(`Processing AI plan generation job: ${goalId}`);

  try {
    // TODO: Implement AI plan generation
    // - Call OpenAI API
    // - Parse response
    // - Create milestones and tasks
    // - Schedule reminders

    logger.info(`AI plan generation job completed: ${goalId}`);
  } catch (error) {
    logger.error(`AI plan generation job failed: ${goalId}`, error);
    throw error;
  }
}

async function processEmailJob(job: Job): Promise<void> {
  const { to, subject, body, template, data } = job.data;

  logger.info(`Processing email job: ${to}`);

  try {
    // TODO: Implement email sending
    // - Use SMTP or email service
    // - Render template if provided
    // - Send email

    logger.info(`Email job completed: ${to}`);
  } catch (error) {
    logger.error(`Email job failed: ${to}`, error);
    throw error;
  }
}

async function processCleanupJob(job: Job): Promise<void> {
  const { type } = job.data;

  logger.info(`Processing cleanup job: ${type}`);

  try {
    // TODO: Implement cleanup tasks
    // - Clean old analytics events
    // - Clean expired refresh tokens
    // - Clean old notifications
    // - Clean old sync operations

    logger.info(`Cleanup job completed: ${type}`);
  } catch (error) {
    logger.error(`Cleanup job failed: ${type}`, error);
    throw error;
  }
}

// Queue management functions
export const addJob = async (queueName: string, jobType: string, data: any, options?: any): Promise<Job> => {
  const queue = queues[queueName];
  if (!queue) {
    throw new Error(`Queue ${queueName} not found`);
  }

  return await queue.add(jobType, data, options);
};

export const scheduleJob = async (
  queueName: string,
  jobType: string,
  data: any,
  delay: number,
  options?: any
): Promise<Job> => {
  const queue = queues[queueName];
  if (!queue) {
    throw new Error(`Queue ${queueName} not found`);
  }

  return await queue.add(jobType, data, {
    ...options,
    delay,
  });
};

export const getQueue = (queueName: string): Queue | undefined => {
  return queues[queueName];
};

export const getWorker = (queueName: string): Worker | undefined => {
  return workers[queueName];
};

export const closeAllQueues = async (): Promise<void> => {
  await Promise.all([
    ...Object.values(queues).map(queue => queue.close()),
    ...Object.values(workers).map(worker => worker.close()),
  ]);
  logger.info('All queues and workers closed');
};

// Specific job scheduling functions
export const scheduleReminder = async (
  reminderId: string,
  userId: string,
  scheduledFor: Date,
  type: string = 'time'
): Promise<Job> => {
  const delay = scheduledFor.getTime() - Date.now();
  if (delay <= 0) {
    throw new Error('Cannot schedule reminder in the past');
  }

  return await scheduleJob(
    QUEUE_NAMES.REMINDERS,
    JOB_TYPES.SEND_REMINDER,
    { reminderId, userId, type },
    delay
  );
};

export const scheduleNotification = async (
  notificationId: string,
  userId: string,
  scheduledFor: Date,
  type: string,
  payload: any
): Promise<Job> => {
  const delay = scheduledFor.getTime() - Date.now();
  if (delay <= 0) {
    throw new Error('Cannot schedule notification in the past');
  }

  return await scheduleJob(
    QUEUE_NAMES.NOTIFICATIONS,
    JOB_TYPES.SEND_NOTIFICATION,
    { notificationId, userId, type, payload },
    delay
  );
};

export const scheduleAIPlanGeneration = async (
  goalId: string,
  userId: string,
  promptOptions: any
): Promise<Job> => {
  return await addJob(
    QUEUE_NAMES.AI_PLAN_GENERATION,
    JOB_TYPES.GENERATE_PLAN,
    { goalId, userId, promptOptions }
  );
};

export const scheduleEmail = async (
  to: string,
  subject: string,
  body: string,
  template?: string,
  data?: any
): Promise<Job> => {
  return await addJob(
    QUEUE_NAMES.EMAIL,
    JOB_TYPES.SEND_EMAIL,
    { to, subject, body, template, data }
  );
};

export const scheduleCleanup = async (type: string, delay: number = 0): Promise<Job> => {
  return await scheduleJob(
    QUEUE_NAMES.CLEANUP,
    JOB_TYPES.CLEANUP_OLD_DATA,
    { type },
    delay
  );
};
