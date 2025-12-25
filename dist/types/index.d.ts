import { Request } from 'express';
import { User } from '@prisma/client';
export interface AuthenticatedRequest extends Request {
    user?: User;
}
export interface JWTPayload {
    userId: string;
    email: string;
    iat?: number;
    exp?: number;
}
export interface ApiResponse<T = any> {
    success: boolean;
    data?: T;
    error?: string;
    message?: string;
}
export interface PaginationParams {
    page?: number;
    limit?: number;
    sortBy?: string;
    sortOrder?: 'asc' | 'desc';
}
export interface PaginatedResponse<T> {
    data: T[];
    pagination: {
        page: number;
        limit: number;
        total: number;
        totalPages: number;
    };
}
export interface SyncOperation {
    id: string;
    entity: string;
    operation: 'create' | 'update' | 'delete';
    data: any;
    timestamp: number;
    version: number;
}
export interface SyncRequest {
    operations: SyncOperation[];
    lastSyncTimestamp: number;
}
export interface SyncResponse {
    operations: SyncOperation[];
    conflicts: SyncConflict[];
    serverTimestamp: number;
}
export interface SyncConflict {
    operationId: string;
    conflictType: 'version' | 'permission' | 'data';
    serverData: any;
    clientData: any;
    resolution: 'client' | 'server' | 'merge' | 'manual';
}
export interface RecurrenceRule {
    frequency: 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY';
    interval?: number;
    byDay?: string[];
    byMonthDay?: number[];
    byMonth?: number[];
    bySetPos?: number[];
    count?: number;
    until?: Date;
    rrule?: string;
}
export interface GeoLocation {
    latitude: number;
    longitude: number;
    radius: number;
    onEnter: boolean;
    onExit: boolean;
}
export interface NotificationPayload {
    title: string;
    body: string;
    data?: any;
    sound?: string;
    badge?: number;
}
export interface PlanGenerationRequest {
    goalId: string;
    promptOptions?: {
        intensity?: 'low' | 'medium' | 'high';
        weeklyHours?: number;
        language?: 'en' | 'ar';
        tone?: 'supportive' | 'professional' | 'casual';
    };
}
export interface GeneratedMilestone {
    title: string;
    durationDays: number;
    targetDate?: string;
    description?: string;
    tasks: string[];
}
export interface GeneratedTask {
    title: string;
    milestoneIndex: number;
    dueOffsetDays: number;
    durationMinutes: number;
    recurrence?: string;
    description?: string;
}
export interface GeneratedPlan {
    milestones: GeneratedMilestone[];
    tasks: GeneratedTask[];
    notes?: string;
}
export interface AnalyticsSummary {
    period: '7d' | '30d' | '90d' | '1y';
    tasksCompleted: number;
    tasksCreated: number;
    goalsCompleted: number;
    goalsCreated: number;
    productivityScore: number;
    averageTaskCompletionTime: number;
    mostProductiveDay: string;
    mostProductiveTime: string;
    categoryBreakdown: {
        category: string;
        count: number;
        percentage: number;
    }[];
}
export interface FileUpload {
    fieldname: string;
    originalname: string;
    encoding: string;
    mimetype: string;
    size: number;
    buffer: Buffer;
}
export interface WebSocketEvents {
    'task-created': {
        task: any;
        projectId: string;
    };
    'task-updated': {
        task: any;
        projectId: string;
    };
    'task-deleted': {
        taskId: string;
        projectId: string;
    };
    'comment-added': {
        comment: any;
        taskId: string;
        projectId: string;
    };
    'member-added': {
        member: any;
        projectId: string;
    };
    'member-removed': {
        memberId: string;
        projectId: string;
    };
    'member-role-changed': {
        member: any;
        projectId: string;
    };
}
export declare class AppError extends Error {
    statusCode: number;
    isOperational: boolean;
    constructor(message: string, statusCode?: number, isOperational?: boolean);
}
export declare class ValidationError extends AppError {
    constructor(message: string, field?: string);
}
export declare class AuthenticationError extends AppError {
    constructor(message?: string);
}
export declare class AuthorizationError extends AppError {
    constructor(message?: string);
}
export declare class NotFoundError extends AppError {
    constructor(resource?: string);
}
//# sourceMappingURL=index.d.ts.map