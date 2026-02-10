// Availability management service
import { prisma } from '@/lib/db';
import { toZonedTime, fromZonedTime, format } from 'date-fns-tz';
import { 
  AvailabilitySettings, 
  AvailabilityTemplateWithSlots, 
  AvailabilityTimeSlot,
  DEFAULT_AVAILABILITY,
  getActiveTemplate,
  isProviderAvailable
} from '@/types/availability';

export class AvailabilityService {
  /**
   * Create default availability template for a new provider
   */
  static async createDefaultTemplate(providerId: string): Promise<AvailabilityTemplateWithSlots> {
    return await prisma.$transaction(async (tx) => {
      // First, unset any existing defaults for this provider (safety check)
      await tx.availabilityTemplate.updateMany({
        where: { providerId },
        data: { isDefault: false },
      });

      const template = await tx.availabilityTemplate.create({
        data: {
          providerId,
          name: DEFAULT_AVAILABILITY.templateName,
          timezone: DEFAULT_AVAILABILITY.timezone,
          isDefault: true,
          isActive: true,
          timeSlots: {
            create: DEFAULT_AVAILABILITY.weeklySchedule
              .filter(day => day.isEnabled)
              .flatMap(day => 
                day.timeSlots.map(slot => ({
                  dayOfWeek: day.dayOfWeek,
                  startTime: slot.startTime,
                  endTime: slot.endTime,
                  isEnabled: slot.isEnabled,
                }))
              ),
          },
          assignments: {
            create: {
              startDate: new Date(),
              endDate: null, // Indefinite
            },
          },
        },
        include: {
          timeSlots: true,
          assignments: true,
        },
      });

      return template;
    });
  }

  /**
   * Get all availability templates for a provider
   */
  static async getProviderTemplates(providerId: string): Promise<AvailabilityTemplateWithSlots[]> {
    return await prisma.availabilityTemplate.findMany({
      where: {
        providerId,
        isActive: true,
      },
      include: {
        timeSlots: {
          orderBy: [
            { dayOfWeek: 'asc' },
            { startTime: 'asc' },
          ],
        },
        assignments: {
          orderBy: { startDate: 'desc' },
        },
      },
      orderBy: [
        { isDefault: 'desc' },
        { name: 'asc' },
      ],
    });
  }

  /**
   * Get active template for a provider on a specific date
   */
  static async getActiveTemplateForDate(
    providerId: string, 
    date: Date
  ): Promise<AvailabilityTemplateWithSlots | null> {
    const templates = await this.getProviderTemplates(providerId);
    return getActiveTemplate(templates, date);
  }

  /**
   * Create or update availability template
   */
  static async saveTemplate(
    providerId: string,
    settings: AvailabilitySettings
  ): Promise<AvailabilityTemplateWithSlots> {
    const templateData = {
      providerId,
      name: settings.templateName,
      timezone: settings.timezone,
      isDefault: settings.isDefault,
      isActive: true,
    };

    const timeSlotData = settings.weeklySchedule
      .filter(day => day.isEnabled)
      .flatMap(day => 
        day.timeSlots.map(slot => ({
          dayOfWeek: day.dayOfWeek,
          startTime: slot.startTime,
          endTime: slot.endTime,
          isEnabled: slot.isEnabled,
        }))
      );

    // If setting this template as default, we need to unset other defaults
    if (settings.isDefault) {
      return await prisma.$transaction(async (tx) => {
        // First, unset all other defaults for this provider
        await tx.availabilityTemplate.updateMany({
          where: {
            providerId,
            ...(settings.templateId ? { id: { not: settings.templateId } } : {}),
          },
          data: { isDefault: false },
        });

        if (settings.templateId) {
          // Update existing template
          const template = await tx.availabilityTemplate.update({
            where: { id: settings.templateId },
            data: {
              ...templateData,
              timeSlots: {
                deleteMany: {}, // Remove all existing slots
                create: timeSlotData, // Create new ones
              },
            },
            include: {
              timeSlots: true,
              assignments: true,
            },
          });

          return template;
        } else {
          // Create new template
          const template = await tx.availabilityTemplate.create({
            data: {
              ...templateData,
              timeSlots: {
                create: timeSlotData,
              },
            },
            include: {
              timeSlots: true,
              assignments: true,
            },
          });

          return template;
        }
      });
    } else {
      // Not setting as default, proceed normally
      if (settings.templateId) {
        // Update existing template
        const template = await prisma.availabilityTemplate.update({
          where: { id: settings.templateId },
          data: {
            ...templateData,
            timeSlots: {
              deleteMany: {}, // Remove all existing slots
              create: timeSlotData, // Create new ones
            },
          },
          include: {
            timeSlots: true,
            assignments: true,
          },
        });

        return template;
      } else {
        // Create new template
        const template = await prisma.availabilityTemplate.create({
          data: {
            ...templateData,
            timeSlots: {
              create: timeSlotData,
            },
          },
          include: {
            timeSlots: true,
            assignments: true,
          },
        });

        return template;
      }
    }
  }

