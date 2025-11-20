import { GeneratedPlan } from '../types';
declare class AIService {
    private static instance;
    private openai;
    private model;
    constructor();
    static getInstance(): AIService;
    generatePlan(goalTitle: string, goalDescription: string, targetDate: string, options?: {
        intensity?: 'low' | 'medium' | 'high';
        weeklyHours?: number;
        language?: 'en' | 'ar';
        tone?: 'supportive' | 'professional' | 'casual';
    }): Promise<GeneratedPlan>;
    private buildPrompt;
    private getSystemPrompt;
    private parseResponse;
    private validateMilestones;
    private validateTasks;
    generateSimplePlan(_goalTitle: string): Promise<GeneratedPlan>;
}
export declare const aiService: AIService;
export {};
//# sourceMappingURL=aiService.d.ts.map