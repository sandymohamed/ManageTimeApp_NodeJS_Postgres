import admin from 'firebase-admin';
import * as fs from 'fs';
import { logger } from '../utils/logger';
import { getPrismaClient } from '../utils/database';

// Initialize Firebase Admin SDK
// Note: This requires service account credentials
// Place your firebase-service-account.json in the backend root directory
// Or set GOOGLE_APPLICATION_CREDENTIALS environment variable
let firebaseInitialized = false;

function initializeFirebase(): void {
  if (firebaseInitialized) {
    return;
  }

  try {
    // Check if Firebase is already initialized
    if (admin.apps.length === 0) {
      // Try to initialize from environment variable or service account file
      const serviceAccountPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;

      logger.info('serviceAccountPath', serviceAccountPath);
      logger.info('FIREBASE_PROJECT_ID', process.env.FIREBASE_PROJECT_ID);
      logger.info('FIREBASE_PRIVATE_KEY', process.env.FIREBASE_PRIVATE_KEY);
      logger.info('FIREBASE_CLIENT_EMAIL', process.env.FIREBASE_CLIENT_EMAIL);

      if (serviceAccountPath) {
        logger.info('Initializing Firebase Admin SDK from service account path');
        // Read service account file synchronously
        const serviceAccountContent = fs.readFileSync(serviceAccountPath, 'utf8');
        const serviceAccount = JSON.parse(serviceAccountContent);
        admin.initializeApp({
          credential: admin.credential.cert(serviceAccount),
        });
      } else if (process.env.FIREBASE_PROJECT_ID && process.env.FIREBASE_PRIVATE_KEY) {
        // Initialize from environment variables
        admin.initializeApp({
          credential: admin.credential.cert({
            projectId: process.env.FIREBASE_PROJECT_ID,
            privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
            clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
          }),
        });
      } else {
        logger.warn('Firebase Admin SDK not initialized. Push notifications will not work.');
        logger.warn('Set GOOGLE_APPLICATION_CREDENTIALS or FIREBASE_* environment variables.');
        return;
      }
    }

    firebaseInitialized = true;
    logger.info('Firebase Admin SDK initialized successfully');
  } catch (error) {
    logger.error('Failed to initialize Firebase Admin SDK:', error);
  }
}

interface PushNotificationPayload {
  title: string;
  body: string;
  data?: any;
  sound?: string;
  badge?: number;
  imageUrl?: string; // Logo/image URL for notifications
}

interface UserPushToken {
  token: string;
  platform: 'android' | 'ios';
  registeredAt: Date;
}

// App configuration constants
const APP_NAME = process.env.APP_NAME || 'Manage Time';
const APP_LOGO_URL = process.env.APP_LOGO_URL || ''; // Can be set via environment variable

class PushNotificationService {
  private static instance: PushNotificationService;

  private constructor() {
    initializeFirebase();
    logger.info('PushNotificationService initialized');
  }

  static getInstance(): PushNotificationService {
    if (!PushNotificationService.instance) {
      PushNotificationService.instance = new PushNotificationService();
    }
    return PushNotificationService.instance;
  }

  /**
   * Get user's push tokens from database
   */
  async getUserPushTokens(userId: string): Promise<UserPushToken[]> {
    try {
      const prisma = getPrismaClient();
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { settings: true },
      });

      if (!user?.settings) {
        return [];
      }

