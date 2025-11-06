"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AuthService = void 0;
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const database_1 = require("../utils/database");
const logger_1 = require("../utils/logger");
const types_1 = require("../types");
const SALT_ROUNDS = 12;
class AuthService {
    static generateTokens(userId, email) {
        const accessToken = jsonwebtoken_1.default.sign({ userId, email }, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRES_IN || '15m' });
        const refreshToken = jsonwebtoken_1.default.sign({ userId, email, type: 'refresh' }, process.env.JWT_REFRESH_SECRET, { expiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '7d' });
        return {
            accessToken,
            refreshToken,
            expiresIn: 15 * 60,
        };
    }
    static async signup(data) {
        const prisma = (0, database_1.getPrismaClient)();
        const existingUser = await prisma.user.findUnique({
            where: { email: data.email.toLowerCase() },
        });
        if (existingUser) {
            throw new types_1.ValidationError('User with this email already exists', 'email');
        }
        const passwordHash = await bcryptjs_1.default.hash(data.password, SALT_ROUNDS);
        const user = await prisma.user.create({
            data: {
                email: data.email.toLowerCase(),
                passwordHash,
                name: data.name,
                timezone: data.timezone || 'UTC',
                settings: {
                    notifications: {
                        email: true,
                        push: true,
                        inApp: true,
                    },
                    theme: 'system',
                    language: 'en',
                },
            },
            select: {
                id: true,
                email: true,
                name: true,
                timezone: true,
                settings: true,
                createdAt: true,
                updatedAt: true,
            },
        });
        const tokens = this.generateTokens(user.id, user.email);
        await prisma.refreshToken.create({
            data: {
                userId: user.id,
                token: tokens.refreshToken,
                expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
            },
        });
        logger_1.logger.info('User signed up successfully', { userId: user.id, email: user.email });
        return { user, tokens };
    }
    static async login(data) {
        const prisma = (0, database_1.getPrismaClient)();
        const user = await prisma.user.findUnique({
            where: { email: data.email.toLowerCase() },
        });
        if (!user) {
            throw new types_1.AuthenticationError('Invalid email or password');
        }
        const isValidPassword = await bcryptjs_1.default.compare(data.password, user.passwordHash);
        if (!isValidPassword) {
            throw new types_1.AuthenticationError('Invalid email or password');
        }
        const tokens = this.generateTokens(user.id, user.email);
        await prisma.refreshToken.create({
            data: {
                userId: user.id,
                token: tokens.refreshToken,
                expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
            },
        });
        const oldTokens = await prisma.refreshToken.findMany({
            where: { userId: user.id },
            orderBy: { createdAt: 'desc' },
            skip: 4,
        });
        if (oldTokens.length > 0) {
            await prisma.refreshToken.deleteMany({
                where: {
                    id: { in: oldTokens.map(t => t.id) },
                },
            });
        }
        logger_1.logger.info('User logged in successfully', { userId: user.id, email: user.email });
        return {
            user: {
                id: user.id,
                email: user.email,
                name: user.name,
                timezone: user.timezone,
                settings: user.settings,
                createdAt: user.createdAt,
                updatedAt: user.updatedAt,
            },
            tokens,
        };
    }
    static async refreshToken(refreshToken) {
        const prisma = (0, database_1.getPrismaClient)();
        let decoded;
        try {
            decoded = jsonwebtoken_1.default.verify(refreshToken, process.env.JWT_REFRESH_SECRET);
        }
        catch (error) {
            throw new types_1.AuthenticationError('Invalid refresh token');
        }
        const tokenRecord = await prisma.refreshToken.findUnique({
            where: { token: refreshToken },
            include: { user: true },
        });
        if (!tokenRecord || tokenRecord.expiresAt < new Date()) {
            if (tokenRecord) {
                await prisma.refreshToken.delete({ where: { id: tokenRecord.id } });
            }
            throw new types_1.AuthenticationError('Refresh token expired');
        }
        const tokens = this.generateTokens(tokenRecord.user.id, tokenRecord.user.email);
        await prisma.refreshToken.update({
            where: { id: tokenRecord.id },
            data: {
                token: tokens.refreshToken,
                expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
            },
        });
        logger_1.logger.info('Tokens refreshed successfully', { userId: tokenRecord.user.id });
        return tokens;
    }
    static async logout(refreshToken) {
        const prisma = (0, database_1.getPrismaClient)();
        if (refreshToken) {
            await prisma.refreshToken.deleteMany({
                where: { token: refreshToken },
            });
        }
        logger_1.logger.info('User logged out successfully');
    }
    static async logoutAll(userId) {
        const prisma = (0, database_1.getPrismaClient)();
        await prisma.refreshToken.deleteMany({
            where: { userId },
        });
        logger_1.logger.info('User logged out from all devices', { userId });
    }
    static async changePassword(userId, currentPassword, newPassword) {
        const prisma = (0, database_1.getPrismaClient)();
        const user = await prisma.user.findUnique({
            where: { id: userId },
            select: { passwordHash: true },
        });
        if (!user) {
            throw new types_1.AuthenticationError('User not found');
        }
        const isValidPassword = await bcryptjs_1.default.compare(currentPassword, user.passwordHash);
        if (!isValidPassword) {
            throw new types_1.AuthenticationError('Current password is incorrect');
        }
        const newPasswordHash = await bcryptjs_1.default.hash(newPassword, SALT_ROUNDS);
        await prisma.user.update({
            where: { id: userId },
            data: { passwordHash: newPasswordHash },
        });
        await this.logoutAll(userId);
        logger_1.logger.info('Password changed successfully', { userId });
    }
}
exports.AuthService = AuthService;
//# sourceMappingURL=authService.js.map