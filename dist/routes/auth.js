"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const joi_1 = __importDefault(require("joi"));
const authService_1 = require("../services/authService");
const logger_1 = require("../utils/logger");
const types_1 = require("../types");
const router = (0, express_1.Router)();
const signupSchema = joi_1.default.object({
    email: joi_1.default.string().email().required(),
    password: joi_1.default.string().min(8).required(),
    name: joi_1.default.string().min(2).max(100).required(),
    timezone: joi_1.default.string().optional(),
});
const loginSchema = joi_1.default.object({
    email: joi_1.default.string().email().required(),
    password: joi_1.default.string().required(),
});
const refreshTokenSchema = joi_1.default.object({
    refreshToken: joi_1.default.string().required(),
});
const optionalRefreshTokenSchema = joi_1.default.object({
    refreshToken: joi_1.default.string().optional(),
});
const changePasswordSchema = joi_1.default.object({
    currentPassword: joi_1.default.string().required(),
    newPassword: joi_1.default.string().min(8).required(),
});
router.post('/signup', async (req, res) => {
    try {
        const { error, value } = signupSchema.validate(req.body);
        if (error) {
            throw new types_1.ValidationError(error.details[0].message);
        }
        const result = await authService_1.AuthService.signup(value);
        res.status(201).json({
            success: true,
            data: result,
            message: 'User created successfully',
        });
    }
    catch (error) {
        logger_1.logger.error('Signup error:', error);
        throw error;
    }
});
router.post('/login', async (req, res) => {
    try {
        const { error, value } = loginSchema.validate(req.body);
        console.log('🔍 Login request:', value);
        console.log('🔍 Login request   error:', error);
        if (error) {
            throw new types_1.ValidationError(error.details[0].message);
        }
        const result = await authService_1.AuthService.login(value);
        console.log('🔍 Login result:', result);
        res.json({
            success: true,
            data: result,
            message: 'Login successful',
        });
    }
    catch (error) {
        logger_1.logger.error('Login error:', error);
        throw error;
    }
});
router.post('/refresh', async (req, res) => {
    try {
        const { error, value } = refreshTokenSchema.validate(req.body);
        if (error) {
            throw new types_1.ValidationError(error.details[0].message);
        }
        const tokens = await authService_1.AuthService.refreshToken(value.refreshToken);
        res.json({
            success: true,
            data: tokens,
            message: 'Tokens refreshed successfully',
        });
    }
    catch (error) {
        logger_1.logger.error('Token refresh error:', error);
        throw error;
    }
});
router.post('/logout', async (req, res) => {
    try {
        const { error, value } = optionalRefreshTokenSchema.validate(req.body);
        if (error) {
            throw new types_1.ValidationError(error.details[0].message);
        }
        if (value.refreshToken) {
            await authService_1.AuthService.logout(value.refreshToken);
        }
        res.json({
            success: true,
            message: 'Logout successful',
        });
    }
    catch (error) {
        logger_1.logger.error('Logout error:', error);
        throw error;
    }
});
router.post('/logout-all', async (req, res) => {
    try {
        const userId = req.user?.id;
        if (!userId) {
            throw new types_1.ValidationError('User not authenticated');
        }
        await authService_1.AuthService.logoutAll(userId);
        res.json({
            success: true,
            message: 'Logged out from all devices',
        });
    }
    catch (error) {
        logger_1.logger.error('Logout all error:', error);
        throw error;
    }
});
router.post('/change-password', async (req, res) => {
    try {
        const userId = req.user?.id;
        if (!userId) {
            throw new types_1.ValidationError('User not authenticated');
        }
        const { error, value } = changePasswordSchema.validate(req.body);
        if (error) {
            throw new types_1.ValidationError(error.details[0].message);
        }
        await authService_1.AuthService.changePassword(userId, value.currentPassword, value.newPassword);
        res.json({
            success: true,
            message: 'Password changed successfully',
        });
    }
    catch (error) {
        logger_1.logger.error('Change password error:', error);
        throw error;
    }
});
exports.default = router;
//# sourceMappingURL=auth.js.map