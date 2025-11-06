import { Queue, Worker, Job } from 'bullmq';
export declare const QUEUE_NAMES: {
    readonly REMINDERS: "reminders";
    readonly NOTIFICATIONS: "notifications";
    readonly AI_PLAN_GENERATION: "ai-plan-generation";
    readonly EMAIL: "email";
    readonly CLEANUP: "cleanup";
};
export declare const JOB_TYPES: {
    readonly SEND_REMINDER: "send-reminder";
    readonly SEND_NOTIFICATION: "send-notification";
    readonly GENERATE_PLAN: "generate-plan";
    readonly SEND_EMAIL: "send-email";
    readonly CLEANUP_OLD_DATA: "cleanup-old-data";
};
export declare const initializeQueues: () => Promise<void>;
export declare const addJob: (queueName: string, jobType: string, data: any, options?: any) => Promise<Job>;
export declare const scheduleJob: (queueName: string, jobType: string, data: any, delay: number, options?: any) => Promise<Job>;
export declare const getQueue: (queueName: string) => Queue | undefined;
export declare const getWorker: (queueName: string) => Worker | undefined;
export declare const closeAllQueues: () => Promise<void>;
export declare const scheduleReminder: (reminderId: string, userId: string, scheduledFor: Date, type?: string) => Promise<Job>;
export declare const scheduleNotification: (notificationId: string, userId: string, scheduledFor: Date, type: string, payload: any) => Promise<Job>;
export declare const scheduleAIPlanGeneration: (goalId: string, userId: string, promptOptions: any) => Promise<Job>;
export declare const scheduleEmail: (to: string, subject: string, body: string, template?: string, data?: any) => Promise<Job>;
export declare const scheduleCleanup: (type: string, delay?: number) => Promise<Job>;
//# sourceMappingURL=queueService.d.ts.map