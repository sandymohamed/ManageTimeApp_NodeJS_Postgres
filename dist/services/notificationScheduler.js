"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.scheduleTaskDueDateNotifications = scheduleTaskDueDateNotifications;
exports.scheduleMilestoneDueDateNotifications = scheduleMilestoneDueDateNotifications;
exports.checkAndNotifyOverdueMilestones = checkAndNotifyOverdueMilestones;
exports.scheduleGoalTargetDateNotifications = scheduleGoalTargetDateNotifications;
exports.cancelAlarmPushNotifications = cancelAlarmPushNotifications;
exports.scheduleAlarmPushNotification = scheduleAlarmPushNotification;
exports.sendTaskAssignmentNotification = sendTaskAssignmentNotification;
exports.sendTaskCreatedNotification = sendTaskCreatedNotification;
exports.scheduleRoutineTaskNotifications = scheduleRoutineTaskNotifications;
exports.cancelRoutineTaskNotifications = cancelRoutineTaskNotifications;
exports.cancelRoutineNotifications = cancelRoutineNotifications;
exports.scheduleRoutineReminderNotification = scheduleRoutineReminderNotification;
exports.scheduleRoutineNotifications = scheduleRoutineNotifications;
const database_1 = require("../utils/database");
const logger_1 = require("../utils/logger");
const queueService_1 = require("./queueService");
const queueService_2 = require("./queueService");
const IMMEDIATE_NOTIFICATION_DELAY_MS = 1000;
function getImmediateScheduleTime(delayMs = IMMEDIATE_NOTIFICATION_DELAY_MS) {
    return new Date(Date.now() + Math.max(delayMs, 0));
}
const ALARM_NOTIFICATION_TYPE = 'ALARM_TRIGGER';
async function scheduleTaskDueDateNotifications(taskId, userId, dueDate, taskTitle, dueTime) {
    try {
        logger_1.logger.info('scheduleTaskDueDateNotifications called', { taskId, userId, dueDate, dueTime });
        const prisma = (0, database_1.getPrismaClient)();
        await prisma.reminder.deleteMany({
            where: {
                targetType: 'TASK',
                targetId: taskId,
                userId,
            },
        });
        const now = new Date();
        const dueDateTime = new Date(dueDate);
        if (dueTime) {
            const [hours, minutes] = dueTime.split(':').map(Number);
            dueDateTime.setHours(hours, minutes, 0, 0);
            logger_1.logger.info('Combined due date with time', { dueDateTime: dueDateTime.toISOString(), hours, minutes });
        }
        else {
            dueDateTime.setHours(23, 59, 0, 0);
            logger_1.logger.info('No due time specified, using end of day', { dueDateTime: dueDateTime.toISOString() });
        }
        if (dueDateTime <= now) {
            logger_1.logger.warn(`Task ${taskId} due date is in the past, skipping notification scheduling`, {
                dueDateTime: dueDateTime.toISOString(),
                now: now.toISOString()
            });
            return;
        }
        const oneDayBefore = new Date(dueDateTime);
        oneDayBefore.setDate(oneDayBefore.getDate() - 1);
        const oneHourBefore = new Date(dueDateTime);
        oneHourBefore.setHours(oneHourBefore.getHours() - 1);
        const reminders = [];
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
                logger_1.logger.info(`Created 1-day-before reminder for task ${taskId} at ${oneDayBefore.toISOString()}`);
            }
            catch (error) {
                logger_1.logger.error(`Failed to create 1-day-before reminder for task ${taskId}:`, error);
            }
        }
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
                logger_1.logger.info(`Created 1-hour-before reminder for task ${taskId} at ${oneHourBefore.toISOString()}`);
            }
            catch (error) {
                logger_1.logger.error(`Failed to create 1-hour-before reminder for task ${taskId}:`, error);
            }
        }
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
            logger_1.logger.info(`Created due-time reminder for task ${taskId} at ${dueDateTime.toISOString()}`);
        }
        catch (error) {
            logger_1.logger.error(`Failed to create due-time reminder for task ${taskId}:`, error);
        }
        logger_1.logger.info(`Scheduling ${reminders.length} reminders for task ${taskId}`);
        for (const { reminder, time, type } of reminders) {
            try {
                await (0, queueService_1.scheduleReminder)(reminder.id, userId, time, type);
                logger_1.logger.info(`Successfully scheduled task reminder for ${taskId} at ${time.toISOString()}, type: ${type}`);
            }
            catch (error) {
                logger_1.logger.error(`Failed to schedule reminder for task ${taskId}:`, error);
                await prisma.reminder.delete({ where: { id: reminder.id } }).catch(() => { });
            }
        }
        if (reminders.length === 0) {
            logger_1.logger.warn(`No reminders scheduled for task ${taskId} - all reminder times are in the past`);
        }
    }
    catch (error) {
        logger_1.logger.error(`Failed to schedule task due date notifications for ${taskId}:`, error);
    }
}
async function scheduleMilestoneDueDateNotifications(milestoneId, goalId, userId, dueDate, milestoneTitle) {
    try {
        const prisma = (0, database_1.getPrismaClient)();
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
        dueDateTime.setHours(23, 59, 0, 0);
        if (dueDateTime <= now) {
            logger_1.logger.info(`Milestone ${milestoneId} due date is in the past, skipping notification scheduling`);
            return;
        }
        const oneDayBefore = new Date(dueDateTime);
        oneDayBefore.setDate(oneDayBefore.getDate() - 1);
        const oneHourBefore = new Date(dueDateTime);
        oneHourBefore.setHours(oneHourBefore.getHours() - 1);
        const reminders = [];
        if (oneDayBefore > now && oneDayBefore < dueDateTime) {
            const reminder1 = await prisma.reminder.create({
                data: {
                    userId,
                    targetType: 'GOAL',
                    targetId: null,
                    title: `Milestone Due Tomorrow: ${milestoneTitle}`,
                    note: `Your milestone "${milestoneTitle}" is due tomorrow.`,
                    triggerType: 'TIME',
                    schedule: {
                        at: oneDayBefore.toISOString(),
                        milestoneId: milestoneId,
                        goalId: goalId,
                    },
                },
            });
            reminders.push({ reminder: reminder1, time: oneDayBefore, type: 'GOAL_REMINDER' });
        }
        if (oneHourBefore > now && oneHourBefore < dueDateTime) {
            const reminder2 = await prisma.reminder.create({
                data: {
                    userId,
                    targetType: 'GOAL',
                    targetId: null,
                    title: `Milestone Due in 1 Hour: ${milestoneTitle}`,
                    note: `Your milestone "${milestoneTitle}" is due in 1 hour.`,
                    triggerType: 'TIME',
                    schedule: {
                        at: oneHourBefore.toISOString(),
                        milestoneId: milestoneId,
                        goalId: goalId,
                    },
                },
            });
            reminders.push({ reminder: reminder2, time: oneHourBefore, type: 'GOAL_REMINDER' });
        }
        const reminder3 = await prisma.reminder.create({
            data: {
                userId,
                targetType: 'GOAL',
                targetId: null,
                title: `Milestone Due Now: ${milestoneTitle}`,
                note: `Your milestone "${milestoneTitle}" is due now.`,
                triggerType: 'TIME',
                schedule: {
                    at: dueDateTime.toISOString(),
                    milestoneId: milestoneId,
                    goalId: goalId,
                },
            },
        });
        reminders.push({ reminder: reminder3, time: dueDateTime, type: 'GOAL_REMINDER' });
        for (const { reminder, time, type } of reminders) {
            try {
                await (0, queueService_1.scheduleReminder)(reminder.id, userId, time, type);
                logger_1.logger.info(`Scheduled milestone reminder for ${milestoneId} at ${time.toISOString()}`);
            }
            catch (error) {
                logger_1.logger.error(`Failed to schedule reminder for milestone ${milestoneId}:`, error);
                await prisma.reminder.delete({ where: { id: reminder.id } }).catch(() => { });
            }
        }
    }
    catch (error) {
        logger_1.logger.error(`Failed to schedule milestone due date notifications for ${milestoneId}:`, error);
    }
}
async function checkAndNotifyOverdueMilestones() {
    try {
        const prisma = (0, database_1.getPrismaClient)();
        const now = new Date();
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
        logger_1.logger.info(`Found ${overdueMilestones.length} overdue milestones`);
        for (const milestone of overdueMilestones) {
            const goal = milestone.goal;
            if (!goal) {
                logger_1.logger.warn(`Milestone ${milestone.id} has no associated goal, skipping`);
                continue;
            }
            const userId = goal.userId;
            const goalId = goal.id;
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
                logger_1.logger.info(`Overdue notification already sent today for milestone ${milestone.id}`);
                continue;
            }
            const daysOverdue = Math.floor((now.getTime() - milestone.dueDate.getTime()) / (1000 * 60 * 60 * 24));
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
            try {
                const immediateTime = new Date(Date.now() + 1000);
                await (0, queueService_1.scheduleReminder)(reminder.id, userId, immediateTime, 'GOAL_REMINDER');
                logger_1.logger.info(`Scheduled overdue notification for milestone ${milestone.id} (immediate)`);
            }
            catch (error) {
                logger_1.logger.error(`Failed to schedule overdue reminder for milestone ${milestone.id}:`, error);
                await prisma.reminder.delete({ where: { id: reminder.id } }).catch(() => { });
            }
        }
    }
    catch (error) {
        logger_1.logger.error('Failed to check and notify overdue milestones:', error);
    }
}
async function scheduleGoalTargetDateNotifications(goalId, userId, targetDate, goalTitle) {
    try {
        const prisma = (0, database_1.getPrismaClient)();
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
        if (targetDateTime <= now) {
            logger_1.logger.info(`Goal ${goalId} target date is in the past, skipping notification scheduling`);
            return;
        }
        const oneWeekBefore = new Date(targetDateTime);
        oneWeekBefore.setDate(oneWeekBefore.getDate() - 7);
        const oneDayBefore = new Date(targetDateTime);
        oneDayBefore.setDate(oneDayBefore.getDate() - 1);
        const reminders = [];
        if (oneWeekBefore > now && oneWeekBefore < targetDateTime) {
            const reminder1 = await prisma.reminder.create({
                data: {
                    userId,
                    targetType: 'GOAL',
                    targetId: null,
                    title: `Goal Deadline in 1 Week: ${goalTitle}`,
                    note: `Your goal "${goalTitle}" deadline is in 1 week.`,
                    triggerType: 'TIME',
                    schedule: {
                        at: oneWeekBefore.toISOString(),
                        goalId: goalId,
                    },
                },
            });
            reminders.push({ reminder: reminder1, time: oneWeekBefore, type: 'GOAL_REMINDER' });
        }
        if (oneDayBefore > now && oneDayBefore < targetDateTime) {
            const reminder2 = await prisma.reminder.create({
                data: {
                    userId,
                    targetType: 'GOAL',
                    targetId: null,
                    title: `Goal Deadline Tomorrow: ${goalTitle}`,
                    note: `Your goal "${goalTitle}" deadline is tomorrow.`,
                    triggerType: 'TIME',
                    schedule: {
                        at: oneDayBefore.toISOString(),
                        goalId: goalId,
                    },
                },
            });
            reminders.push({ reminder: reminder2, time: oneDayBefore, type: 'GOAL_REMINDER' });
        }
        const reminder3 = await prisma.reminder.create({
            data: {
                userId,
                targetType: 'GOAL',
                targetId: null,
                title: `Goal Deadline Today: ${goalTitle}`,
                note: `Your goal "${goalTitle}" deadline is today.`,
                triggerType: 'TIME',
                schedule: {
                    at: targetDateTime.toISOString(),
                    goalId: goalId,
                },
            },
        });
        reminders.push({ reminder: reminder3, time: targetDateTime, type: 'GOAL_REMINDER' });
        for (const { reminder, time, type } of reminders) {
            try {
                await (0, queueService_1.scheduleReminder)(reminder.id, userId, time, type);
                logger_1.logger.info(`Scheduled goal reminder for ${goalId} at ${time.toISOString()}`);
            }
            catch (error) {
                logger_1.logger.error(`Failed to schedule reminder for goal ${goalId}:`, error);
                await prisma.reminder.delete({ where: { id: reminder.id } }).catch(() => { });
            }
        }
    }
    catch (error) {
        logger_1.logger.error(`Failed to schedule goal target date notifications for ${goalId}:`, error);
    }
}
async function cancelAlarmPushNotifications(alarmId, userId) {
    try {
        const prisma = (0, database_1.getPrismaClient)();
        const deleted = await prisma.notification.deleteMany({
            where: {
                userId,
                payload: {
                    path: ['alarmId'],
                    equals: alarmId,
                },
            },
        });
        logger_1.logger.info(`Cancelled ${deleted.count} scheduled notifications for alarm ${alarmId}`);
    }
    catch (error) {
        logger_1.logger.warn(`Failed to cancel scheduled notifications for alarm ${alarmId}:`, error);
    }
}
async function scheduleAlarmPushNotification(alarm) {
    const now = new Date();
    const alarmTime = new Date(alarm.time);
    if (!alarm.enabled) {
        logger_1.logger.info(`Alarm ${alarm.id} is disabled, skipping push notification scheduling`);
        await cancelAlarmPushNotifications(alarm.id, alarm.userId);
        return;
    }
    if (Number.isNaN(alarmTime.getTime())) {
        logger_1.logger.warn(`Invalid alarm time provided for alarm ${alarm.id}, skipping scheduling`);
        await cancelAlarmPushNotifications(alarm.id, alarm.userId);
        return;
    }
    if (alarmTime.getTime() <= now.getTime() + 5000) {
        logger_1.logger.warn(`Alarm ${alarm.id} time is in the past or too soon (${alarmTime.toISOString()}), skipping scheduling`);
        await cancelAlarmPushNotifications(alarm.id, alarm.userId);
        return;
    }
    const prisma = (0, database_1.getPrismaClient)();
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
        await (0, queueService_2.scheduleNotification)(notification.id, alarm.userId, alarmTime, ALARM_NOTIFICATION_TYPE, {
            title,
            body,
            alarmId: alarm.id,
            notificationType: ALARM_NOTIFICATION_TYPE,
        });
        logger_1.logger.info(`Scheduled push notification for alarm ${alarm.id} at ${alarmTime.toISOString()}`);
    }
    catch (error) {
        logger_1.logger.error(`Failed to schedule push notification for alarm ${alarm.id}:`, error);
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
        }
        catch (cleanupError) {
            logger_1.logger.warn(`Failed to clean up notification record for alarm ${alarm.id}:`, cleanupError);
        }
    }
}
async function sendTaskAssignmentNotification(taskId, assigneeId, taskTitle, assignerName) {
    try {
        const prisma = (0, database_1.getPrismaClient)();
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
                scheduledFor: new Date(),
                status: 'PENDING',
            },
        });
        await (0, queueService_2.scheduleNotification)(notification.id, assigneeId, getImmediateScheduleTime(), 'TASK_ASSIGNMENT', {
            title: `New Task Assigned: ${taskTitle}`,
            body: assignerName
                ? `${assignerName} assigned you a task: ${taskTitle}`
                : `You have been assigned a new task: ${taskTitle}`,
        });
        logger_1.logger.info(`Sent task assignment notification for task ${taskId} to user ${assigneeId}`);
    }
    catch (error) {
        logger_1.logger.error(`Failed to send task assignment notification for ${taskId}:`, error);
    }
}
async function sendTaskCreatedNotification(taskId, userId, taskTitle, context) {
    try {
        const prisma = (0, database_1.getPrismaClient)();
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
        await (0, queueService_2.scheduleNotification)(notification.id, userId, getImmediateScheduleTime(), 'TASK_CREATED', {
            title: `Task Created: ${taskTitle}`,
            body: context?.projectTitle
                ? `Task "${taskTitle}" was created in ${context.projectTitle}.`
                : `Task "${taskTitle}" was created successfully.`,
        });
        logger_1.logger.info(`Sent task created notification for task ${taskId} to user ${userId}`);
    }
    catch (error) {
        logger_1.logger.error(`Failed to send task created notification for ${taskId}:`, error);
    }
}
async function scheduleRoutineTaskNotifications(routineId, userId, routineTitle, frequency, schedule, timezone, taskId, taskTitle, reminderTime) {
    try {
        const prisma = (0, database_1.getPrismaClient)();
        const now = new Date();
        await prisma.reminder.deleteMany({
            where: {
                targetType: 'CUSTOM',
                userId,
                note: {
                    contains: taskTitle,
                },
            },
        });
        if (!schedule.time) {
            logger_1.logger.info(`Routine ${routineId} has no time set, skipping notification scheduling`);
            return;
        }
        const [routineHours, routineMinutes] = schedule.time.split(':').map(Number);
        let notificationHours = routineHours;
        let notificationMinutes = routineMinutes;
        if (reminderTime) {
            if (reminderTime.startsWith('-')) {
                const offsetStr = reminderTime.slice(1).toLowerCase();
                if (offsetStr.includes('min')) {
                    const mins = parseInt(offsetStr.replace('min', '').replace('s', ''), 10);
                    const totalMinutes = routineHours * 60 + routineMinutes - mins;
                    notificationHours = Math.floor(totalMinutes / 60);
                    notificationMinutes = totalMinutes % 60;
                    if (notificationHours < 0) {
                        notificationHours += 24;
                    }
                }
                else if (offsetStr.includes('hour')) {
                    const hours = parseInt(offsetStr.replace('hour', '').replace('s', ''), 10);
                    notificationHours = routineHours - hours;
                    if (notificationHours < 0) {
                        notificationHours += 24;
                    }
                }
            }
            else if (reminderTime.includes(':')) {
                const [reminderHours, reminderMinutes] = reminderTime.split(':').map(Number);
                notificationHours = reminderHours;
                notificationMinutes = reminderMinutes;
            }
        }
        const notificationTimeStr = `${String(notificationHours).padStart(2, '0')}:${String(notificationMinutes).padStart(2, '0')}`;
        let nextOccurrence = null;
        if (frequency === 'DAILY') {
            nextOccurrence = new Date(now);
            nextOccurrence.setHours(notificationHours, notificationMinutes, 0, 0);
            if (nextOccurrence <= now) {
                nextOccurrence.setDate(nextOccurrence.getDate() + 1);
            }
        }
        else if (frequency === 'WEEKLY' && schedule.days && schedule.days.length > 0) {
            const currentDay = now.getDay();
            let soonest = null;
            for (const day of schedule.days) {
                const d = new Date(now);
                const delta = (day - currentDay + 7) % 7;
                d.setDate(d.getDate() + delta);
                d.setHours(notificationHours, notificationMinutes, 0, 0);
                if (d <= now) {
                    d.setDate(d.getDate() + 7);
                }
                if (!soonest || d < soonest)
                    soonest = d;
            }
            nextOccurrence = soonest;
        }
        else if (frequency === 'MONTHLY' && schedule.day) {
            nextOccurrence = new Date(now);
            nextOccurrence.setDate(schedule.day);
            nextOccurrence.setHours(notificationHours, notificationMinutes, 0, 0);
            if (nextOccurrence <= now) {
                nextOccurrence.setMonth(nextOccurrence.getMonth() + 1);
            }
        }
        else if (frequency === 'YEARLY') {
            logger_1.logger.warn(`Yearly frequency not fully supported for routine notifications, skipping ${routineId}`);
            return;
        }
        if (!nextOccurrence || nextOccurrence <= now) {
            logger_1.logger.warn(`Could not calculate valid next occurrence for routine task ${taskId}, skipping notification`);
            return;
        }
        const reminderSchedule = {
            frequency,
            time: notificationTimeStr,
            timezone: timezone || 'UTC',
        };
        if (frequency === 'WEEKLY' && schedule.days) {
            reminderSchedule.days = schedule.days;
        }
        else if (frequency === 'MONTHLY' && schedule.day) {
            reminderSchedule.day = schedule.day;
        }
        logger_1.logger.info(`Creating reminder for routine task ${taskId}`, {
            reminderSchedule,
            nextOccurrence: nextOccurrence.toISOString(),
            routineId,
            taskId,
        });
        const reminder = await prisma.reminder.create({
            data: {
                userId,
                targetType: 'CUSTOM',
                targetId: null,
                title: `Routine: ${routineTitle}`,
                note: `Time to complete "${taskTitle}"`,
                triggerType: 'TIME',
                schedule: {
                    ...reminderSchedule,
                    routineId: routineId,
                    taskId: taskId,
                },
            },
        });
        try {
            const delay = nextOccurrence.getTime() - Date.now();
            if (delay <= 0) {
                logger_1.logger.warn(`Cannot schedule routine task notification in the past for task ${taskId}`, {
                    taskId,
                    routineId,
                    nextOccurrence: nextOccurrence.toISOString(),
                    now: new Date().toISOString(),
                    delay,
                });
                return;
            }
            const job = await (0, queueService_1.scheduleReminder)(reminder.id, userId, nextOccurrence, 'ROUTINE_REMINDER');
            logger_1.logger.info(`Scheduled routine task notification for task ${taskId}`, {
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
        }
        catch (scheduleError) {
            logger_1.logger.error(`Failed to schedule reminder job for routine task ${taskId}:`, {
                error: scheduleError,
                reminderId: reminder.id,
                taskId,
                routineId,
                nextOccurrence: nextOccurrence.toISOString(),
                schedule: reminderSchedule,
            });
        }
    }
    catch (error) {
        logger_1.logger.error(`Failed to schedule routine task notifications for task ${taskId}:`, {
            error,
            taskId,
            routineId,
            userId,
        });
    }
}
async function cancelRoutineTaskNotifications(taskId, userId) {
    try {
        const prisma = (0, database_1.getPrismaClient)();
        const allCustomReminders = await prisma.reminder.findMany({
            where: {
                targetType: 'CUSTOM',
                userId,
            },
        });
        const matchingReminders = allCustomReminders.filter((reminder) => {
            const schedule = reminder.schedule;
            return schedule?.taskId === taskId;
        });
        for (const reminder of matchingReminders) {
            await prisma.reminder.delete({
                where: { id: reminder.id },
            });
        }
        logger_1.logger.info(`Cancelled ${matchingReminders.length} reminders for routine task ${taskId}`);
    }
    catch (error) {
        logger_1.logger.warn(`Failed to cancel reminders for routine task ${taskId}:`, error);
    }
}
async function cancelRoutineNotifications(routineId, userId) {
    try {
        const prisma = (0, database_1.getPrismaClient)();
        const routine = await prisma.routine.findUnique({
            where: { id: routineId },
            include: { routineTasks: true },
        });
        if (!routine) {
            return;
        }
        for (const task of routine.routineTasks) {
            await cancelRoutineTaskNotifications(task.id, userId);
        }
        logger_1.logger.info(`Cancelled all notifications for routine ${routineId}`);
    }
    catch (error) {
        logger_1.logger.warn(`Failed to cancel notifications for routine ${routineId}:`, error);
    }
}
async function scheduleRoutineReminderNotification(routineId, userId, routineTitle, frequency, schedule, timezone, reminderBefore, nextOccurrence) {
    try {
        const prisma = (0, database_1.getPrismaClient)();
        const now = new Date();
        const match = reminderBefore.match(/^(\d+)([hdw])$/);
        if (!match) {
            logger_1.logger.warn(`Invalid reminderBefore format: ${reminderBefore}, skipping reminder notification`);
            return;
        }
        const [, valueStr, unit] = match;
        const value = parseInt(valueStr, 10);
        const reminderTime = new Date(nextOccurrence);
        if (unit === 'h') {
            reminderTime.setHours(reminderTime.getHours() - value);
        }
        else if (unit === 'd') {
            reminderTime.setDate(reminderTime.getDate() - value);
        }
        else if (unit === 'w') {
            reminderTime.setDate(reminderTime.getDate() - (value * 7));
        }
        if (reminderTime <= now) {
            logger_1.logger.info(`Routine reminder time is in the past, skipping: ${reminderTime.toISOString()}`);
            return;
        }
        await prisma.reminder.deleteMany({
            where: {
                targetType: 'CUSTOM',
                userId,
                title: {
                    contains: `Routine Reminder: ${routineTitle}`,
                },
            },
        });
        const reminderSchedule = {
            frequency,
            time: schedule.time,
            timezone: timezone || 'UTC',
            routineId,
            reminderBefore,
        };
        if (frequency === 'WEEKLY' && schedule.days) {
            reminderSchedule.days = schedule.days;
        }
        else if (frequency === 'MONTHLY' && schedule.day) {
            reminderSchedule.day = schedule.day;
        }
        const reminder = await prisma.reminder.create({
            data: {
                userId,
                targetType: 'CUSTOM',
                targetId: null,
                title: `Routine Reminder: ${routineTitle}`,
                note: `Your routine "${routineTitle}" is coming up soon`,
                triggerType: 'TIME',
                schedule: reminderSchedule,
            },
        });
        const delay = reminderTime.getTime() - Date.now();
        if (delay <= 0) {
            logger_1.logger.warn(`Cannot schedule routine reminder in the past for routine ${routineId}`, {
                reminderTime: reminderTime.toISOString(),
                now: new Date().toISOString(),
                delay,
            });
            return;
        }
        const job = await (0, queueService_1.scheduleReminder)(reminder.id, userId, reminderTime, 'ROUTINE_REMINDER');
        logger_1.logger.info(`Scheduled routine reminder notification for routine ${routineId}`, {
            reminderId: reminder.id,
            routineId,
            reminderTime: reminderTime.toISOString(),
            nextOccurrence: nextOccurrence.toISOString(),
            reminderBefore,
            jobId: job.id,
            delayMs: delay,
            delayMinutes: Math.round(delay / 60000),
        });
    }
    catch (error) {
        logger_1.logger.error(`Failed to schedule routine reminder notification for routine ${routineId}:`, error);
    }
}
async function scheduleRoutineNotifications(routineId, _userId) {
    try {
        const prisma = (0, database_1.getPrismaClient)();
        const routine = await prisma.routine.findUnique({
            where: { id: routineId },
            include: { routineTasks: true },
        });
        if (!routine || !routine.enabled) {
            logger_1.logger.info(`Routine ${routineId} not found or disabled, skipping notification scheduling`);
            return;
        }
        const schedule = routine.schedule;
        const now = new Date();
        let nextOccurrence = null;
        const [routineHours, routineMinutes] = (schedule.time || '00:00').split(':').map(Number);
        if (routine.frequency === 'DAILY') {
            nextOccurrence = new Date(now);
            nextOccurrence.setHours(routineHours, routineMinutes, 0, 0);
            if (nextOccurrence <= now) {
                nextOccurrence.setDate(nextOccurrence.getDate() + 1);
            }
        }
        else if (routine.frequency === 'WEEKLY' && schedule.days && schedule.days.length > 0) {
            const currentDay = now.getDay();
            let soonest = null;
            for (const day of schedule.days) {
                const d = new Date(now);
                const delta = (day - currentDay + 7) % 7;
                d.setDate(d.getDate() + delta);
                d.setHours(routineHours, routineMinutes, 0, 0);
                if (d <= now) {
                    d.setDate(d.getDate() + 7);
                }
                if (!soonest || d < soonest)
                    soonest = d;
            }
            nextOccurrence = soonest;
        }
        else if (routine.frequency === 'MONTHLY' && schedule.day) {
            nextOccurrence = new Date(now);
            nextOccurrence.setDate(schedule.day);
            nextOccurrence.setHours(routineHours, routineMinutes, 0, 0);
            if (nextOccurrence <= now) {
                nextOccurrence.setMonth(nextOccurrence.getMonth() + 1);
            }
        }
        if (routine.reminderBefore && nextOccurrence) {
            await scheduleRoutineReminderNotification(routine.id, routine.userId, routine.title, routine.frequency, schedule, routine.timezone, routine.reminderBefore, nextOccurrence);
        }
        for (const task of routine.routineTasks) {
            await scheduleRoutineTaskNotifications(routine.id, routine.userId, routine.title, routine.frequency, schedule, routine.timezone, task.id, task.title, task.reminderTime);
        }
        logger_1.logger.info(`Scheduled notifications for all tasks in routine ${routineId}`);
    }
    catch (error) {
        logger_1.logger.error(`Failed to schedule notifications for routine ${routineId}:`, error);
    }
}
//# sourceMappingURL=notificationScheduler.js.map