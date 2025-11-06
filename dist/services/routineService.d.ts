import { Prisma } from '@prisma/client';
export interface RoutineSchedule {
    time?: string;
    days?: number[];
    day?: number;
}
export interface CreateRoutineData {
    title: string;
    description?: string;
    frequency: 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY';
    schedule: RoutineSchedule;
    timezone?: string;
}
export interface CreateRoutineTaskData {
    title: string;
    description?: string;
    order?: number;
    reminderTime?: string;
}
export declare class RoutineService {
    createRoutine(userId: string, data: CreateRoutineData): Promise<{
        routineTasks: {
            id: string;
            createdAt: Date;
            updatedAt: Date;
            completed: boolean;
            title: string;
            description: string | null;
            completedAt: Date | null;
            order: number;
            routineId: string;
            reminderTime: string | null;
        }[];
    } & {
        id: string;
        timezone: string;
        createdAt: Date;
        updatedAt: Date;
        userId: string;
        title: string;
        description: string | null;
        enabled: boolean;
        schedule: Prisma.JsonValue;
        frequency: import(".prisma/client").$Enums.RoutineFrequency;
        lastResetAt: Date | null;
        nextOccurrenceAt: Date | null;
    }>;
    getUserRoutines(userId: string): Promise<({
        routineTasks: {
            id: string;
            createdAt: Date;
            updatedAt: Date;
            completed: boolean;
            title: string;
            description: string | null;
            completedAt: Date | null;
            order: number;
            routineId: string;
            reminderTime: string | null;
        }[];
    } & {
        id: string;
        timezone: string;
        createdAt: Date;
        updatedAt: Date;
        userId: string;
        title: string;
        description: string | null;
        enabled: boolean;
        schedule: Prisma.JsonValue;
        frequency: import(".prisma/client").$Enums.RoutineFrequency;
        lastResetAt: Date | null;
        nextOccurrenceAt: Date | null;
    })[]>;
    getRoutineById(routineId: string, userId: string): Promise<({
        routineTasks: {
            id: string;
            createdAt: Date;
            updatedAt: Date;
            completed: boolean;
            title: string;
            description: string | null;
            completedAt: Date | null;
            order: number;
            routineId: string;
            reminderTime: string | null;
        }[];
    } & {
        id: string;
        timezone: string;
        createdAt: Date;
        updatedAt: Date;
        userId: string;
        title: string;
        description: string | null;
        enabled: boolean;
        schedule: Prisma.JsonValue;
        frequency: import(".prisma/client").$Enums.RoutineFrequency;
        lastResetAt: Date | null;
        nextOccurrenceAt: Date | null;
    }) | null>;
    updateRoutine(routineId: string, userId: string, data: Partial<CreateRoutineData>): Promise<{
        routineTasks: {
            id: string;
            createdAt: Date;
            updatedAt: Date;
            completed: boolean;
            title: string;
            description: string | null;
            completedAt: Date | null;
            order: number;
            routineId: string;
            reminderTime: string | null;
        }[];
    } & {
        id: string;
        timezone: string;
        createdAt: Date;
        updatedAt: Date;
        userId: string;
        title: string;
        description: string | null;
        enabled: boolean;
        schedule: Prisma.JsonValue;
        frequency: import(".prisma/client").$Enums.RoutineFrequency;
        lastResetAt: Date | null;
        nextOccurrenceAt: Date | null;
    }>;
    deleteRoutine(routineId: string, userId: string): Promise<{
        success: boolean;
    }>;
    addTaskToRoutine(routineId: string, userId: string, taskData: CreateRoutineTaskData): Promise<{
        id: string;
        createdAt: Date;
        updatedAt: Date;
        completed: boolean;
        title: string;
        description: string | null;
        completedAt: Date | null;
        order: number;
        routineId: string;
        reminderTime: string | null;
    }>;
    updateRoutineTask(taskId: string, userId: string, data: Partial<CreateRoutineTaskData>): Promise<{
        id: string;
        createdAt: Date;
        updatedAt: Date;
        completed: boolean;
        title: string;
        description: string | null;
        completedAt: Date | null;
        order: number;
        routineId: string;
        reminderTime: string | null;
    }>;
    deleteRoutineTask(taskId: string, userId: string): Promise<{
        success: boolean;
    }>;
    toggleTaskCompletion(taskId: string, userId: string, completed: boolean): Promise<{
        id: string;
        createdAt: Date;
        updatedAt: Date;
        completed: boolean;
        title: string;
        description: string | null;
        completedAt: Date | null;
        order: number;
        routineId: string;
        reminderTime: string | null;
    }>;
    resetRoutineTasks(routineId: string): Promise<{
        success: boolean;
    }>;
    checkAndResetDueRoutinesForUser(userId: string): Promise<void>;
    checkAndResetDueRoutines(): Promise<({
        routineId: string;
        success: boolean;
        error?: undefined;
    } | {
        routineId: string;
        success: boolean;
        error: unknown;
    })[]>;
    getRoutineTasksAsTasks(userId: string): Promise<any[]>;
    private calculateTaskDueDate;
    private determineTaskUrgencyAndStatus;
    private calculateNextOccurrence;
}
export declare const routineService: RoutineService;
//# sourceMappingURL=routineService.d.ts.map