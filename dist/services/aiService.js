"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.aiService = void 0;
const openai_1 = __importDefault(require("openai"));
const logger_1 = require("../utils/logger");
class AIService {
    constructor() {
        this.openai = new openai_1.default({
            apiKey: process.env.OPENAI_API_KEY,
        });
    }
    static getInstance() {
        if (!AIService.instance) {
            AIService.instance = new AIService();
        }
        return AIService.instance;
    }
    async generatePlan(goalTitle, goalDescription, targetDate, options = {}) {
        try {
            const { intensity = 'medium', weeklyHours = 10, language = 'en', tone = 'supportive', } = options;
            const prompt = this.buildPrompt(goalTitle, goalDescription, targetDate, {
                intensity,
                weeklyHours,
                language,
                tone,
            });
            const response = await this.openai.chat.completions.create({
                model: 'gpt-4',
                messages: [
                    {
                        role: 'system',
                        content: this.getSystemPrompt(language),
                    },
                    {
                        role: 'user',
                        content: prompt,
                    },
                ],
                temperature: 0.7,
                max_tokens: 2000,
            });
            const content = response.choices[0]?.message?.content;
            if (!content) {
                throw new Error('No response from OpenAI');
            }
            return this.parseResponse(content);
        }
        catch (error) {
            logger_1.logger.error('Failed to generate AI plan:', error);
            throw error;
        }
    }
    buildPrompt(goalTitle, goalDescription, targetDate, options) {
        const { intensity, weeklyHours, language, tone } = options;
        if (language === 'ar') {
            return `
الهدف: "${goalTitle}"
الوصف: "${goalDescription}"
التاريخ المستهدف: ${targetDate}
الكثافة: ${intensity}
الساعات الأسبوعية: ${weeklyHours}
النبرة: ${tone}

يرجى إنشاء خطة مفصلة لتحقيق هذا الهدف مع:
- معالم واضحة وقابلة للقياس
- مهام عملية ومحددة
- جدول زمني واقعي
- تذكيرات مناسبة
- ملاحظات مفيدة

تأكد من أن الخطة مناسبة للمستوى المطلوب والوقت المتاح.
      `.trim();
        }
        return `
Goal: "${goalTitle}"
Description: "${goalDescription}"
Target Date: ${targetDate}
Intensity: ${intensity}
Weekly Hours: ${weeklyHours}
Tone: ${tone}

Please create a detailed plan to achieve this goal with:
- Clear, measurable milestones
- Practical, specific tasks
- Realistic timeline
- Appropriate reminders
- Helpful notes

Make sure the plan is suitable for the requested level and available time.
    `.trim();
    }
    getSystemPrompt(language) {
        if (language === 'ar') {
            return `
أنت خبير في التخطيط الشخصي والمهني. مهمتك هي تحويل الأهداف إلى خطط عمل مفصلة ومنظمة.

يجب أن ترد دائماً بصيغة JSON صالحة مع المفاتيح التالية:
- "milestones": مصفوفة من المعالم مع {title, duration_days, description, tasks}
- "tasks": مصفوفة مسطحة من المهام مع {title, milestone_index, due_offset_days, duration_minutes, recurrence, description}
- "notes": نص مفيد إضافي

قواعد مهمة:
1. اجعل المهام عملية وقابلة للتنفيذ
2. استخدم فترات زمنية واقعية
3. رتب المهام بترتيب منطقي
4. أضف تذكيرات مناسبة للمهام المهمة
5. استخدم نبرة داعمة ومحفزة
6. تأكد من أن الخطة قابلة للتحقيق في الوقت المحدد
      `.trim();
        }
        return `
You are an expert personal and professional planner. Your task is to convert goals into detailed, structured action plans.

You must always respond with valid JSON format containing these keys:
- "milestones": array of milestones with {title, duration_days, description, tasks}
- "tasks": flattened array of tasks with {title, milestone_index, due_offset_days, duration_minutes, recurrence, description}
- "notes": additional helpful text

Important rules:
1. Make tasks practical and actionable
2. Use realistic timeframes
3. Order tasks in logical sequence
4. Add appropriate reminders for important tasks
5. Use supportive and motivating tone
6. Ensure the plan is achievable within the given timeframe
    `.trim();
    }
    parseResponse(content) {
        try {
            const jsonMatch = content.match(/\{[\s\S]*\}/);
            if (!jsonMatch) {
                throw new Error('No JSON found in response');
            }
            const jsonString = jsonMatch[0];
            const parsed = JSON.parse(jsonString);
            const plan = {
                milestones: this.validateMilestones(parsed.milestones || []),
                tasks: this.validateTasks(parsed.tasks || []),
                notes: parsed.notes || '',
            };
            return plan;
        }
        catch (error) {
            logger_1.logger.error('Failed to parse AI response:', error);
            throw new Error('Invalid response format from AI');
        }
    }
    validateMilestones(milestones) {
        return milestones.map((milestone, index) => ({
            title: milestone.title || `Milestone ${index + 1}`,
            durationDays: Math.max(1, parseInt(milestone.duration_days) || 7),
            description: milestone.description || '',
            tasks: milestone.tasks || [],
        }));
    }
    validateTasks(tasks) {
        return tasks.map((task, index) => ({
            title: task.title || `Task ${index + 1}`,
            milestoneIndex: Math.max(0, parseInt(task.milestone_index) || 0),
            dueOffsetDays: Math.max(0, parseInt(task.due_offset_days) || 1),
            durationMinutes: Math.max(15, parseInt(task.duration_minutes) || 60),
            recurrence: task.recurrence || null,
            description: task.description || '',
        }));
    }
    async generateSimplePlan(goalTitle) {
        return {
            milestones: [
                {
                    title: 'Getting Started',
                    durationDays: 7,
                    description: 'Initial setup and planning phase',
                    tasks: ['Research and gather information', 'Set up tools and resources'],
                },
                {
                    title: 'Core Development',
                    durationDays: 21,
                    description: 'Main work phase',
                    tasks: ['Implement core features', 'Test and iterate'],
                },
                {
                    title: 'Finalization',
                    durationDays: 7,
                    description: 'Completion and review',
                    tasks: ['Final testing', 'Documentation', 'Deployment'],
                },
            ],
            tasks: [
                {
                    title: 'Research and gather information',
                    milestoneIndex: 0,
                    dueOffsetDays: 1,
                    durationMinutes: 120,
                    recurrence: undefined,
                    description: 'Spend time researching the topic thoroughly',
                },
                {
                    title: 'Set up tools and resources',
                    milestoneIndex: 0,
                    dueOffsetDays: 3,
                    durationMinutes: 90,
                    recurrence: undefined,
                    description: 'Prepare all necessary tools and resources',
                },
                {
                    title: 'Implement core features',
                    milestoneIndex: 1,
                    dueOffsetDays: 1,
                    durationMinutes: 180,
                    recurrence: 'RRULE:FREQ=DAILY;COUNT=14',
                    description: 'Work on the main features daily',
                },
                {
                    title: 'Test and iterate',
                    milestoneIndex: 1,
                    dueOffsetDays: 15,
                    durationMinutes: 120,
                    recurrence: 'RRULE:FREQ=WEEKLY;COUNT=3',
                    description: 'Regular testing and improvement cycles',
                },
                {
                    title: 'Final testing',
                    milestoneIndex: 2,
                    dueOffsetDays: 1,
                    durationMinutes: 240,
                    recurrence: undefined,
                    description: 'Comprehensive final testing',
                },
                {
                    title: 'Documentation',
                    milestoneIndex: 2,
                    dueOffsetDays: 3,
                    durationMinutes: 120,
                    recurrence: undefined,
                    description: 'Create comprehensive documentation',
                },
                {
                    title: 'Deployment',
                    milestoneIndex: 2,
                    dueOffsetDays: 5,
                    durationMinutes: 90,
                    recurrence: undefined,
                    description: 'Deploy the final solution',
                },
            ],
            notes: 'This is a sample plan. Adjust the timeline and tasks based on your specific needs and available time.',
        };
    }
}
exports.aiService = AIService.getInstance();
//# sourceMappingURL=aiService.js.map