"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.disconnectRedis = exports.getRedisClient = exports.connectRedis = void 0;
const ioredis_1 = __importDefault(require("ioredis"));
const logger_1 = require("./logger");
let redis;
const connectRedis = async () => {
    try {
        redis = new ioredis_1.default(process.env.REDIS_URL || 'redis://localhost:6379', {
            enableReadyCheck: false,
            maxRetriesPerRequest: null,
        });
        redis.on('connect', () => {
            logger_1.logger.info('Redis connected successfully');
        });
        redis.on('error', (error) => {
            logger_1.logger.error('Redis connection error:', error);
        });
        redis.on('close', () => {
            logger_1.logger.warn('Redis connection closed');
        });
        await redis.ping();
    }
    catch (error) {
        logger_1.logger.error('Failed to connect to Redis:', error);
        throw error;
    }
};
exports.connectRedis = connectRedis;
const getRedisClient = () => {
    if (!redis) {
        throw new Error('Redis not connected. Call connectRedis() first.');
    }
    return redis;
};
exports.getRedisClient = getRedisClient;
const disconnectRedis = async () => {
    if (redis) {
        await redis.quit();
        logger_1.logger.info('Redis disconnected');
    }
};
exports.disconnectRedis = disconnectRedis;
//# sourceMappingURL=redis.js.map