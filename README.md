# Manage Time Backend API

A comprehensive backend API for the Manage Time application, built with Node.js, Express, TypeScript, and PostgreSQL. This API provides robust task management, goal tracking, project collaboration, AI-powered planning, and real-time notifications.

## 🚀 Features

### Core Functionality
- **User Authentication & Authorization** - JWT-based auth with refresh tokens
- **Task Management** - Full CRUD operations with filtering, sorting, and search
- **Project Management** - Collaborative projects with role-based access
- **Goal Tracking** - SMART goals with milestones and progress tracking
- **AI-Powered Planning** - OpenAI integration for intelligent task and goal planning
- **Real-time Notifications** - WebSocket support for live updates
- **Analytics & Insights** - User behavior tracking and productivity metrics
- **Alarm & Reminder System** - Smart notifications with location and time triggers
- **Data Synchronization** - Offline-first architecture with conflict resolution

### Technical Features
- **TypeScript** - Full type safety and modern JavaScript features
- **Prisma ORM** - Type-safe database operations with migrations
- **Redis Caching** - High-performance caching and session management
- **Queue System** - Background job processing with BullMQ
- **Rate Limiting** - API protection against abuse
- **Comprehensive Logging** - Winston-based structured logging
- **Error Handling** - Centralized error management with proper HTTP status codes
- **API Validation** - Joi schema validation for all endpoints
- **Security** - Helmet, CORS, and input sanitization

## 📋 Prerequisites

- **Node.js** >= 18.0.0
- **PostgreSQL** >= 13.0
- **Redis** >= 6.0
- **npm** or **yarn**

## 🛠️ Installation

1. **Clone the repository**
   ```bash
   git clone <repository-url>
   cd manage_time_app/backend
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Environment Setup**

4. **Database Setup**
   ```bash
   # Generate Prisma client
   npm run db:generate
   
   # Run migrations
   npm run db:migrate
   
   # (Optional) Seed database
   npm run db:seed
   ```

5. **Start the server**
   ```bash
   # Development
   npm run dev
   
   # Production
   npm run build
   npm start
   ```

## 🏗️ Project Structure

```
backend/
├── src/
│   ├── index.ts                 # Main server entry point
│   ├── middleware/              # Express middleware
│   │   ├── auth.ts             # JWT authentication
│   │   └── errorHandler.ts     # Global error handling
│   ├── routes/                  # API route handlers
│   │   ├── auth.ts             # Authentication endpoints
│   │   ├── user.ts             # User management
│   │   ├── task.ts             # Task CRUD operations
│   │   ├── project.ts          # Project management
│   │   ├── goal.ts             # Goal tracking
│   │   ├── alarm.ts            # Alarm system
│   │   ├── reminder.ts         # Reminder management
│   │   ├── notification.ts     # Notification system
│   │   ├── sync.ts             # Data synchronization
│   │   ├── analytics.ts        # Analytics and insights
│   │   └── ai.ts               # AI-powered features
│   ├── services/                # Business logic services
│   │   ├── authService.ts      # Authentication logic
│   │   ├── aiService.ts        # OpenAI integration
│   │   └── queueService.ts     # Background job processing
│   ├── types/                   # TypeScript type definitions
│   │   └── index.ts            # Shared types and interfaces
│   └── utils/                   # Utility functions
│       ├── database.ts         # Database connection
│       ├── logger.ts           # Logging configuration
│       └── redis.ts            # Redis connection
├── prisma/
│   ├── schema.prisma           # Database schema
│   └── migrations/             # Database migrations
├── logs/                       # Application logs
├── package.json
├── tsconfig.json
└── README.md
```

## 🗄️ Database Schema

The application uses PostgreSQL with Prisma ORM. Key entities include:

### Core Entities
- **User** - User accounts with authentication and settings
- **Project** - Collaborative workspaces with role-based access
- **Task** - Individual tasks with priorities, status, and metadata
- **Goal** - Long-term objectives with milestones
- **Milestone** - Goal checkpoints with progress tracking

### Supporting Entities
- **Alarm** - Time-based notifications with recurrence
- **Reminder** - Location and time-triggered reminders
- **Notification** - System notifications and alerts
- **AnalyticsEvent** - User behavior tracking
- **RefreshToken** - JWT refresh token management

### Enums
- **TaskPriority**: LOW, MEDIUM, HIGH, URGENT
- **TaskStatus**: TODO, IN_PROGRESS, DONE, ARCHIVED
- **ProjectRole**: OWNER, EDITOR, VIEWER
- **MilestoneStatus**: TODO, IN_PROGRESS, DONE

## 🔌 API Endpoints

### Authentication (`/api/v1/auth`)
- `POST /register` - User registration
- `POST /login` - User login
- `POST /refresh` - Refresh access token
- `POST /logout` - User logout
- `POST /forgot-password` - Password reset request
- `POST /reset-password` - Password reset confirmation
- `POST /change-password` - Change user password

### User Management (`/api/v1/me`)
- `GET /` - Get current user profile
- `PUT /` - Update user profile
- `DELETE /` - Delete user account
- `GET /settings` - Get user settings
- `PUT /settings` - Update user settings

### Task Management (`/api/v1/tasks`)
- `GET /` - List tasks with filtering and pagination
- `POST /` - Create new task
- `GET /:id` - Get task details
- `PUT /:id` - Update task
- `DELETE /:id` - Delete task
- `POST /:id/complete` - Mark task as complete
- `POST /:id/assign` - Assign task to user
- `GET /:id/subtasks` - Get task subtasks
- `POST /:id/subtasks` - Create subtask

### Project Management (`/api/v1/projects`)
- `GET /` - List user projects
- `POST /` - Create new project
- `GET /:id` - Get project details
- `PUT /:id` - Update project
- `DELETE /:id` - Delete project
- `POST /:id/members` - Add project member
- `PUT /:id/members/:userId` - Update member role
- `DELETE /:id/members/:userId` - Remove project member

### Goal Management (`/api/v1/goals`)
- `GET /` - List user goals
- `POST /` - Create new goal
- `GET /:id` - Get goal details
- `PUT /:id` - Update goal
- `DELETE /:id` - Delete goal
- `POST /:id/milestones` - Create milestone
- `PUT /:id/milestones/:milestoneId` - Update milestone
- `DELETE /:id/milestones/:milestoneId` - Delete milestone

### AI Features (`/api/v1/ai`)
- `POST /generate-plan` - Generate AI-powered goal plan
- `POST /suggest-tasks` - Get AI task suggestions
- `POST /optimize-schedule` - Optimize task scheduling
- `POST /analyze-productivity` - Analyze user productivity patterns

### Analytics (`/api/v1/analytics`)
- `GET /dashboard` - Get productivity dashboard data
- `GET /productivity` - Get productivity metrics
- `GET /goals-progress` - Get goals progress analytics
- `GET /time-tracking` - Get time tracking data

### Notifications (`/api/v1/notifications`)
- `GET /` - List user notifications
- `PUT /:id/read` - Mark notification as read
- `PUT /:id/unread` - Mark notification as unread
- `DELETE /:id` - Delete notification

### Sync (`/api/v1/sync`)
- `POST /upload` - Upload local changes
- `GET /download` - Download server changes
- `POST /resolve-conflicts` - Resolve sync conflicts

## 🔧 Development

### Available Scripts
```bash
# Development
npm run dev              # Start development server with hot reload
npm run build            # Build TypeScript to JavaScript
npm start                # Start production server

