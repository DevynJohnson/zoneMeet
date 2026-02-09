/**
 * Modern Apple Calendar (CalDAV) integration using secure axios implementation
 * No external CalDAV libraries needed - built with industry standards
 */

import axios from 'axios';
import { prisma } from '@/lib/db';

export interface AppleCalendarCredentials {
  appleId: string;
  appSpecificPassword: string;
}

export interface AppleCalendar {
  url: string;
  displayName: string;
  description?: string;
  ctag?: string;
  calendarColor?: string;
  timezone?: string;
}

export class AppleCalendarService {
  private static readonly CALDAV_BASE_URL = 'https://caldav.icloud.com';

  /**
   * Test Apple Calendar connection using CalDAV
   */
  static async testConnection(credentials: AppleCalendarCredentials): Promise<boolean> {
    try {
      // Test with a simple PROPFIND request to the CalDAV server
      const response = await axios({
        method: 'PROPFIND',
        url: `${this.CALDAV_BASE_URL}/`,
        auth: {
          username: credentials.appleId,
          password: credentials.appSpecificPassword,
        },
        headers: {
          'Content-Type': 'application/xml; charset=utf-8',
          'Depth': '0',
        },
        data: `<?xml version="1.0" encoding="UTF-8"?>
<propfind xmlns="DAV:">
  <prop>
    <current-user-principal />
  </prop>
</propfind>`,
        timeout: 15000,
        validateStatus: (status) => status >= 200 && status < 300,
      });

      console.log(`✅ Apple Calendar connection test successful (${response.status})`);
      return true;
    } catch (error) {
      console.error('❌ Apple Calendar connection test failed:', error);
      return false;
    }
  }

  /**
   * Connect Apple Calendar for a provider
   */
  static async connectAppleCalendar(
    providerId: string,
    credentials: AppleCalendarCredentials
  ) {
    try {
      // Test connection first
      const isConnected = await this.testConnection(credentials);
      
      if (!isConnected) {
        throw new Error('Failed to authenticate with Apple Calendar. Please check your Apple ID and App-Specific Password.');
      }

      // Store the connection in database
      const connection = await prisma.calendarConnection.create({
        data: {
          providerId,
          platform: 'APPLE' as const,
          email: credentials.appleId,
          calendarId: `apple-${credentials.appleId}`, // Generate a unique calendar ID
          accessToken: Buffer.from(JSON.stringify(credentials)).toString('base64'), // Encode credentials
          isActive: true,
          isDefaultForBookings: false,
          syncEvents: true,
          allowBookings: true,
          calendarName: 'Apple Calendar',
          lastSyncAt: new Date(),
        },
      });

      console.log('✅ Apple Calendar connected successfully');
      return connection;
    } catch (error) {
      console.error('Failed to connect Apple calendar:', error);
      throw new Error('Failed to connect Apple calendar. Please check your Apple ID and App-Specific Password.');
    }
  }

