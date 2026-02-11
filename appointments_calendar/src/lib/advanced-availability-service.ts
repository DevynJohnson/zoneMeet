import { prisma } from '@/lib/db';
import type { AvailabilitySchedule } from '@prisma/client';

export interface AvailabilityScheduleInput {
  name: string;
  startDate: Date;
  endDate?: Date;
  isRecurring: boolean;
  recurrenceType?: 'DAILY' | 'WEEKLY' | 'BIWEEKLY' | 'MONTHLY' | 'BIMONTHLY' | 'QUARTERLY' | 'YEARLY' | 'CUSTOM';
  recurrenceInterval?: number;
  daysOfWeek?: number[];
  weekOfMonth?: number;
  monthOfYear?: number;
  recurrenceEndDate?: Date;
  occurrenceCount?: number;
  priority?: number;
  timeSlots: {
    dayOfWeek: number;
    startTime: string;
    endTime: string;
    isEnabled?: boolean;
    weekNumber?: number; // NEW: Which week in the pattern (0-indexed)
  }[];
}

export class AdvancedAvailabilityService {
  
  /**
   * Create a new availability schedule for a template
   */
  static async createSchedule(templateId: string, scheduleData: AvailabilityScheduleInput) {
    return await prisma.availabilitySchedule.create({
      data: {
        templateId,
        name: scheduleData.name,
        startDate: scheduleData.startDate,
        endDate: scheduleData.endDate,
        isRecurring: scheduleData.isRecurring,
        recurrenceType: scheduleData.recurrenceType,
        recurrenceInterval: scheduleData.recurrenceInterval,
        daysOfWeek: scheduleData.daysOfWeek || [],
        weekOfMonth: scheduleData.weekOfMonth,
        monthOfYear: scheduleData.monthOfYear,
        recurrenceEndDate: scheduleData.recurrenceEndDate,
        occurrenceCount: scheduleData.occurrenceCount,
        priority: scheduleData.priority || 0,
        timeSlots: {
          create: scheduleData.timeSlots.map(slot => ({
            dayOfWeek: slot.dayOfWeek,
            startTime: slot.startTime,
            endTime: slot.endTime,
            isEnabled: slot.isEnabled ?? true,
            weekNumber: slot.weekNumber ?? 0, // Default to week 0 for backwards compatibility
          }))
        }
      },
      include: {
        timeSlots: true,
      }
    });
  }

  /**
   * Get all schedules for a template, ordered by priority
   */
  static async getSchedulesForTemplate(templateId: string, activeOnly: boolean = true) {
    return await prisma.availabilitySchedule.findMany({
      where: { 
        templateId,
        ...(activeOnly && { isActive: true })
      },
      include: {
        timeSlots: {
          where: { isEnabled: true },
          orderBy: [
            { dayOfWeek: 'asc' },
            { startTime: 'asc' }
          ]
        }
      },
      orderBy: [
        { priority: 'desc' }, // Higher priority first
        { createdAt: 'asc' }
      ]
    });
  }

  /**
   * Calculate if a schedule is active on a specific date
   */
  static isScheduleActiveOnDate(schedule: AvailabilitySchedule, targetDate: Date): boolean {
    const scheduleStart = new Date(schedule.startDate);
    const scheduleEnd = schedule.endDate ? new Date(schedule.endDate) : null;

    // Debug logging for schedule matching
    console.log('[ADVANCED SCHEDULE DEBUG] Checking schedule:', {
      id: schedule.id,
      name: schedule.name,
      isActive: schedule.isActive,
      startDate: scheduleStart,
      endDate: scheduleEnd,
      isRecurring: schedule.isRecurring,
      recurrenceType: schedule.recurrenceType,
      recurrenceInterval: schedule.recurrenceInterval,
      daysOfWeek: schedule.daysOfWeek,
      weekOfMonth: schedule.weekOfMonth,
      monthOfYear: schedule.monthOfYear,
      recurrenceEndDate: schedule.recurrenceEndDate,
      occurrenceCount: schedule.occurrenceCount,
      targetDate,
    });

    // Check if date is within the schedule's date range
    if (targetDate < scheduleStart) {
      console.log('[ADVANCED SCHEDULE DEBUG] Target date is before schedule start date');
      return false;
    }
    if (scheduleEnd && targetDate > scheduleEnd) {
      console.log('[ADVANCED SCHEDULE DEBUG] Target date is after schedule end date');
      return false;
    }

    // If not recurring, active for whole date range
    if (!schedule.isRecurring) {
      if (scheduleEnd) {
        const isActive = targetDate.toDateString() >= scheduleStart.toDateString() && targetDate.toDateString() <= scheduleEnd.toDateString();
        console.log('[ADVANCED SCHEDULE DEBUG] Non-recurring schedule with end date. isActive:', isActive);
        return isActive;
      }
      // If no end date, active for all dates from startDate onward
      const isActive = targetDate >= scheduleStart;
      console.log('[ADVANCED SCHEDULE DEBUG] Non-recurring schedule with no end date. isActive:', isActive);
      return isActive;
    }

    // Handle recurring schedules
    const recurrenceMatch = this.isRecurrenceMatch(schedule, targetDate, scheduleStart);
    console.log('[ADVANCED SCHEDULE DEBUG] Recurring schedule. recurrenceMatch:', recurrenceMatch);
    return recurrenceMatch;
  }