  /**
   * Set template as default (unsets others)
   */
  static async setDefaultTemplate(templateId: string): Promise<void> {
    const template = await prisma.availabilityTemplate.findUnique({
      where: { id: templateId },
      select: { providerId: true },
    });

    if (!template) {
      throw new Error('Template not found');
    }

    await prisma.$transaction([
      // Unset all other defaults for this provider
      prisma.availabilityTemplate.updateMany({
        where: {
          providerId: template.providerId,
          id: { not: templateId },
        },
        data: { isDefault: false },
      }),
      // Set this template as default
      prisma.availabilityTemplate.update({
        where: { id: templateId },
        data: { isDefault: true },
      }),
    ]);
  }

  /**
   * Assign template to date range
   */
  static async assignTemplate(
    templateId: string,
    startDate: Date,
    endDate?: Date
  ): Promise<void> {
    await prisma.templateAssignment.create({
      data: {
        templateId,
        startDate,
        endDate: endDate || null,
      },
    });
  }

  /**
   * Delete availability template
   */
  static async deleteTemplate(templateId: string): Promise<void> {
    const template = await prisma.availabilityTemplate.findUnique({
      where: { id: templateId },
      select: { isDefault: true, providerId: true },
    });

    if (!template) {
      throw new Error('Template not found');
    }

    if (template.isDefault) {
      throw new Error('Cannot delete default template');
    }

    await prisma.availabilityTemplate.delete({
      where: { id: templateId },
    });
  }

