import { PrismaClient } from '@prisma/client';
export declare const connectDatabase: (maxRetries?: number, retryDelay?: number) => Promise<void>;
export declare const getPrismaClient: () => PrismaClient;
export declare function executeWithRetry<T>(operation: () => Promise<T>, maxRetries?: number, retryDelay?: number): Promise<T>;
export declare const disconnectDatabase: () => Promise<void>;
//# sourceMappingURL=database.d.ts.map