  /**
   * Check if a date matches the recurrence pattern
   */
  private static isRecurrenceMatch(schedule: AvailabilitySchedule, targetDate: Date, startDate: Date): boolean {
    const { recurrenceType, recurrenceInterval, daysOfWeek, weekOfMonth, monthOfYear } = schedule;

    // Normalize dates to midnight for consistent day calculations
    const normalizedStart = new Date(startDate);
    normalizedStart.setHours(0, 0, 0, 0);
    const normalizedTarget = new Date(targetDate);
    normalizedTarget.setHours(0, 0, 0, 0);
    
    // Calculate days since start
    const daysSinceStart = Math.floor((normalizedTarget.getTime() - normalizedStart.getTime()) / (1000 * 60 * 60 * 24));
    
    switch (recurrenceType) {
      case 'DAILY':
        return daysSinceStart % (recurrenceInterval || 1) === 0;
        
      case 'WEEKLY':
        const targetDayOfWeek = targetDate.getDay();
        
        // For multi-week patterns (recurrenceInterval > 1), we don't check individual weeks
        // Instead, we let getEffectiveAvailabilityForDate handle the specific week matching
        // Here we just verify the date is in a valid interval period
        if (recurrenceInterval && recurrenceInterval > 1) {
          const weeksIntoPattern = Math.floor(daysSinceStart / 7);
          const patternMatches = weeksIntoPattern % recurrenceInterval === 0 || 
                                 (weeksIntoPattern % recurrenceInterval < recurrenceInterval);
          const dayMatches = daysOfWeek.includes(targetDayOfWeek);
          
          console.log('[ADVANCED SCHEDULE DEBUG] Multi-week WEEKLY pattern check:', {
            daysSinceStart,
            weeksIntoPattern,
            recurrenceInterval,
            weekInCycle: weeksIntoPattern % recurrenceInterval,
            patternMatches,
            targetDayOfWeek,
            daysOfWeek,
            dayMatches,
            result: dayMatches // For multi-week patterns, just check if day is in daysOfWeek
          });
          
          return dayMatches; // Return true if this day appears anywhere in the multi-week pattern
        }
        
        // Single week pattern - standard weekly recurrence
        const weekMatches = Math.floor(daysSinceStart / 7) % 1 === 0;
        const dayMatches = daysOfWeek.includes(targetDayOfWeek);
        
        console.log('[ADVANCED SCHEDULE DEBUG] Single-week WEEKLY pattern check:', {
          daysSinceStart,
          weekMatches,
          targetDayOfWeek,
          daysOfWeek,
          dayMatches,
          result: weekMatches && dayMatches
        });
        
        return weekMatches && dayMatches;
               
      case 'BIWEEKLY':
        const biweeklyTarget = targetDate.getDay();
        // Calculate which 2-week period we're in since the start date
        const twoWeeksSinceStart = Math.floor(daysSinceStart / 14);
        const biweekMatches = twoWeeksSinceStart % (recurrenceInterval || 1) === 0;
        const biweekDayMatches = daysOfWeek.includes(biweeklyTarget);
        
        console.log('[ADVANCED SCHEDULE DEBUG] BIWEEKLY match check:', {
          daysSinceStart,
          twoWeeksSinceStart,
          recurrenceInterval: recurrenceInterval || 1,
          biweekMatches,
          biweeklyTarget,
          daysOfWeek,
          biweekDayMatches,
          result: biweekMatches && biweekDayMatches
        });
        
        return biweekMatches && biweekDayMatches;
               
      case 'MONTHLY':
        if (monthOfYear && targetDate.getMonth() + 1 !== monthOfYear) return false;
        if (weekOfMonth) {
          const weekInMonth = Math.ceil(targetDate.getDate() / 7);
          return weekInMonth === weekOfMonth && daysOfWeek.includes(targetDate.getDay());
        }
        return daysOfWeek.includes(targetDate.getDay());
        
      default:
        return false;
    }
  }

