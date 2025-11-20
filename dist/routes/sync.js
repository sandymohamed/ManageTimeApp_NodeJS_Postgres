"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const joi_1 = __importDefault(require("joi"));
const database_1 = require("../utils/database");
const auth_1 = require("../middleware/auth");
const types_1 = require("../types");
const router = (0, express_1.Router)();
router.use(auth_1.authenticateToken);
const syncRequestSchema = joi_1.default.object({
    operations: joi_1.default.array().items(joi_1.default.object({
        id: joi_1.default.string().required(),
        entity: joi_1.default.string().required(),
        operation: joi_1.default.string().valid('create', 'update', 'delete').required(),
        data: joi_1.default.object().required(),
        timestamp: joi_1.default.number().required(),
        version: joi_1.default.number().required(),
    })).required(),
    lastSyncTimestamp: joi_1.default.number().required(),
});
router.post('/', async (req, res) => {
    try {
        const { error, value } = syncRequestSchema.validate(req.body);
        if (error) {
            throw new types_1.ValidationError(error.details[0].message);
        }
        const { operations, lastSyncTimestamp } = value;
        const userId = req.user.id;
        const prisma = (0, database_1.getPrismaClient)();
        const processedOperations = [];
        const conflicts = [];
        for (const operation of operations) {
            try {
                const result = await processSyncOperation(prisma, userId, operation);
                processedOperations.push(result);
            }
            catch (error) {
                conflicts.push({
                    operationId: operation.id,
                    conflictType: 'data',
                    serverData: null,
                    clientData: operation.data,
                    resolution: 'manual',
                });
            }
        }
        await getServerChanges(prisma, userId, lastSyncTimestamp);
        const response = {
            operations: processedOperations,
            conflicts,
            serverTimestamp: Date.now(),
        };
        return res.json({
            success: true,
            data: response,
        });
    }
    catch (error) {
        throw error;
    }
});
router.get('/state', async (req, res) => {
    try {
        const userId = req.user.id;
        const prisma = (0, database_1.getPrismaClient)();
        const lastUpdate = await prisma.user.findUnique({
            where: { id: userId },
            select: { updatedAt: true },
        });
        res.json({
            success: true,
            data: {
                lastSyncTimestamp: lastUpdate?.updatedAt.getTime() || 0,
                serverTimestamp: Date.now(),
            },
        });
    }
    catch (error) {
        throw error;
    }
});
async function processSyncOperation(prisma, userId, operation) {
    const { entity, operation: op, data } = operation;
    switch (entity) {
        case 'task':
            return await processTaskOperation(prisma, userId, op, data);
        case 'project':
            return await processProjectOperation(prisma, userId, op, data);
        case 'goal':
            return await processGoalOperation(prisma, userId, op, data);
        case 'reminder':
            return await processReminderOperation(prisma, userId, op, data);
        case 'alarm':
            return await processAlarmOperation(prisma, userId, op, data);
        default:
            throw new Error(`Unknown entity: ${entity}`);
    }
}
async function processTaskOperation(prisma, userId, op, data) {
    switch (op) {
        case 'create':
            return await prisma.task.create({
                data: {
                    ...data,
                    creatorId: userId,
                },
            });
        case 'update':
            return await prisma.task.update({
                where: { id: data.id },
                data: { ...data, id: undefined },
            });
        case 'delete':
            return await prisma.task.delete({
                where: { id: data.id },
            });
        default:
            throw new Error(`Unknown operation: ${op}`);
    }
}
async function processProjectOperation(prisma, userId, op, data) {
    switch (op) {
        case 'create':
            return await prisma.project.create({
                data: {
                    ...data,
                    ownerId: userId,
                },
            });
        case 'update':
            return await prisma.project.update({
                where: { id: data.id },
                data: { ...data, id: undefined },
            });
        case 'delete':
            return await prisma.project.delete({
                where: { id: data.id },
            });
        default:
            throw new Error(`Unknown operation: ${op}`);
    }
}
async function processGoalOperation(prisma, userId, op, data) {
    switch (op) {
        case 'create':
            return await prisma.goal.create({
                data: {
                    ...data,
                    userId,
                },
            });
        case 'update':
            return await prisma.goal.update({
                where: { id: data.id },
                data: { ...data, id: undefined },
            });
        case 'delete':
            return await prisma.goal.delete({
                where: { id: data.id },
            });
        default:
            throw new Error(`Unknown operation: ${op}`);
    }
}
async function processReminderOperation(prisma, userId, op, data) {
    switch (op) {
        case 'create':
            return await prisma.reminder.create({
                data: {
                    ...data,
                    userId,
                },
            });
        case 'update':
            return await prisma.reminder.update({
                where: { id: data.id },
                data: { ...data, id: undefined },
            });
        case 'delete':
            return await prisma.reminder.delete({
                where: { id: data.id },
            });
        default:
            throw new Error(`Unknown operation: ${op}`);
    }
}
async function processAlarmOperation(prisma, userId, op, data) {
    switch (op) {
        case 'create':
            return await prisma.alarm.create({
                data: {
                    ...data,
                    userId,
                },
            });
        case 'update':
            return await prisma.alarm.update({
                where: { id: data.id },
                data: { ...data, id: undefined },
            });
        case 'delete':
            return await prisma.alarm.delete({
                where: { id: data.id },
            });
        default:
            throw new Error(`Unknown operation: ${op}`);
    }
}
async function getServerChanges(prisma, userId, lastSyncTimestamp) {
    const since = new Date(lastSyncTimestamp);
    const [tasks, projects, goals, reminders, alarms] = await Promise.all([
        prisma.task.findMany({
            where: {
                OR: [
                    { creatorId: userId },
                    { assigneeId: userId },
                ],
                updatedAt: { gt: since },
            },
        }),
        prisma.project.findMany({
            where: {
                OR: [
                    { ownerId: userId },
                    {
                        members: {
                            some: { userId },
                        },
                    },
                ],
                updatedAt: { gt: since },
            },
        }),
        prisma.goal.findMany({
            where: {
                userId,
                updatedAt: { gt: since },
            },
        }),
        prisma.reminder.findMany({
            where: {
                userId,
                createdAt: { gt: since },
            },
        }),
        prisma.alarm.findMany({
            where: {
                userId,
                updatedAt: { gt: since },
            },
        }),
    ]);
    return [
        ...tasks.map((task) => ({ entity: 'task', operation: 'update', data: task })),
        ...projects.map((project) => ({ entity: 'project', operation: 'update', data: project })),
        ...goals.map((goal) => ({ entity: 'goal', operation: 'update', data: goal })),
        ...reminders.map((reminder) => ({ entity: 'reminder', operation: 'create', data: reminder })),
        ...alarms.map((alarm) => ({ entity: 'alarm', operation: 'update', data: alarm })),
    ];
}
exports.default = router;
//# sourceMappingURL=sync.js.map