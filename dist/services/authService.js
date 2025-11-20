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
exports.AuthService = void 0;
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const uuid_1 = require("uuid");
const database_1 = require("../utils/database");
const logger_1 = require("../utils/logger");
const types_1 = require("../types");
const SALT_ROUNDS = 12;
class AuthService {
    static generateTokens(userId, email) {
        const accessToken = jsonwebtoken_1.default.sign({ userId, email }, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRES_IN || '15m' });
        const refreshToken = jsonwebtoken_1.default.sign({ userId, email, type: 'refresh' }, process.env.JWT_REFRESH_SECRET, { expiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '36500d' });
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
        const farFutureDate = new Date();
        farFutureDate.setFullYear(farFutureDate.getFullYear() + 100);
        await prisma.refreshToken.create({
            data: {
                userId: user.id,
                token: tokens.refreshToken,
                expiresAt: farFutureDate,
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
        const farFutureDate = new Date();
        farFutureDate.setFullYear(farFutureDate.getFullYear() + 100);
        await prisma.refreshToken.create({
            data: {
                userId: user.id,
                token: tokens.refreshToken,
                expiresAt: farFutureDate,
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
        const tokenRecord = await prisma.refreshToken.findUnique({
            where: { token: refreshToken },
            include: { user: true },
        });
        if (!tokenRecord) {
            logger_1.logger.warn('Refresh token not found in database', { token: refreshToken.substring(0, 20) + '...' });
            throw new types_1.AuthenticationError('Invalid refresh token');
        }
        if (tokenRecord.expiresAt && tokenRecord.expiresAt < new Date()) {
            await prisma.refreshToken.delete({ where: { id: tokenRecord.id } });
            logger_1.logger.warn('Refresh token expired in database', {
                tokenId: tokenRecord.id,
                expiresAt: tokenRecord.expiresAt,
                now: new Date()
            });
            throw new types_1.AuthenticationError('Refresh token expired');
        }
        try {
            jsonwebtoken_1.default.verify(refreshToken, process.env.JWT_REFRESH_SECRET, {
                ignoreExpiration: true,
            });
        }
        catch (error) {
            if (error.name === 'JsonWebTokenError' || error.name === 'TokenExpiredError') {
                logger_1.logger.warn('Refresh token JWT verification failed', {
                    error: error.name,
                    message: error.message,
                    tokenId: tokenRecord.id
                });
                await prisma.refreshToken.delete({ where: { id: tokenRecord.id } });
                throw new types_1.AuthenticationError('Invalid refresh token');
            }
            throw error;
        }
        const tokens = this.generateTokens(tokenRecord.user.id, tokenRecord.user.email);
        const farFutureDate = new Date();
        farFutureDate.setFullYear(farFutureDate.getFullYear() + 100);
        await prisma.refreshToken.update({
            where: { id: tokenRecord.id },
            data: {
                token: tokens.refreshToken,
                expiresAt: farFutureDate,
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
    static async requestPasswordReset(email) {
        const prisma = (0, database_1.getPrismaClient)();
        const { emailService } = await Promise.resolve().then(() => __importStar(require('./emailService')));
        const user = await prisma.user.findUnique({
            where: { email },
            select: { id: true, email: true, name: true },
        });
        if (!user) {
            logger_1.logger.warn('Password reset requested for non-existent email', { email });
            return;
        }
        const otp = Math.floor(100000 + Math.random() * 900000).toString();
        const resetToken = (0, uuid_1.v4)();
        const expiresAt = new Date();
        expiresAt.setMinutes(expiresAt.getMinutes() + 10);
        await prisma.passwordResetToken.deleteMany({
            where: { userId: user.id },
        });
        await prisma.passwordResetToken.create({
            data: {
                userId: user.id,
                email: user.email,
                otp,
                token: resetToken,
                expiresAt,
            },
        });
        await emailService.sendPasswordResetOTP({
            email: user.email,
            otp,
            name: user.name || undefined,
        });
        logger_1.logger.info('Password reset OTP sent', { userId: user.id, email });
    }
    static async verifyPasswordResetOTP(email, otp) {
        const prisma = (0, database_1.getPrismaClient)();
        const user = await prisma.user.findUnique({
            where: { email },
            select: { id: true },
        });
        if (!user) {
            throw new types_1.AuthenticationError('Invalid OTP');
        }
        const resetToken = await prisma.passwordResetToken.findFirst({
            where: {
                userId: user.id,
                email,
                otp,
                expiresAt: { gt: new Date() },
                verified: false,
            },
            orderBy: { createdAt: 'desc' },
        });
        if (!resetToken) {
            throw new types_1.AuthenticationError('Invalid or expired OTP');
        }
        await prisma.passwordResetToken.update({
            where: { id: resetToken.id },
            data: { verified: true },
        });
        logger_1.logger.info('Password reset OTP verified', { userId: user.id });
        return resetToken.token;
    }
    static async resetPassword(token, newPassword) {
        const prisma = (0, database_1.getPrismaClient)();
        const resetToken = await prisma.passwordResetToken.findUnique({
            where: { token },
            include: { user: true },
        });
        if (!resetToken || !resetToken.verified || resetToken.expiresAt < new Date()) {
            throw new types_1.AuthenticationError('Invalid or expired reset token');
        }
        const newPasswordHash = await bcryptjs_1.default.hash(newPassword, SALT_ROUNDS);
        await prisma.user.update({
            where: { id: resetToken.userId },
            data: { passwordHash: newPasswordHash },
        });
        await prisma.passwordResetToken.deleteMany({
            where: { userId: resetToken.userId },
        });
        await this.logoutAll(resetToken.userId);
        logger_1.logger.info('Password reset successfully', { userId: resetToken.userId });
    }
}
exports.AuthService = AuthService;
//# sourceMappingURL=authService.js.map