# Database
npm run db:migrate       # Run database migrations
npm run db:generate      # Generate Prisma client
npm run db:studio        # Open Prisma Studio
npm run db:seed          # Seed database with sample data
npm run db:reset         # Reset database (WARNING: deletes all data)

# Testing
npm test                 # Run test suite
npm run test:watch       # Run tests in watch mode
npm run test:coverage    # Run tests with coverage report

# Code Quality
npm run lint             # Run ESLint
npm run lint:fix         # Fix ESLint issues automatically
```

### Database Migrations
```bash
# Create a new migration
npx prisma migrate dev --name migration_name

# Apply migrations to production
npx prisma migrate deploy

# Reset database (development only)
npx prisma migrate reset
```

### Environment Variables
| Variable | Description | Required | Default |
|----------|-------------|----------|---------|
| `DATABASE_URL` | PostgreSQL connection string | Yes | - |
| `REDIS_URL` | Redis connection string | Yes | - |
| `JWT_SECRET` | JWT signing secret | Yes | - |
| `JWT_REFRESH_SECRET` | JWT refresh token secret | Yes | - |
| `OPENAI_API_KEY` | OpenAI API key for AI features | No | - |
| `PORT` | Server port | No | 3000 |
| `NODE_ENV` | Environment mode | No | development |
| `CORS_ORIGIN` | Allowed CORS origins | No | http://localhost:3000 |

## 🔒 Security

### Authentication
- JWT-based authentication with access and refresh tokens
- Password hashing using bcryptjs
- Token expiration and refresh mechanism
- Secure cookie handling

### Authorization
- Role-based access control for projects
- Resource ownership validation
- API endpoint protection

### Security Headers
- Helmet.js for security headers
- CORS configuration
- Rate limiting to prevent abuse
- Input validation and sanitization

## 📊 Monitoring & Logging

### Logging
- Winston-based structured logging
- Log levels: error, warn, info, debug
- Separate log files for different levels
- Request/response logging middleware

### Health Checks
- `/health` endpoint for server status
- Database connection monitoring
- Redis connection monitoring

## 🚀 Deployment

### Production Build
```bash
npm run build
npm start
```

### Docker Deployment
```dockerfile
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY dist ./dist
EXPOSE 3000
CMD ["npm", "start"]
```

### Environment Setup
1. Set up PostgreSQL database
2. Set up Redis instance
3. Configure environment variables
4. Run database migrations
5. Start the application

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add some amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

### Code Style
- Follow TypeScript best practices
- Use ESLint configuration provided
- Write comprehensive tests
- Document new features

## 📝 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🆘 Support

For support and questions:
- Create an issue in the repository
- Check the documentation
- Review the API documentation

## 🔄 Changelog

### Version 1.0.0
- Initial release
- Core task management functionality
- User authentication and authorization
- Project collaboration features
- AI-powered planning
- Real-time notifications
- Analytics and insights
- Comprehensive API documentation

---

