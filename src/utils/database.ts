// import { PrismaClient } from '@prisma/client';
// import { logger } from './logger';

// let prisma: PrismaClient;

// export const connectDatabase = async (): Promise<void> => {
//   try {
//     prisma = new PrismaClient({
//       log: [
//         { level: 'query', emit: 'event' },
//         { level: 'error', emit: 'stdout' },
//         { level: 'info', emit: 'stdout' },
//         { level: 'warn', emit: 'stdout' },
//       ],
//     });

//     // Log queries in development
//     if (process.env.NODE_ENV === 'development') {
//       prisma.$on('query', (e) => {
//         logger.debug('Query:', {
//           query: e.query,
//           params: e.params,
//           duration: `${e.duration}ms`,
//         });
//       });
//     }

//     await prisma.$connect();
//     logger.info('Database connected successfully');
//   } catch (error) {
//     logger.error('Failed to connect to database:', error);
//     throw error;
//   }
// };

// export const getPrismaClient = (): PrismaClient => {
//   if (!prisma) {
//     throw new Error('Database not connected. Call connectDatabase() first.');
//   }
//   return prisma;
// };

// export const disconnectDatabase = async (): Promise<void> => {
//   if (prisma) {
//     await prisma.$disconnect();
//     logger.info('Database disconnected');
//   }
// };


import { PrismaClient, Prisma } from '@prisma/client';
import { logger } from './logger';

let prisma: PrismaClient;

export const connectDatabase = async (maxRetries: number = 5, retryDelay: number = 5000): Promise<void> => {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      // Disconnect existing client if it exists (cleanup from previous connections)
      if (prisma) {
        try {
          await prisma.$disconnect();
          logger.info('Disconnected existing Prisma client before reconnecting');
          // Wait a bit for the disconnection to complete
          await new Promise(resolve => setTimeout(resolve, 1000));
        } catch (disconnectError) {
          logger.warn('Error disconnecting existing client:', disconnectError);
        }
      }
      
      // Parse DATABASE_URL and add connection pool parameters if not present
      let databaseUrl = process.env.DATABASE_URL || '';
      
      // Add connection pool parameters to prevent "too many connections" errors
      // Using 1 connection temporarily to minimize connection slot usage
      // PostgreSQL connection pool parameters
      if (databaseUrl && !databaseUrl.includes('connection_limit')) {
        try {
          const url = new URL(databaseUrl);
          url.searchParams.set('connection_limit', '1');
          url.searchParams.set('pool_timeout', '10');
          databaseUrl = url.toString();
          logger.info('Added connection pool parameters to DATABASE_URL (limit: 1)');
        } catch (urlError) {
          // Fallback if URL parsing fails
          const separator = databaseUrl.includes('?') ? '&' : '?';
          databaseUrl = `${databaseUrl}${separator}connection_limit=1&pool_timeout=10`;
          logger.info('Added connection pool parameters to DATABASE_URL (limit: 1, fallback)');
        }
      }

    prisma = new PrismaClient({
      log: [
        { level: 'error', emit: 'stdout' },
        { level: 'warn', emit: 'stdout' },
        // Removed query and info logs to reduce overhead
      ],
      datasources: {
        db: {
          url: databaseUrl,
        },
      },
    });

    if (process.env.NODE_ENV === 'development') {
      (prisma.$on as any)('query', (e: Prisma.QueryEvent) => {
        logger.debug('Query:', {
          query: e.query,
          params: e.params,
          duration: `${e.duration}ms`,
        });
      });
    }

      await prisma.$connect();
      logger.info('Database connected successfully');
      
      // Set up connection error handling
      // Note: Connection pool errors are normal when idle connections are closed
      // Prisma will automatically reconnect, so we log these as warnings in development
      prisma.$on('error' as any, (e: any) => {
        // Connection closed errors are common in connection pools and are handled automatically
        const isConnectionPoolError = 
          e?.message?.includes('connection') && 
          e?.message?.includes('Closed') ||
          e?.kind === 'Closed';
        
        if (isConnectionPoolError) {
          // These are expected - Prisma will reconnect automatically
          // Only log in development for debugging, suppress in production
          if (process.env.NODE_ENV === 'development') {
            logger.debug('Connection pool error (auto-reconnecting):', e);
          }
        } else {
          // Other errors should be logged
          logger.error('Prisma error event:', e);
        }
      });
      
      // Successfully connected, exit retry loop
      return;
    } catch (error: any) {
      const isConnectionLimitError = 
        error?.code === 'P2037' || 
        error?.message?.includes('too many database connections') ||
        error?.message?.includes('connection slots');
      
      if (isConnectionLimitError && attempt < maxRetries) {
        const delay = retryDelay * attempt; // Exponential backoff
        logger.warn(`Database connection limit reached (attempt ${attempt}/${maxRetries}), waiting ${delay}ms before retry...`, {
          error: error.message,
          code: error.code,
        });
        
        // Wait before retrying (connections may timeout and free up slots)
        await new Promise(resolve => setTimeout(resolve, delay));
        continue;
      }
      
      // If not a connection limit error or max retries reached, throw
      logger.error('Failed to connect to database:', error);
      throw error;
    }
  }
};

export const getPrismaClient = (): PrismaClient => {
  if (!prisma) {
    throw new Error('Database not connected. Call connectDatabase() first.');
  }
  
  // Check if connection is still alive, reconnect if needed
  // Note: This is a simple check, Prisma will handle reconnection automatically
  // but we can add retry logic here if needed
  
  return prisma;
};

/**
 * Execute a database operation with automatic retry on connection errors
 */
export async function executeWithRetry<T>(
  operation: () => Promise<T>,
  maxRetries: number = 3,
  retryDelay: number = 1000
): Promise<T> {
  let lastError: any;
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error: any) {
      lastError = error;
      
      // Check if it's a connection error
      const isConnectionError = 
        error?.code === 'P1017' || // Server has closed the connection
        error?.code === 'P1001' || // Can't reach database server
        error?.code === 'P2037' || // Too many database connections
        error?.message?.includes('connection') ||
        error?.message?.includes('closed') ||
        error?.message?.includes('connection slots');
      
      if (isConnectionError && attempt < maxRetries) {
        logger.warn(`Database connection error (attempt ${attempt}/${maxRetries}), retrying...`, {
          error: error.message,
          code: error.code,
        });
        
        // Try to reconnect
        try {
          if (prisma) {
            await prisma.$disconnect();
          }
          await connectDatabase();
        } catch (reconnectError) {
          logger.error('Failed to reconnect to database:', reconnectError);
        }
        
        // Wait before retrying
        await new Promise(resolve => setTimeout(resolve, retryDelay * attempt));
        continue;
      }
      
      // If not a connection error or max retries reached, throw
      throw error;
    }
  }
  
  throw lastError;
}

export const disconnectDatabase = async (): Promise<void> => {
  if (prisma) {
    await prisma.$disconnect();
    logger.info('Database disconnected');
  }
};
