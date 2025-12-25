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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.pushNotificationService = void 0;
const firebase_admin_1 = __importDefault(require("firebase-admin"));
const fs = __importStar(require("fs"));
const logger_1 = require("../utils/logger");
const database_1 = require("../utils/database");
let firebaseInitialized = false;
function initializeFirebase() {
    if (firebaseInitialized) {
        return;
    }
    try {
        if (firebase_admin_1.default.apps.length === 0) {
            const serviceAccountPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
            if (serviceAccountPath) {
                const serviceAccountContent = fs.readFileSync(serviceAccountPath, 'utf8');
                const serviceAccount = JSON.parse(serviceAccountContent);
                firebase_admin_1.default.initializeApp({
                    credential: firebase_admin_1.default.credential.cert(serviceAccount),
                });
            }
            else if (process.env.FIREBASE_PROJECT_ID && process.env.FIREBASE_PRIVATE_KEY) {
                firebase_admin_1.default.initializeApp({
                    credential: firebase_admin_1.default.credential.cert({
                        projectId: process.env.FIREBASE_PROJECT_ID,
                        privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
                        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
                    }),
                });
            }
            else {
                logger_1.logger.warn('Firebase Admin SDK not initialized. Push notifications will not work.');
                logger_1.logger.warn('Set GOOGLE_APPLICATION_CREDENTIALS or FIREBASE_* environment variables.');
                return;
            }
        }
        firebaseInitialized = true;
        logger_1.logger.info('Firebase Admin SDK initialized successfully');
    }
    catch (error) {
        logger_1.logger.error('Failed to initialize Firebase Admin SDK:', error);
    }
}
const APP_NAME = process.env.APP_NAME || 'Manage Time';
const APP_LOGO_URL = process.env.APP_LOGO_URL || '';
class PushNotificationService {
    constructor() {
        initializeFirebase();
        logger_1.logger.info('PushNotificationService initialized');
    }
    static getInstance() {
        if (!PushNotificationService.instance) {
            PushNotificationService.instance = new PushNotificationService();
        }
        return PushNotificationService.instance;
    }
    async getUserPushTokens(userId) {
        try {
            const prisma = (0, database_1.getPrismaClient)();
            const user = await prisma.user.findUnique({
                where: { id: userId },
                select: { settings: true },
            });
            if (!user?.settings) {
                return [];
            }
            const settings = user.settings;
            const pushTokens = settings.pushTokens || [];
            logger_1.logger.debug('Retrieved push tokens for user', { userId, tokenCount: pushTokens.length });
            return pushTokens.filter((token) => {
                const registeredAt = new Date(token.registeredAt);
                const thirtyDaysAgo = new Date();
                thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
                return registeredAt > thirtyDaysAgo;
            });
        }
        catch (error) {
            logger_1.logger.error('Failed to get user push tokens:', error);
            return [];
        }
    }
    async sendPushNotification(userId, payload, checkPreferences = true) {
        try {
            if (!firebaseInitialized || !firebase_admin_1.default.apps.length) {
                logger_1.logger.warn('Firebase not initialized, cannot send push notification');
                return false;
            }
            if (checkPreferences) {
                const prisma = (0, database_1.getPrismaClient)();
                const user = await prisma.user.findUnique({
                    where: { id: userId },
                    select: { settings: true },
                });
                const settings = user?.settings || {};
                const notificationSettings = settings.notifications || {};
                if (notificationSettings.pushNotifications === false) {
                    logger_1.logger.info(`Push notifications disabled for user ${userId}`);
                    return false;
                }
            }
            const tokens = await this.getUserPushTokens(userId);
            if (tokens.length === 0) {
                logger_1.logger.warn(`No push tokens found for user ${userId}`);
                return false;
            }
            const notificationData = payload.data || {};
            const isAlarmTrigger = notificationData.notificationType === 'ALARM_TRIGGER' || notificationData.type === 'alarm';
            const isReminderType = notificationData.type === 'TASK_REMINDER' ||
                notificationData.type === 'DUE_DATE_REMINDER' ||
                notificationData.type === 'ROUTINE_REMINDER';
            const isTimer = notificationData.type === 'timer';
            const androidChannelId = (isAlarmTrigger || isReminderType) ? 'alarm-channel-v2' : (isTimer ? 'timer-channel-v2' : 'default-channel-id');
            const androidPriority = 'high';
            const messages = tokens.map((tokenInfo) => {
                const notificationTitle = payload.title || APP_NAME;
                const imageUrl = payload.imageUrl || APP_LOGO_URL || undefined;
                const message = {
                    token: tokenInfo.token,
                    notification: {
                        title: notificationTitle,
                        body: payload.body,
                    },
                    data: {
                        ...notificationData,
                        type: notificationData.type || notificationData.notificationType || 'notification',
                    },
                    android: {
                        priority: (isAlarmTrigger || isReminderType) ? 'high' : androidPriority,
                        notification: {
                            sound: isAlarmTrigger ? undefined : (isReminderType ? 'alarm' : (payload.sound || 'default')),
                            channelId: androidChannelId,
                            ...(imageUrl ? { imageUrl } : {}),
                            visibility: 'public',
                            ...(isReminderType && !isAlarmTrigger ? {
                                defaultSound: true,
                                defaultVibrateTimings: true,
                                vibrateTimingsMillis: [0, 1000, 500, 1000, 500, 1000],
                                priority: 'max',
                            } : {}),
                        },
                    },
                    apns: {
                        payload: {
                            aps: {
                                sound: isAlarmTrigger ? undefined : (isReminderType ? 'alarm' : (payload.sound || 'default')),
                                badge: payload.badge,
                                ...((isAlarmTrigger || isReminderType) ? {
                                    'content-available': 1,
                                    'mutable-content': 1,
                                } : {}),
                            },
                        },
                        ...(imageUrl ? {
                            fcmOptions: {
                                imageUrl: imageUrl,
                            },
                        } : {}),
                    },
                };
                return message;
            });
            const messaging = firebase_admin_1.default.messaging();
            let successCount = 0;
            for (let i = 0; i < messages.length; i++) {
                try {
                    await messaging.send(messages[i]);
                    successCount++;
                }
                catch (error) {
                    logger_1.logger.error(`Failed to send push notification to token ${tokens[i].token}:`, error);
                }
            }
            logger_1.logger.info(`Sent ${successCount} push notifications to user ${userId}`);
            return successCount > 0;
        }
        catch (error) {
            logger_1.logger.error('Failed to send push notification:', error);
            return false;
        }
    }
    async sendPushNotificationToUsers(userIds, payload, checkPreferences = true) {
        let successCount = 0;
        for (const userId of userIds) {
            const success = await this.sendPushNotification(userId, payload, checkPreferences);
            if (success) {
                successCount++;
            }
        }
        return successCount;
    }
    isAvailable() {
        return firebaseInitialized && firebase_admin_1.default.apps.length > 0;
    }
}
exports.pushNotificationService = PushNotificationService.getInstance();
//# sourceMappingURL=pushNotificationService.js.map