  /**
   * Get available Apple calendars for a provider
   */
  static async getAvailableCalendars(credentials: AppleCalendarCredentials): Promise<AppleCalendar[]> {
    try {
      // Test connection first
      const isConnected = await this.testConnection(credentials);
      if (!isConnected) {
        throw new Error('Failed to connect to Apple Calendar');
      }

      console.log('🔍 Discovering Apple calendars for:', credentials.appleId);

      // Discover actual calendars using CalDAV
      const calendarPaths = await this.discoverCalendarPaths(credentials);
      console.log(`📂 Found ${calendarPaths.length} calendar path(s)`);

      // Fetch details for each calendar
      const calendars: AppleCalendar[] = [];
      
      for (const calendarPath of calendarPaths) {
        try {
          // Get calendar properties
          const response = await axios({
            method: 'PROPFIND',
            url: calendarPath,
            auth: {
              username: credentials.appleId,
              password: credentials.appSpecificPassword,
            },
            headers: {
              'Content-Type': 'application/xml; charset=utf-8',
              'Depth': '0',
            },
            data: `<?xml version="1.0" encoding="UTF-8"?>
<propfind xmlns="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav" xmlns:cs="http://calendarserver.org/ns/" xmlns:a="http://apple.com/ns/ical/">
  <prop>
    <displayname />
    <c:calendar-description />
    <a:calendar-color />
    <c:calendar-timezone />
  </prop>
</propfind>`,
            timeout: 10000,
            validateStatus: (status) => status >= 200 && status < 300,
          });

          const responseData = String(response.data);
          console.log(`📄 Calendar ${calendarPath} response snippet:`, responseData.substring(0, 800));
          
          // Extract display name (handle namespace prefixes like D:displayname)
          const displayNameMatch = responseData.match(/<(?:displayname|D:displayname|d:displayname)[^>]*>([^<]+)<\/(?:displayname|D:displayname|d:displayname)>/i);
          let displayName = displayNameMatch ? displayNameMatch[1].trim() : '';
          
          // Fallback to last path segment if no display name, but make it more readable
          if (!displayName) {
            const pathSegment = calendarPath.split('/').filter(Boolean).pop() || 'Calendar';
            // If it looks like a UUID, use a generic name
            if (/^[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}$/i.test(pathSegment)) {
              displayName = 'Calendar';
            } else {
              displayName = pathSegment;
            }
          }
          
          // Extract description (handle namespace prefixes)
          const descMatch = responseData.match(/<(?:calendar-description|c:calendar-description|C:calendar-description)[^>]*>([^<]+)<\/(?:calendar-description|c:calendar-description|C:calendar-description)>/i);
          const description = descMatch ? descMatch[1].trim() : undefined;
          
          // Extract color (handle namespace prefixes)
          const colorMatch = responseData.match(/<(?:calendar-color|a:calendar-color|A:calendar-color)[^>]*>([^<]+)<\/(?:calendar-color|a:calendar-color|A:calendar-color)>/i);
          const color = colorMatch ? colorMatch[1].trim() : undefined;

          calendars.push({
            url: calendarPath,
            displayName,
            description,
            calendarColor: color,
            timezone: 'UTC',
          });

          console.log(`✅ Loaded calendar: ${displayName}`);
        } catch (error) {
          console.error(`Failed to fetch details for calendar ${calendarPath}:`, error);
        }
      }

      if (calendars.length === 0) {
        console.warn('⚠️ No calendars found, returning default');
        // Return a default calendar as fallback
        return [
          {
            url: `${this.CALDAV_BASE_URL}/${credentials.appleId.split('@')[0]}/calendars/`,
            displayName: 'Primary Calendar',
            description: 'Apple iCloud Calendar',
            timezone: 'UTC',
          },
        ];
      }

      return calendars;
    } catch (error) {
      console.error('Failed to fetch Apple calendars:', error);
      throw new Error('Failed to fetch Apple calendars');
    }
  }

