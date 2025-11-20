export interface SignupData {
    email: string;
    password: string;
    name: string;
    timezone?: string;
}
export interface LoginData {
    email: string;
    password: string;
}
export interface AuthTokens {
    accessToken: string;
    refreshToken: string;
    expiresIn: number;
}
export declare class AuthService {
    private static generateTokens;
    static signup(data: SignupData): Promise<{
        user: any;
        tokens: AuthTokens;
    }>;
    static login(data: LoginData): Promise<{
        user: any;
        tokens: AuthTokens;
    }>;
    static refreshToken(refreshToken: string): Promise<AuthTokens>;
    static logout(refreshToken?: string): Promise<void>;
    static logoutAll(userId: string): Promise<void>;
    static changePassword(userId: string, currentPassword: string, newPassword: string): Promise<void>;
    static requestPasswordReset(email: string): Promise<void>;
    static verifyPasswordResetOTP(email: string, otp: string): Promise<string>;
    static resetPassword(token: string, newPassword: string): Promise<void>;
}
//# sourceMappingURL=authService.d.ts.map