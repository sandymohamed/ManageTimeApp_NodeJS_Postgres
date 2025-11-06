"use strict";
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
    workers[exports.QUEUE_NAMES.REMINDERS] = new bullmq_1.Worker(exports.QUEUE_NAMES.REMINDERS, async (job) => {
        await processReminderJob(job);
    }, {
        connection: redis,
        concurrency: 10,
    });
    workers[exports.QUEUE_NAMES.NOTIFICATIONS] = new bullmq_1.Worker(exports.QUEUE_NAMES.NOTIFICATIONS, async (job) => {
        await processNotificationJob(job);
    }, {
        connection: redis,
        concurrency: 20,
    });
    workers[exports.QUEUE_NAMES.AI_PLAN_GENERATION] = new bullmq_1.Worker(exports.QUEUE_NAMES.AI_PLAN_GENERATION, async (job) => {
        await processAIPlanGenerationJob(job);
    }, {
        connection: redis,
        concurrency: 5,
    });
    workers[exports.QUEUE_NAMES.EMAIL] = new bullmq_1.Worker(exports.QUEUE_NAMES.EMAIL, async (job) => {
        await processEmailJob(job);
    }, {
        connection: redis,
        concurrency: 10,
    });
    workers[exports.QUEUE_NAMES.CLEANUP] = new bullmq_1.Worker(exports.QUEUE_NAMES.CLEANUP, async (job) => {
        await processCleanupJob(job);
    }, {
        connection: redis,
        concurrency: 1,
    });
    Object.values(workers).forEach(worker => {
        worker.on('error', (error) => {
            logger_1.logger.error('Worker error:', error);
        });
        worker.on('failed', (job, error) => {
            logger_1.logger.error(`Job ${job?.id} failed:`, error);
        });
    });
};
async function processReminderJob(job) {
    const { reminderId, userId, type } = job.data;
    logger_1.logger.info(`Processing reminder job: ${reminderId}`);
    try {
        logger_1.logger.info(`Reminder job completed: ${reminderId}`);
    }
    catch (error) {
        logger_1.logger.error(`Reminder job failed: ${reminderId}`, error);
        throw error;
    }
}
async function processNotificationJob(job) {
    const { notificationId, userId, type, payload } = job.data;
    logger_1.logger.info(`Processing notification job: ${notificationId}`);
    try {
        logger_1.logger.info(`Notification job completed: ${notificationId}`);
    }
    catch (error) {
        logger_1.logger.error(`Notification job failed: ${notificationId}`, error);
        throw error;
    }
}
async function processAIPlanGenerationJob(job) {
    const { goalId, userId, promptOptions } = job.data;
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
    const { to, subject, body, template, data } = job.data;
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