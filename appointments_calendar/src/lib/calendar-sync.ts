// Enhanced calendar synchronization service for multiple platforms
import axios from 'axios';
import { ensureValidToken } from './token-refresh';
import { LocationService } from './location';
import { prisma } from '@/lib/db';

// Calendar platform constants
const CalendarPlatform = {
  OUTLOOK: 'OUTLOOK',
  GOOGLE: 'GOOGLE',
  TEAMS: 'TEAMS',
  APPLE: 'APPLE',
  OTHER: 'OTHER'
} as const;

type CalendarPlatform = typeof CalendarPlatform[keyof typeof CalendarPlatform];
// import { CalendarConnectionService } from './calendar-connections'; // Unused import
import { AppleCalendarService } from './apple-calendar';

interface DateRange {
  start: Date;
  end: Date;
}

export class CalendarSyncService {
  /**
   * Perform lightweight token maintenance during normal operations
   * This runs automatically whenever calendars are synced - no extra cost!
   */
  static async performOpportunisticMaintenance() {
    try {
      // Only check for tokens expiring in the next 2 hours (lightweight check)
      const soonExpiring = new Date(Date.now() + 2 * 60 * 60 * 1000);
      
      const expiringConnections = await prisma.calendarConnection.findMany({
        where: {
          isActive: true,
          tokenExpiry: {
            lt: soonExpiring,
            gte: new Date() // Not already expired
          },
          refreshToken: {
            not: null
          }
        },
        take: 3, // Limit to 3 at a time to avoid performance impact
        select: {
          id: true,
          platform: true,
          providerId: true
        }
      });

      if (expiringConnections.length > 0) {
        // Refresh in parallel (fast)
        const { refreshConnectionToken } = await import('@/lib/token-refresh');
        
        await Promise.allSettled(
          expiringConnections.map(async (conn) => {
            try {
              await refreshConnectionToken(conn.id);
            } catch (error) {
              console.warn(`Failed to refresh ${conn.platform} token:`, error);
            }
          })
        );
      }
    } catch (error) {
      // Don't let maintenance errors affect the main sync operation
      console.warn('Opportunistic maintenance failed (continuing with sync):', error);
    }
  }

  /**
   * Sync all calendars for a provider with optional date range
   */
  static async syncAllCalendars(providerId: string, dateRange?: DateRange) {
    // Run token maintenance before sync (no extra cost!)
    await this.performOpportunisticMaintenance();

    // Default to next 3 months if no date range specified
    const defaultRange = dateRange || {
      start: new Date(),
      end: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000) // 90 days
    };

    const connections = await prisma.calendarConnection.findMany({
      where: {
        providerId,
        isActive: true,
        syncEvents: true, // Only sync connections that have syncEvents enabled
      },
    });

    // Run all calendar syncs in parallel for better performance
    const syncPromises = connections.map(async (connection) => {
      try {
        let result;
        
        const syncConnection = {
          id: connection.id,
          providerId: connection.providerId,
          calendarId: connection.calendarId,
          accessToken: connection.accessToken,
          refreshToken: connection.refreshToken || undefined,
          tokenExpiry: connection.tokenExpiry,
          platform: connection.platform,
          selectedCalendars: connection.selectedCalendars,
          calendarSettings: connection.calendarSettings,
        };
        
        if (connection.platform === 'OUTLOOK') {
          result = await this.syncOutlookCalendar(syncConnection, defaultRange);
        } else if (connection.platform === 'GOOGLE') {
          result = await this.syncGoogleCalendar(syncConnection, defaultRange);
        } else if (connection.platform === 'TEAMS') {
          result = await this.syncTeamsCalendar(syncConnection, defaultRange);
        } else if (connection.platform === 'APPLE') {
          result = await this.syncAppleCalendar(syncConnection, defaultRange);
        } else {
          console.warn(`Unsupported platform: ${connection.platform}`);
          return {
            connectionId: connection.id,
            platform: connection.platform,
            success: false,
            error: 'Unsupported platform',
          };
        }

        return {
          connectionId: connection.id,
          platform: connection.platform,
          ...result,
        };
      } catch (error) {
        console.error(`Failed to sync ${connection.platform} calendar:`, error);
        return {
          connectionId: connection.id,
          platform: connection.platform,
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        };
      }
    });

    // Wait for all syncs to complete in parallel
    const promiseResults = await Promise.allSettled(syncPromises);
    const results = promiseResults.map(result => 
      result.status === 'fulfilled' ? result.value : {
        connectionId: 'unknown',
        platform: 'unknown',
        success: false,
        error: 'Promise rejected'
      }
    );