  /**
   * Get availability preview - shows which days have availability without generating full slots
   * Much faster than full slot generation for initial page load
   */
  static async getAvailabilityPreview(
    providerId: string,
    startDate: Date,
    endDate: Date,
    durations: number[]
  ): Promise<Array<{
    date: string;
    dayOfWeek: string;
    hasAvailability: boolean;
    availableDurations: number[];
    timeWindows: Array<{ start: string; end: string }>;
  }>> {
    // Get templates and assignments (lightweight query)
    const templates = await prisma.availabilityTemplate.findMany({
      where: { providerId, isActive: true },
      include: { timeSlots: true }
    });

    const assignments = await prisma.templateAssignment.findMany({
      where: {
        template: { providerId },
        startDate: { lte: endDate },
        OR: [
          { endDate: null },
          { endDate: { gte: startDate } }
        ]
      }
    });

    // Get busy periods for conflict checking
    const [busyEvents, existingBookings] = await Promise.all([
      prisma.calendarEvent.findMany({
        where: {
          providerId,
          startTime: { lt: endDate },
          endTime: { gt: startDate }
        },
        select: { startTime: true, endTime: true }
      }),
      prisma.booking.findMany({
        where: {
          providerId,
          scheduledAt: { gte: startDate, lt: endDate },
          status: { in: ['CONFIRMED', 'PENDING'] }
        },
        select: { scheduledAt: true, duration: true }
      })
    ]);

    // Build busy periods map
    const busyPeriodsByDate = new Map<string, Array<{ start: Date; end: Date }>>();
    
    busyEvents.forEach((event: { startTime: Date; endTime: Date }) => {
      const dateKey = event.startTime.toISOString().split('T')[0];
      if (!busyPeriodsByDate.has(dateKey)) {
        busyPeriodsByDate.set(dateKey, []);
      }
      busyPeriodsByDate.get(dateKey)!.push({
        start: event.startTime,
        end: event.endTime
      });
    });

    existingBookings.forEach((booking: { scheduledAt: Date; duration: number }) => {
      const dateKey = booking.scheduledAt.toISOString().split('T')[0];
      if (!busyPeriodsByDate.has(dateKey)) {
        busyPeriodsByDate.set(dateKey, []);
      }
      const endTime = new Date(booking.scheduledAt);
      endTime.setMinutes(endTime.getMinutes() + booking.duration);
      busyPeriodsByDate.get(dateKey)!.push({
        start: booking.scheduledAt,
        end: endTime
      });
    });

    const results = [];

    // Check each date for availability
    const totalDays = Math.ceil((endDate.getTime() - startDate.getTime()) / (24 * 60 * 60 * 1000)) + 1;
    
    for (let i = 0; i < totalDays; i++) {
      const currentDate = new Date(startDate);
      currentDate.setDate(startDate.getDate() + i);
      
      // Use local date for both key and display to avoid timezone mismatches
      const year = currentDate.getFullYear();
      const month = String(currentDate.getMonth() + 1).padStart(2, '0');
      const day = String(currentDate.getDate()).padStart(2, '0');
      const dateKey = `${year}-${month}-${day}`;
      const dayOfWeek = currentDate.getDay();

      // Get the active template for this date
      const template = this.getTemplateForDateOptimized(templates, assignments, currentDate);
      if (!template) {
        results.push({
          date: dateKey,
          dayOfWeek: currentDate.toLocaleDateString('en-US', { weekday: 'long' }),
          hasAvailability: false,
          availableDurations: [],
          timeWindows: []
        });
        continue;
      }

      // Get time slots for this day of week
      const daySlots = template.timeSlots.filter(
        (slot: { dayOfWeek: number; isEnabled: boolean }) => 
          slot.dayOfWeek === dayOfWeek && slot.isEnabled
      );

      if (daySlots.length === 0) {
        results.push({
          date: dateKey,
          dayOfWeek: currentDate.toLocaleDateString('en-US', { weekday: 'long' }),
          hasAvailability: false,
          availableDurations: [],
          timeWindows: []
        });
        continue;
      }

      // Get busy periods for this date
      const busyPeriods = busyPeriodsByDate.get(dateKey) || [];

      // Check which durations have availability (quick check, not full slot generation)
      const availableDurations = [];
      const timeWindows = daySlots.map((slot: { startTime: string; endTime: string }) => ({
        start: slot.startTime,
        end: slot.endTime
      }));

      for (const duration of durations) {
        // Quick check: see if any time window can fit this duration
        const canFitDuration = daySlots.some((slot: { startTime: string; endTime: string }) => {
          const slotStart = new Date(currentDate);
          const [startHours, startMinutes] = slot.startTime.split(':').map(Number);
          slotStart.setHours(startHours, startMinutes, 0, 0);

          const slotEnd = new Date(currentDate);
          const [endHours, endMinutes] = slot.endTime.split(':').map(Number);
          slotEnd.setHours(endHours, endMinutes, 0, 0);

          // Check if the duration fits in the time window
          const durationMs = duration * 60 * 1000;
          const windowMs = slotEnd.getTime() - slotStart.getTime();

          if (windowMs < durationMs) return false;

          // Quick conflict check - if the entire window is busy, no availability
          const entireWindowBusy = busyPeriods.some(busy =>
            busy.start <= slotStart && busy.end >= slotEnd
          );

          return !entireWindowBusy;
        });

        if (canFitDuration) {
          availableDurations.push(duration);
        }
      }

      results.push({
        date: dateKey,
        dayOfWeek: currentDate.toLocaleDateString('en-US', { weekday: 'long' }),
        hasAvailability: availableDurations.length > 0,
        availableDurations,
        timeWindows
      });
    }

    return results;
  }