  /**
   * Parse iCalendar data and extract event details
   */
  private static parseICalendarEvent(icalData: string): {
    uid: string;
    title: string;
    startTime: Date;
    endTime: Date;
    location?: string;
    description?: string;
  } | null {
    try {
      // Handle both \r\n and \n line endings
      const lines = icalData.split(/\r?\n/);
      let uid = '';
      let summary = '';
      let dtstart = '';
      let dtend = '';
      let dtstartTzid = '';
      let dtendTzid = '';
      let location = '';
      let description = '';
      
      for (const line of lines) {
        const trimmedLine = line.trim();
        if (trimmedLine.startsWith('UID:')) {
          uid = trimmedLine.substring(4);
        } else if (trimmedLine.startsWith('SUMMARY:')) {
          summary = trimmedLine.substring(8);
        } else if (trimmedLine.startsWith('DTSTART')) {
          // Handle both DTSTART:value and DTSTART;params:value
          const parts = trimmedLine.split(':');
          dtstart = parts[parts.length - 1];
          // Extract TZID if present
          const tzidMatch = trimmedLine.match(/TZID=([^:;]+)/);
          if (tzidMatch) {
            dtstartTzid = tzidMatch[1];
          }
        } else if (trimmedLine.startsWith('DTEND')) {
          // Handle both DTEND:value and DTEND;params:value
          const parts = trimmedLine.split(':');
          dtend = parts[parts.length - 1];
          // Extract TZID if present
          const tzidMatch = trimmedLine.match(/TZID=([^:;]+)/);
          if (tzidMatch) {
            dtendTzid = tzidMatch[1];
          }
        } else if (trimmedLine.startsWith('LOCATION:')) {
          location = trimmedLine.substring(9);
        } else if (trimmedLine.startsWith('DESCRIPTION:')) {
          description = trimmedLine.substring(12);
        }
      }

      if (!uid || !dtstart || !dtend) {
        console.warn('⚠️ Incomplete event data:', { uid, dtstart, dtend });
        return null;
      }

      // Parse iCalendar datetime format (YYYYMMDDTHHMMSSZ or YYYYMMDD)
      const parseICalDate = (dateStr: string, tzid?: string): Date => {
        // Check if the datetime is in UTC (ends with Z)
        const isUTC = dateStr.trim().endsWith('Z');
        
        // Log timezone info for debugging
        if (tzid) {
          console.log(`📍 Parsing datetime with TZID: ${tzid}, value: ${dateStr}`);
        }
        
        // Remove timezone info but preserve numbers and T separator
        const cleanDateStr = dateStr.replace(/[^0-9T]/g, '');
        
        if (cleanDateStr.length === 8) {
          // All-day event: YYYYMMDD
          const year = parseInt(cleanDateStr.substring(0, 4));
          const month = parseInt(cleanDateStr.substring(4, 6)) - 1;
          const day = parseInt(cleanDateStr.substring(6, 8));
          return new Date(Date.UTC(year, month, day, 0, 0, 0));
        } else {
          // Datetime: YYYYMMDDTHHMMSS[Z]
          const year = parseInt(cleanDateStr.substring(0, 4));
          const month = parseInt(cleanDateStr.substring(4, 6)) - 1;
          const day = parseInt(cleanDateStr.substring(6, 8));
          const hour = parseInt(cleanDateStr.substring(9, 11)) || 0;
          const minute = parseInt(cleanDateStr.substring(11, 13)) || 0;
          const second = parseInt(cleanDateStr.substring(13, 15)) || 0;
          
          if (isUTC) {
            // UTC time - use Date.UTC()
            return new Date(Date.UTC(year, month, day, hour, minute, second));
          } else {
            // NOTE: Without a timezone conversion library, we can't accurately convert
            // from the event's timezone to UTC. For now, we interpret non-UTC times
            // as-is. This may cause timezone display issues in dev/production if the
            // server timezone differs from the event's timezone.
            // TODO: Add proper timezone handling with a library like date-fns-tz or luxon
            console.warn(`⚠️ Non-UTC datetime without proper timezone conversion: ${dateStr} ${tzid ? `(TZID: ${tzid})` : ''}`);
            const localDate = new Date(year, month, day, hour, minute, second);
            return localDate;
          }
        }
      };

      const parsedEvent = {
        uid,
        title: summary || 'Untitled Event',
        startTime: parseICalDate(dtstart, dtstartTzid),
        endTime: parseICalDate(dtend, dtendTzid),
        location: location || undefined,
        description: description || undefined,
      };

      console.log('✅ Parsed event:', parsedEvent.title, parsedEvent.startTime);
      return parsedEvent;
    } catch (error) {
      console.error('Failed to parse iCalendar event:', error);
      console.error('Event data:', icalData.substring(0, 200));
      return null;
    }
  }

