"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.disconnectDatabase = exports.getPrismaClient = exports.connectDatabase = void 0;
exports.executeWithRetry = executeWithRetry;
const client_1 = require("@prisma/client");
const logger_1 = require("./logger");
let prisma;
const connectDatabase = async (maxRetries = 5, retryDelay = 5000) => {
    if (prisma) {
        try {
            await Promise.race([
                prisma.$queryRaw `SELECT 1`,
                new Promise((_, reject) => setTimeout(() => reject(new Error('Connection test timeout')), 2000))
            ]);
            logger_1.logger.debug('Database connection is already active, skipping reconnect');
            return;
        }
        catch (testError) {
            const errorMsg = testError?.message || String(testError);
            logger_1.logger.warn('Database connection test failed, will reconnect:', errorMsg);
            try {
                await prisma.$disconnect();
            }
            catch (disconnectError) {
            }
            prisma = null;
        }
    }
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            let databaseUrl = process.env.DATABASE_URL || '';
            if (databaseUrl && !databaseUrl.includes('connection_limit')) {
                try {
                    const url = new URL(databaseUrl);
                    url.searchParams.set('connection_limit', '5');
                    url.searchParams.set('pool_timeout', '10');
                    databaseUrl = url.toString();
                    logger_1.logger.info('Added connection pool parameters to DATABASE_URL (limit: 5)');
                }
                catch (urlError) {
                    const separator = databaseUrl.includes('?') ? '&' : '?';
                    databaseUrl = `${databaseUrl}${separator}connection_limit=5&pool_timeout=10`;
                    logger_1.logger.info('Added connection pool parameters to DATABASE_URL (limit: 5, fallback)');
                }
            }
            prisma = new client_1.PrismaClient({
                log: [
                    { level: 'error', emit: 'stdout' },
                    { level: 'warn', emit: 'stdout' },
                ],
                datasources: {
                    db: {
                        url: databaseUrl,
                    },
                },
            });
            if (process.env.NODE_ENV === 'development') {
                prisma.$on('query', (e) => {
                    logger_1.logger.debug('Query:', {
                        query: e.query,
                        params: e.params,
                        duration: `${e.duration}ms`,
                    });
                });
            }
            await prisma.$connect();
            logger_1.logger.info('Database connected successfully');
            return;
        }
        catch (error) {
            const isConnectionLimitError = error?.code === 'P2037' ||
                error?.message?.includes('too many database connections') ||
                error?.message?.includes('connection slots');
            if (isConnectionLimitError && attempt < maxRetries) {
                const delay = retryDelay * attempt;
                logger_1.logger.warn(`Database connection limit reached (attempt ${attempt}/${maxRetries}), waiting ${delay}ms before retry...`, {
                    error: error.message,
                    code: error.code,
                });
                await new Promise(resolve => setTimeout(resolve, delay));
                continue;
            }
            logger_1.logger.error('Failed to connect to database:', error);
            throw error;
        }
    }
};
exports.connectDatabase = connectDatabase;
const getPrismaClient = () => {
    if (!prisma) {
        logger_1.logger.warn('Prisma client not initialized, attempting to connect...');
        throw new Error('Database not connected. Call connectDatabase() first.');
    }
    return prisma;
};
exports.getPrismaClient = getPrismaClient;
async function executeWithRetry(operation, maxRetries = 3, retryDelay = 1000) {
    let lastError;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            return await operation();
        }
        catch (error) {
            lastError = error;
            const isConnectionError = error?.code === 'P1017' ||
                error?.code === 'P1001' ||
                error?.code === 'P2037' ||
                error?.code === 'P1008' ||
                error?.message?.includes('connection') ||
                error?.message?.includes('closed') ||
                error?.message?.includes('connection slots') ||
                error?.message?.includes('Server has closed the connection');
            if (isConnectionError && attempt < maxRetries) {
                logger_1.logger.warn(`Database connection error (attempt ${attempt}/${maxRetries}), retrying...`, {
                    error: error.message,
                    code: error.code,
                });
                try {
                    if (prisma) {
                        try {
                            await prisma.$disconnect();
                        }
                        catch (disconnectError) {
                            logger_1.logger.debug('Error disconnecting (expected if already disconnected):', disconnectError);
                        }
                    }
                    prisma = null;
                    await (0, exports.connectDatabase)(3, 2000);
                }
                catch (reconnectError) {
                    logger_1.logger.error('Failed to reconnect to database:', reconnectError);
                }
                await new Promise(resolve => setTimeout(resolve, retryDelay * attempt));
                continue;
            }
            throw error;
        }
    }
    throw lastError;
}
const disconnectDatabase = async () => {
    if (prisma) {
        await prisma.$disconnect();
        logger_1.logger.info('Database disconnected');
    }
};
exports.disconnectDatabase = disconnectDatabase;
//# sourceMappingURL=database.js.map