  /**
   * Optimized method to get available slots for multiple durations across a date range
   * This reduces database calls by batching operations
   */
  static async getAvailableSlotsOptimized(
    providerId: string,
    startDate: Date,
    endDate: Date,
    durations: number[]
  ): Promise<Array<{
    date: Date;
    duration: number;
    timeSlots: string[];
  }>> {
    // Get all templates for the provider in one query
    const templates = await prisma.availabilityTemplate.findMany({
      where: { providerId, isActive: true },
      include: { timeSlots: true }
    });

    // Get all assignments that could apply to this date range
    const assignments = await prisma.templateAssignment.findMany({
      where: {
        template: { providerId },
        startDate: { lte: endDate },
        OR: [
          { endDate: null },
          { endDate: { gte: startDate } }
        ]
      }
    });

    // Get all busy periods for the entire date range in one query
    const [busyEvents, existingBookings] = await Promise.all([
      prisma.calendarEvent.findMany({
        where: {
          providerId,
          startTime: { lt: endDate },
          endTime: { gt: startDate }
        },
        select: { startTime: true, endTime: true }
      }),
      prisma.booking.findMany({
        where: {
          providerId,
          scheduledAt: { gte: startDate, lt: endDate },
          status: { in: ['CONFIRMED', 'PENDING'] }
        },
        select: { scheduledAt: true, duration: true }
      })
    ]);

    // Build a map of busy periods by date for faster lookup
    const busyPeriodsByDate = new Map<string, Array<{ start: Date; end: Date }>>();
    
    // Process calendar events
    busyEvents.forEach((event: { startTime: Date; endTime: Date }) => {
      const dateKey = event.startTime.toISOString().split('T')[0];
      if (!busyPeriodsByDate.has(dateKey)) {
        busyPeriodsByDate.set(dateKey, []);
      }
      busyPeriodsByDate.get(dateKey)!.push({
        start: event.startTime,
        end: event.endTime
      });
    });

    // Process existing bookings
    existingBookings.forEach((booking: { scheduledAt: Date; duration: number }) => {
      const dateKey = booking.scheduledAt.toISOString().split('T')[0];
      if (!busyPeriodsByDate.has(dateKey)) {
        busyPeriodsByDate.set(dateKey, []);
      }
      const endTime = new Date(booking.scheduledAt);
      endTime.setMinutes(endTime.getMinutes() + booking.duration);
      busyPeriodsByDate.get(dateKey)!.push({
        start: booking.scheduledAt,
        end: endTime
      });
    });

    const results: Array<{ date: Date; duration: number; timeSlots: string[] }> = [];

    // Process each date
    const totalDays = Math.ceil((endDate.getTime() - startDate.getTime()) / (24 * 60 * 60 * 1000)) + 1;
    
    for (let i = 0; i < totalDays; i++) {
      const currentDate = new Date(startDate);
      currentDate.setDate(startDate.getDate() + i);
      const dateKey = currentDate.toISOString().split('T')[0];
      const dayOfWeek = currentDate.getDay();

      // Get the active template for this date
      const template = this.getTemplateForDateOptimized(templates, assignments, currentDate);
      if (!template) continue;

      // Get time slots for this day of week
      const daySlots = template.timeSlots.filter(
        (slot: { dayOfWeek: number; isEnabled: boolean }) => 
          slot.dayOfWeek === dayOfWeek && slot.isEnabled
      );
      if (daySlots.length === 0) continue;

      // Get busy periods for this date
      const busyPeriods = busyPeriodsByDate.get(dateKey) || [];

      // Process each duration
      for (const duration of durations) {
        const availableSlots = this.generateSlotsForDurationOptimized(
          currentDate,
          daySlots,
          busyPeriods,
          duration,
          template.timezone
        );

        if (availableSlots.length > 0) {
          results.push({
            date: new Date(currentDate),
            duration,
            timeSlots: availableSlots
          });
        }
      }
    }

    return results;
  }