  /**
   * Fetch calendar events from Apple Calendar using CalDAV REPORT
   */
  private static async fetchCalendarEvents(
    credentials: AppleCalendarCredentials,
    calendarPath: string,
    startDate: Date,
    endDate: Date
  ) {
    try {
      const formatDate = (date: Date) => {
        return date.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
      };

      const reportQuery = `<?xml version="1.0" encoding="UTF-8"?>
<calendar-query xmlns="urn:ietf:params:xml:ns:caldav" xmlns:d="DAV:">
  <d:prop>
    <d:getetag/>
    <calendar-data/>
  </d:prop>
  <filter>
    <comp-filter name="VCALENDAR">
      <comp-filter name="VEVENT">
        <time-range start="${formatDate(startDate)}" end="${formatDate(endDate)}"/>
      </comp-filter>
    </comp-filter>
  </filter>
</calendar-query>`;

      const response = await axios({
        method: 'REPORT',
        url: calendarPath,
        auth: {
          username: credentials.appleId,
          password: credentials.appSpecificPassword,
        },
        headers: {
          'Content-Type': 'application/xml; charset=utf-8',
          'Depth': '1',
        },
        data: reportQuery,
        timeout: 30000,
        validateStatus: (status) => status >= 200 && status < 300,
      });

      // Parse the multistatus response
      const events: Array<{
        uid: string;
        title: string;
        startTime: Date;
        endTime: Date;
        location?: string;
        description?: string;
      }> = [];

      if (response.data) {
        // Extract VEVENT components from the response
        const dataStr = typeof response.data === 'string' ? response.data : String(response.data);
        const vevents = dataStr.match(/BEGIN:VEVENT[\s\S]*?END:VEVENT/g) || [];
        
        for (const vevent of vevents) {
          const parsed = this.parseICalendarEvent(vevent);
          if (parsed) {
            events.push(parsed);
          }
        }
      }

      return events;
    } catch (error) {
      console.error('Failed to fetch calendar events:', error);
      return [];
    }
  }