    return {
      success: true,
      results,
      totalConnections: connections.length,
      successfulSyncs: results.filter(r => r.success).length,
    };
  }

  /**
   * Sync Outlook calendar
   */
  static async syncOutlookCalendar(connection: {
    id: string;
    providerId: string;
    calendarId: string;
    accessToken: string;
    refreshToken?: string;
    tokenExpiry: Date | null;
    platform: string;
    selectedCalendars?: unknown;
    calendarSettings?: unknown;
  }, dateRange?: DateRange) {
    try {
      // Default to next 3 months if no date range specified
      const syncRange = dateRange || {
        start: new Date(),
        end: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000)
      };

      // Ensure we have a valid access token (refresh if needed)
      const validConnection = {
        ...connection,
        refreshToken: connection.refreshToken || null
      };
      const accessToken = await ensureValidToken(validConnection);

      // Determine which calendars to sync
      let calendarsToSync: string[] = [connection.calendarId]; // Default to primary calendar
      
      // If we have multi-calendar configuration, use those settings
      if (connection.selectedCalendars && Array.isArray(connection.selectedCalendars)) {
        const calendarSettings = connection.calendarSettings as Record<string, { syncEvents?: boolean; allowBookings?: boolean }> | null;
        
        // Filter to only calendars that have syncEvents enabled
        calendarsToSync = (connection.selectedCalendars as string[]).filter(calendarId => {
          const settings = calendarSettings?.[calendarId];
          return settings?.syncEvents === true;
        });
      }

      // If no calendars are enabled for sync, return early
      if (calendarsToSync.length === 0) {
        return {
          success: true,
          eventsProcessed: 0,
          message: 'No calendars enabled for sync'
        };
      }

      let totalEventsProcessed = 0;

      // Sync each calendar that has syncEvents enabled
      for (const calendarId of calendarsToSync) {
        try {
          // Create date filter for Microsoft Graph API
          const startFilter = syncRange.start.toISOString();
          const endFilter = syncRange.end.toISOString();
          
          // Fetch events from Microsoft Graph API with date filtering
          const response = await axios.get(
            `https://graph.microsoft.com/v1.0/me/calendars/${calendarId}/events`,
            {
              headers: {
                Authorization: `Bearer ${accessToken}`,
                'Content-Type': 'application/json',
              },
              params: {
                $select: 'id,subject,body,start,end,location,isAllDay',
                $top: 250,
                $filter: `start/dateTime ge '${startFilter}' and start/dateTime le '${endFilter}'`,
              },
            }
          );

          const events = response.data.value || [];

          for (const event of events) {
            try {
              await this.processOutlookEvent(connection.providerId, event, calendarId, connection.id);
              totalEventsProcessed++;
            } catch (eventError) {
              console.error(`Failed to process Outlook event ${event.id}:`, eventError);
            }
          }
        } catch (calendarError) {
          console.error(`Failed to sync Outlook calendar ${calendarId}:`, calendarError);
        }
      }

      // Update last sync time
      await prisma.calendarConnection.update({
        where: { id: connection.id },
        data: { lastSyncAt: new Date() },
      });

      return {
        success: true,
        eventsProcessed: totalEventsProcessed,
        message: `Synced ${totalEventsProcessed} events from ${calendarsToSync.length} Outlook calendar(s)`,
      };
    } catch (error) {
      console.error('Outlook calendar sync failed:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Sync Google calendar
   */
  static async syncGoogleCalendar(connection: {
    id: string;
    providerId: string;
    calendarId: string;
    accessToken: string;
    refreshToken?: string;
    tokenExpiry: Date | null;
    platform: string;
    selectedCalendars?: unknown;
    calendarSettings?: unknown;
  }, dateRange?: DateRange) {
    try {
      // Default to next 3 months if no date range specified
      const syncRange = dateRange || {
        start: new Date(),
        end: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000)
      };

      const validConnection = {
        ...connection,
        refreshToken: connection.refreshToken || null
      };
      const accessToken = await ensureValidToken(validConnection);

      // Determine which calendars to sync
      let calendarsToSync: string[] = [connection.calendarId]; // Default to primary calendar
      
      // If we have multi-calendar configuration, use those settings
      if (connection.selectedCalendars && Array.isArray(connection.selectedCalendars)) {
        const calendarSettings = connection.calendarSettings as Record<string, { syncEvents?: boolean; allowBookings?: boolean }> | null;
        
        // Filter to only calendars that have syncEvents enabled
        calendarsToSync = (connection.selectedCalendars as string[]).filter(calendarId => {
          const settings = calendarSettings?.[calendarId];
          return settings?.syncEvents === true;
        });
        
        console.log(`📋 Multi-calendar mode: ${calendarsToSync.length} calendars enabled for sync`);
        console.log(`📝 Calendars to sync:`, calendarsToSync);
      } else {
        console.log(`📋 Single-calendar mode: syncing primary calendar only`);
      }

      let totalEventsProcessed = 0;

      // Sync events from each enabled calendar
      for (const calendarId of calendarsToSync) {
        // Implement retry logic for transient network errors
        let retryCount = 0;
        const maxRetries = 3;
        
        while (retryCount <= maxRetries) {
          try {
            console.log(`📡 Fetching events from Google Calendar: ${calendarId} (attempt ${retryCount + 1}/${maxRetries + 1})`);
            
            const response = await axios.get(
              `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`,
              {
                headers: {
                  Authorization: `Bearer ${accessToken}`,
                },
                params: {
                  maxResults: 250,
                  singleEvents: true,
                  orderBy: 'startTime',
                  timeMin: syncRange.start.toISOString(),
                  timeMax: syncRange.end.toISOString(), // Key optimization: only get events in specified window
                },
                timeout: 30000, // 30 second timeout
              }
            );

            const events = response.data.items || [];

            for (const event of events) {
              try {
                await this.processGoogleEvent(connection.providerId, event, calendarId, connection.id);
                totalEventsProcessed++;
              } catch (eventError) {
                console.error(`Failed to process Google event ${event.id}:`, eventError);
              }
            }
            
            break; // Success, exit retry loop
            
          } catch (calendarError: unknown) {
            retryCount++;
            
            // Type guard for axios errors and network errors
            const error = calendarError as { 
              code?: string; 
              message?: string; 
              response?: { status?: number } 
            };
            
            // Check if this is a network/connection error that we should retry
            const isRetryableError = 
              error.code === 'ECONNRESET' ||
              error.code === 'ENOTFOUND' ||
              error.code === 'ETIMEDOUT' ||
              error.code === 'ECONNREFUSED' ||
              (error.response?.status && error.response.status >= 500 && error.response.status < 600) ||
              error.response?.status === 429; // Rate limit
            
            if (isRetryableError && retryCount <= maxRetries) {
              const delayMs = Math.min(1000 * Math.pow(2, retryCount - 1), 10000); // Exponential backoff, max 10s
              await new Promise(resolve => setTimeout(resolve, delayMs));
              continue;
            } else {
              console.error(`Failed to sync calendar ${calendarId}:`, error.message || String(calendarError));
              break; // Exit retry loop
            }
          }
        }
      }

      // Update last sync time
      await prisma.calendarConnection.update({
        where: { id: connection.id },
        data: { lastSyncAt: new Date() },
      });

      return {
        success: true,
        eventsProcessed: totalEventsProcessed,
        message: `Synced ${totalEventsProcessed} events from Google Calendar`,
      };
    } catch (error) {
      console.error('❌ Google calendar sync failed:', error);
      
      // Enhanced error logging
      if (error && typeof error === 'object' && 'response' in error) {
        const axiosError = error as { response?: { status?: number; statusText?: string; data?: unknown } };
        console.error('Google API Error Response:', {
          status: axiosError.response?.status,
          statusText: axiosError.response?.statusText,
          data: axiosError.response?.data
        });
      }
      
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Sync Teams calendar (uses same API as Outlook)
   */
  static async syncTeamsCalendar(connection: {
    id: string;
    providerId: string;
    calendarId: string;
    accessToken: string;
    refreshToken?: string;
    tokenExpiry: Date | null;
    platform: string;
  }, dateRange?: DateRange) {
    // Teams uses the same Microsoft Graph API as Outlook
    return this.syncOutlookCalendar(connection, dateRange);
  }

  /**
   * Sync Apple iCloud calendar using modern CalDAV
   */
  static async syncAppleCalendar(connection: {
    id: string;
    providerId: string;
    calendarId: string;
    accessToken: string;
    refreshToken?: string;
    tokenExpiry: Date | null;
    platform: string;
  }, dateRange?: DateRange) {
    // Get the full connection details including email
    const fullConnection = await prisma.calendarConnection.findFirst({
      where: { id: connection.id }
    });
    
    if (!fullConnection) {
      throw new Error(`Apple connection ${connection.id} not found`);
    }
    
    // TODO: Implement date range filtering for Apple calendar sync
    // For now, using the existing Apple sync service without date filtering
    console.log(`📅 Apple calendar sync requested for ${dateRange?.start.toDateString()} to ${dateRange?.end.toDateString()} (date filtering not yet implemented)`);
    
    return AppleCalendarService.syncCalendarEvents({
      ...connection,
      email: fullConnection.email
    });
  }

  /**
   * Process Outlook calendar event
   */
  private static async processOutlookEvent(
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    providerId: string, 
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    event: {
      id: string;
      subject?: string;
      body?: { content?: string };
      start: { dateTime?: string; date?: string };
      end: { dateTime?: string; date?: string };
      location?: { displayName?: string };
      isAllDay?: boolean;
    }, 
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    calendarId: string,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    connectionId: string
  ) {
    // Implementation for processing Outlook events
  }

  /**
   * Process Google calendar event
   */
  private static async processGoogleEvent(
    providerId: string,
    event: {
      id: string;
      summary?: string;
      description?: string;
      start?: { dateTime?: string; date?: string };
      end?: { dateTime?: string; date?: string };
      location?: string;
    },
    calendarId: string,
    connectionId: string
  ) {
    const startTime = new Date(event.start?.dateTime || event.start?.date || '');
    const endTime = new Date(event.end?.dateTime || event.end?.date || '');
    
    // Skip events without valid dates
    if (isNaN(startTime.getTime()) || isNaN(endTime.getTime())) {
      return;
    }

    // Format location from calendar event
    const locationText = event.location || '';
    const locationInfo = LocationService.parseLocation(locationText);

    await prisma.calendarEvent.upsert({
      where: {
        externalEventId_platform_calendarId: {
          externalEventId: event.id,
          platform: CalendarPlatform.GOOGLE,
          calendarId,
        },
      },
      update: {
        title: event.summary || 'Untitled Event',
        description: event.description || '',
        startTime,
        endTime,
        isAllDay: !event.start?.dateTime, // All-day if no specific time
        location: locationInfo.displayLocation,
        lastSyncAt: new Date(),
      },
      create: {
        providerId,
        connectionId,
        externalEventId: event.id,
        platform: CalendarPlatform.GOOGLE,
        calendarId,
        title: event.summary || 'Untitled Event',
        description: event.description || '',
        startTime,
        endTime,
        isAllDay: !event.start?.dateTime, // All-day if no specific time
        location: locationInfo.displayLocation,
        allowBookings: true, // Provider can disable later if needed
        maxBookings: 1,
      },
    });
  }
  
  // Fast booking-specific sync methods with date range filtering
  // These are optimized for client-side appointment booking lookups

  /**
   * Fast sync for booking lookups - only syncs events in the specified date range
   */
  static async syncForBookingLookup(providerId: string, dateRange: DateRange) {
    const connections = await prisma.calendarConnection.findMany({
      where: {
        providerId,
        isActive: true,
        syncEvents: true,
      },
    });

    const syncPromises = connections.map(async (connection) => {
      const syncConnection = {
        id: connection.id,
        providerId: connection.providerId,
        platform: connection.platform,
        accessToken: connection.accessToken,
        refreshToken: connection.refreshToken || undefined,
        calendarId: connection.calendarId,
        tokenExpiry: connection.tokenExpiry,
        selectedCalendars: connection.selectedCalendars,
        calendarSettings: connection.calendarSettings,
      };

      switch (connection.platform) {
        case 'GOOGLE':
          return this.syncGoogleCalendarForBooking(syncConnection, dateRange);
        case 'OUTLOOK':
          return this.syncOutlookCalendarForBooking(syncConnection, dateRange);
        case 'TEAMS':
          return this.syncTeamsCalendarForBooking(syncConnection, dateRange);
        case 'APPLE':
          return this.syncAppleCalendarForBooking(syncConnection, dateRange);
        default:
          console.warn(`Unsupported platform: ${connection.platform}`);
          return { success: false, error: 'Unsupported platform' };
      }
    });

    const results = await Promise.allSettled(syncPromises);
    const successfulSyncs = results.filter(result => 
      result.status === 'fulfilled' && result.value?.success
    ).length;

    return { success: true, synced: successfulSyncs, total: connections.length };
  }

  private static async syncGoogleCalendarForBooking(connection: {
    id: string;
    providerId: string;
    calendarId: string;
    accessToken: string;
    refreshToken?: string;
    tokenExpiry: Date | null;
    platform: string;
    selectedCalendars?: unknown;
    calendarSettings?: unknown;
  }, dateRange: DateRange) {
    try {
      const validConnection = {
        ...connection,
        refreshToken: connection.refreshToken || null
      };
      const accessToken = await ensureValidToken(validConnection);

      // Determine which calendars to sync (same logic as full sync)
      let calendarsToSync: string[] = [connection.calendarId];
      
      if (connection.selectedCalendars && Array.isArray(connection.selectedCalendars)) {
        const calendarSettings = connection.calendarSettings as Record<string, { syncEvents?: boolean; allowBookings?: boolean }> | null;
        
        calendarsToSync = (connection.selectedCalendars as string[]).filter(calendarId => {
          const settings = calendarSettings?.[calendarId];
          return settings?.syncEvents === true;
        });
      }

      // Process all calendars in parallel for maximum speed
      const calendarPromises = calendarsToSync.map(async (calendarId) => {
        const params: Record<string, string | number | boolean> = {
          maxResults: 250,
          singleEvents: true,
          orderBy: 'startTime',
          timeMin: dateRange.start.toISOString(),
          timeMax: dateRange.end.toISOString(), // Key optimization: only get events in booking window
        };

        const response = await axios.get(
          `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`,
          {
            headers: { Authorization: `Bearer ${accessToken}` },
            params,
          }
        );

        const events = response.data.items || [];

        let calendarEventsProcessed = 0;

        // Process events for this calendar
        for (const event of events) {
          if (!event.start?.dateTime && !event.start?.date) continue;

          const startTime = new Date(event.start.dateTime || event.start.date);
          const endTime = new Date(event.end?.dateTime || event.end?.date || startTime);

          // Skip events outside our exact range (extra safety)
          if (startTime < dateRange.start || startTime > dateRange.end) continue;

          // Get location info
          const locationText = event.location || '';
          const locationInfo = LocationService.parseLocation(locationText);

          // Upsert calendar event
          await prisma.calendarEvent.upsert({
            where: {
              externalEventId_platform_calendarId: {
                externalEventId: event.id,
                platform: CalendarPlatform.GOOGLE,
                calendarId,
              },
            },
            update: {
              title: event.summary || 'Untitled Event',
              description: event.description || '',
              startTime,
              endTime,
              isAllDay: !event.start?.dateTime,
              location: locationInfo.displayLocation,
              lastSyncAt: new Date(),
            },
            create: {
              providerId: connection.providerId,
              connectionId: connection.id,
              externalEventId: event.id,
              platform: CalendarPlatform.GOOGLE,
              calendarId,
              title: event.summary || 'Untitled Event',
              description: event.description || '',
              startTime,
              endTime,
              isAllDay: !event.start?.dateTime,
              location: locationInfo.displayLocation,
              allowBookings: true,
              maxBookings: 1,
            },
          });

          calendarEventsProcessed++;
        }

        return calendarEventsProcessed;
      });

      // Wait for all calendar syncs to complete in parallel
      const calendarResults = await Promise.allSettled(calendarPromises);
      const totalEventsProcessed = calendarResults
        .filter(result => result.status === 'fulfilled')
        .reduce((total, result) => total + (result.value || 0), 0);

      // Update connection sync timestamp
      await prisma.calendarConnection.update({
        where: { id: connection.id },
        data: { lastSyncAt: new Date() },
      });

      return { success: true, eventsProcessed: totalEventsProcessed };
    } catch (error) {
      console.error('Fast Google calendar sync failed:', error);
      
      // Check if this is a token refresh error
      if (error instanceof Error && error.message.includes('Token refresh failed')) {
        return { 
          success: false, 
          error: 'Authentication required',
          requiresReauth: true,
          message: 'Google calendar needs to be reconnected'
        };
      }
      
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }

  private static async syncOutlookCalendarForBooking(connection: {
    id: string;
    providerId: string;
    calendarId: string;
    accessToken: string;
    refreshToken?: string;
    tokenExpiry: Date | null;
    platform: string;
    selectedCalendars?: unknown;
    calendarSettings?: unknown;
  }, dateRange: DateRange) {
    try {
      console.log('🌐 Fast Outlook calendar sync for booking lookup');

      const validConnection = {
        ...connection,
        refreshToken: connection.refreshToken || null
      };
      const accessToken = await ensureValidToken(validConnection);

      let calendarsToSync: string[] = [connection.calendarId];
      
      if (connection.selectedCalendars && Array.isArray(connection.selectedCalendars)) {
        const calendarSettings = connection.calendarSettings as Record<string, { syncEvents?: boolean; allowBookings?: boolean }> | null;
        
        calendarsToSync = (connection.selectedCalendars as string[]).filter(calendarId => {
          const settings = calendarSettings?.[calendarId];
          return settings?.syncEvents === true;
        });
      }

      // Process all calendars in parallel for maximum speed
      const calendarPromises = calendarsToSync.map(async (calendarId) => {
        // Microsoft Graph API with date filtering
        const startFilter = dateRange.start.toISOString();
        const endFilter = dateRange.end.toISOString();
        
        const params: Record<string, string | number> = {
          $select: 'id,subject,body,start,end,location,isAllDay',
          $top: 250,
          $filter: `start/dateTime ge '${startFilter}' and start/dateTime le '${endFilter}'`,
        };

        console.log(`📡 Fast fetching Outlook events for ${calendarId} (${startFilter} to ${endFilter})`);
        
        const response = await axios.get(
          `https://graph.microsoft.com/v1.0/me/calendars/${calendarId}/events`,
          {
            headers: {
              Authorization: `Bearer ${accessToken}`,
              'Content-Type': 'application/json',
            },
            params,
          }
        );

        const events = response.data.value || [];
        console.log(`📅 Found ${events.length} events in booking window for Outlook calendar ${calendarId}`);

        let calendarEventsProcessed = 0;
        for (const event of events) {
          const startTime = new Date(event.start.dateTime);
          const endTime = new Date(event.end.dateTime);

          // Skip events outside our range (extra safety)
          if (startTime < dateRange.start || startTime > dateRange.end) continue;

          const locationText = event.location?.displayName || '';
          const locationInfo = LocationService.parseLocation(locationText);

          await prisma.calendarEvent.upsert({
            where: {
              externalEventId_platform_calendarId: {
                externalEventId: event.id,
                platform: CalendarPlatform.OUTLOOK,
                calendarId,
              },
            },
            update: {
              title: event.subject || 'Untitled Event',
              description: event.body?.content || '',
              startTime,
              endTime,
              isAllDay: event.isAllDay || false,
              location: locationInfo.displayLocation,
              lastSyncAt: new Date(),
            },
            create: {
              providerId: connection.providerId,
              connectionId: connection.id,
              externalEventId: event.id,
              platform: CalendarPlatform.OUTLOOK,
              calendarId,
              title: event.subject || 'Untitled Event',
              description: event.body?.content || '',
              startTime,
              endTime,
              isAllDay: event.isAllDay || false,
              location: locationInfo.displayLocation,
              allowBookings: true,
              maxBookings: 1,
            },
          });

          calendarEventsProcessed++;
        }

        return calendarEventsProcessed;
      });

      // Wait for all calendar syncs to complete in parallel
      const calendarResults = await Promise.allSettled(calendarPromises);
      const totalEventsProcessed = calendarResults
        .filter(result => result.status === 'fulfilled')
        .reduce((total, result) => total + (result.value || 0), 0);

      console.log(`✅ Fast Outlook sync processed ${totalEventsProcessed} events across ${calendarsToSync.length} calendars`);

      await prisma.calendarConnection.update({
        where: { id: connection.id },
        data: { lastSyncAt: new Date() },
      });

      return { success: true, eventsProcessed: totalEventsProcessed };
    } catch (error) {
      console.error('Fast Outlook calendar sync failed:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }

  private static async syncTeamsCalendarForBooking(
    connection: {
      id: string;
      providerId: string;
      calendarId: string;
      accessToken: string;
      refreshToken?: string;
      tokenExpiry: Date | null;
      platform: string;
    }, 
    dateRange: DateRange
  ) {
    console.log(`⚠️ Teams calendar fast sync not yet implemented, falling back to regular sync for ${dateRange.start.toDateString()} - ${dateRange.end.toDateString()}`);
    return this.syncTeamsCalendar(connection);
  }

  private static async syncAppleCalendarForBooking(
    connection: {
      id: string;
      providerId: string;
      calendarId: string;
      accessToken: string;
      refreshToken?: string;
      tokenExpiry: Date | null;
      platform: string;
    }, 
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    dateRange: DateRange
  ) {
    return this.syncAppleCalendar(connection);
  }
}
