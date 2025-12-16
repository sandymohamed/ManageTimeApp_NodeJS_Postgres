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
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const helmet_1 = __importDefault(require("helmet"));
const dotenv_1 = __importDefault(require("dotenv"));
const http_1 = require("http");
const socket_io_1 = require("socket.io");
const express_rate_limit_1 = __importDefault(require("express-rate-limit"));
const errorHandler_1 = require("./middleware/errorHandler");
const logger_1 = require("./utils/logger");
const database_1 = require("./utils/database");
const redis_1 = require("./utils/redis");
const queueService_1 = require("./services/queueService");
const auth_1 = __importDefault(require("./routes/auth"));
const user_1 = __importDefault(require("./routes/user"));
const project_1 = __importDefault(require("./routes/project"));
const task_1 = __importDefault(require("./routes/task"));
const goal_1 = __importDefault(require("./routes/goal"));
const reminder_1 = __importDefault(require("./routes/reminder"));
const alarm_1 = __importDefault(require("./routes/alarm"));
const timer_1 = __importDefault(require("./routes/timer"));
const notification_1 = __importDefault(require("./routes/notification"));
const sync_1 = __importDefault(require("./routes/sync"));
const analytics_1 = __importDefault(require("./routes/analytics"));
const ai_1 = __importDefault(require("./routes/ai"));
const milestone_1 = __importDefault(require("./routes/milestone"));
const invitation_1 = __importDefault(require("./routes/invitation"));
const routine_1 = __importDefault(require("./routes/routine"));
dotenv_1.default.config();
const app = (0, express_1.default)();
const server = (0, http_1.createServer)(app);
const io = new socket_io_1.Server(server, {
    cors: {
        origin: process.env.CORS_ORIGIN?.split(',') || [
            'http://localhost:3000',
            'http://192.168.1.13:3000',
            'http:// 192.168.52.67:3000',
            'http://localhost:8081',
            'http://192.168.1.13:8081'
        ],
        methods: ['GET', 'POST']
    }
});
const PORT = process.env.PORT || 3000;
const limiter = (0, express_rate_limit_1.default)({
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '900000'),
    max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || '100'),
    message: 'Too many requests from this IP, please try again later.',
    standardHeaders: true,
    legacyHeaders: false,
});
app.use((0, helmet_1.default)());
app.use((0, cors_1.default)({
    origin: process.env.CORS_ORIGIN?.split(',') || [
        'http://localhost:3000',
        'http://192.168.1.13:3000',
        'http://localhost:8081',
        'http://192.168.1.13:8081'
    ],
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
}));
app.use(limiter);
app.use(express_1.default.json({ limit: '10mb' }));
app.use(express_1.default.urlencoded({ extended: true }));
app.get('/health', (req, res) => {
    res.json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        uptime: process.uptime()
    });
});
app.use('/api/v1/auth', auth_1.default);
app.use('/api/v1/me', user_1.default);
app.use('/api/v1/projects', project_1.default);
app.use('/api/v1/tasks', task_1.default);
app.use('/api/v1/goals', goal_1.default);
app.use('/api/v1/reminders', reminder_1.default);
app.use('/api/v1/alarms', alarm_1.default);
app.use('/api/v1/timers', timer_1.default);
app.use('/api/v1/notifications', notification_1.default);
app.use('/api/v1/sync', sync_1.default);
app.use('/api/v1/analytics', analytics_1.default);
app.use('/api/v1/ai', ai_1.default);
app.use('/api/v1/milestones', milestone_1.default);
app.use('/api/v1/invitations', invitation_1.default);
app.use('/api/v1/routines', routine_1.default);
io.on('connection', (socket) => {
    logger_1.logger.info(`Client connected: ${socket.id}`);
    socket.on('join-project', (projectId) => {
        socket.join(`project-${projectId}`);
        logger_1.logger.info(`Client ${socket.id} joined project ${projectId}`);
    });
    socket.on('leave-project', (projectId) => {
        socket.leave(`project-${projectId}`);
        logger_1.logger.info(`Client ${socket.id} left project ${projectId}`);
    });
    socket.on('disconnect', () => {
        logger_1.logger.info(`Client disconnected: ${socket.id}`);
    });
});
app.set('io', io);
app.use(errorHandler_1.errorHandler);
app.use('*', (req, res) => {
    res.status(404).json({
        error: 'Route not found',
        path: req.originalUrl
    });
});
async function startServer() {
    try {
        await (0, database_1.connectDatabase)();
        logger_1.logger.info('Database connected successfully');
        await (0, redis_1.connectRedis)();
        logger_1.logger.info('Redis connected successfully');
        await (0, queueService_1.initializeQueues)();
        logger_1.logger.info('Job queues initialized');
        server.listen(Number(PORT), '0.0.0.0', () => {
            logger_1.logger.info(`Server running on port ${PORT}`);
            logger_1.logger.info(`Environment: ${process.env.NODE_ENV}`);
            logger_1.logger.info(`Server accessible at: http://localhost:${PORT} and http://192.168.1.13:${PORT}`);
        });
    }
    catch (error) {
        logger_1.logger.error('Failed to start server:', error);
        process.exit(1);
    }
}
const gracefulShutdown = async (signal) => {
    logger_1.logger.info(`${signal} received, shutting down gracefully`);
    server.close(async () => {
        logger_1.logger.info('HTTP server closed');
        try {
            const { disconnectDatabase } = await Promise.resolve().then(() => __importStar(require('./utils/database')));
            await disconnectDatabase();
            logger_1.logger.info('Database disconnected');
        }
        catch (error) {
            logger_1.logger.error('Error disconnecting database:', error);
        }
        try {
            const { disconnectRedis } = await Promise.resolve().then(() => __importStar(require('./utils/redis')));
            await disconnectRedis();
            logger_1.logger.info('Redis disconnected');
        }
        catch (error) {
            logger_1.logger.error('Error disconnecting Redis:', error);
        }
        logger_1.logger.info('Process terminated');
        process.exit(0);
    });
    setTimeout(() => {
        logger_1.logger.error('Forced shutdown after timeout');
        process.exit(1);
    }, 10000);
};
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
startServer();
//# sourceMappingURL=index.js.map