  /**
   * Discover available calendars for a user
   */
  private static async discoverCalendarPaths(
    credentials: AppleCalendarCredentials
  ): Promise<string[]> {
    try {
      console.log('🔍 Step 1: Getting principal URL');
      // First, get the user's principal URL
      const principalResponse = await axios({
        method: 'PROPFIND',
        url: `${this.CALDAV_BASE_URL}/`,
        auth: {
          username: credentials.appleId,
          password: credentials.appSpecificPassword,
        },
        headers: {
          'Content-Type': 'application/xml; charset=utf-8',
          'Depth': '0',
        },
        data: `<?xml version="1.0" encoding="UTF-8"?>
<propfind xmlns="DAV:">
  <prop>
    <current-user-principal />
  </prop>
</propfind>`,
        timeout: 15000,
        validateStatus: (status) => status >= 200 && status < 300,
      });

      // Extract principal path from response
      const principalData = String(principalResponse.data);
      console.log('📄 Principal response snippet:', principalData.substring(0, 500));
      const principalMatch = principalData.match(/<(?:current-user-principal|D:current-user-principal)[^>]*>\s*<(?:href|D:href)[^>]*>([^<]+)<\/(?:href|D:href)>/i);
      const principalPath = principalMatch ? principalMatch[1] : `/${credentials.appleId.split('@')[0]}/`;
      console.log('👤 Principal path:', principalPath);

      console.log('🔍 Step 2: Getting calendar-home-set');
      // Get calendar-home-set
      const homeSetResponse = await axios({
        method: 'PROPFIND',
        url: `${this.CALDAV_BASE_URL}${principalPath}`,
        auth: {
          username: credentials.appleId,
          password: credentials.appSpecificPassword,
        },
        headers: {
          'Content-Type': 'application/xml; charset=utf-8',
          'Depth': '0',
        },
        data: `<?xml version="1.0" encoding="UTF-8"?>
<propfind xmlns="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
  <prop>
    <c:calendar-home-set />
  </prop>
</propfind>`,
        timeout: 15000,
        validateStatus: (status) => status >= 200 && status < 300,
      });

      const homeSetData = String(homeSetResponse.data);
      console.log('📄 Calendar-home-set response snippet:', homeSetData.substring(0, 500));
      const homeSetMatch = homeSetData.match(/<(?:calendar-home-set|c:calendar-home-set|C:calendar-home-set)[^>]*>\s*<(?:href|D:href)[^>]*>([^<]+)<\/(?:href|D:href)>/i);
      const homeSetPath = homeSetMatch ? homeSetMatch[1] : `${principalPath}calendars/`;
      console.log('🏠 Calendar home-set path:', homeSetPath);

      // Determine the full URL for calendar-home-set (may already be absolute)
      const homeSetUrl = homeSetPath.startsWith('http://') || homeSetPath.startsWith('https://')
        ? homeSetPath
        : `${this.CALDAV_BASE_URL}${homeSetPath}`;
      console.log('🌐 Calendar home-set URL:', homeSetUrl);

      console.log('🔍 Step 3: Listing calendars');
      // List all calendars
      const calendarsResponse = await axios({
        method: 'PROPFIND',
        url: homeSetUrl,
        auth: {
          username: credentials.appleId,
          password: credentials.appSpecificPassword,
        },
        headers: {
          'Content-Type': 'application/xml; charset=utf-8',
          'Depth': '1',
        },
        data: `<?xml version="1.0" encoding="UTF-8"?>
<propfind xmlns="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
  <prop>
    <resourcetype />
    <displayname />
    <c:supported-calendar-component-set />
  </prop>
</propfind>`,
        timeout: 15000,
        validateStatus: (status) => status >= 200 && status < 300,
      });

      // Parse the multistatus response more carefully
      const calendarsData = String(calendarsResponse.data);
      console.log('📄 Calendars response length:', calendarsData.length);
      console.log('📄 Calendars response preview:', calendarsData.substring(0, 1000));
      
      // Split response into individual <response> elements (match with any attributes)
      const responseBlocks = calendarsData.split(/<(?:response|D:response)(?:\s[^>]*)?\s*>/i).slice(1);
      console.log('📦 Found', responseBlocks.length, 'response blocks');
      
      const calendarPaths: string[] = [];

      // Extract path portion from homeSetUrl for comparison (handles both relative and absolute URLs)
      const homeSetPathForComparison = homeSetUrl.startsWith('http://') || homeSetUrl.startsWith('https://')
        ? new URL(homeSetUrl).pathname
        : homeSetUrl;

      for (const block of responseBlocks) {
        // Extract href
        const hrefMatch = block.match(/<(?:href|D:href)[^>]*>([^<]+)<\/(?:href|D:href)>/i);
        if (!hrefMatch) continue;
        
        const path = hrefMatch[1];
        
        // Check if this is a calendar (not just a collection)
        const hasCalendar = block.match(/<(?:calendar|c:calendar|C:calendar)\s*\/>/i) || 
                          block.match(/<(?:resourcetype|D:resourcetype)[^>]*>[\s\S]*?<(?:calendar|c:calendar|C:calendar)/i);
        
        // Skip parent collection, inbox, outbox, and notifications
        const skipPatterns = [
          homeSetPathForComparison + '$', // exact match of parent
          '/inbox/',
          '/outbox/',
          '/notification/',
          '/dropbox/',
          '/attachments/'
        ];
        
        const shouldSkip = skipPatterns.some(pattern => {
          if (pattern.endsWith('$')) {
            return path === pattern.slice(0, -1);
          }
          return path.includes(pattern);
        });
        
        if (hasCalendar && !shouldSkip && path !== homeSetPathForComparison) {
          const fullPath = path.startsWith('http') ? path : `${this.CALDAV_BASE_URL}${path}`;
          calendarPaths.push(fullPath);
          console.log('✅ Found calendar:', path);
        } else {
          console.log('⏭️  Skipped:', path, '(hasCalendar:', !!hasCalendar, ', shouldSkip:', shouldSkip, ')');
        }
      }

      console.log('📊 Total calendars discovered:', calendarPaths.length);
      
      if (calendarPaths.length === 0) {
        console.warn('⚠️ No calendars found, using fallback');
      }

      return calendarPaths.length > 0 ? calendarPaths : [
        `${this.CALDAV_BASE_URL}/${credentials.appleId.split('@')[0]}/calendars/`,
      ];
    } catch (error) {
      console.error('❌ Failed to discover calendar paths:', error);
      if (axios.isAxiosError(error)) {
        console.error('Response status:', error.response?.status);
        console.error('Response data:', error.response?.data);
      }
      // Fallback to common calendar paths
      return [
        `${this.CALDAV_BASE_URL}/${credentials.appleId.split('@')[0]}/calendars/`,
      ];
    }
  }