  /**
   * Helper method to get template for a specific date from cached data
   */
  private static getTemplateForDateOptimized(
    templates: Array<{ id: string; isDefault: boolean; timezone: string; timeSlots: AvailabilityTimeSlot[] }>,
    assignments: Array<{ templateId: string; startDate: Date; endDate: Date | null }>,
    date: Date
  ) {
    // Check for specific assignment first
    const assignment = assignments.find(a => 
      date >= a.startDate && (a.endDate === null || date <= a.endDate)
    );

    if (assignment) {
      return templates.find(t => t.id === assignment.templateId);
    }

    // Fall back to default template
    return templates.find(t => t.isDefault);
  }

  /**
   * Helper method to generate available slots for a specific duration
   */
  private static generateSlotsForDurationOptimized(
    date: Date,
    daySlots: Array<{ startTime: string; endTime: string }>,
    busyPeriods: Array<{ start: Date; end: Date }>,
    duration: number,
    timezone: string = 'America/New_York'
  ): string[] {
    const availableSlots: string[] = [];

    for (const slot of daySlots) {
      // Create date strings in the provider's timezone, then convert to UTC for processing
      const dateStr = format(toZonedTime(date, timezone), 'yyyy-MM-dd', { timeZone: timezone });
      
      // Parse the slot times in the provider's timezone
      const slotStartLocal = new Date(`${dateStr}T${slot.startTime}:00`);
      const slotEndLocal = new Date(`${dateStr}T${slot.endTime}:00`);
      
      // Convert to UTC for consistent processing with busy periods
      const slotStart = fromZonedTime(slotStartLocal, timezone);
      const slotEnd = fromZonedTime(slotEndLocal, timezone);

      // Generate time slots within this availability window
      for (let currentTime = new Date(slotStart); currentTime < slotEnd; currentTime.setMinutes(currentTime.getMinutes() + 15)) {
        const appointmentEnd = new Date(currentTime);
        appointmentEnd.setMinutes(appointmentEnd.getMinutes() + duration);

        // Check if appointment would fit within the availability window
        if (appointmentEnd <= slotEnd) {
          // Check for conflicts with busy periods
          const hasConflict = busyPeriods.some(busy =>
            currentTime < busy.end && appointmentEnd > busy.start
          );

          if (!hasConflict) {
            // Convert back to provider timezone for display
            const localTime = toZonedTime(currentTime, timezone);
            const timeString = format(localTime, 'HH:mm', { timeZone: timezone });
            availableSlots.push(timeString);
          }
        }
      }
    }

    return availableSlots;
  }

