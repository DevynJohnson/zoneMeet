// Multi-calendar connection service
import { CalendarPlatform } from '@prisma/client';
import axios from 'axios';
import { AppleCalendarService } from './apple-calendar';
import { prisma } from '@/lib/db';

export interface AvailableCalendar {
  id: string;
  name: string;
  description?: string;
  isDefault?: boolean;
  canWrite?: boolean;
  color?: string;
}

export class CalendarConnectionService {
  /**
   * Connect an Outlook calendar
   */
  static async connectOutlookCalendar(providerId: string, authCode: string) {
    try {
      // Exchange auth code for access token
      const tokenResponse = await axios.post(
        'https://login.microsoftonline.com/common/oauth2/v2.0/token',
        new URLSearchParams({
          client_id: process.env.OUTLOOK_CLIENT_ID!,
          client_secret: process.env.OUTLOOK_CLIENT_SECRET!,
          code: authCode,
          grant_type: 'authorization_code',
          redirect_uri: process.env.OUTLOOK_REDIRECT_URI!,
          scope: 'https://graph.microsoft.com/calendars.read',
        }),
        {
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        }
      );

      const { access_token, refresh_token, expires_in } = tokenResponse.data;

      // Get user's email from Microsoft Graph
      const userResponse = await axios.get('https://graph.microsoft.com/v1.0/me', {
        headers: { Authorization: `Bearer ${access_token}` },
      });

      const userEmail = userResponse.data.mail || userResponse.data.userPrincipalName;

      // Use the enhanced createConnection method with multi-calendar support
      const connection = await CalendarConnectionService.createConnection({
        providerId,
        platform: CalendarPlatform.OUTLOOK,
        email: userEmail,
        calendarId: 'primary',
        accessToken: access_token,
        refreshToken: refresh_token,
        tokenExpiry: new Date(Date.now() + expires_in * 1000),
      });

      return connection;
    } catch (error: unknown) {
      console.error('Failed to refresh access token:', error);
      
      // Log more details about the error for debugging
      if (error && typeof error === 'object' && 'response' in error) {
        const axiosError = error as { response?: { status?: number; statusText?: string; data?: unknown; headers?: unknown } };
        console.error('Token refresh error response:', {
          status: axiosError.response?.status,
          statusText: axiosError.response?.statusText,
          data: axiosError.response?.data,
          headers: axiosError.response?.headers
        });
      }
      
      throw new Error(`Failed to refresh access token: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Connect a Google calendar
   */
  static async connectGoogleCalendar(providerId: string, authCode: string) {
    try {
      // Exchange auth code for access token
      const tokenResponse = await axios.post(
        'https://oauth2.googleapis.com/token',
        {
          client_id: process.env.GOOGLE_CLIENT_ID!,
          client_secret: process.env.GOOGLE_CLIENT_SECRET!,
          code: authCode,
          grant_type: 'authorization_code',
          redirect_uri: process.env.GOOGLE_REDIRECT_URI!,
        }
      );

      const { access_token, refresh_token, expires_in } = tokenResponse.data;

      // Get user's email from Google
      const userResponse = await axios.get(
        'https://www.googleapis.com/oauth2/v2/userinfo',
        {
          headers: { Authorization: `Bearer ${access_token}` },
        }
      );

      const userEmail = userResponse.data.email;

      // Use the enhanced createConnection method with multi-calendar support
      const connection = await CalendarConnectionService.createConnection({
        providerId,
        platform: CalendarPlatform.GOOGLE,
        email: userEmail,
        calendarId: 'primary',
        accessToken: access_token,
        refreshToken: refresh_token,
        tokenExpiry: new Date(Date.now() + expires_in * 1000),
      });

      return connection;
    } catch (error) {
      console.error('Failed to connect Google calendar:', error);
      throw new Error('Failed to connect Google calendar');
    }
  }

  /**
   * Connect a Microsoft Teams calendar
   */
  static async connectTeamsCalendar(providerId: string, authCode: string) {
    try {
      // Teams uses the same OAuth flow as Outlook but accesses Teams-specific endpoints
      const tokenResponse = await axios.post(
        'https://login.microsoftonline.com/common/oauth2/v2.0/token',
        new URLSearchParams({
          client_id: process.env.TEAMS_CLIENT_ID!,
          client_secret: process.env.TEAMS_CLIENT_SECRET!,
          code: authCode,
          grant_type: 'authorization_code',
          redirect_uri: process.env.TEAMS_REDIRECT_URI!,
          scope: 'https://graph.microsoft.com/calendars.read https://graph.microsoft.com/onlineMeetings.read',
        }),
        {
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        }
      );

      const { access_token, refresh_token, expires_in } = tokenResponse.data;

      // Get user's email from Microsoft Graph
      const userResponse = await axios.get('https://graph.microsoft.com/v1.0/me', {
        headers: { Authorization: `Bearer ${access_token}` },
      });

      const userEmail = userResponse.data.mail || userResponse.data.userPrincipalName;

      // Use the enhanced createConnection method with multi-calendar support
      const connection = await CalendarConnectionService.createConnection({
        providerId,
        platform: CalendarPlatform.TEAMS,
        email: userEmail,
        calendarId: 'primary',
        accessToken: access_token,
        refreshToken: refresh_token,
        tokenExpiry: new Date(Date.now() + expires_in * 1000),
      });

      return connection;
    } catch (error) {
      console.error('Failed to connect Teams calendar:', error);
      throw new Error('Failed to connect Teams calendar');
    }
  }

  /**
   * Connect an Apple iCloud calendar (using modern CalDAV with tsdav)
   */
  static async connectAppleCalendar(
    providerId: string, 
    appleId: string, 
    appSpecificPassword: string
  ) {
    return AppleCalendarService.connectAppleCalendar(providerId, {
      appleId,
      appSpecificPassword,
    });
  }
  static async getProviderConnections(providerId: string) {
    return await prisma.calendarConnection.findMany({
      where: { providerId },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Disconnect a calendar
   */
  static async disconnectCalendar(connectionId: string, providerId: string) {
    const connection = await prisma.calendarConnection.findFirst({
      where: {
        id: connectionId,
        providerId,
      },
    });

    if (!connection) {
      throw new Error('Calendar connection not found');
    }

    // Deactivate the connection
    await prisma.calendarConnection.update({
      where: { id: connectionId },
      data: { isActive: false },
    });

    return { success: true };
  }

  /**
   * Refresh access token for a connection
   */
  static async refreshAccessToken(connectionId: string) {
    const connection = await prisma.calendarConnection.findUnique({
      where: { id: connectionId },
    });

    if (!connection || !connection.refreshToken) {
      // Apple calendars don't need token refresh
      if (connection?.platform === CalendarPlatform.APPLE) {
        return connection.accessToken;
      }
      throw new Error('Connection not found or no refresh token available');
    }

    try {
      let tokenResponse;

      if (connection.platform === CalendarPlatform.OUTLOOK) {
        tokenResponse = await axios.post(
          'https://login.microsoftonline.com/common/oauth2/v2.0/token',
          new URLSearchParams({
            client_id: process.env.OUTLOOK_CLIENT_ID!,
            client_secret: process.env.OUTLOOK_CLIENT_SECRET!,
            refresh_token: connection.refreshToken,
            grant_type: 'refresh_token',
          }),
          {
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          }
        );
      } else if (connection.platform === CalendarPlatform.TEAMS) {
        tokenResponse = await axios.post(
          'https://login.microsoftonline.com/common/oauth2/v2.0/token',
          new URLSearchParams({
            client_id: process.env.TEAMS_CLIENT_ID!,
            client_secret: process.env.TEAMS_CLIENT_SECRET!,
            refresh_token: connection.refreshToken,
            grant_type: 'refresh_token',
          }),
          {
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          }
        );
      } else if (connection.platform === CalendarPlatform.GOOGLE) {
        tokenResponse = await axios.post('https://oauth2.googleapis.com/token', {
          client_id: process.env.GOOGLE_CLIENT_ID!,
          client_secret: process.env.GOOGLE_CLIENT_SECRET!,
          refresh_token: connection.refreshToken,
          grant_type: 'refresh_token',
        });
      } else {
        throw new Error('Unsupported calendar platform');
      }

      const { access_token, expires_in, refresh_token } = tokenResponse.data;

      // Update the connection with new tokens
      await prisma.calendarConnection.update({
        where: { id: connectionId },
        data: {
          accessToken: access_token,
          refreshToken: refresh_token || connection.refreshToken,
          tokenExpiry: new Date(Date.now() + expires_in * 1000),
        },
      });

      return access_token;
    } catch (error) {
      console.error('Failed to refresh access token:', error);
      // Deactivate the connection if refresh fails
      await prisma.calendarConnection.update({
        where: { id: connectionId },
        data: { isActive: false },
      });
      throw new Error('Failed to refresh access token');
    }
  }

  /**
   * Generic method to create a calendar connection
   */
  static async createConnection(connectionData: {
    providerId: string;
    platform: CalendarPlatform;
    email: string;
    calendarId: string;
    accessToken: string;
    refreshToken?: string | null;
    tokenExpiry?: Date | null;
  }) {
    try {
      // Initialize multi-calendar settings
      let selectedCalendars: string[] = [connectionData.calendarId];
      let calendarSettings: Record<string, { syncEvents: boolean; allowBookings: boolean; calendarName: string; canWrite: boolean }> = {
        [connectionData.calendarId]: {
          syncEvents: true,
          allowBookings: true,
          calendarName: `${connectionData.platform} Calendar`,
          canWrite: true,
        }
      };

      // Try to fetch available calendars and set up multi-calendar support
      if (connectionData.accessToken) {
        try {
          // Only fetch for supported platforms (skip APPLE for now)
          if (connectionData.platform !== 'APPLE') {
            const availableCalendars = await CalendarConnectionService.getAvailableCalendars(
              connectionData.platform as 'GOOGLE' | 'OUTLOOK' | 'TEAMS',
              connectionData.accessToken
            );

            // Set up settings for all writeable calendars
            const writeableCalendars = availableCalendars.filter(cal => cal.canWrite !== false);
            selectedCalendars = writeableCalendars.map(cal => cal.id);
            calendarSettings = writeableCalendars.reduce((settings, cal) => {
              settings[cal.id] = {
                syncEvents: true,
                allowBookings: true,
                calendarName: cal.name || 'Unnamed Calendar',
                canWrite: cal.canWrite !== false,
              };
              return settings;
            }, {} as Record<string, { syncEvents: boolean; allowBookings: boolean; calendarName: string; canWrite: boolean }>);

            console.log(`Initialized multi-calendar support for ${connectionData.platform}: found ${availableCalendars.length} calendars`);
          }
        } catch (fetchError) {
          console.error(`Failed to fetch available calendars during connection creation:`, fetchError);
          // Fall back to primary calendar only (already set above)
        }
      }

      const connection = await prisma.calendarConnection.create({
        data: {
          providerId: connectionData.providerId,
          platform: connectionData.platform,
          email: connectionData.email,
          calendarId: connectionData.calendarId,
          accessToken: connectionData.accessToken,
          refreshToken: connectionData.refreshToken,
          tokenExpiry: connectionData.tokenExpiry,
          isActive: true,
          syncEvents: true,
          allowBookings: true,
          selectedCalendars: selectedCalendars,
          calendarSettings: calendarSettings,
        },
      });

      console.log(`✅ Calendar connection created with multi-calendar support: ${selectedCalendars.length} calendars available`);
      return connection;
    } catch (error) {
      console.error('Failed to create calendar connection:', error);
      
      // Check for unique constraint violation
      if (error && typeof error === 'object' && 'code' in error && error.code === 'P2002') {
        throw new Error('This calendar is already connected to your account');
      }
      
      throw new Error('Failed to create calendar connection');
    }
  }

  /**
   * Get OAuth authorization URLs (legacy method - kept for compatibility)
   */
  static getAuthUrls() {
    const outlookAuthUrl = `https://login.microsoftonline.com/common/oauth2/v2.0/authorize?` +
      `client_id=${process.env.OUTLOOK_CLIENT_ID}&` +
      `response_type=code&` +
      `redirect_uri=${encodeURIComponent(process.env.OUTLOOK_REDIRECT_URI!)}&` +
      `scope=${encodeURIComponent('https://graph.microsoft.com/Calendars.Read https://graph.microsoft.com/Calendars.ReadWrite https://graph.microsoft.com/User.Read offline_access')}&` +
      `response_mode=query&` +
      `prompt=select_account`;

    const teamsAuthUrl = `https://login.microsoftonline.com/common/oauth2/v2.0/authorize?` +
      `client_id=${process.env.TEAMS_CLIENT_ID}&` +
      `response_type=code&` +
      `redirect_uri=${encodeURIComponent(process.env.TEAMS_REDIRECT_URI!)}&` +
      `scope=${encodeURIComponent('https://graph.microsoft.com/Calendars.Read https://graph.microsoft.com/Calendars.ReadWrite https://graph.microsoft.com/User.Read offline_access')}&` +
      `response_mode=query&` +
      `prompt=select_account`;

    const googleAuthUrl = `https://accounts.google.com/o/oauth2/v2/auth?` +
      `client_id=${process.env.GOOGLE_CLIENT_ID}&` +
      `response_type=code&` +
      `redirect_uri=${encodeURIComponent(process.env.GOOGLE_REDIRECT_URI!)}&` +
      `scope=${encodeURIComponent('https://www.googleapis.com/auth/calendar.readonly https://www.googleapis.com/auth/calendar.events')}&` +
      `access_type=offline&` +
      `approval_prompt=force&` +
      `prompt=consent&` +
      `include_granted_scopes=true`;

    return {
      outlook: outlookAuthUrl,
      teams: teamsAuthUrl,
      google: googleAuthUrl,
      // Apple uses a different authentication method (App-specific passwords)
      apple: null,
    };
  }

  /**
   * Get OAuth authorization URLs with provider context (includes state parameter)
   */
  static getAuthUrlsWithProvider(providerId: string) {
    const outlookStateParam = encodeURIComponent(JSON.stringify({ providerId, platform: 'outlook' }));
    const teamsStateParam = encodeURIComponent(JSON.stringify({ providerId, platform: 'teams' }));
    const googleStateParam = encodeURIComponent(JSON.stringify({ providerId }));
    
    const outlookAuthUrl = `https://login.microsoftonline.com/common/oauth2/v2.0/authorize?` +
      `client_id=${process.env.OUTLOOK_CLIENT_ID}&` +
      `response_type=code&` +
      `redirect_uri=${encodeURIComponent(process.env.OUTLOOK_REDIRECT_URI!)}&` +
      `scope=${encodeURIComponent('https://graph.microsoft.com/Calendars.Read https://graph.microsoft.com/Calendars.ReadWrite https://graph.microsoft.com/User.Read offline_access')}&` +
      `state=${outlookStateParam}&` +
      `response_mode=query&` +
      `prompt=select_account`;

    const teamsAuthUrl = `https://login.microsoftonline.com/common/oauth2/v2.0/authorize?` +
      `client_id=${process.env.TEAMS_CLIENT_ID}&` +
      `response_type=code&` +
      `redirect_uri=${encodeURIComponent(process.env.TEAMS_REDIRECT_URI!)}&` +
      `scope=${encodeURIComponent('https://graph.microsoft.com/Calendars.Read https://graph.microsoft.com/Calendars.ReadWrite https://graph.microsoft.com/User.Read offline_access')}&` +
      `state=${teamsStateParam}&` +
      `response_mode=query&` +
      `prompt=select_account`;

    const googleAuthUrl = `https://accounts.google.com/o/oauth2/v2/auth?` +
      `client_id=${process.env.GOOGLE_CLIENT_ID}&` +
      `response_type=code&` +
      `redirect_uri=${encodeURIComponent(process.env.GOOGLE_REDIRECT_URI!)}&` +
      `scope=${encodeURIComponent('https://www.googleapis.com/auth/calendar.readonly')}&` +
      `state=${googleStateParam}&` +
      `access_type=offline&` +
      `prompt=select_account`;

    return {
      outlook: outlookAuthUrl,
      teams: teamsAuthUrl,
      google: googleAuthUrl,
      // Apple uses a different authentication method (App-specific passwords)
      apple: null,
    };
  }

  /**
   * Fetch available calendars for Google
   */
  static async getGoogleCalendars(accessToken: string): Promise<AvailableCalendar[]> {
    try {
      const response = await axios.get(
        'https://www.googleapis.com/calendar/v3/users/me/calendarList',
        {
          headers: { Authorization: `Bearer ${accessToken}` },
          params: {
            minAccessRole: 'reader',
            showHidden: false,
          }
        }
      );

      return response.data.items.map((calendar: {
        id: string;
        summary?: string;
        summaryOverride?: string;
        description?: string;
        primary?: boolean;
        accessRole?: string;
        backgroundColor?: string;
      }) => ({
        id: calendar.id,
        name: calendar.summary || calendar.summaryOverride || 'Unnamed Calendar',
        description: calendar.description,
        isDefault: calendar.primary || false,
        canWrite: calendar.accessRole === 'owner' || calendar.accessRole === 'writer',
        color: calendar.backgroundColor,
      }));
    } catch (error) {
      console.error('Failed to fetch Google calendars:', error);
      throw new Error('Failed to fetch Google calendars');
    }
  }

  /**
   * Fetch available calendars for Outlook
   */
  static async getOutlookCalendars(accessToken: string): Promise<AvailableCalendar[]> {
    try {
      const response = await axios.get(
        'https://graph.microsoft.com/v1.0/me/calendars',
        {
          headers: { Authorization: `Bearer ${accessToken}` },
          params: {
            $select: 'id,name,color,isDefaultCalendar,canEdit,canShare,owner'
          }
        }
      );

      return response.data.value.map((calendar: {
        id: string;
        name?: string;
        color?: string;
        isDefaultCalendar?: boolean;
        canEdit?: boolean;
      }) => ({
        id: calendar.id,
        name: calendar.name || 'Unnamed Calendar',
        isDefault: calendar.isDefaultCalendar || false,
        canWrite: calendar.canEdit || false,
        color: calendar.color,
      }));
    } catch (error) {
      console.error('Failed to fetch Outlook calendars:', error);
      throw new Error('Failed to fetch Outlook calendars');
    }
  }

  /**
   * Fetch available calendars for Teams (uses Outlook API)
   */
  static async getTeamsCalendars(accessToken: string): Promise<AvailableCalendar[]> {
    // Teams uses the same API as Outlook for calendars
    return this.getOutlookCalendars(accessToken);
  }

  /**
   * Fetch available calendars for Apple using modern CalDAV
   */
  static async getAppleCalendars(email: string, appPassword: string): Promise<AvailableCalendar[]> {
    try {
      const appleCalendars = await AppleCalendarService.getAvailableCalendars({
        appleId: email,
        appSpecificPassword: appPassword,
      });

      return appleCalendars.map((calendar, index) => {
        // Generate a unique ID from the calendar URL
        // Use the full path to ensure uniqueness
        const urlParts = calendar.url.split('/');
        const calendarId = urlParts[urlParts.length - 2] || urlParts[urlParts.length - 1] || `calendar-${index}`;
        
        return {
          id: calendarId || `apple-cal-${index}`,
          name: calendar.displayName,
          description: calendar.description,
          isDefault: calendar.displayName.toLowerCase().includes('primary') || index === 0,
          canWrite: true,
          color: calendar.calendarColor,
        };
      });
    } catch (error) {
      console.error('Failed to fetch Apple calendars:', error);
      // Fallback to basic calendar if fetch fails
      return [
        {
          id: 'primary',
          name: 'Primary Calendar',
          isDefault: true,
          canWrite: true,
        }
      ];
    }
  }

  /**
   * Get available calendars for any platform
   */
  static async getAvailableCalendars(
    platform: CalendarPlatform,
    accessToken: string,
    email?: string,
    appPassword?: string
  ): Promise<AvailableCalendar[]> {
    switch (platform) {
      case CalendarPlatform.GOOGLE:
        return this.getGoogleCalendars(accessToken);
      case CalendarPlatform.OUTLOOK:
        return this.getOutlookCalendars(accessToken);
      case CalendarPlatform.TEAMS:
        return this.getTeamsCalendars(accessToken);
      case CalendarPlatform.APPLE:
        return this.getAppleCalendars(email || '', appPassword || '');
      default:
        throw new Error(`Unsupported platform: ${platform}`);
    }
  }

  /**
   * Update calendar connection settings
   */
  static async updateCalendarSettings(
    connectionId: string,
    settings: {
      isDefaultForBookings?: boolean;
      syncEvents?: boolean;
      allowBookings?: boolean;
      calendarName?: string;
    }
  ) {
    try {
      // If setting as default, first unset any other defaults for this provider
      if (settings.isDefaultForBookings) {
        const connection = await prisma.calendarConnection.findUnique({
          where: { id: connectionId },
          select: { providerId: true, platform: true }
        });

        if (connection) {
          await prisma.calendarConnection.updateMany({
            where: {
              providerId: connection.providerId,
              platform: connection.platform,
              id: { not: connectionId }
            },
            data: {
              isDefaultForBookings: false
            }
          });
        }
      }

      const updatedConnection = await prisma.calendarConnection.update({
        where: { id: connectionId },
        data: {
          ...(settings.isDefaultForBookings !== undefined && { isDefaultForBookings: settings.isDefaultForBookings }),
          ...(settings.syncEvents !== undefined && { syncEvents: settings.syncEvents }),
          ...(settings.allowBookings !== undefined && { allowBookings: settings.allowBookings }),
          ...(settings.calendarName !== undefined && { calendarName: settings.calendarName }),
        },
      });

      return updatedConnection;
    } catch (error) {
      console.error('Failed to update calendar settings:', error);
      throw new Error('Failed to update calendar settings');
    }
  }

  static async updateConnection(connectionId: string, updateData: {
    email?: string;
    calendarId?: string;
    accessToken?: string;
    refreshToken?: string;
    tokenExpiry?: Date | null;
  }) {
    try {
      // Get the existing connection to check platform and update multi-calendar settings
      const existingConnection = await prisma.calendarConnection.findUnique({
        where: { id: connectionId },
      });

      if (!existingConnection) {
        throw new Error('Connection not found');
      }

      let additionalUpdateData: Record<string, unknown> = {};

      // If access token is being updated, refresh multi-calendar settings
      if (updateData.accessToken && existingConnection.platform !== 'APPLE') {
        try {
          const availableCalendars = await CalendarConnectionService.getAvailableCalendars(
            existingConnection.platform as 'GOOGLE' | 'OUTLOOK' | 'TEAMS',
            updateData.accessToken
          );

          // Set up settings for all writeable calendars
          const writeableCalendars = availableCalendars.filter(cal => cal.canWrite !== false);
          const selectedCalendars = writeableCalendars.map(cal => cal.id);
          const calendarSettings = writeableCalendars.reduce((settings, cal) => {
            settings[cal.id] = {
              syncEvents: true,
              allowBookings: true,
              calendarName: cal.name || 'Unnamed Calendar',
              canWrite: cal.canWrite !== false,
            };
            return settings;
          }, {} as Record<string, { syncEvents: boolean; allowBookings: boolean; calendarName: string; canWrite: boolean }>);

          additionalUpdateData = {
            selectedCalendars: selectedCalendars,
            calendarSettings: calendarSettings,
          };

          console.log(`Refreshed multi-calendar settings for ${existingConnection.platform}: found ${availableCalendars.length} calendars`);
        } catch (fetchError) {
          console.error('Failed to refresh multi-calendar settings during update:', fetchError);
          // Don't fail the entire update, just skip multi-calendar refresh
        }
      }

      const updatedConnection = await prisma.calendarConnection.update({
        where: { id: connectionId },
        data: {
          ...(updateData.email && { email: updateData.email }),
          ...(updateData.calendarId && { calendarId: updateData.calendarId }),
          ...(updateData.accessToken && { accessToken: updateData.accessToken }),
          ...(updateData.refreshToken && { refreshToken: updateData.refreshToken }),
          ...(updateData.tokenExpiry !== undefined && { tokenExpiry: updateData.tokenExpiry }),
          ...additionalUpdateData,
        },
      });

      return updatedConnection;
    } catch (error) {
      console.error('Failed to update calendar connection:', error);
      throw new Error('Failed to update calendar connection');
    }
  }
}
