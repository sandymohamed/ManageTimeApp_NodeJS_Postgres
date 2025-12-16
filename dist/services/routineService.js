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
exports.routineService = exports.RoutineService = void 0;
const database_1 = require("../utils/database");
const logger_1 = require("../utils/logger");
class RoutineService {
    async createRoutine(userId, data) {
        const prisma = (0, database_1.getPrismaClient)();
        const nextOccurrence = this.calculateNextOccurrence(data.frequency, data.schedule, data.timezone || 'UTC');
        const routine = await prisma.routine.create({
            data: {
                userId,
                title: data.title,
                description: data.description,
                frequency: data.frequency,
                schedule: data.schedule,
                timezone: data.timezone || 'UTC',
                reminderBefore: data.reminderBefore || null,
                nextOccurrenceAt: nextOccurrence,
            },
            include: {
                routineTasks: true,
            },
        });
        return routine;
    }
    async getUserRoutines(userId) {
        const { executeWithRetry } = await Promise.resolve().then(() => __importStar(require('../utils/database')));
        const prisma = (0, database_1.getPrismaClient)();
        return executeWithRetry(async () => {
            await this.checkAndResetDueRoutinesForUser(userId);
            const routines = await prisma.routine.findMany({
                where: { userId },
                include: {
                    routineTasks: {
                        orderBy: { order: 'asc' },
                    },
                },
                orderBy: { createdAt: 'desc' },
            });
            const { scheduleRoutineNotifications } = await Promise.resolve().then(() => __importStar(require('./notificationScheduler')));
            const reschedulePromises = routines
                .filter(routine => routine.enabled && routine.reminderBefore)
                .map(async (routine) => {
                try {
                    const reminderCount = await prisma.reminder.count({
                        where: {
                            userId: routine.userId,
                            targetType: 'CUSTOM',
                            title: {
                                contains: `Routine Reminder: ${routine.title}`,
                            },
                        },
                    });
                    if (reminderCount === 0) {
                        scheduleRoutineNotifications(routine.id, routine.userId)
                            .catch(err => logger_1.logger.error(`Failed to reschedule reminders for routine ${routine.id}:`, err));
                    }
                }
                catch (error) {
                    logger_1.logger.error(`Error checking reminders for routine ${routine.id}:`, error);
                }
            });
            Promise.all(reschedulePromises).catch(err => logger_1.logger.error('Error in parallel reminder rescheduling:', err));
            return routines;
        }, 3, 1000);
    }
    async getRoutineById(routineId, userId) {
        const prisma = (0, database_1.getPrismaClient)();
        const routineToCheck = await prisma.routine.findFirst({
            where: {
                id: routineId,
                userId,
            },
        });
        if (routineToCheck && routineToCheck.enabled && routineToCheck.nextOccurrenceAt) {
            const now = new Date();
            if (routineToCheck.nextOccurrenceAt <= now) {
                await this.resetRoutineTasks(routineId);
            }
        }
        const routine = await prisma.routine.findFirst({
            where: {
                id: routineId,
                userId,
            },
            include: {
                routineTasks: {
                    orderBy: { order: 'asc' },
                },
            },
        });
        return routine;
    }
    async updateRoutine(routineId, userId, data) {
        const prisma = (0, database_1.getPrismaClient)();
        const existing = await prisma.routine.findFirst({
            where: {
                id: routineId,
                userId,
            },
        });
        if (!existing) {
            throw new Error('Routine not found');
        }
        const updateData = {};
        if (data.title)
            updateData.title = data.title;
        if (data.description !== undefined)
            updateData.description = data.description;
        if (data.frequency)
            updateData.frequency = data.frequency;
        if (data.schedule)
            updateData.schedule = data.schedule;
        if (data.timezone)
            updateData.timezone = data.timezone;
        if (data.reminderBefore !== undefined)
            updateData.reminderBefore = data.reminderBefore || null;
        if (data.enabled !== undefined) {
            updateData.enabled = data.enabled;
        }
        if (data.schedule || data.frequency) {
            const schedule = data.schedule || existing.schedule;
            const frequency = data.frequency || existing.frequency;
            updateData.nextOccurrenceAt = this.calculateNextOccurrence(frequency, schedule, data.timezone || existing.timezone);
        }
        if (data.schedule) {
            updateData.schedule = data.schedule;
        }
        const routine = await prisma.routine.update({
            where: { id: routineId },
            data: updateData,
            include: {
                routineTasks: {
                    orderBy: { order: 'asc' },
                },
            },
        });
        return routine;
    }
    async deleteRoutine(routineId, userId) {
        const prisma = (0, database_1.getPrismaClient)();
        const routine = await prisma.routine.findFirst({
            where: {
                id: routineId,
                userId,
            },
        });
        if (!routine) {
            throw new Error('Routine not found');
        }
        await prisma.routine.delete({
            where: { id: routineId },
        });
        return { success: true };
    }
    async addTaskToRoutine(routineId, userId, taskData) {
        const prisma = (0, database_1.getPrismaClient)();
        const routine = await prisma.routine.findFirst({
            where: {
                id: routineId,
                userId,
            },
        });
        if (!routine) {
            throw new Error('Routine not found');
        }
        const maxOrder = await prisma.routineTask.aggregate({
            where: { routineId },
            _max: { order: true },
        });
        const task = await prisma.routineTask.create({
            data: {
                routineId,
                title: taskData.title,
                description: taskData.description,
                order: taskData.order || ((maxOrder._max.order || -1) + 1),
                reminderTime: taskData.reminderTime,
            },
        });
        return task;
    }
    async updateRoutineTask(taskId, userId, data) {
        const prisma = (0, database_1.getPrismaClient)();
        const task = await prisma.routineTask.findUnique({
            where: { id: taskId },
            include: { routine: true },
        });
        if (!task || task.routine.userId !== userId) {
            throw new Error('Task not found');
        }
        const updatedTask = await prisma.routineTask.update({
            where: { id: taskId },
            data: {
                title: data.title,
                description: data.description,
                order: data.order,
                reminderTime: data.reminderTime,
            },
        });
        return updatedTask;
    }
    async deleteRoutineTask(taskId, userId) {
        const prisma = (0, database_1.getPrismaClient)();
        const task = await prisma.routineTask.findUnique({
            where: { id: taskId },
            include: { routine: true },
        });
        if (!task || task.routine.userId !== userId) {
            throw new Error('Task not found');
        }
        await prisma.routineTask.delete({
            where: { id: taskId },
        });
        return { success: true };
    }
    async toggleTaskCompletion(taskId, userId, completed) {
        const prisma = (0, database_1.getPrismaClient)();
        const task = await prisma.routineTask.findUnique({
            where: { id: taskId },
            include: { routine: true },
        });
        if (!task || task.routine.userId !== userId) {
            throw new Error('Task not found');
        }
        const updatedTask = await prisma.routineTask.update({
            where: { id: taskId },
            data: {
                completed,
                completedAt: completed ? new Date() : null,
            },
        });
        return updatedTask;
    }
    async resetRoutineTasks(routineId) {
        const prisma = (0, database_1.getPrismaClient)();
        const routine = await prisma.routine.findUnique({
            where: { id: routineId },
        });
        if (!routine) {
            throw new Error('Routine not found');
        }
        await prisma.routineTask.updateMany({
            where: { routineId },
            data: {
                completed: false,
                completedAt: null,
            },
        });
        const schedule = routine.schedule;
        const nextOccurrence = this.calculateNextOccurrence(routine.frequency, schedule, routine.timezone);
        await prisma.routine.update({
            where: { id: routineId },
            data: {
                lastResetAt: new Date(),
                nextOccurrenceAt: nextOccurrence,
            },
        });
        return { success: true };
    }
    async checkAndResetDueRoutinesForUser(userId) {
        const prisma = (0, database_1.getPrismaClient)();
        const now = new Date();
        const routines = await prisma.routine.findMany({
            where: {
                userId,
                enabled: true,
                nextOccurrenceAt: {
                    lte: now,
                },
            },
        });
        for (const routine of routines) {
            try {
                await this.resetRoutineTasks(routine.id);
                const { scheduleRoutineNotifications } = await Promise.resolve().then(() => __importStar(require('./notificationScheduler')));
                scheduleRoutineNotifications(routine.id, userId)
                    .catch(err => logger_1.logger.error(`Failed to reschedule notifications for routine ${routine.id} after reset:`, err));
            }
            catch (error) {
                logger_1.logger.error(`Failed to reset routine ${routine.id}:`, error);
            }
        }
    }
    async checkAndResetDueRoutines() {
        const prisma = (0, database_1.getPrismaClient)();
        const now = new Date();
        const routines = await prisma.routine.findMany({
            where: {
                enabled: true,
                nextOccurrenceAt: {
                    lte: now,
                },
            },
        });
        const results = [];
        for (const routine of routines) {
            try {
                await this.resetRoutineTasks(routine.id);
                results.push({ routineId: routine.id, success: true });
            }
            catch (error) {
                logger_1.logger.error(`Failed to reset routine ${routine.id}:`, error);
                results.push({ routineId: routine.id, success: false, error });
            }
        }
        return results;
    }
    async getRoutineTasksAsTasks(userId) {
        const prisma = (0, database_1.getPrismaClient)();
        const now = new Date();
        await this.checkAndResetDueRoutinesForUser(userId);
        const routines = await prisma.routine.findMany({
            where: {
                userId,
                enabled: true,
            },
            include: {
                routineTasks: {
                    orderBy: { order: 'asc' },
                },
            },
        });
        const taskList = [];
        for (const routine of routines) {
            const schedule = routine.schedule;
            for (const routineTask of routine.routineTasks) {
                if (routine.frequency === 'WEEKLY' && schedule.days && schedule.days.length > 0) {
                    const timeParts = schedule.time?.split(':') || ['0', '0'];
                    const targetDays = schedule.days;
                    const currentDay = now.getDay();
                    for (const day of targetDays) {
                        let taskDate = new Date(now);
                        const daysDifference = day - currentDay;
                        if (daysDifference === 0) {
                            taskDate = new Date(now);
                        }
                        else if (daysDifference > 0) {
                            taskDate.setDate(now.getDate() + daysDifference);
                        }
                        else {
                            const thisWeekDay = new Date(now);
                            thisWeekDay.setDate(now.getDate() + daysDifference);
                            thisWeekDay.setHours(parseInt(timeParts[0]), parseInt(timeParts[1]), 0, 0);
                            if (thisWeekDay < now) {
                                taskDate.setDate(now.getDate() + daysDifference + 7);
                            }
                            else {
                                taskDate = thisWeekDay;
                            }
                        }
                        taskDate.setHours(parseInt(timeParts[0]), parseInt(timeParts[1]), 0, 0);
                        const weekStart = new Date(now);
                        weekStart.setDate(now.getDate() - now.getDay() + 1);
                        weekStart.setHours(0, 0, 0, 0);
                        const isCompletedThisWeek = routineTask.completed && routineTask.completedAt &&
                            new Date(routineTask.completedAt) >= weekStart;
                        const taskDateTime = new Date(taskDate);
                        taskDateTime.setHours(parseInt(timeParts[0]), parseInt(timeParts[1]), 0, 0);
                        const isUrgent = !isCompletedThisWeek && taskDateTime < now;
                        const taskStatus = isCompletedThisWeek ? 'DONE' : 'TODO';
                        const completedAt = isCompletedThisWeek && routineTask.completedAt ? new Date(routineTask.completedAt) : null;
                        const task = {
                            id: `routine_${routineTask.id}_day_${day}`,
                            title: routineTask.title,
                            description: routineTask.description || undefined,
                            status: taskStatus,
                            priority: isUrgent ? 'URGENT' : 'MEDIUM',
                            dueDate: taskDate.toISOString(),
                            dueTime: schedule.time || undefined,
                            completedAt: completedAt ? completedAt.toISOString() : undefined,
                            projectId: null,
                            goalId: null,
                            assigneeId: null,
                            createdBy: userId,
                            tags: ['routine', routine.title.toLowerCase().replace(/\s+/g, '-')],
                            order: routineTask.order,
                            metadata: {
                                routineId: routine.id,
                                routineTaskId: routineTask.id,
                                routineTitle: routine.title,
                                isRoutineTask: true,
                                scheduledDay: day,
                            },
                            createdAt: routineTask.createdAt.toISOString(),
                            updatedAt: routineTask.updatedAt.toISOString(),
                            isDeleted: false,
                            creator: {
                                id: userId,
                                name: null,
                                email: null,
                            },
                            assignee: null,
                            project: null,
                            goal: null,
                            milestone: null,
                        };
                        taskList.push(task);
                    }
                }
                else {
                    const dueDate = this.calculateTaskDueDate(routine.frequency, schedule, routine.lastResetAt || routine.createdAt, now);
                    const { isUrgent, taskStatus, completedAt } = this.determineTaskUrgencyAndStatus(routineTask, routine.frequency, schedule, dueDate, now);
                    const task = {
                        id: `routine_${routineTask.id}`,
                        title: routineTask.title,
                        description: routineTask.description || undefined,
                        status: taskStatus,
                        priority: isUrgent ? 'URGENT' : 'MEDIUM',
                        dueDate: dueDate.toISOString(),
                        dueTime: schedule.time || undefined,
                        completedAt: completedAt ? completedAt.toISOString() : undefined,
                        projectId: null,
                        goalId: null,
                        assigneeId: null,
                        createdBy: userId,
                        tags: ['routine', routine.title.toLowerCase().replace(/\s+/g, '-')],
                        order: routineTask.order,
                        metadata: {
                            routineId: routine.id,
                            routineTaskId: routineTask.id,
                            routineTitle: routine.title,
                            isRoutineTask: true,
                        },
                        createdAt: routineTask.createdAt.toISOString(),
                        updatedAt: routineTask.updatedAt.toISOString(),
                        isDeleted: false,
                        creator: {
                            id: userId,
                            name: null,
                            email: null,
                        },
                        assignee: null,
                        project: null,
                        goal: null,
                        milestone: null,
                    };
                    taskList.push(task);
                }
            }
        }
        return taskList;
    }
    calculateTaskDueDate(frequency, schedule, lastResetAt, now) {
        let dueDate;
        switch (frequency) {
            case 'DAILY': {
                const timeParts = schedule.time?.split(':') || ['0', '0'];
                dueDate = new Date(now);
                dueDate.setHours(parseInt(timeParts[0]), parseInt(timeParts[1]), 0, 0);
                if (dueDate > now) {
                    return dueDate;
                }
                else {
                    return dueDate;
                }
            }
            case 'WEEKLY': {
                const timeParts = schedule.time?.split(':') || ['0', '0'];
                const targetDays = schedule.days || [];
                const currentDay = now.getDay();
                if (targetDays.includes(currentDay)) {
                    dueDate = new Date(now);
                    dueDate.setHours(parseInt(timeParts[0]), parseInt(timeParts[1]), 0, 0);
                    return dueDate;
                }
                let daysToAdd = 0;
                for (let i = 1; i <= 7; i++) {
                    const checkDay = (currentDay + i) % 7;
                    if (targetDays.includes(checkDay)) {
                        daysToAdd = i;
                        break;
                    }
                }
                dueDate = new Date(now);
                dueDate.setDate(dueDate.getDate() + daysToAdd);
                dueDate.setHours(parseInt(timeParts[0]), parseInt(timeParts[1]), 0, 0);
                return dueDate;
            }
            case 'MONTHLY': {
                const timeParts = schedule.time?.split(':') || ['0', '0'];
                const targetDay = schedule.day || 1;
                dueDate = new Date(now);
                dueDate.setDate(targetDay);
                dueDate.setHours(parseInt(timeParts[0]), parseInt(timeParts[1]), 0, 0);
                if (dueDate < now) {
                    dueDate.setMonth(dueDate.getMonth() + 1);
                }
                return dueDate;
            }
            case 'YEARLY': {
                const timeParts = schedule.time?.split(':') || ['0', '0'];
                dueDate = new Date(now);
                dueDate.setMonth(0);
                dueDate.setDate(1);
                dueDate.setHours(parseInt(timeParts[0]), parseInt(timeParts[1]), 0, 0);
                if (dueDate < now) {
                    dueDate.setFullYear(dueDate.getFullYear() + 1);
                }
                return dueDate;
            }
            default:
                return new Date(now);
        }
    }
    determineTaskUrgencyAndStatus(routineTask, frequency, schedule, dueDate, now) {
        const isCompleted = routineTask.completed;
        const completedAtDate = routineTask.completedAt ? new Date(routineTask.completedAt) : null;
        if (isCompleted && completedAtDate) {
            let isInCurrentCycle = false;
            switch (frequency) {
                case 'DAILY': {
                    const today = new Date(now);
                    today.setHours(0, 0, 0, 0);
                    const completedToday = new Date(completedAtDate);
                    completedToday.setHours(0, 0, 0, 0);
                    isInCurrentCycle = completedToday.getTime() === today.getTime();
                    break;
                }
                case 'WEEKLY': {
                    const weekStart = new Date(now);
                    weekStart.setDate(now.getDate() - now.getDay() + 1);
                    weekStart.setHours(0, 0, 0, 0);
                    isInCurrentCycle = completedAtDate >= weekStart;
                    break;
                }
                case 'MONTHLY': {
                    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
                    isInCurrentCycle = completedAtDate >= monthStart;
                    break;
                }
                case 'YEARLY': {
                    const yearStart = new Date(now.getFullYear(), 0, 1);
                    isInCurrentCycle = completedAtDate >= yearStart;
                    break;
                }
            }
            if (isInCurrentCycle) {
                return { isUrgent: false, taskStatus: 'DONE', completedAt: completedAtDate };
            }
        }
        const timeParts = schedule.time?.split(':') || ['0', '0'];
        let currentCycleDueDate;
        switch (frequency) {
            case 'DAILY': {
                currentCycleDueDate = new Date(now);
                currentCycleDueDate.setHours(parseInt(timeParts[0]), parseInt(timeParts[1]), 0, 0);
                break;
            }
            case 'WEEKLY': {
                const targetDays = schedule.days || [];
                const currentDay = now.getDay();
                if (targetDays.includes(currentDay)) {
                    currentCycleDueDate = new Date(now);
                    currentCycleDueDate.setHours(parseInt(timeParts[0]), parseInt(timeParts[1]), 0, 0);
                }
                else {
                    const weekStart = new Date(now);
                    weekStart.setDate(now.getDate() - now.getDay());
                    weekStart.setHours(0, 0, 0, 0);
                    let lastScheduledDay = -1;
                    for (let day = 6; day >= 0; day--) {
                        if (targetDays.includes(day)) {
                            lastScheduledDay = day;
                            break;
                        }
                    }
                    if (lastScheduledDay >= 0) {
                        const lastDay = new Date(weekStart);
                        lastDay.setDate(weekStart.getDate() + lastScheduledDay);
                        lastDay.setHours(parseInt(timeParts[0]), parseInt(timeParts[1]), 0, 0);
                        currentCycleDueDate = lastDay;
                    }
                    else {
                        currentCycleDueDate = dueDate;
                    }
                }
                break;
            }
            case 'MONTHLY': {
                const targetDay = schedule.day || 1;
                currentCycleDueDate = new Date(now);
                currentCycleDueDate.setDate(targetDay);
                currentCycleDueDate.setHours(parseInt(timeParts[0]), parseInt(timeParts[1]), 0, 0);
                break;
            }
            case 'YEARLY': {
                currentCycleDueDate = new Date(now);
                currentCycleDueDate.setMonth(0);
                currentCycleDueDate.setDate(1);
                currentCycleDueDate.setHours(parseInt(timeParts[0]), parseInt(timeParts[1]), 0, 0);
                break;
            }
            default:
                currentCycleDueDate = dueDate;
        }
        const isUrgent = !isCompleted && currentCycleDueDate < now;
        return {
            isUrgent,
            taskStatus: isCompleted && completedAtDate ? 'DONE' : 'TODO',
            completedAt: completedAtDate,
        };
    }
    calculateNextOccurrence(frequency, schedule, _timezone) {
        const now = new Date();
        let next;
        switch (frequency) {
            case 'DAILY': {
                const timeParts = schedule.time?.split(':') || ['0', '0'];
                next = new Date(now);
                next.setHours(parseInt(timeParts[0]), parseInt(timeParts[1]), 0, 0);
                if (next <= now) {
                    next.setDate(next.getDate() + 1);
                }
                break;
            }
            case 'WEEKLY': {
                const timeParts = schedule.time?.split(':') || ['0', '0'];
                next = new Date(now);
                const targetDays = schedule.days || [];
                const currentDay = now.getDay();
                let daysToAdd = 0;
                for (let i = 1; i <= 7; i++) {
                    const checkDay = (currentDay + i) % 7;
                    if (targetDays.includes(checkDay)) {
                        daysToAdd = i;
                        break;
                    }
                }
                next.setDate(next.getDate() + daysToAdd);
                next.setHours(parseInt(timeParts[0]), parseInt(timeParts[1]), 0, 0);
                break;
            }
            case 'MONTHLY': {
                const timeParts = schedule.time?.split(':') || ['0', '0'];
                next = new Date(now);
                const targetDay = schedule.day || 1;
                next.setDate(targetDay);
                next.setHours(parseInt(timeParts[0]), parseInt(timeParts[1]), 0, 0);
                if (next <= now) {
                    next.setMonth(next.getMonth() + 1);
                }
                break;
            }
            case 'YEARLY': {
                const timeParts = schedule.time?.split(':') || ['0', '0'];
                next = new Date(now);
                next.setDate(1);
                next.setMonth(0);
                next.setHours(parseInt(timeParts[0]), parseInt(timeParts[1]), 0, 0);
                if (next <= now) {
                    next.setFullYear(next.getFullYear() + 1);
                }
                break;
            }
            default:
                next = new Date(now.getTime() + 24 * 60 * 60 * 1000);
        }
        return next;
    }
}
exports.RoutineService = RoutineService;
exports.routineService = new RoutineService();
//# sourceMappingURL=routineService.js.map