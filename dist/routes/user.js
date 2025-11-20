"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const joi_1 = __importDefault(require("joi"));
const bcrypt_1 = __importDefault(require("bcrypt"));
const database_1 = require("../utils/database");
const auth_1 = require("../middleware/auth");
const types_1 = require("../types");
const logger_1 = require("../utils/logger");
const router = (0, express_1.Router)();
router.use(auth_1.authenticateToken);
const updateProfileSchema = joi_1.default.object({
    name: joi_1.default.string().min(2).max(100).optional(),
    timezone: joi_1.default.string().optional(),
    settings: joi_1.default.object().optional(),
});
const changePasswordSchema = joi_1.default.object({
    currentPassword: joi_1.default.string().required(),
    newPassword: joi_1.default.string().min(8).required(),
});
const notificationSettingsSchema = joi_1.default.object({
    pushNotifications: joi_1.default.boolean().optional(),
    emailNotifications: joi_1.default.boolean().optional(),
    taskReminders: joi_1.default.boolean().optional(),
    goalReminders: joi_1.default.boolean().optional(),
    projectInvitations: joi_1.default.boolean().optional(),
    taskAssignments: joi_1.default.boolean().optional(),
    taskComments: joi_1.default.boolean().optional(),
    dueDateReminders: joi_1.default.boolean().optional(),
    weeklyDigest: joi_1.default.boolean().optional(),
    monthlyReport: joi_1.default.boolean().optional(),
    marketingEmails: joi_1.default.boolean().optional(),
}).unknown(false);
const privacySettingsSchema = joi_1.default.object({
    shareAnalytics: joi_1.default.boolean().optional(),
    shareCrashReports: joi_1.default.boolean().optional(),
    showProfileToOthers: joi_1.default.boolean().optional(),
    allowProjectInvites: joi_1.default.boolean().optional(),
    showActivityStatus: joi_1.default.boolean().optional(),
    allowDataCollection: joi_1.default.boolean().optional(),
});
const pushTokenSchema = joi_1.default.object({
    token: joi_1.default.string().required(),
    platform: joi_1.default.string().valid('android', 'ios').required(),
});
router.get('/', async (req, res) => {
    try {
        const user = req.user;
        res.json({
            success: true,
            data: user,
        });
    }
    catch (error) {
        throw error;
    }
});
router.put('/', async (req, res) => {
    try {
        const { error, value } = updateProfileSchema.validate(req.body);
        if (error) {
            throw new types_1.ValidationError(error.details[0].message);
        }
        const prisma = (0, database_1.getPrismaClient)();
        const userId = req.user.id;
        const updatedUser = await prisma.user.update({
            where: { id: userId },
            data: value,
            select: {
                id: true,
                email: true,
                name: true,
                timezone: true,
                settings: true,
                createdAt: true,
                updatedAt: true,
            },
        });
        res.json({
            success: true,
            data: updatedUser,
            message: 'Profile updated successfully',
        });
    }
    catch (error) {
        throw error;
    }
});
router.delete('/', async (req, res) => {
    try {
        const prisma = (0, database_1.getPrismaClient)();
        const userId = req.user.id;
        await prisma.user.delete({
            where: { id: userId },
        });
        res.json({
            success: true,
            message: 'Account deleted successfully',
        });
    }
    catch (error) {
        throw error;
    }
});
router.get('/stats', async (req, res) => {
    try {
        const prisma = (0, database_1.getPrismaClient)();
        const userId = req.user.id;
        const [taskCount, completedTasks, goalCount, completedGoals, projectCount, alarmCount, reminderCount,] = await Promise.all([
            prisma.task.count({
                where: { creatorId: userId },
            }),
            prisma.task.count({
                where: {
                    creatorId: userId,
                    status: 'DONE',
                },
            }),
            prisma.goal.count({
                where: { userId },
            }),
            prisma.goal.count({
                where: {
                    userId,
                },
            }),
            prisma.project.count({
                where: { ownerId: userId },
            }),
            prisma.alarm.count({
                where: { userId },
            }),
            prisma.reminder.count({
                where: { userId },
            }),
        ]);
        res.json({
            success: true,
            data: {
                tasks: {
                    total: taskCount,
                    completed: completedTasks,
                    completionRate: taskCount > 0 ? (completedTasks / taskCount) * 100 : 0,
                },
                goals: {
                    total: goalCount,
                    completed: completedGoals,
                },
                projects: projectCount,
                alarms: alarmCount,
                reminders: reminderCount,
            },
        });
    }
    catch (error) {
        throw error;
    }
});
router.post('/change-password', async (req, res) => {
    try {
        const { error, value } = changePasswordSchema.validate(req.body);
        if (error) {
            throw new types_1.ValidationError(error.details[0].message);
        }
        const prisma = (0, database_1.getPrismaClient)();
        const userId = req.user.id;
        const { currentPassword, newPassword } = value;
        const user = await prisma.user.findUnique({
            where: { id: userId },
            select: { id: true, passwordHash: true },
        });
        if (!user) {
            return res.status(404).json({
                success: false,
                error: 'User not found',
            });
        }
        const isPasswordValid = await bcrypt_1.default.compare(currentPassword, user.passwordHash);
        if (!isPasswordValid) {
            return res.status(400).json({
                success: false,
                error: 'Current password is incorrect',
            });
        }
        const hashedPassword = await bcrypt_1.default.hash(newPassword, 10);
        await prisma.user.update({
            where: { id: userId },
            data: { passwordHash: hashedPassword },
        });
        return res.json({
            success: true,
            message: 'Password changed successfully',
        });
    }
    catch (error) {
        throw error;
    }
});
router.post('/push-token', async (req, res) => {
    try {
        const { error, value } = pushTokenSchema.validate(req.body);
        if (error) {
            throw new types_1.ValidationError(error.details[0].message);
        }
        const { token, platform } = value;
        const prisma = (0, database_1.getPrismaClient)();
        const userId = req.user.id;
        const user = await prisma.user.findUnique({
            where: { id: userId },
            select: { settings: true },
        });
        const currentSettings = user?.settings || {};
        const pushTokens = currentSettings.pushTokens || [];
        const filteredTokens = pushTokens.filter((t) => t.token !== token && t.platform !== platform);
        const newToken = {
            token,
            platform,
            registeredAt: new Date().toISOString(),
        };
        const updatedSettings = {
            ...currentSettings,
            pushTokens: [...filteredTokens, newToken],
        };
        await prisma.user.update({
            where: { id: userId },
            data: { settings: updatedSettings },
        });
        logger_1.logger.info(`Push token registered for user ${userId}`, { platform, tokenLength: token.length });
        res.json({
            success: true,
            data: newToken,
            message: 'Push token registered successfully',
        });
    }
    catch (error) {
        throw error;
    }
});
router.delete('/push-token', async (req, res) => {
    try {
        const deletePushTokenSchema = joi_1.default.object({
            token: joi_1.default.string().required(),
        });
        const { error, value } = deletePushTokenSchema.validate(req.body);
        if (error) {
            throw new types_1.ValidationError(error.details[0].message);
        }
        const { token } = value;
        const prisma = (0, database_1.getPrismaClient)();
        const userId = req.user.id;
        const user = await prisma.user.findUnique({
            where: { id: userId },
            select: { settings: true },
        });
        const currentSettings = user?.settings || {};
        const pushTokens = (currentSettings.pushTokens || []).filter((t) => t.token !== token);
        const updatedSettings = {
            ...currentSettings,
            pushTokens,
        };
        await prisma.user.update({
            where: { id: userId },
            data: { settings: updatedSettings },
        });
        res.json({
            success: true,
            message: 'Push token removed successfully',
        });
    }
    catch (error) {
        throw error;
    }
});
router.get('/notification-settings', async (req, res) => {
    try {
        const prisma = (0, database_1.getPrismaClient)();
        const userId = req.user.id;
        const user = await prisma.user.findUnique({
            where: { id: userId },
            select: { settings: true },
        });
        const settings = user?.settings || {};
        const notificationSettings = settings.notifications || {
            pushNotifications: true,
            emailNotifications: false,
            taskReminders: true,
            goalReminders: true,
            projectInvitations: true,
            taskAssignments: true,
            taskComments: true,
            dueDateReminders: true,
            weeklyDigest: false,
            monthlyReport: false,
            marketingEmails: false,
        };
        res.json({
            success: true,
            data: notificationSettings,
        });
    }
    catch (error) {
        throw error;
    }
});
router.put('/notification-settings', async (req, res) => {
    try {
        const { error, value } = notificationSettingsSchema.validate(req.body);
        if (error) {
            throw new types_1.ValidationError(error.details[0].message);
        }
        const prisma = (0, database_1.getPrismaClient)();
        const userId = req.user.id;
        const user = await prisma.user.findUnique({
            where: { id: userId },
            select: { settings: true },
        });
        const currentSettings = user?.settings || {};
        const updatedSettings = {
            ...currentSettings,
            notifications: {
                ...(currentSettings.notifications || {}),
                ...value,
            },
        };
        await prisma.user.update({
            where: { id: userId },
            data: { settings: updatedSettings },
        });
        res.json({
            success: true,
            data: updatedSettings.notifications,
            message: 'Notification settings updated successfully',
        });
    }
    catch (error) {
        throw error;
    }
});
router.get('/privacy-settings', async (req, res) => {
    try {
        const prisma = (0, database_1.getPrismaClient)();
        const userId = req.user.id;
        const user = await prisma.user.findUnique({
            where: { id: userId },
            select: { settings: true },
        });
        const settings = user?.settings || {};
        const privacySettings = settings.privacy || {
            shareAnalytics: true,
            shareCrashReports: true,
            showProfileToOthers: true,
            allowProjectInvites: true,
            showActivityStatus: true,
            allowDataCollection: true,
        };
        res.json({
            success: true,
            data: privacySettings,
        });
    }
    catch (error) {
        throw error;
    }
});
router.put('/privacy-settings', async (req, res) => {
    try {
        const { error, value } = privacySettingsSchema.validate(req.body);
        if (error) {
            throw new types_1.ValidationError(error.details[0].message);
        }
        const prisma = (0, database_1.getPrismaClient)();
        const userId = req.user.id;
        const user = await prisma.user.findUnique({
            where: { id: userId },
            select: { settings: true },
        });
        const currentSettings = user?.settings || {};
        const updatedSettings = {
            ...currentSettings,
            privacy: {
                ...(currentSettings.privacy || {}),
                ...value,
            },
        };
        await prisma.user.update({
            where: { id: userId },
            data: { settings: updatedSettings },
        });
        res.json({
            success: true,
            data: updatedSettings.privacy,
            message: 'Privacy settings updated successfully',
        });
    }
    catch (error) {
        throw error;
    }
});
router.get('/export', async (req, res) => {
    try {
        const prisma = (0, database_1.getPrismaClient)();
        const userId = req.user.id;
        const [user, tasks, projects, goals, alarms, reminders] = await Promise.all([
            prisma.user.findUnique({
                where: { id: userId },
                select: {
                    id: true,
                    email: true,
                    name: true,
                    timezone: true,
                    settings: true,
                    createdAt: true,
                    updatedAt: true,
                },
            }),
            prisma.task.findMany({
                where: { creatorId: userId },
            }),
            prisma.project.findMany({
                where: { ownerId: userId },
            }),
            prisma.goal.findMany({
                where: { userId },
            }),
            prisma.alarm.findMany({
                where: { userId },
            }),
            prisma.reminder.findMany({
                where: { userId },
            }),
        ]);
        const exportData = {
            user,
            tasks,
            projects,
            goals,
            alarms,
            reminders,
            exportedAt: new Date().toISOString(),
        };
        res.json({
            success: true,
            data: exportData,
            message: 'Data exported successfully',
        });
    }
    catch (error) {
        throw error;
    }
});
router.delete('/data', async (req, res) => {
    try {
        const prisma = (0, database_1.getPrismaClient)();
        const userId = req.user.id;
        await prisma.$transaction(async (tx) => {
            await tx.task.deleteMany({ where: { creatorId: userId } });
            await tx.goal.deleteMany({ where: { userId } });
            await tx.alarm.deleteMany({ where: { userId } });
            await tx.reminder.deleteMany({ where: { userId } });
            await tx.notification.deleteMany({ where: { userId } });
            await tx.projectMember.deleteMany({ where: { userId } });
        });
        res.json({
            success: true,
            message: 'All data deleted successfully',
        });
    }
    catch (error) {
        throw error;
    }
});
exports.default = router;
//# sourceMappingURL=user.js.map