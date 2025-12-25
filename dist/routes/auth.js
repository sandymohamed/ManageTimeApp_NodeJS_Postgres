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
    password: joi_1.default.string().min(6).required(),
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
    newPassword: joi_1.default.string().min(6).required(),
});
const forgotPasswordSchema = joi_1.default.object({
    email: joi_1.default.string().email().required(),
});
const verifyOTPSchema = joi_1.default.object({
    email: joi_1.default.string().email().required(),
    otp: joi_1.default.string().length(6).pattern(/^\d+$/).required(),
});
const resetPasswordSchema = joi_1.default.object({
    token: joi_1.default.string().uuid().required(),
    newPassword: joi_1.default.string().min(6).required(),
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
        if (error) {
            throw new types_1.ValidationError(error.details[0].message);
        }
        const result = await authService_1.AuthService.login(value);
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
        const statusCode = error.statusCode || 401;
        logger_1.logger.error('Token refresh error:', {
            message: error.message,
            statusCode,
            stack: error.stack,
            isOperational: error.isOperational,
        });
        res.status(statusCode).json({
            success: false,
            error: error.message || 'Invalid refresh token',
            message: error.message || 'Invalid refresh token',
        });
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
router.post('/forgot-password', async (req, res) => {
    try {
        const { error, value } = forgotPasswordSchema.validate(req.body);
        if (error) {
            throw new types_1.ValidationError(error.details[0].message);
        }
        await authService_1.AuthService.requestPasswordReset(value.email);
        res.json({
            success: true,
            message: 'If an account with that email exists, an OTP has been sent to your email.',
        });
    }
    catch (error) {
        logger_1.logger.error('Forgot password error:', error);
        throw error;
    }
});
router.post('/verify-otp', async (req, res) => {
    try {
        const { error, value } = verifyOTPSchema.validate(req.body);
        if (error) {
            throw new types_1.ValidationError(error.details[0].message);
        }
        const token = await authService_1.AuthService.verifyPasswordResetOTP(value.email, value.otp);
        res.json({
            success: true,
            data: { token },
            message: 'OTP verified successfully. You can now reset your password.',
        });
    }
    catch (error) {
        logger_1.logger.error('Verify OTP error:', error);
        throw error;
    }
});
router.post('/reset-password', async (req, res) => {
    try {
        const { error, value } = resetPasswordSchema.validate(req.body);
        if (error) {
            throw new types_1.ValidationError(error.details[0].message);
        }
        await authService_1.AuthService.resetPassword(value.token, value.newPassword);
        res.json({
            success: true,
            message: 'Password reset successfully. Please login with your new password.',
        });
    }
    catch (error) {
        logger_1.logger.error('Reset password error:', error);
        throw error;
    }
});
exports.default = router;
//# sourceMappingURL=auth.js.map