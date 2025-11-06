"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const notificationService_1 = require("../services/notificationService");
const auth_1 = require("../middleware/auth");
const router = (0, express_1.Router)();
router.use(auth_1.authenticateToken);
router.get('/', async (req, res) => {
    try {
        const userId = req.user.id;
        const notifications = await notificationService_1.notificationService.getUserNotifications(userId);
        res.json({
            success: true,
            data: notifications,
        });
    }
    catch (error) {
        console.error('Get notifications error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to get notifications',
            error: error.message,
        });
    }
});
router.get('/unread-count', async (req, res) => {
    try {
        console.log('req.user', req.user);
        const userId = req.user.id;
        console.log('userId', userId);
        const count = await notificationService_1.notificationService.getUnreadNotificationCount(userId);
        res.json({
            success: true,
            data: { count },
        });
    }
    catch (error) {
        console.error('Get unread count error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to get unread count',
            error: error.message,
        });
    }
});
router.put('/:id/read', async (req, res) => {
    try {
        const { id } = req.params;
        await notificationService_1.notificationService.markNotificationAsRead(id);
        res.json({
            success: true,
            message: 'Notification marked as read',
        });
    }
    catch (error) {
        console.error('Mark notification as read error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to mark notification as read',
            error: error.message,
        });
    }
});
router.delete('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        await notificationService_1.notificationService.deleteNotification(id);
        res.json({
            success: true,
            message: 'Notification deleted',
        });
    }
    catch (error) {
        console.error('Delete notification error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to delete notification',
            error: error.message,
        });
    }
});
exports.default = router;
//# sourceMappingURL=notification.js.map