  /**
   * Get available time slots for a provider on a specific date
   * Combines availability template with calendar conflict checking
   */
  static async getAvailableSlots(
    providerId: string,
    date: Date,
    duration: number
  ): Promise<string[]> {
    const template = await this.getActiveTemplateForDate(providerId, date);
    
    if (!template) {
      return []; // No availability template
    }

    const dayOfWeek = date.getDay();
    const daySlots = template.timeSlots.filter(
      slot => slot.dayOfWeek === dayOfWeek && slot.isEnabled
    );

    if (daySlots.length === 0) {
      return []; // No availability on this day
    }

    // Get busy periods from calendar events and existing bookings
    const startOfDay = new Date(date);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(date);
    endOfDay.setHours(23, 59, 59, 999);

    const [busyEvents, existingBookings] = await Promise.all([
      prisma.calendarEvent.findMany({
        where: {
          providerId,
          startTime: { gte: startOfDay },
          endTime: { lte: endOfDay },
        },
        select: { startTime: true, endTime: true },
      }),
      prisma.booking.findMany({
        where: {
          providerId,
          scheduledAt: { gte: startOfDay, lte: endOfDay },
          status: { in: ['CONFIRMED', 'PENDING'] },
        },
        select: { scheduledAt: true, duration: true },
      }),
    ]);

    // Convert to busy periods
    const busyPeriods = [
      ...busyEvents.map(event => ({
        start: event.startTime,
        end: event.endTime,
      })),
      ...existingBookings.map(booking => ({
        start: booking.scheduledAt,
        end: new Date(booking.scheduledAt.getTime() + (booking.duration * 60 * 1000)),
      })),
    ];

    // Generate possible time slots and check for conflicts
    const availableSlots: string[] = [];
    
    for (const daySlot of daySlots) {
      const startMinutes = this.timeStringToMinutes(daySlot.startTime);
      const endMinutes = this.timeStringToMinutes(daySlot.endTime);
      
      // Generate slots in 15-minute intervals
      for (let minutes = startMinutes; minutes + duration <= endMinutes; minutes += 15) {
        const timeString = this.minutesToTimeString(minutes);
        const slotStart = new Date(date);
        slotStart.setHours(Math.floor(minutes / 60), minutes % 60, 0, 0);
        const slotEnd = new Date(slotStart.getTime() + (duration * 60 * 1000));

        // Check for conflicts with busy periods
        const hasConflict = busyPeriods.some(busy => {
          return (
            (slotStart >= busy.start && slotStart < busy.end) ||
            (slotEnd > busy.start && slotEnd <= busy.end) ||
            (slotStart <= busy.start && slotEnd >= busy.end)
          );
        });

        if (!hasConflict && slotStart >= new Date()) { // Only future slots
          availableSlots.push(timeString);
        }
      }
    }

    return availableSlots;
  }

  /**
   * Check if provider is available at specific time
   */
  static async isAvailable(
    providerId: string,
    date: Date,
    startTime: string,
    duration: number
  ): Promise<boolean> {
    const template = await this.getActiveTemplateForDate(providerId, date);
    
    if (!template) {
      return false;
    }

    // Check template availability
    if (!isProviderAvailable(template, date, startTime, duration)) {
      return false;
    }

    // Check for calendar conflicts
    const slotStart = new Date(date);
    const [hours, minutes] = startTime.split(':').map(Number);
    slotStart.setHours(hours, minutes, 0, 0);
    const slotEnd = new Date(slotStart.getTime() + (duration * 60 * 1000));

    const [conflictingEvents, conflictingBookings] = await Promise.all([
      prisma.calendarEvent.count({
        where: {
          providerId,
          OR: [
            {
              AND: [
                { startTime: { lte: slotStart } },
                { endTime: { gt: slotStart } }
              ]
            },
            {
              AND: [
                { startTime: { lt: slotEnd } },
                { endTime: { gte: slotEnd } }
              ]
            },
            {
              AND: [
                { startTime: { gte: slotStart } },
                { endTime: { lte: slotEnd } }
              ]
            }
          ]
        }
      }),
      prisma.booking.count({
        where: {
          providerId,
          status: { in: ['CONFIRMED', 'PENDING'] },
          OR: [
            {
              AND: [
                { scheduledAt: { lte: slotStart } },
                { scheduledAt: { gte: new Date(slotStart.getTime() - 3 * 60 * 60 * 1000) } }
              ]
            }
          ]
        }
      })
    ]);

    if (conflictingEvents > 0 || conflictingBookings > 0) {
      // Log details for debugging
      const events = await prisma.calendarEvent.findMany({
        where: {
          providerId,
          OR: [
            {
              AND: [
                { startTime: { lte: slotStart } },
                { endTime: { gt: slotStart } }
              ]
            },
            {
              AND: [
                { startTime: { lt: slotEnd } },
                { endTime: { gte: slotEnd } }
              ]
            },
            {
              AND: [
                { startTime: { gte: slotStart } },
                { endTime: { lte: slotEnd } }
              ]
            }
          ]
        },
        select: {
          title: true,
          startTime: true,
          endTime: true,
          platform: true,
          calendarId: true,
        }
      });

      console.log('❌ Booking slot conflict detected:', {
        slotStart: slotStart.toISOString(),
        slotEnd: slotEnd.toISOString(),
        conflictingEvents,
        conflictingBookings,
        events: events.map(e => ({
          title: e.title,
          start: e.startTime.toISOString(),
          end: e.endTime.toISOString(),
          platform: e.platform,
          calendarId: e.calendarId,
        }))
      });
    }

    return conflictingEvents === 0 && conflictingBookings === 0;
  }