  /**
   * Sync Apple calendar events
   */
  static async syncCalendarEvents(connection: {
    id: string;
    providerId: string;
    accessToken: string;
    calendarId?: string | null;
    email?: string;
  }) {
    try {
      // For legacy connections, accessToken might be just the app password
      // For new connections, it should be base64-encoded JSON
      let credentials: AppleCalendarCredentials;
      
      try {
        // Try to decode as JSON first (new format)
        const decoded = Buffer.from(connection.accessToken, 'base64').toString('utf8');
        console.log('🔍 Decoded accessToken:', decoded.substring(0, 100) + '...');
        credentials = JSON.parse(decoded);
        console.log('✅ Successfully parsed JSON credentials');
      } catch (error) {
        // Fallback: treat accessToken as legacy format (email:password)
        console.log('⚠️ Failed to parse as JSON, treating as legacy format:', error);
        const decoded = Buffer.from(connection.accessToken, 'base64').toString('utf8');
        
        // Check if decoded string is in 'email:password' format
        if (decoded.includes(':')) {
          const [appleId, appSpecificPassword] = decoded.split(':', 2);
          credentials = {
            appleId: appleId.trim(),
            appSpecificPassword: appSpecificPassword.trim()
          };
          console.log('🔄 Using legacy credentials format (email:password):', appleId);
        } else {
          // Very old format: just the password, use email from connection
          credentials = {
            appleId: connection.email || 'unknown@icloud.com',
            appSpecificPassword: decoded
          };
          console.log('🔄 Using very old legacy credentials format');
        }
      }

      // Test connection
      const isConnected = await this.testConnection(credentials);
      if (!isConnected) {
        throw new Error('Apple Calendar connection failed during sync');
      }

      console.log(`📅 Starting Apple calendar sync for connection ${connection.id}`);

      // Discover calendar paths
      const calendarPaths = await this.discoverCalendarPaths(credentials);
      console.log(`📂 Found ${calendarPaths.length} calendar(s)`);

      // Fetch events from the last 30 days and next 90 days
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - 30);
      const endDate = new Date();
      endDate.setDate(endDate.getDate() + 90);

      let totalEventsCount = 0;

      // Fetch events from all calendars
      for (const calendarPath of calendarPaths) {
        console.log(`🔍 Fetching events from: ${calendarPath}`);
        const events = await this.fetchCalendarEvents(
          credentials,
          calendarPath,
          startDate,
          endDate
        );

        console.log(`📥 Fetched ${events.length} events from calendar`);

        // Store events in database
        for (const event of events) {
          try {
            // Check if event already exists (by external ID)
            const existingEvent = await prisma.calendarEvent.findFirst({
              where: {
                connectionId: connection.id,
                externalEventId: event.uid,
              },
            });

            if (existingEvent) {
              // Update existing event
              await prisma.calendarEvent.update({
                where: { id: existingEvent.id },
                data: {
                  title: event.title,
                  startTime: event.startTime,
                  endTime: event.endTime,
                  location: event.location || '',
                  description: event.description,
                },
              });
            } else {
              // Create new event
              await prisma.calendarEvent.create({
                data: {
                  connectionId: connection.id,
                  providerId: connection.providerId,
                  calendarId: connection.calendarId || connection.email || 'apple-calendar',
                  externalEventId: event.uid,
                  title: event.title,
                  startTime: event.startTime,
                  endTime: event.endTime,
                  location: event.location || '',
                  description: event.description,
                  platform: 'APPLE',
                },
              });
              totalEventsCount++;
            }
          } catch (eventError) {
            console.error(`Failed to store event ${event.uid}:`, eventError);
          }
        }
      }

      // Update last sync time
      await prisma.calendarConnection.update({
        where: { id: connection.id },
        data: { lastSyncAt: new Date() },
      });

      console.log(`✅ Apple calendar sync completed: ${totalEventsCount} new events`);

      return {
        success: true,
        eventsCount: totalEventsCount,
        calendarName: 'Apple Calendar',
      };
    } catch (error) {
      console.error('Apple calendar sync failed:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Create an event in Apple calendar
   */
  static async createEvent(
    connection: { accessToken: string; calendarId?: string | null },
    eventData: {
      title: string;
      description?: string;
      startTime: Date;
      endTime: Date;
      location?: string;
    }
  ) {
    try {
      const credentials: AppleCalendarCredentials = JSON.parse(
        Buffer.from(connection.accessToken, 'base64').toString()
      );

      // Generate iCalendar data
      const icalData = this.createICalendarData(eventData);
      
      // In a full implementation, you would PUT this to a CalDAV calendar URL
      const calendarUrl = `${this.CALDAV_BASE_URL}/${credentials.appleId}/calendars/`;
      const eventUrl = `${calendarUrl}${Date.now()}.ics`;

      await axios({
        method: 'PUT',
        url: eventUrl,
        auth: {
          username: credentials.appleId,
          password: credentials.appSpecificPassword,
        },
        headers: {
          'Content-Type': 'text/calendar; charset=utf-8',
          'If-None-Match': '*', // Ensure we're creating, not updating
        },
        data: icalData,
        timeout: 15000,
        validateStatus: (status) => status >= 200 && status < 300,
      });

      console.log('✅ Apple calendar event created successfully');
      return { success: true, eventUrl };
    } catch (error) {
      console.error('Failed to create Apple calendar event:', error);
      throw new Error('Failed to create Apple calendar event');
    }
  }

  /**
   * Generate iCalendar data for an event
   */
  private static createICalendarData(eventData: {
    title: string;
    description?: string;
    startTime: Date;
    endTime: Date;
    location?: string;
  }): string {
    const formatDate = (date: Date) => {
      return date.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
    };

    const uid = `${Date.now()}@appointmentscalendar.com`;
    const now = formatDate(new Date());
    const start = formatDate(eventData.startTime);
    const end = formatDate(eventData.endTime);

    return [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//Appointments Calendar//EN',
      'BEGIN:VEVENT',
      `UID:${uid}`,
      `DTSTAMP:${now}`,
      `DTSTART:${start}`,
      `DTEND:${end}`,
      `SUMMARY:${eventData.title}`,
      eventData.description ? `DESCRIPTION:${eventData.description}` : '',
      eventData.location ? `LOCATION:${eventData.location}` : '',
      'STATUS:CONFIRMED',
      'END:VEVENT',
      'END:VCALENDAR'
    ].filter(line => line).join('\r\n');
  }

  /**
   * Disconnect Apple calendar
   */
  static async disconnectAppleCalendar(connectionId: string) {
    try {
      await prisma.calendarConnection.update({
        where: { id: connectionId },
        data: { isActive: false },
      });

      console.log('✅ Apple Calendar disconnected successfully');
      return true;
    } catch (error) {
      console.error('Failed to disconnect Apple calendar:', error);
      throw new Error('Failed to disconnect Apple calendar');
    }
  }
}
