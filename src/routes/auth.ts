import { Router, Request, Response } from 'express';
import Joi from 'joi';
import { AuthService } from '../services/authService';
import { logger } from '../utils/logger';
import { ValidationError } from '../types';

const router = Router();

// Validation schemas
const signupSchema = Joi.object({
  email: Joi.string().email().required(),
  password: Joi.string().min(6).required(),
  name: Joi.string().min(2).max(100).required(),
  timezone: Joi.string().optional(),
});

const loginSchema = Joi.object({
  email: Joi.string().email().required(),
  password: Joi.string().required(),
});

const refreshTokenSchema = Joi.object({
  refreshToken: Joi.string().required(),
});

const optionalRefreshTokenSchema = Joi.object({
  refreshToken: Joi.string().optional(),
});

const changePasswordSchema = Joi.object({
  currentPassword: Joi.string().required(),
  newPassword: Joi.string().min(6).required(),
});

const forgotPasswordSchema = Joi.object({
  email: Joi.string().email().required(),
});

const verifyOTPSchema = Joi.object({
  email: Joi.string().email().required(),
  otp: Joi.string().length(6).pattern(/^\d+$/).required(),
});

const resetPasswordSchema = Joi.object({
  token: Joi.string().uuid().required(),
  newPassword: Joi.string().min(6).required(),
});

// POST /api/v1/auth/signup
router.post('/signup', async (req: Request, res: Response) => {
  try {
    const { error, value } = signupSchema.validate(req.body);
    if (error) {
      throw new ValidationError(error.details[0].message);
    }

    const result = await AuthService.signup(value);
    
    res.status(201).json({
      success: true,
      data: result,
      message: 'User created successfully',
    });
  } catch (error) {
    logger.error('Signup error:', error);
    throw error;
  }
});

// POST /api/v1/auth/login
router.post('/login', async (req: Request, res: Response) => {
  try {
    const { error, value } = loginSchema.validate(req.body);
    if (error) {
      throw new ValidationError(error.details[0].message);
    }

    const result = await AuthService.login(value);
    res.json({
      success: true,
      data: result,
      message: 'Login successful',
    });
  } catch (error) {
    logger.error('Login error:', error);
    throw error;
  }
});

// POST /api/v1/auth/refresh
router.post('/refresh', async (req: Request, res: Response) => {
  try {
    const { error, value } = refreshTokenSchema.validate(req.body);
    if (error) {
      throw new ValidationError(error.details[0].message);
    }

    const tokens = await AuthService.refreshToken(value.refreshToken);
    
    res.json({
      success: true,
      data: tokens,
      message: 'Tokens refreshed successfully',
    });
  } catch (error: any) {
    // Log error with full details
    const statusCode = error.statusCode || 401;
    logger.error('Token refresh error:', {
      message: error.message,
      statusCode,
      stack: error.stack,
      isOperational: error.isOperational,
    });
    
    // Return a proper error response instead of throwing
    res.status(statusCode).json({
      success: false,
      error: error.message || 'Invalid refresh token',
      message: error.message || 'Invalid refresh token',
    });
  }
});

// POST /api/v1/auth/logout
router.post('/logout', async (req: Request, res: Response) => {
  try {
    const { error, value } = optionalRefreshTokenSchema.validate(req.body);
    if (error) {
      throw new ValidationError(error.details[0].message);
    }

    // Only call AuthService.logout if refreshToken is provided
    if (value.refreshToken) {
      await AuthService.logout(value.refreshToken);
    }
    
    res.json({
      success: true,
      message: 'Logout successful',
    });
  } catch (error) {
    logger.error('Logout error:', error);
    throw error;
  }
});

// POST /api/v1/auth/logout-all
router.post('/logout-all', async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.id;
    if (!userId) {
      throw new ValidationError('User not authenticated');
    }

    await AuthService.logoutAll(userId);
    
    res.json({
      success: true,
      message: 'Logged out from all devices',
    });
  } catch (error) {
    logger.error('Logout all error:', error);
    throw error;
  }
});

// POST /api/v1/auth/change-password
router.post('/change-password', async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.id;
    if (!userId) {
      throw new ValidationError('User not authenticated');
    }

    const { error, value } = changePasswordSchema.validate(req.body);
    if (error) {
      throw new ValidationError(error.details[0].message);
    }

    await AuthService.changePassword(
      userId,
      value.currentPassword,
      value.newPassword
    );
    
    res.json({
      success: true,
      message: 'Password changed successfully',
    });
  } catch (error) {
    logger.error('Change password error:', error);
    throw error;
  }
});

// POST /api/v1/auth/forgot-password
router.post('/forgot-password', async (req: Request, res: Response) => {
  try {
    const { error, value } = forgotPasswordSchema.validate(req.body);
    if (error) {
      throw new ValidationError(error.details[0].message);
    }

    await AuthService.requestPasswordReset(value.email);
    
    res.json({
      success: true,
      message: 'If an account with that email exists, an OTP has been sent to your email.',
    });
  } catch (error) {
    logger.error('Forgot password error:', error);
    throw error;
  }
});

// POST /api/v1/auth/verify-otp
router.post('/verify-otp', async (req: Request, res: Response) => {
  try {
    const { error, value } = verifyOTPSchema.validate(req.body);
    if (error) {
      throw new ValidationError(error.details[0].message);
    }

    const token = await AuthService.verifyPasswordResetOTP(value.email, value.otp);
    
    res.json({
      success: true,
      data: { token },
      message: 'OTP verified successfully. You can now reset your password.',
    });
  } catch (error) {
    logger.error('Verify OTP error:', error);
    throw error;
  }
});

// POST /api/v1/auth/reset-password
router.post('/reset-password', async (req: Request, res: Response) => {
  try {
    const { error, value } = resetPasswordSchema.validate(req.body);
    if (error) {
      throw new ValidationError(error.details[0].message);
    }

    await AuthService.resetPassword(value.token, value.newPassword);
    
    res.json({
      success: true,
      message: 'Password reset successfully. Please login with your new password.',
    });
  } catch (error) {
    logger.error('Reset password error:', error);
    throw error;
  }
});

export default router;