  /**
   * Update provider's allowed durations
   */
  static async updateAllowedDurations(
    providerId: string,
    durations: number[]
  ): Promise<void> {
    await prisma.provider.update({
      where: { id: providerId },
      data: { allowedDurations: durations },
    });
  }

  /**
   * Get provider's allowed durations
   */
  static async getAllowedDurations(providerId: string): Promise<number[]> {
    const provider = await prisma.provider.findUnique({
      where: { id: providerId },
      select: { allowedDurations: true },
    });

    return provider?.allowedDurations || [15, 30, 45, 60, 90];
  }

  /**
   * Get template assignments for a specific template
   */
  static async getTemplateAssignments(templateId: string) {
    return await prisma.templateAssignment.findMany({
      where: { templateId },
      include: {
        template: {
          select: { name: true, providerId: true },
        },
      },
      orderBy: { startDate: 'desc' },
    });
  }

  /**
   * Get template assignments within a date range for a provider
   */
  static async getAssignmentsInDateRange(
    providerId: string,
    startDate: Date,
    endDate: Date
  ) {
    return await prisma.templateAssignment.findMany({
      where: {
        template: { providerId },
        OR: [
          {
            AND: [
              { startDate: { lte: endDate } },
              {
                OR: [
                  { endDate: { gte: startDate } },
                  { endDate: null },
                ],
              },
            ],
          },
        ],
      },
      include: {
        template: {
          select: { name: true },
        },
      },
      orderBy: { startDate: 'desc' },
    });
  }

  /**
   * Get all template assignments for a provider
   */
  static async getAllAssignmentsForProvider(providerId: string) {
    return await prisma.templateAssignment.findMany({
      where: {
        template: { providerId },
      },
      include: {
        template: {
          select: { name: true },
        },
      },
      orderBy: { startDate: 'desc' },
    });
  }

  /**
   * Fix multiple default templates for a provider by keeping only the first one
   * This is a utility method to clean up data inconsistencies
   */
  static async fixMultipleDefaults(providerId: string): Promise<void> {
    const templates = await prisma.availabilityTemplate.findMany({
      where: {
        providerId,
        isDefault: true,
        isActive: true,
      },
      orderBy: [
        { createdAt: 'asc' }, // Keep the oldest one as default
      ],
    });

    if (templates.length > 1) {
      // Keep the first template as default, unset the rest
      const [, ...otherTemplates] = templates;
      
      await prisma.availabilityTemplate.updateMany({
        where: {
          id: { in: otherTemplates.map(t => t.id) },
        },
        data: { isDefault: false },
      });

      console.log(`Fixed ${otherTemplates.length} duplicate default templates for provider ${providerId}`);
    }
  }

  /**
   * Fix multiple defaults for all providers
   * This is a utility method to clean up data inconsistencies across the entire system
   */
  static async fixAllMultipleDefaults(): Promise<void> {
    const providersWithMultipleDefaults = await prisma.$queryRaw<Array<{ providerId: string; count: number }>>`
      SELECT "providerId", COUNT(*) as count
      FROM "availability_templates"
      WHERE "isDefault" = true AND "isActive" = true
      GROUP BY "providerId"
      HAVING COUNT(*) > 1
    `;

    for (const provider of providersWithMultipleDefaults) {
      await this.fixMultipleDefaults(provider.providerId);
    }

    console.log(`Fixed multiple defaults for ${providersWithMultipleDefaults.length} providers`);
  }

  // Helper methods
  private static timeStringToMinutes(timeString: string): number {
    const [hours, minutes] = timeString.split(':').map(Number);
    return hours * 60 + minutes;
  }

  private static minutesToTimeString(minutes: number): string {
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return `${hours.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}`;
  }
}
