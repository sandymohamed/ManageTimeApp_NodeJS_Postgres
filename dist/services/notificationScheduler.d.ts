type AlarmLike = {
    id: string;
    userId: string;
    title: string;
    time: Date;
    timezone?: string | null;
    recurrenceRule?: string | null;
    enabled: boolean;
};
export declare function scheduleTaskDueDateNotifications(taskId: string, userId: string, dueDate: Date, taskTitle: string, dueTime?: string | null): Promise<void>;
export declare function scheduleMilestoneDueDateNotifications(milestoneId: string, goalId: string, userId: string, dueDate: Date, milestoneTitle: string): Promise<void>;
export declare function checkAndNotifyOverdueMilestones(): Promise<void>;
export declare function scheduleGoalTargetDateNotifications(goalId: string, userId: string, targetDate: Date, goalTitle: string): Promise<void>;
export declare function cancelAlarmPushNotifications(alarmId: string, userId: string): Promise<void>;
export declare function cancelAllPendingAlarmNotifications(userId: string): Promise<number>;
export declare function scheduleAlarmPushNotification(alarm: AlarmLike): Promise<void>;
export declare function sendTaskAssignmentNotification(taskId: string, assigneeId: string, taskTitle: string, assignerName?: string): Promise<void>;
export declare function sendTaskCreatedNotification(taskId: string, userId: string, taskTitle: string, context?: {
    projectTitle?: string;
}): Promise<void>;
export declare function scheduleRoutineTaskNotifications(routineId: string, userId: string, routineTitle: string, frequency: 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY', schedule: {
    time?: string;
    days?: number[];
    day?: number;
}, timezone: string, taskId: string, taskTitle: string, reminderTime?: string | null, reminderBefore?: string | null): Promise<void>;
export declare function cancelRoutineTaskNotifications(taskId: string, userId: string): Promise<void>;
export declare function cancelRoutineNotifications(routineId: string, userId: string): Promise<void>;
export declare function scheduleRoutineReminderNotification(routineId: string, userId: string, routineTitle: string, frequency: 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY', schedule: {
    time?: string;
    days?: number[];
    day?: number;
}, timezone: string, reminderBefore: string, nextOccurrence: Date): Promise<void>;
export declare function scheduleRoutineNotifications(routineId: string, _userId: string): Promise<void>;
export {};
//# sourceMappingURL=notificationScheduler.d.ts.map