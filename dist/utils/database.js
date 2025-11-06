"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.disconnectDatabase = exports.getPrismaClient = exports.connectDatabase = void 0;
const client_1 = require("@prisma/client");
const logger_1 = require("./logger");
let prisma;
const connectDatabase = async () => {
    try {
        prisma = new client_1.PrismaClient({
            log: [
                { level: 'query', emit: 'event' },
                { level: 'error', emit: 'stdout' },
                { level: 'info', emit: 'stdout' },
                { level: 'warn', emit: 'stdout' },
            ],
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
    }
    catch (error) {
        logger_1.logger.error('Failed to connect to database:', error);
        throw error;
    }
};
exports.connectDatabase = connectDatabase;
const getPrismaClient = () => {
    if (!prisma) {
        throw new Error('Database not connected. Call connectDatabase() first.');
    }
    return prisma;
};
exports.getPrismaClient = getPrismaClient;
const disconnectDatabase = async () => {
    if (prisma) {
        await prisma.$disconnect();
        logger_1.logger.info('Database disconnected');
    }
};
exports.disconnectDatabase = disconnectDatabase;
//# sourceMappingURL=database.js.map