  /**
   * Get effective availability for a specific date
   * (considers all schedules and their priorities)
   */
  static async getEffectiveAvailabilityForDate(templateId: string, targetDate: Date) {
    const schedules = await this.getSchedulesForTemplate(templateId);
    const targetDayOfWeek = targetDate.getDay();
    
    console.log('[ADVANCED SCHEDULE DEBUG] Looking for schedules on date:', targetDate, 'dayOfWeek:', targetDayOfWeek);
    
    // Find all active schedules for this date that have time slots for this day of week
    const activeSchedules = schedules.filter((schedule: AvailabilitySchedule & { 
      timeSlots: Array<{ 
        dayOfWeek: number; 
        startTime: string; 
        endTime: string; 
        isEnabled: boolean;
        weekNumber: number | null;
      }> 
    }) => {
      // First check if the schedule's recurrence pattern matches this date
      if (!this.isScheduleActiveOnDate(schedule, targetDate)) {
        return false;
      }
      
      // For multi-week patterns, determine which week we're in
      const recurrenceInterval = schedule.recurrenceInterval || 1;
      if (recurrenceInterval > 1) {
        const startDate = new Date(schedule.startDate);
        startDate.setHours(0, 0, 0, 0);
        const normalizedTarget = new Date(targetDate);
        normalizedTarget.setHours(0, 0, 0, 0);
        const daysSinceStart = Math.floor((normalizedTarget.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));
        const weeksIntoPattern = Math.floor(daysSinceStart / 7);
        // Use modulo to get which week in the pattern (0-indexed, but matches UI's 1-based labeling)
        const weekInCycle = weeksIntoPattern % recurrenceInterval;
        
        console.log('[ADVANCED SCHEDULE DEBUG] Multi-week pattern analysis:', {
          scheduleName: schedule.name,
          daysSinceStart,
          weeksIntoPattern,
          recurrenceInterval,
          weekInCycle,
          targetDayOfWeek
        });
        
        // Check if this specific week in the cycle has slots for this day
        // Use weekNumber field for accurate week matching
        const slotsForThisWeekAndDay = schedule.timeSlots.filter((slot: { 
          dayOfWeek: number; 
          startTime: string; 
          endTime: string; 
          isEnabled: boolean; 
          weekNumber: number | null;
        }) => {
          const matchesDay = slot.dayOfWeek === targetDayOfWeek;
          const isEnabled = slot.isEnabled;
          
          // Use weekNumber if available (0-indexed)
          const matchesWeek = (slot.weekNumber !== null && slot.weekNumber !== undefined)
            ? slot.weekNumber === weekInCycle
            : true; // Backwards compatibility
          
          return matchesWeek && matchesDay && isEnabled;
        });
        
        console.log('[ADVANCED SCHEDULE DEBUG] Slots for week', weekInCycle, 'day', targetDayOfWeek, ':', slotsForThisWeekAndDay);
        
        return slotsForThisWeekAndDay.length > 0;
      }
      
      // Single week pattern - check if this schedule has time slots for this day of week
      const hasSlotsForDay = schedule.timeSlots.some(slot => 
        slot.dayOfWeek === targetDayOfWeek && slot.isEnabled
      );
      
      console.log('[ADVANCED SCHEDULE DEBUG] Single-week schedule', schedule.name, 'has slots for day', targetDayOfWeek, ':', hasSlotsForDay);
      
      return hasSlotsForDay;
    });

    if (activeSchedules.length === 0) {
      console.log('[ADVANCED SCHEDULE DEBUG] No active schedules with time slots for this day');
      return { timeSlots: [], appliedSchedules: [] };
    }

    // Use the highest priority schedule
    const effectiveSchedule = activeSchedules[0]; // Already sorted by priority desc
    
    console.log('[ADVANCED SCHEDULE DEBUG] Effective schedule:', effectiveSchedule.name);
    console.log('[ADVANCED SCHEDULE DEBUG] All timeSlots:', effectiveSchedule.timeSlots);
    
    // For multi-week patterns, filter to only return slots for the current week in the cycle
    let relevantTimeSlots = effectiveSchedule.timeSlots;
    
    const effectiveRecurrenceInterval = effectiveSchedule.recurrenceInterval || 1;
    if (effectiveRecurrenceInterval > 1) {
      const startDate = new Date(effectiveSchedule.startDate);
      startDate.setHours(0, 0, 0, 0);
      const normalizedTarget = new Date(targetDate);
      normalizedTarget.setHours(0, 0, 0, 0);
      const daysSinceStart = Math.floor((normalizedTarget.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));
      const weeksIntoPattern = Math.floor(daysSinceStart / 7);
      const weekInCycle = weeksIntoPattern % effectiveRecurrenceInterval;
      
      // Filter slots using weekNumber field if available
      relevantTimeSlots = effectiveSchedule.timeSlots.filter((slot: { 
        dayOfWeek: number; 
        startTime: string; 
        endTime: string; 
        isEnabled: boolean; 
        weekNumber: number | null;
      }) => {
        // Use weekNumber if available (0-indexed)
        if (slot.weekNumber !== null && slot.weekNumber !== undefined) {
          return slot.weekNumber === weekInCycle;
        }
        // Backwards compatibility: if no weekNumber, include all slots
        return true;
      });
      
      console.log('[ADVANCED SCHEDULE DEBUG] Filtered time slots for week', weekInCycle, ':', relevantTimeSlots);
    }
    
    return {
      timeSlots: relevantTimeSlots,
      appliedSchedules: activeSchedules.map((s: AvailabilitySchedule) => ({ 
        id: s.id, 
        name: s.name, 
        priority: s.priority 
      }))
    };
  }