      const settings = user.settings as any;
      const pushTokens = settings.pushTokens || [];
      logger.debug('Retrieved push tokens for user', { userId, tokenCount: pushTokens.length });
      return pushTokens.filter((token: UserPushToken) => {
        // Filter out expired tokens (older than 30 days)
        const registeredAt = new Date(token.registeredAt);
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
        return registeredAt > thirtyDaysAgo;
      });
    } catch (error) {
      logger.error('Failed to get user push tokens:', error);
      return [];
    }
  }

  /**
   * Send push notification to user
   */
  async sendPushNotification(
    userId: string,
    payload: PushNotificationPayload,
    checkPreferences: boolean = true
  ): Promise<boolean> {
    try {
      if (!firebaseInitialized || !admin.apps.length) {
        logger.warn('Firebase not initialized, cannot send push notification');
        return false;
      }

      // Check user notification preferences if requested
      if (checkPreferences) {
        const prisma = getPrismaClient();
        const user = await prisma.user.findUnique({
          where: { id: userId },
          select: { settings: true },
        });

        const settings = (user?.settings as any) || {};
        const notificationSettings = settings.notifications || {};

        // Check if push notifications are enabled
        if (notificationSettings.pushNotifications === false) {
          logger.info(`Push notifications disabled for user ${userId}`);
          return false;
        }
      }

      // Get user's push tokens
      const tokens = await this.getUserPushTokens(userId);

      if (tokens.length === 0) {
        logger.warn(`No push tokens found for user ${userId}`);
        return false;
      }

      // Detect if this is an alarm notification (includes task/routine reminders which should ring like alarms)
      const notificationData = payload.data || {};
      const isAlarm = notificationData.notificationType === 'ALARM_TRIGGER' || 
                      notificationData.type === 'alarm' ||
                      notificationData.type === 'TASK_REMINDER' ||
                      notificationData.type === 'DUE_DATE_REMINDER' ||
                      notificationData.type === 'ROUTINE_REMINDER';
      const isTimer = notificationData.type === 'timer';
      
      // Use alarm channel for alarms, default for others
      const androidChannelId = isAlarm ? 'alarm-channel-v2' : (isTimer ? 'timer-channel-v2' : 'default-channel-id');
      const androidPriority = isAlarm ? 'high' as const : 'high' as const; // Keep high for all, but alarms will use max importance via channel

      // Prepare FCM messages
      const messages = tokens.map((tokenInfo: UserPushToken) => {
        // Use payload title as-is (app name is shown by OS automatically)
        // If title is missing, use app name as fallback
        const notificationTitle = payload.title || APP_NAME;

        const imageUrl = payload.imageUrl || APP_LOGO_URL || undefined;
        
        const message: admin.messaging.Message = {
          token: tokenInfo.token,
          notification: {
            title: notificationTitle,
            body: payload.body,
            // App name is automatically shown by the OS, so we don't prefix it here
            // Image URL can be set at notification level for web, but platform-specific is better
          },
          data: {
            ...notificationData,
            // Ensure type is included in data for frontend
            type: notificationData.type || notificationData.notificationType || 'notification',
          },
          android: {
            priority: isAlarm ? 'high' as const : androidPriority,
            notification: {
              sound: isAlarm ? 'alarm' : (payload.sound || 'default'), // Use 'alarm' sound for alarms
              channelId: androidChannelId,
              // Add image for Android notifications (requires imageUrl)
              ...(imageUrl ? { imageUrl } : {}),
              // Ensure notification is shown even when app is in foreground
              visibility: 'public' as const,
              // For alarms, ensure it wakes device and plays sound
              ...(isAlarm ? {
                // Note: 'sound' is already set above to 'alarm'
                defaultSound: true, // Use default sound if custom sound fails
                defaultVibrateTimings: true, // Use default vibration pattern
                vibrateTimingsMillis: [0, 1000, 500, 1000, 500, 1000], // Vibrate pattern for alarms
                priority: 'max' as const, // MAX priority for alarms
                // Note: 'importance' is controlled by the channel, not per-notification
              } : {}),
            },
          },
          apns: {
            payload: {
              aps: {
                sound: payload.sound || 'default',
                badge: payload.badge,
                // For alarms, ensure it wakes device
                ...(isAlarm ? {
                  'content-available': 1,
                  'mutable-content': 1,
                } : {}),
              },
            },
            // For iOS, add fcm_options with image for rich notifications (iOS 15+)
            ...(imageUrl ? {
              fcmOptions: {
                imageUrl: imageUrl,
              },
            } : {}),
          },
        };

        return message;
      });

      // Send notifications - use sendEach for compatibility
      const messaging = admin.messaging();
      let successCount = 0;

      for (let i = 0; i < messages.length; i++) {
        try {
          await messaging.send(messages[i]);
          successCount++;
        } catch (error: any) {
          logger.error(`Failed to send push notification to token ${tokens[i].token}:`, error);
        }
      }

      logger.info(`Sent ${successCount} push notifications to user ${userId}`);
      return successCount > 0;
    } catch (error) {
      logger.error('Failed to send push notification:', error);
      return false;
    }
  }

  /**
   * Send push notification to multiple users
   */
  async sendPushNotificationToUsers(
    userIds: string[],
    payload: PushNotificationPayload,
    checkPreferences: boolean = true
  ): Promise<number> {
    let successCount = 0;

    for (const userId of userIds) {
      const success = await this.sendPushNotification(userId, payload, checkPreferences);
      if (success) {
        successCount++;
      }
    }

    return successCount;
  }

  /**
   * Check if push notifications are available
   */
  isAvailable(): boolean {
    return firebaseInitialized && admin.apps.length > 0;
  }
}

export const pushNotificationService = PushNotificationService.getInstance();

