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
Object.defineProperty(exports, "__esModule", { value: true });
exports.scheduleCleanup = exports.scheduleEmail = exports.scheduleAIPlanGeneration = exports.scheduleNotification = exports.scheduleReminder = exports.closeAllQueues = exports.getWorker = exports.getQueue = exports.scheduleJob = exports.addJob = exports.initializeQueues = exports.JOB_TYPES = exports.QUEUE_NAMES = void 0;
const bullmq_1 = require("bullmq");
const redis_1 = require("../utils/redis");
const logger_1 = require("../utils/logger");
exports.QUEUE_NAMES = {
    REMINDERS: 'reminders',
    NOTIFICATIONS: 'notifications',
    AI_PLAN_GENERATION: 'ai-plan-generation',
    EMAIL: 'email',
    CLEANUP: 'cleanup',
};
exports.JOB_TYPES = {
    SEND_REMINDER: 'send-reminder',
    SEND_NOTIFICATION: 'send-notification',
    GENERATE_PLAN: 'generate-plan',
    SEND_EMAIL: 'send-email',
    CLEANUP_OLD_DATA: 'cleanup-old-data',
};
const queues = {};
const workers = {};
const initializeQueues = async () => {
    const redis = (0, redis_1.getRedisClient)();
    Object.values(exports.QUEUE_NAMES).forEach(queueName => {
        queues[queueName] = new bullmq_1.Queue(queueName, {
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
    await initializeWorkers();
    logger_1.logger.info('All queues and workers initialized');
};
exports.initializeQueues = initializeQueues;
const initializeWorkers = async () => {
    const redis = (0, redis_1.getRedisClient)();
    const defaultWorkerOptions = {
        connection: redis,
        lockDuration: 300000,
        maxStalledCount: 1,
        maxStalledCountResetter: 10000,
    };
    workers[exports.QUEUE_NAMES.REMINDERS] = new bullmq_1.Worker(exports.QUEUE_NAMES.REMINDERS, async (job) => {
        await processReminderJob(job);
    }, {
        ...defaultWorkerOptions,
        concurrency: 10,
    });
    workers[exports.QUEUE_NAMES.NOTIFICATIONS] = new bullmq_1.Worker(exports.QUEUE_NAMES.NOTIFICATIONS, async (job) => {
        await processNotificationJob(job);
    }, {
        ...defaultWorkerOptions,
        concurrency: 20,
    });
    workers[exports.QUEUE_NAMES.AI_PLAN_GENERATION] = new bullmq_1.Worker(exports.QUEUE_NAMES.AI_PLAN_GENERATION, async (job) => {
        await processAIPlanGenerationJob(job);
    }, {
        ...defaultWorkerOptions,
        concurrency: 5,
        lockDuration: 600000,
    });
    workers[exports.QUEUE_NAMES.EMAIL] = new bullmq_1.Worker(exports.QUEUE_NAMES.EMAIL, async (job) => {
        await processEmailJob(job);
    }, {
        ...defaultWorkerOptions,
        concurrency: 10,
    });
    workers[exports.QUEUE_NAMES.CLEANUP] = new bullmq_1.Worker(exports.QUEUE_NAMES.CLEANUP, async (job) => {
        await processCleanupJob(job);
    }, {
        ...defaultWorkerOptions,
        concurrency: 1,
        lockDuration: 600000,
    });
    Object.values(workers).forEach(worker => {
        worker.on('error', (error) => {
            if (error.message && error.message.includes('Missing lock')) {
                logger_1.logger.debug('Worker lock error (non-critical):', error.message);
                return;
            }
            logger_1.logger.error('Worker error:', error);
        });
        worker.on('failed', (job, error) => {
            if (error.message && error.message.includes('Missing lock')) {
                logger_1.logger.debug(`Job ${job?.id} lock error (non-critical):`, error.message);
                return;
            }
            logger_1.logger.error(`Job ${job?.id} failed:`, error);
        });
    });
};
function computeNextOccurrence(schedule, _timezone) {
    try {
        if (!schedule || typeof schedule !== 'object') {
            logger_1.logger.debug('computeNextOccurrence: schedule is not an object', { schedule });
            return null;
        }
        if (schedule.at) {
            logger_1.logger.debug('computeNextOccurrence: one-off schedule, not rescheduling', { schedule });
            return null;
        }
        const now = new Date();
        if (schedule.frequency === 'DAILY' && schedule.time) {
            const [hh, mm] = String(schedule.time).split(':').map((v) => parseInt(v, 10));
            const next = new Date(now);
            next.setHours(hh || 0, mm || 0, 0, 0);
            if (next <= now) {
                next.setDate(next.getDate() + 1);
            }
            logger_1.logger.debug('computeNextOccurrence: calculated DAILY next occurrence', { next: next.toISOString(), schedule });
            return next;
        }
        if (schedule.frequency === 'WEEKLY' && schedule.time) {
            const [hh, mm] = String(schedule.time).split(':').map((v) => parseInt(v, 10));
            const days = Array.isArray(schedule.days) && schedule.days.length > 0 ? schedule.days : [new Date().getDay()];
            let soonest = null;
            for (const day of days) {
                const d = new Date(now);
                const delta = (day - d.getDay() + 7) % 7;
                d.setDate(d.getDate() + delta);
                d.setHours(hh || 0, mm || 0, 0, 0);
                if (d <= now) {
                    d.setDate(d.getDate() + 7);
                }
                if (!soonest || d < soonest)
                    soonest = d;
            }
            logger_1.logger.debug('computeNextOccurrence: calculated WEEKLY next occurrence', { next: soonest?.toISOString(), schedule });
            return soonest;
        }
        if (schedule.frequency === 'MONTHLY' && schedule.time && schedule.day) {
            const [hh, mm] = String(schedule.time).split(':').map((v) => parseInt(v, 10));
            const targetDay = schedule.day;
            const next = new Date(now);
            next.setDate(targetDay);
            next.setHours(hh || 0, mm || 0, 0, 0);
            if (next <= now) {
                next.setMonth(next.getMonth() + 1);
                const daysInMonth = new Date(next.getFullYear(), next.getMonth() + 1, 0).getDate();
                if (targetDay > daysInMonth) {
                    next.setDate(daysInMonth);
                }
                else {
                    next.setDate(targetDay);
                }
            }
            logger_1.logger.debug('computeNextOccurrence: calculated MONTHLY next occurrence', { next: next.toISOString(), schedule });
            return next;
        }
        logger_1.logger.warn('computeNextOccurrence: unsupported schedule format', { schedule, frequency: schedule.frequency });
        return null;
    }
    catch (error) {
        logger_1.logger.error('computeNextOccurrence: error calculating next occurrence', { error, schedule });
        return null;
    }
}
async function processReminderJob(job) {
    const { reminderId, userId, type } = job.data;
    logger_1.logger.info(`Processing reminder job: ${reminderId}`, { type, userId });
    try {
        const { pushNotificationService } = await Promise.resolve().then(() => __importStar(require('./pushNotificationService')));
        const { getPrismaClient } = await Promise.resolve().then(() => __importStar(require('../utils/database')));
        const prisma = getPrismaClient();
        const reminder = await prisma.reminder.findUnique({
            where: { id: reminderId },
        });
        if (!reminder) {
            logger_1.logger.warn(`Reminder ${reminderId} not found`);
            return;
        }
        logger_1.logger.info(`Reminder found: ${reminderId}`, {
            title: reminder.title,
            note: reminder.note,
            targetType: reminder.targetType,
            targetId: reminder.targetId,
            schedule: reminder.schedule
        });
        const user = await prisma.user.findUnique({
            where: { id: userId },
            select: { settings: true },
        });
        const settings = user?.settings || {};
        const notificationSettings = settings.notifications || {};
        logger_1.logger.info('Notification settings check for reminder', {
            userId,
            type,
            reminderId,
            pushNotifications: notificationSettings.pushNotifications,
            routineReminders: notificationSettings.routineReminders,
            targetType: reminder.targetType,
            targetId: reminder.targetId,
        });
        let shouldSendPush = notificationSettings.pushNotifications !== false;
        if (type === 'TASK_REMINDER' && notificationSettings.taskReminders === false) {
            shouldSendPush = false;
            logger_1.logger.debug('Push notification disabled: taskReminders setting', { type });
        }
        else if (type === 'GOAL_REMINDER' && notificationSettings.goalReminders === false) {
            shouldSendPush = false;
            logger_1.logger.debug('Push notification disabled: goalReminders setting', { type });
        }
        else if (type === 'DUE_DATE_REMINDER' && notificationSettings.dueDateReminders === false) {
            shouldSendPush = false;
            logger_1.logger.debug('Push notification disabled: dueDateReminders setting', { type });
        }
        else if (type === 'ROUTINE_REMINDER' && notificationSettings.routineReminders === false) {
            shouldSendPush = false;
            logger_1.logger.info('Push notification disabled: routineReminders setting is false', {
                type,
                userId,
                reminderId,
                routineReminders: notificationSettings.routineReminders,
            });
        }
        else if (type === 'ROUTINE_REMINDER') {
            const schedule = reminder.schedule;
            let routineId = schedule?.routineId;
            let routine = null;
            if (!routineId && schedule?.taskId) {
                const routineTask = await prisma.routineTask.findUnique({
                    where: { id: schedule.taskId },
                    include: { routine: { select: { id: true, enabled: true, userId: true } } },
                });
                if (routineTask?.routine) {
                    routineId = routineTask.routine.id;
                    routine = routineTask.routine;
                }
            }
            else if (routineId) {
                routine = await prisma.routine.findUnique({
                    where: { id: routineId },
                    select: { enabled: true, userId: true },
                });
            }
            if (routineId && (!routine || !routine.enabled || routine.userId !== userId)) {
                shouldSendPush = false;
                logger_1.logger.info('Push notification skipped: routine is disabled or not found', {
                    type,
                    userId,
                    reminderId,
                    routineId,
                    taskId: schedule?.taskId,
                    routineEnabled: routine?.enabled,
                    routineExists: !!routine,
                });
                if (!routine || !routine.enabled) {
                    logger_1.logger.info(`Skipping reschedule for reminder ${reminderId}: routine is disabled`, {
                        reminderId,
                        routineId,
                        enabled: routine?.enabled,
                    });
                    await prisma.reminder.delete({
                        where: { id: reminderId },
                    }).catch(err => logger_1.logger.error(`Failed to delete reminder ${reminderId}:`, err));
                    logger_1.logger.info(`Reminder job completed (cancelled due to disabled routine): ${reminderId}`);
                    return;
                }
            }
            logger_1.logger.debug('Routine reminder notification enabled', {
                type,
                userId,
                reminderId,
                routineReminders: notificationSettings.routineReminders,
            });
        }
        if (shouldSendPush && pushNotificationService.isAvailable()) {
            logger_1.logger.info(`Sending push notification for reminder ${reminderId}`, {
                userId,
                type,
                title: reminder.title,
                body: reminder.note,
            });
            const notificationData = {
                reminderId: String(reminderId),
                type: String(type),
                targetType: String(reminder.targetType),
            };
            if (reminder.targetId) {
                notificationData.targetId = String(reminder.targetId);
            }
            const isReminderType = type === 'TASK_REMINDER' ||
                type === 'DUE_DATE_REMINDER' ||
                type === 'ROUTINE_REMINDER';
            const soundToUse = isReminderType ? 'alarm' : 'default';
            await pushNotificationService.sendPushNotification(userId, {
                title: reminder.title,
                body: reminder.note || 'Reminder',
                data: notificationData,
                sound: soundToUse,
            }, false);
            logger_1.logger.info(`Push notification sent successfully for reminder ${reminderId}`);
        }
        else {
            logger_1.logger.warn(`Push notification not sent for reminder ${reminderId}`, {
                shouldSendPush,
                isAvailable: pushNotificationService.isAvailable(),
                type,
            });
        }
        try {
            const schedule = reminder.schedule;
            logger_1.logger.debug('Attempting to reschedule reminder', {
                reminderId,
                schedule,
                type,
            });
            const scheduleTimezone = schedule.timezone || user?.settings?.timezone || 'UTC';
            let next = null;
            if (type === 'ROUTINE_REMINDER' && schedule.reminderBefore) {
                if (schedule.routineId) {
                    const routine = await prisma.routine.findUnique({
                        where: { id: schedule.routineId },
                        select: { enabled: true, userId: true },
                    });
                    if (!routine || !routine.enabled || routine.userId !== userId) {
                        logger_1.logger.info(`Skipping reschedule for reminder ${reminderId}: routine is disabled or not found`, {
                            reminderId,
                            routineId: schedule.routineId,
                            enabled: routine?.enabled,
                            routineExists: !!routine,
                        });
                        await prisma.reminder.delete({
                            where: { id: reminderId },
                        }).catch(err => logger_1.logger.error(`Failed to delete reminder ${reminderId}:`, err));
                        logger_1.logger.info(`Reminder job completed (cancelled due to disabled routine during reschedule): ${reminderId}`);
                        return;
                    }
                }
                const routineNext = computeNextOccurrence(schedule, scheduleTimezone);
                if (routineNext) {
                    const match = schedule.reminderBefore.match(/^(\d+)([hdw])$/);
                    if (match) {
                        const [, valueStr, unit] = match;
                        const value = parseInt(valueStr, 10);
                        next = new Date(routineNext);
                        if (unit === 'h') {
                            next.setHours(next.getHours() - value);
                        }
                        else if (unit === 'd') {
                            next.setDate(next.getDate() - value);
                        }
                        else if (unit === 'w') {
                            next.setDate(next.getDate() - (value * 7));
                        }
                        const now = new Date();
                        if (next <= now) {
                            logger_1.logger.info(`Calculated reminder time is in the past, calculating next occurrence`, {
                                reminderId,
                                calculatedTime: next.toISOString(),
                                now: now.toISOString(),
                            });
                            const nextRoutineOccurrence = new Date(routineNext);
                            let attempts = 0;
                            const maxAttempts = 12;
                            while (next <= now && attempts < maxAttempts) {
                                attempts++;
                                if (schedule.frequency === 'DAILY') {
                                    nextRoutineOccurrence.setDate(nextRoutineOccurrence.getDate() + 1);
                                }
                                else if (schedule.frequency === 'WEEKLY' && schedule.days) {
                                    nextRoutineOccurrence.setDate(nextRoutineOccurrence.getDate() + 7);
                                }
                                else if (schedule.frequency === 'MONTHLY' && schedule.day) {
                                    nextRoutineOccurrence.setMonth(nextRoutineOccurrence.getMonth() + 1);
                                    const daysInMonth = new Date(nextRoutineOccurrence.getFullYear(), nextRoutineOccurrence.getMonth() + 1, 0).getDate();
                                    if (schedule.day > daysInMonth) {
                                        nextRoutineOccurrence.setDate(daysInMonth);
                                    }
                                    else {
                                        nextRoutineOccurrence.setDate(schedule.day);
                                    }
                                    const [hh, mm] = String(schedule.time).split(':').map((v) => parseInt(v, 10));
                                    nextRoutineOccurrence.setHours(hh || 0, mm || 0, 0, 0);
                                }
                                else {
                                    break;
                                }
                                next = new Date(nextRoutineOccurrence);
                                if (unit === 'h') {
                                    next.setHours(next.getHours() - value);
                                }
                                else if (unit === 'd') {
                                    next.setDate(next.getDate() - value);
                                }
                                else if (unit === 'w') {
                                    next.setDate(next.getDate() - (value * 7));
                                }
                            }
                            if (next <= now) {
                                logger_1.logger.warn(`Could not find future reminder time after ${attempts} attempts`, {
                                    reminderId,
                                    lastCalculated: next.toISOString(),
                                    now: now.toISOString(),
                                });
                                next = null;
                            }
                            else {
                                logger_1.logger.info(`Found future reminder time after ${attempts} attempt(s)`, {
                                    reminderId,
                                    reminderTime: next.toISOString(),
                                    routineOccurrence: nextRoutineOccurrence.toISOString(),
                                });
                            }
                        }
                        if (next) {
                            logger_1.logger.info(`Calculated next reminder time for routine reminder`, {
                                reminderId,
                                routineNext: routineNext.toISOString(),
                                reminderBefore: schedule.reminderBefore,
                                reminderTime: next.toISOString(),
                            });
                        }
                    }
                }
            }
            else {
                next = computeNextOccurrence(schedule, scheduleTimezone);
            }
            if (next) {
                await (0, exports.scheduleReminder)(reminderId, userId, next, type);
                logger_1.logger.info(`Rescheduled recurring reminder ${reminderId} for ${next.toISOString()}`, {
                    type,
                    schedule,
                    nextOccurrence: next.toISOString(),
                });
            }
            else {
                logger_1.logger.warn(`Could not compute next occurrence for reminder ${reminderId}`, {
                    schedule,
                    type,
                });
            }
        }
        catch (rescheduleError) {
            logger_1.logger.error(`Could not reschedule reminder ${reminderId}:`, rescheduleError);
        }
        logger_1.logger.info(`Reminder job completed: ${reminderId}`);
    }
    catch (error) {
        logger_1.logger.error(`Reminder job failed: ${reminderId}`, error);
        throw error;
    }
}
async function processNotificationJob(job) {
    const { notificationId, userId, type } = job.data;
    logger_1.logger.info(`Processing notification job: ${notificationId}`);
    try {
        const { pushNotificationService } = await Promise.resolve().then(() => __importStar(require('./pushNotificationService')));
        const { getPrismaClient } = await Promise.resolve().then(() => __importStar(require('../utils/database')));
        const prisma = getPrismaClient();
        const notification = await prisma.notification.findUnique({
            where: { id: notificationId },
        });
        if (!notification) {
            logger_1.logger.warn(`Notification ${notificationId} not found`);
            return;
        }
        const user = await prisma.user.findUnique({
            where: { id: userId },
            select: { settings: true },
        });
        const settings = user?.settings || {};
        const notificationSettings = settings.notifications || {};
        let shouldSendPush = notificationSettings.pushNotifications !== false;
        if (type === 'PROJECT_INVITATION' && notificationSettings.projectInvitations === false) {
            shouldSendPush = false;
        }
        else if (type === 'TASK_ASSIGNMENT' && notificationSettings.taskAssignments === false) {
            shouldSendPush = false;
        }
        else if (type === 'TASK_COMMENT' && notificationSettings.taskComments === false) {
            shouldSendPush = false;
        }
        else if (type === 'TASK_REMINDER' && notificationSettings.taskReminders === false) {
            shouldSendPush = false;
        }
        else if (type === 'GOAL_REMINDER' && notificationSettings.goalReminders === false) {
            shouldSendPush = false;
        }
        else if (type === 'DUE_DATE_REMINDER' && notificationSettings.dueDateReminders === false) {
            shouldSendPush = false;
        }
        if (shouldSendPush && pushNotificationService.isAvailable()) {
            const notificationPayload = notification.payload;
            const title = notificationPayload.title || 'New Notification';
            const body = notificationPayload.body || 'You have a new notification';
            await pushNotificationService.sendPushNotification(userId, {
                title,
                body,
                data: {
                    notificationId,
                    type,
                    ...notificationPayload,
                },
                sound: 'default',
            }, false);
        }
        await prisma.notification.update({
            where: { id: notificationId },
            data: {
                status: 'SENT',
                sentAt: new Date(),
            },
        });
        logger_1.logger.info(`Notification job completed: ${notificationId}`);
    }
    catch (error) {
        logger_1.logger.error(`Notification job failed: ${notificationId}`, error);
        try {
            const { getPrismaClient } = await Promise.resolve().then(() => __importStar(require('../utils/database')));
            const prisma = getPrismaClient();
            await prisma.notification.update({
                where: { id: notificationId },
                data: {
                    status: 'FAILED',
                },
            });
        }
        catch (updateError) {
            logger_1.logger.error(`Failed to update notification status: ${notificationId}`, updateError);
        }
        throw error;
    }
}
async function processAIPlanGenerationJob(job) {
    const { goalId } = job.data;
    logger_1.logger.info(`Processing AI plan generation job: ${goalId}`);
    try {
        logger_1.logger.info(`AI plan generation job completed: ${goalId}`);
    }
    catch (error) {
        logger_1.logger.error(`AI plan generation job failed: ${goalId}`, error);
        throw error;
    }
}
async function processEmailJob(job) {
    const { to } = job.data;
    logger_1.logger.info(`Processing email job: ${to}`);
    try {
        logger_1.logger.info(`Email job completed: ${to}`);
    }
    catch (error) {
        logger_1.logger.error(`Email job failed: ${to}`, error);
        throw error;
    }
}
async function processCleanupJob(job) {
    const { type } = job.data;
    logger_1.logger.info(`Processing cleanup job: ${type}`);
    try {
        logger_1.logger.info(`Cleanup job completed: ${type}`);
    }
    catch (error) {
        logger_1.logger.error(`Cleanup job failed: ${type}`, error);
        throw error;
    }
}
const addJob = async (queueName, jobType, data, options) => {
    const queue = queues[queueName];
    if (!queue) {
        throw new Error(`Queue ${queueName} not found`);
    }
    return await queue.add(jobType, data, options);
};
exports.addJob = addJob;
const scheduleJob = async (queueName, jobType, data, delay, options) => {
    const queue = queues[queueName];
    if (!queue) {
        throw new Error(`Queue ${queueName} not found`);
    }
    return await queue.add(jobType, data, {
        ...options,
        delay,
    });
};
exports.scheduleJob = scheduleJob;
const getQueue = (queueName) => {
    return queues[queueName];
};
exports.getQueue = getQueue;
const getWorker = (queueName) => {
    return workers[queueName];
};
exports.getWorker = getWorker;
const closeAllQueues = async () => {
    await Promise.all([
        ...Object.values(queues).map(queue => queue.close()),
        ...Object.values(workers).map(worker => worker.close()),
    ]);
    logger_1.logger.info('All queues and workers closed');
};
exports.closeAllQueues = closeAllQueues;
const scheduleReminder = async (reminderId, userId, scheduledFor, type = 'time') => {
    const delay = scheduledFor.getTime() - Date.now();
    if (delay <= 0) {
        throw new Error('Cannot schedule reminder in the past');
    }
    return await (0, exports.scheduleJob)(exports.QUEUE_NAMES.REMINDERS, exports.JOB_TYPES.SEND_REMINDER, { reminderId, userId, type }, delay);
};
exports.scheduleReminder = scheduleReminder;
const scheduleNotification = async (notificationId, userId, scheduledFor, type, payload) => {
    const delay = scheduledFor.getTime() - Date.now();
    if (delay <= 0) {
        throw new Error('Cannot schedule notification in the past');
    }
    return await (0, exports.scheduleJob)(exports.QUEUE_NAMES.NOTIFICATIONS, exports.JOB_TYPES.SEND_NOTIFICATION, { notificationId, userId, type, payload }, delay);
};
exports.scheduleNotification = scheduleNotification;
const scheduleAIPlanGeneration = async (goalId, userId, promptOptions) => {
    return await (0, exports.addJob)(exports.QUEUE_NAMES.AI_PLAN_GENERATION, exports.JOB_TYPES.GENERATE_PLAN, { goalId, userId, promptOptions });
};
exports.scheduleAIPlanGeneration = scheduleAIPlanGeneration;
const scheduleEmail = async (to, subject, body, template, data) => {
    return await (0, exports.addJob)(exports.QUEUE_NAMES.EMAIL, exports.JOB_TYPES.SEND_EMAIL, { to, subject, body, template, data });
};
exports.scheduleEmail = scheduleEmail;
const scheduleCleanup = async (type, delay = 0) => {
    return await (0, exports.scheduleJob)(exports.QUEUE_NAMES.CLEANUP, exports.JOB_TYPES.CLEANUP_OLD_DATA, { type }, delay);
};
exports.scheduleCleanup = scheduleCleanup;
//# sourceMappingURL=queueService.js.map