  /**
   * Helper to get time windows for a specific day of the week
   * FIXED: This now properly extracts time windows from AvailabilityScheduleTimeSlot objects
   */
  static getTimeWindowsForDay(
    timeSlots: Array<{ dayOfWeek: number; startTime: string; endTime: string; isEnabled?: boolean; weekNumber?: number | null }>, 
    dayOfWeek: number
  ) {
    // Filter slots for the given day that are enabled
    const slotsForDay = timeSlots.filter(slot => 
      slot.dayOfWeek === dayOfWeek && (slot.isEnabled === undefined || slot.isEnabled === true)
    );
    
    console.log('[ADVANCED SCHEDULE DEBUG] getTimeWindowsForDay input:', {
      totalSlots: timeSlots.length,
      dayOfWeek,
      slotsForDay: slotsForDay.length,
      slots: slotsForDay
    });
    
    // Map to { start, end } format and remove duplicates
    const windows = slotsForDay.map(slot => ({
      start: slot.startTime,
      end: slot.endTime
    }));
    
    // Deduplicate based on start and end time
    const uniqueWindows = windows.filter((window, index, self) =>
      index === self.findIndex(w => w.start === window.start && w.end === window.end)
    );
    
    console.log('[ADVANCED SCHEDULE DEBUG] Unique time windows:', uniqueWindows);
    
    return uniqueWindows;
  }

  /**
   * Update a schedule
   */
  static async updateSchedule(scheduleId: string, scheduleData: Partial<AvailabilityScheduleInput> & { isActive?: boolean }) {
    const { timeSlots, ...scheduleFields } = scheduleData;

    const result = await prisma.availabilitySchedule.update({
      where: { id: scheduleId },
      data: {
        ...scheduleFields,
        ...(timeSlots && {
          timeSlots: {
            deleteMany: {}, // Remove existing slots
            create: timeSlots.map(slot => ({
              dayOfWeek: slot.dayOfWeek,
              startTime: slot.startTime,
              endTime: slot.endTime,
              isEnabled: slot.isEnabled ?? true,
              weekNumber: slot.weekNumber ?? 0,
            }))
          }
        })
      },
      include: {
        timeSlots: true,
      }
    });

    return result;
  }

  /**
   * Toggle the active status of a schedule
   */
  static async toggleScheduleActive(scheduleId: string, isActive: boolean) {
    return await prisma.availabilitySchedule.update({
      where: { id: scheduleId },
      data: { isActive },
      include: {
        timeSlots: true,
      }
    });
  }

  /**
   * Delete a schedule
   */
  static async deleteSchedule(scheduleId: string) {
    return await prisma.availabilitySchedule.delete({
      where: { id: scheduleId }
    });
  }
}