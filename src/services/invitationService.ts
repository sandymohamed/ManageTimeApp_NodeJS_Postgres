import { getPrismaClient } from '../utils/database';
import { emailService } from './emailService';
import { notificationService } from './notificationService';
import { logger } from '../utils/logger';
import { ProjectInvitationStatus } from '@prisma/client';
import crypto from 'crypto';

interface CreateInvitationData {
  projectId: string;
  email: string;
  role: 'OWNER' | 'EDITOR' | 'VIEWER';
  invitedBy: string;
}

interface InvitationResponse {
  id: string;
  email: string;
  role: string;
  status: string;
  invitedAt: string;
  expiresAt: string;
  project: {
    id: string;
    name: string;
    description?: string;
  };
  inviter: {
    id: string;
    name: string;
    email: string;
  };
}

class InvitationService {
  private generateToken(): string {
    return crypto.randomBytes(32).toString('hex');
  }

  private getExpirationDate(): Date {
    const expirationDays = 7; // Invitations expire in 7 days
    const expirationDate = new Date();
    expirationDate.setDate(expirationDate.getDate() + expirationDays);
    return expirationDate;
  }

  async createInvitation(data: CreateInvitationData): Promise<InvitationResponse> {
    const prisma = getPrismaClient();

    try {
      // Check if user already exists
      const existingUser = await prisma.user.findUnique({
        where: { email: data.email },
      });

      // Check if user is already a member
      if (existingUser) {
        const existingMember = await prisma.projectMember.findFirst({
          where: {
            projectId: data.projectId,
            userId: existingUser.id,
          },
        });

        if (existingMember) {
          throw new Error('User is already a member of this project');
        }
      }

      // Check if there's already a pending invitation
      const existingInvitation = await prisma.projectInvitation.findFirst({
        where: {
          projectId: data.projectId,
          email: data.email,
          status: ProjectInvitationStatus.PENDING,
        },
      });

      if (existingInvitation) {
        // Update existing invitation
        const updatedInvitation = await prisma.projectInvitation.update({
          where: { id: existingInvitation.id },
          data: {
            role: data.role,
            token: this.generateToken(),
            expiresAt: this.getExpirationDate(),
            invitedBy: data.invitedBy,
          },
          include: {
            project: {
              select: {
                id: true,
                title: true,
                description: true,
              },
            },
            inviter: {
              select: {
                id: true,
                name: true,
                email: true,
              },
            },
          },
        });

        try {
          await this.sendInvitationEmail(updatedInvitation);
          
          // Create in-app notification if user exists
          if (existingUser) {
            await notificationService.createInvitationNotification({
              userId: existingUser.id,
              invitationId: updatedInvitation.id,
              projectName: updatedInvitation.project.title,
              inviterName: updatedInvitation.inviter.name || updatedInvitation.inviter.email,
              role: updatedInvitation.role,
            });
          }
          
          return this.mapInvitationToResponse(updatedInvitation);
        } catch (emailError: any) {
          // If email fails, revert the invitation update
          await prisma.projectInvitation.update({
            where: { id: existingInvitation.id },
            data: {
              role: existingInvitation.role,
              token: existingInvitation.token,
              expiresAt: existingInvitation.expiresAt,
              invitedBy: existingInvitation.invitedBy,
            },
          });
          throw new Error(`Failed to send invitation email: ${emailError.message}`);
        }
      }

      // Create new invitation
      const invitation = await prisma.projectInvitation.create({
        data: {
          projectId: data.projectId,
          email: data.email,
          role: data.role,
          token: this.generateToken(),
          invitedBy: data.invitedBy,
          expiresAt: this.getExpirationDate(),
        },
        include: {
          project: {
            select: {
              id: true,
              title: true,
              description: true,
            },
          },
          inviter: {
            select: {
              id: true,
              name: true,
              email: true,
            },
          },
        },
      });

      try {
        await this.sendInvitationEmail(invitation);
        
        // Create in-app notification if user exists
        if (existingUser) {
          await notificationService.createInvitationNotification({
            userId: existingUser.id,
            invitationId: invitation.id,
            projectName: invitation.project.title,
            inviterName: invitation.inviter.name || invitation.inviter.email,
            role: invitation.role,
          });
        }
        
        return this.mapInvitationToResponse(invitation);
      } catch (emailError: any) {
        // If email fails, delete the invitation
        await prisma.projectInvitation.delete({
          where: { id: invitation.id },
        });
        throw new Error(`Failed to send invitation email: ${emailError.message}`);
      }
    } catch (error) {
      logger.error('Failed to create invitation:', error);
      throw error;
    }
  }

  async getInvitationByToken(token: string): Promise<InvitationResponse | null> {
    const prisma = getPrismaClient();

    try {
      const invitation = await prisma.projectInvitation.findUnique({
        where: { token },
        include: {
          project: {
            select: {
              id: true,
              title: true,
              description: true,
            },
          },
          inviter: {
            select: {
              id: true,
              name: true,
              email: true,
            },
          },
        },
      });

      if (!invitation) {
        return null;
      }

      // Check if invitation is expired
      if (invitation.expiresAt < new Date()) {
        await prisma.projectInvitation.update({
          where: { id: invitation.id },
          data: { status: ProjectInvitationStatus.EXPIRED },
        });
        return null;
      }

      return this.mapInvitationToResponse(invitation);
    } catch (error) {
      logger.error('Failed to get invitation by token:', error);
      throw error;
    }
  }

