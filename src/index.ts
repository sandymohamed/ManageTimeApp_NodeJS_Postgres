import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import dotenv from 'dotenv';
import { createServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';
import rateLimit from 'express-rate-limit';
console.log(" APP STARTED");


import { errorHandler } from './middleware/errorHandler';
import { logger } from './utils/logger';
import { connectDatabase } from './utils/database';
import { connectRedis } from './utils/redis';
import { initializeQueues } from './services/queueService';

// Routes
import authRoutes from './routes/auth';
import userRoutes from './routes/user';
import projectRoutes from './routes/project';
import taskRoutes from './routes/task';
import goalRoutes from './routes/goal';
import reminderRoutes from './routes/reminder';
import alarmRoutes from './routes/alarm';
import timerRoutes from './routes/timer';
import notificationRoutes from './routes/notification';
import syncRoutes from './routes/sync';
import analyticsRoutes from './routes/analytics';
import aiRoutes from './routes/ai';
import milestoneRoutes from './routes/milestone';
import invitationRoutes from './routes/invitation';
import routineRoutes from './routes/routine';

// Load environment variables
dotenv.config();

const app = express();
const server = createServer(app);
const io = new SocketIOServer(server, {
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

// Rate limiting
const limiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '900000'), // 15 minutes
  max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || '100'),
  message: 'Too many requests from this IP, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
});



// Middleware
app.use(helmet());
app.use(cors({
  origin: process.env.CORS_ORIGIN?.split(',') || [
    'http://localhost:3000',
    'http://192.168.1.13:3000',
    'http://localhost:8081', // React Native Metro bundler
    'http://192.168.1.13:8081'
  ],
  
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
}));
app.use(limiter);
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Health check
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

// API Routes
app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/me', userRoutes);
app.use('/api/v1/projects', projectRoutes);
app.use('/api/v1/tasks', taskRoutes);
app.use('/api/v1/goals', goalRoutes);
app.use('/api/v1/reminders', reminderRoutes);
app.use('/api/v1/alarms', alarmRoutes);
app.use('/api/v1/timers', timerRoutes);
app.use('/api/v1/notifications', notificationRoutes);
app.use('/api/v1/sync', syncRoutes);
app.use('/api/v1/analytics', analyticsRoutes);
app.use('/api/v1/ai', aiRoutes);
app.use('/api/v1/milestones', milestoneRoutes);
app.use('/api/v1/invitations', invitationRoutes);
app.use('/api/v1/routines', routineRoutes);

// WebSocket connection handling
io.on('connection', (socket) => {
  logger.info(`Client connected: ${socket.id}`);

  socket.on('join-project', (projectId: string) => {
    socket.join(`project-${projectId}`);
    logger.info(`Client ${socket.id} joined project ${projectId}`);
  });

  socket.on('leave-project', (projectId: string) => {
    socket.leave(`project-${projectId}`);
    logger.info(`Client ${socket.id} left project ${projectId}`);
  });

  socket.on('disconnect', () => {
    logger.info(`Client disconnected: ${socket.id}`);
  });
});

// Make io available to routes
app.set('io', io);

// Error handling
app.use(errorHandler);

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({ 
    error: 'Route not found',
    path: req.originalUrl 
  });
});


// Initialize services
async function startServer() {
  try {
    // Connect to database
    await connectDatabase();
    logger.info('Database connected successfully');

    // Connect to Redis
    await connectRedis();
    logger.info('Redis connected successfully');

    // Initialize job queues
    await initializeQueues();
    logger.info('Job queues initialized');

    // Start server
    server.listen(Number(PORT), '0.0.0.0', () => {
      logger.info(`Server running on port ${PORT}`);
      logger.info(`Environment: ${process.env.NODE_ENV}`);
      logger.info(`Server accessible at: http://localhost:${PORT} and http://192.168.1.13:${PORT}`);
    });
  } catch (error) {
    logger.error('Failed to start server:', error);
    process.exit(1);
  }
}

// Graceful shutdown
const gracefulShutdown = async (signal: string) => {
  logger.info(`${signal} received, shutting down gracefully`);
  
  // Stop accepting new connections
  server.close(async () => {
    logger.info('HTTP server closed');
    
    // Disconnect from database
    try {
      const { disconnectDatabase } = await import('./utils/database');
      await disconnectDatabase();
      logger.info('Database disconnected');
    } catch (error) {
      logger.error('Error disconnecting database:', error);
    }
    
    // Disconnect from Redis
    try {
      const { disconnectRedis } = await import('./utils/redis');
      await disconnectRedis();
      logger.info('Redis disconnected');
    } catch (error) {
      logger.error('Error disconnecting Redis:', error);
    }
    
    logger.info('Process terminated');
    process.exit(0);
  });
  
  // Force shutdown after 10 seconds
  setTimeout(() => {
    logger.error('Forced shutdown after timeout');
    process.exit(1);
  }, 10000);
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

startServer();
