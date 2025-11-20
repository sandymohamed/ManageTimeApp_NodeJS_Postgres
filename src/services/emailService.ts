import nodemailer from 'nodemailer';
import { logger } from '../utils/logger';

interface EmailOptions {
  to: string;
  subject: string;
  html: string;
  text?: string;
}

interface ProjectInvitationNotificationData {
  email: string;
  inviterName: string;
  projectName: string;
  projectDescription?: string;
  role: string;
  expiresAt: string;
}

class EmailService {
  private transporter: nodemailer.Transporter;

  constructor() {
    // Check if email is configured
    if (!process.env.SMTP_USER || !process.env.SMTP_PASS) {
      logger.warn('Email service not configured. SMTP_USER and SMTP_PASS environment variables are required.');
      this.transporter = null as any;
      return;
    }

    // Configure email transporter
    this.transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST || 'smtp.gmail.com',
      port: parseInt(process.env.SMTP_PORT || '587'),
      secure: process.env.SMTP_SECURE === 'true', // true for 465, false for other ports
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
      tls: {
        rejectUnauthorized: false, // Allow self-signed certificates
      },
    });
  }

  async sendEmail(options: EmailOptions): Promise<boolean> {
    try {
      if (!this.transporter) {
        logger.warn('Email service not configured. Skipping email send.', { to: options.to, subject: options.subject });
        return false;
      }

      const mailOptions = {
        from: `"${process.env.APP_NAME || 'Manage Time App'}" <${process.env.SMTP_FROM || process.env.SMTP_USER}>`,
        to: options.to,
        subject: options.subject,
        html: options.html,
        text: options.text,
      };

      const result = await this.transporter.sendMail(mailOptions);
      logger.info('Email sent successfully', { messageId: result.messageId, to: options.to });
      return true;
    } catch (error) {
      logger.error('Failed to send email:', error);
      return false;
    }
  }

  async sendProjectInvitationNotification(data: ProjectInvitationNotificationData): Promise<boolean> {
    const { email, inviterName, projectName, projectDescription, role, expiresAt } = data;

    const subject = `New project invitation: "${projectName}"`;
    logger.info("Sending invitation notification", { email, projectName });
    
    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Project Invitation</title>
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
          .content { background: #f9f9f9; padding: 30px; border-radius: 0 0 10px 10px; }
          .project-card { background: white; padding: 20px; border-radius: 8px; margin: 20px 0; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
          .role-badge { display: inline-block; background: #667eea; color: white; padding: 4px 12px; border-radius: 20px; font-size: 12px; font-weight: bold; text-transform: uppercase; }
          .button { 
            display: inline-block; 
            background: #667eea; 
            color: white !important; 
            padding: 15px 35px; 
            text-decoration: none !important; 
            border-radius: 8px; 
            font-weight: bold; 
            margin: 20px 0; 
            font-size: 16px;
            border: none;
            cursor: pointer;
            box-shadow: 0 2px 4px rgba(102, 126, 234, 0.3);
            transition: all 0.2s ease;
          }
          .button:hover { 
            background: #5a6fd8 !important; 
            text-decoration: none !important;
            box-shadow: 0 4px 8px rgba(102, 126, 234, 0.4);
          }
          .button:active { 
            background: #4c63d2 !important; 
            text-decoration: none !important;
          }
          .button:visited { 
            color: white !important; 
            text-decoration: none !important; 
          }
          .button:link { 
            color: white !important; 
            text-decoration: none !important; 
          }
          .footer { text-align: center; margin-top: 30px; color: #666; font-size: 12px; }
          .expires { background: #fff3cd; border: 1px solid #ffeaa7; padding: 10px; border-radius: 5px; margin: 15px 0; }
        </style>
      </head>
      <body>
        <div class="header">
          <h1>🔔 New Project Invitation</h1>
          <p>You have a new project invitation waiting for you!</p>
        </div>
        
        <div class="content">
          <h2>Hello!</h2>
          <p><strong>${inviterName}</strong> has invited you to join the project:</p>
          
          <div class="project-card">
            <h3 style="margin-top: 0; color: #667eea;">${projectName}</h3>
            ${projectDescription ? `<p style="color: #666;">${projectDescription}</p>` : ''}
            <p><strong>Your role:</strong> <span class="role-badge">${role}</span></p>
          </div>
          
          <div class="expires">
            <strong>⏰ This invitation expires on:</strong> ${expiresAt}
          </div>
          
          <div style="text-align: center; margin: 30px 0; padding: 20px; background: #f8f9fa; border-radius: 8px;">
            <h3 style="color: #667eea; margin-bottom: 15px;">📱 How to Accept</h3>
            <p style="color: #666; font-size: 16px; line-height: 1.5;">
              <strong>1.</strong> Open the Manage Time App<br>
              <strong>2.</strong> Go to Profile Settings<br>
              <strong>3.</strong> Tap on "Project Invitations"<br>
              <strong>4.</strong> Review and accept or decline the invitation
            </p>
          </div>
          
          <div style="text-align: center; margin: 20px 0;">
            <p style="color: #666; font-size: 14px;">
              <strong>💡 Tip:</strong> You can also check your notifications in the app for quick access to pending invitations.
            </p>
          </div>
        </div>
        
        <div class="footer">
          <p>This invitation was sent by Manage Time App</p>
          <p>If you didn't expect this invitation, you can safely ignore this email.</p>
        </div>
      </body>
      </html>
    `;

    const text = `
Project Invitation

Hello!

${inviterName} has invited you to join the project: ${projectName}

${projectDescription ? `Description: ${projectDescription}` : ''}
Your role: ${role}

This invitation expires on: ${expiresAt}

To accept this invitation, please open the Manage Time App and go to Profile Settings > Project Invitations.

If you didn't expect this invitation, you can safely ignore this email.

---
Manage Time App
    `;

    return await this.sendEmail({
      to: data.email, // Use the actual email address
      subject,
      html,
      text,
    });
  }

  async sendInvitationAcceptedNotification(data: {
    inviterEmail: string;
    inviterName: string;
    projectName: string;
    acceptedBy: string;
  }): Promise<boolean> {
    const { inviterEmail, projectName, acceptedBy } = data;

    const subject = `Invitation accepted for "${projectName}" project`;
    
    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Invitation Accepted</title>
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background: linear-gradient(135deg, #28a745 0%, #20c997 100%); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
          .content { background: #f9f9f9; padding: 30px; border-radius: 0 0 10px 10px; }
          .success-card { background: white; padding: 20px; border-radius: 8px; margin: 20px 0; box-shadow: 0 2px 4px rgba(0,0,0,0.1); border-left: 4px solid #28a745; }
        </style>
      </head>
      <body>
        <div class="header">
          <h1>✅ Invitation Accepted</h1>
        </div>
        
        <div class="content">
          <h2>Great news!</h2>
          
          <div class="success-card">
            <p><strong>${acceptedBy}</strong> has accepted your invitation to join the project:</p>
            <h3 style="color: #28a745; margin-top: 15px;">${projectName}</h3>
            <p>They can now start collaborating on the project!</p>
          </div>
        </div>
      </body>
      </html>
    `;

    return await this.sendEmail({
      to: inviterEmail,
      subject,
      html,
    });
  }

  async sendInvitationDeclinedNotification(data: {
    inviterEmail: string;
    inviterName: string;
    projectName: string;
    declinedBy: string;
  }): Promise<boolean> {
    const { inviterEmail, projectName, declinedBy } = data;

    const subject = `Invitation declined for "${projectName}" project`;
    
    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Invitation Declined</title>
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background: linear-gradient(135deg, #dc3545 0%, #fd7e14 100%); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
          .content { background: #f9f9f9; padding: 30px; border-radius: 0 0 10px 10px; }
          .info-card { background: white; padding: 20px; border-radius: 8px; margin: 20px 0; box-shadow: 0 2px 4px rgba(0,0,0,0.1); border-left: 4px solid #dc3545; }
        </style>
      </head>
      <body>
        <div class="header">
          <h1>❌ Invitation Declined</h1>
        </div>
        
        <div class="content">
          <h2>Invitation Update</h2>
          
          <div class="info-card">
            <p><strong>${declinedBy}</strong> has declined your invitation to join the project:</p>
            <h3 style="color: #dc3545; margin-top: 15px;">${projectName}</h3>
            <p>You can try inviting them again later or invite someone else.</p>
          </div>
        </div>
      </body>
      </html>
    `;

    return await this.sendEmail({
      to: inviterEmail,
      subject,
      html,
    });
  }

  async sendPasswordResetOTP(data: {
    email: string;
    otp: string;
    name?: string;
  }): Promise<boolean> {
    const { email, otp, name } = data;

    const subject = 'Password Reset - OTP Code';
    
    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Password Reset OTP</title>
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
          .content { background: #f9f9f9; padding: 30px; border-radius: 0 0 10px 10px; }
          .otp-box { background: white; padding: 30px; border-radius: 8px; margin: 20px 0; text-align: center; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
          .otp-code { font-size: 36px; font-weight: bold; color: #667eea; letter-spacing: 8px; margin: 20px 0; font-family: 'Courier New', monospace; }
          .warning { background: #fff3cd; border: 1px solid #ffeaa7; padding: 15px; border-radius: 5px; margin: 20px 0; }
          .footer { text-align: center; margin-top: 30px; color: #666; font-size: 12px; }
        </style>
      </head>
      <body>
        <div class="header">
          <h1>🔐 Password Reset</h1>
          <p>Your OTP code is ready</p>
        </div>
        
        <div class="content">
          <h2>Hello${name ? ` ${name}` : ''}!</h2>
          <p>You requested to reset your password. Use the OTP code below to verify your identity:</p>
          
          <div class="otp-box">
            <p style="margin: 0 0 10px 0; color: #666; font-size: 14px;">Your OTP Code:</p>
            <div class="otp-code">${otp}</div>
            <p style="margin: 10px 0 0 0; color: #666; font-size: 12px;">This code expires in 10 minutes</p>
          </div>
          
          <div class="warning">
            <strong>⚠️ Security Notice:</strong> If you didn't request this password reset, please ignore this email. Your password will remain unchanged.
          </div>
          
          <p style="color: #666; font-size: 14px;">
            Enter this code in the app to continue with your password reset process.
          </p>
        </div>
        
        <div class="footer">
          <p>This email was sent by Manage Time App</p>
          <p>For security reasons, this OTP will expire in 10 minutes.</p>
        </div>
      </body>
      </html>
    `;

    const text = `
Password Reset - OTP Code

Hello${name ? ` ${name}` : ''}!

You requested to reset your password. Use the OTP code below to verify your identity:

OTP Code: ${otp}

This code expires in 10 minutes.

If you didn't request this password reset, please ignore this email. Your password will remain unchanged.

Enter this code in the app to continue with your password reset process.

---
Manage Time App
    `;

    return await this.sendEmail({
      to: email,
      subject,
      html,
      text,
    });
  }
}

export const emailService = new EmailService();