  async acceptInvitation(token: string, userId: string): Promise<{ success: boolean; message: string }> {
    const prisma = getPrismaClient();

    try {
      const invitation = await prisma.projectInvitation.findUnique({
        where: { token },
        include: {
          project: true,
          inviter: true,
        },
      });

      if (!invitation) {
        return { success: false, message: 'Invitation not found' };
      }

      if (invitation.status !== ProjectInvitationStatus.PENDING) {
        return { success: false, message: 'Invitation is no longer valid' };
      }

      if (invitation.expiresAt < new Date()) {
        await prisma.projectInvitation.update({
          where: { id: invitation.id },
          data: { status: ProjectInvitationStatus.EXPIRED },
        });
        return { success: false, message: 'Invitation has expired' };
      }

      // Check if user is already a member
      const existingMember = await prisma.projectMember.findFirst({
        where: {
          projectId: invitation.projectId,
          userId: userId,
        },
      });

      if (existingMember) {
        return { success: false, message: 'You are already a member of this project' };
      }

      // Add user to project
      await prisma.projectMember.create({
        data: {
          projectId: invitation.projectId,
          userId: userId,
          role: invitation.role,
        },
      });

      // Update invitation status
      await prisma.projectInvitation.update({
        where: { id: invitation.id },
        data: {
          status: ProjectInvitationStatus.ACCEPTED,
          respondedAt: new Date(),
        },
      });

      // Send notification to inviter
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { name: true, email: true },
      });

      if (user) {
        await emailService.sendInvitationAcceptedNotification({
          inviterEmail: invitation.inviter.email,
          inviterName: invitation.inviter.name || 'Unknown',
          projectName: invitation.project.title,
          acceptedBy: user.name || user.email,
        });
      }

      logger.info('Invitation accepted', {
        invitationId: invitation.id,
        projectId: invitation.projectId,
        userId,
      });

      return { success: true, message: 'Successfully joined the project!' };
    } catch (error) {
      logger.error('Failed to accept invitation:', error);
      throw error;
    }
  }

  async declineInvitation(token: string): Promise<{ success: boolean; message: string }> {
    const prisma = getPrismaClient();

    try {
      const invitation = await prisma.projectInvitation.findUnique({
        where: { token },
        include: {
          project: true,
          inviter: true,
        },
      });

      if (!invitation) {
        return { success: false, message: 'Invitation not found' };
      }

      if (invitation.status !== ProjectInvitationStatus.PENDING) {
        return { success: false, message: 'Invitation is no longer valid' };
      }

      // Update invitation status
      await prisma.projectInvitation.update({
        where: { id: invitation.id },
        data: {
          status: ProjectInvitationStatus.DECLINED,
          respondedAt: new Date(),
        },
      });

      // Send notification to inviter
      await emailService.sendInvitationDeclinedNotification({
        inviterEmail: invitation.inviter.email,
        inviterName: invitation.inviter.name || 'Unknown',
        projectName: invitation.project.title,
        declinedBy: invitation.email,
      });

      logger.info('Invitation declined', {
        invitationId: invitation.id,
        projectId: invitation.projectId,
      });

      return { success: true, message: 'Invitation declined' };
    } catch (error) {
      logger.error('Failed to decline invitation:', error);
      throw error;
    }
  }

  async getProjectInvitations(projectId: string): Promise<InvitationResponse[]> {
    const prisma = getPrismaClient();

    try {
      const invitations = await prisma.projectInvitation.findMany({
        where: { projectId },
        include: {
          project: {
            select: {
              id: true,
              title: true,
              description: true,
            },
          },
          inviter: {
            select: {
              id: true,
              name: true,
              email: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
      });

      return invitations.map(invitation => this.mapInvitationToResponse(invitation));
    } catch (error) {
      logger.error('Failed to get project invitations:', error);
      throw error;
    }
  }

  async cancelInvitation(invitationId: string, userId: string): Promise<{ success: boolean; message: string }> {
    const prisma = getPrismaClient();

    try {
      const invitation = await prisma.projectInvitation.findUnique({
        where: { id: invitationId },
        include: { project: true },
      });

      if (!invitation) {
        return { success: false, message: 'Invitation not found' };
      }

      // Check if user has permission to cancel (project owner or inviter)
      const project = await prisma.project.findFirst({
        where: {
          id: invitation.projectId,
          OR: [
            { ownerId: userId },
            { members: { some: { userId, role: { in: ['OWNER', 'EDITOR'] } } } },
          ],
        },
      });

      if (!project) {
        return { success: false, message: 'You do not have permission to cancel this invitation' };
      }

      await prisma.projectInvitation.update({
        where: { id: invitationId },
        data: { status: ProjectInvitationStatus.CANCELLED },
      });

      logger.info('Invitation cancelled', { invitationId, userId });

      return { success: true, message: 'Invitation cancelled successfully' };
    } catch (error) {
      logger.error('Failed to cancel invitation:', error);
      throw error;
    }
  }

  private async sendInvitationEmail(invitation: any): Promise<void> {
    const emailSent = await emailService.sendProjectInvitationNotification({
      email: invitation.email,
      inviterName: invitation.inviter.name || invitation.inviter.email,
      projectName: invitation.project.title,
      projectDescription: invitation.project.description,
      role: invitation.role,
      expiresAt: invitation.expiresAt.toLocaleDateString(),
    });

    if (!emailSent) {
      throw new Error('Failed to send invitation notification email');
    }
  }

  private mapInvitationToResponse(invitation: any): InvitationResponse {
    return {
      id: invitation.id,
      email: invitation.email,
      role: invitation.role,
      status: invitation.status,
      invitedAt: invitation.invitedAt.toISOString(),
      expiresAt: invitation.expiresAt.toISOString(),
      project: {
        id: invitation.project.id,
        name: invitation.project.title,
        description: invitation.project.description,
      },
      inviter: {
        id: invitation.inviter.id,
        name: invitation.inviter.name || invitation.inviter.email,
        email: invitation.inviter.email,
      },
    };
  }
}

export const invitationService = new InvitationService();
