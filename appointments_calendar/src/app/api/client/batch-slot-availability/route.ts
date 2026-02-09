import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { fromZonedTime } from 'date-fns-tz';

/**
 * Batch API to check slot availability for multiple dates and durations
 * Returns slot counts without generating full slot details for performance
 * Optimized: Pre-fetches all data once and processes everything in parallel
 */
export async function POST(request: NextRequest) {
  const startTime = Date.now();
  try {
    const body = await request.json();
    const { providerId, dates, durations } = body;

    if (!providerId || !dates || !durations) {
      return NextResponse.json({ 
        error: "Provider ID, dates array, and durations array required" 
      }, { status: 400 });
    }

    console.log(`🚀 Batch availability check: ${dates.length} dates × ${durations.length} durations = ${dates.length * durations.length} combinations`);

    // Fetch provider details once
    const provider = await prisma.provider.findUnique({
      where: { id: providerId },
      select: {
        id: true,
        name: true,
        allowedDurations: true,
        availabilityTemplates: {
          where: { isDefault: true },
          select: { id: true },
          take: 1,
        },
      },
    });

    if (!provider) {
      return NextResponse.json({ error: "Provider not found" }, { status: 404 });
    }

    const defaultTemplate = provider.availabilityTemplates?.[0];
    const templateId = defaultTemplate?.id;

    // Pre-fetch availability template time slots to avoid repeated queries
    const templateTimeSlots = templateId ? await prisma.availabilityTimeSlot.findMany({
      where: { templateId },
      select: {
        dayOfWeek: true,
        startTime: true,
        endTime: true,
      }
    }) : [];

    // Get all provider locations once (we'll filter per date later)
    const allProviderLocations = await prisma.providerLocation.findMany({
      where: {
        providerId: providerId,
        isActive: true,
      },
      select: {
        id: true,
        timezone: true,
        startDate: true,
        endDate: true,
        isDefault: true,
      },
      orderBy: [
        { isDefault: 'asc' },
        { startDate: 'desc' }
      ]
    });

    console.log(`📊 Pre-fetched ${templateTimeSlots.length} template time slots for optimization`);

    // Pre-fetch ALL advanced schedules to avoid repeated database queries
    const advancedSchedules = templateId ? await prisma.availabilitySchedule.findMany({
      where: {
        templateId,
        isActive: true,
        OR: [
          { startDate: { lte: new Date(dates[dates.length - 1] + 'T23:59:59') } },
          { isRecurring: true }
        ]
      },
      include: {
        timeSlots: {
          select: {
            dayOfWeek: true,
            startTime: true,
            endTime: true,
          }
        }
      },
      orderBy: { priority: 'desc' }
    }) : [];

    console.log(`📊 Pre-fetched ${advancedSchedules.length} advanced schedules for optimization`);

    // Get current time for filtering past slots
    const now = new Date();
    const currentTimeWithBuffer = new Date(now.getTime() + (15 * 60 * 1000));

    // Process all dates in parallel for maximum speed
    const dateProcessingPromises = dates.map(async (dateString: string) => {
      const targetDate = new Date(dateString + 'T00:00:00');
      const dateCounts: Record<number, number> = {};

      // Find the location for this specific date
      const currentLocation = allProviderLocations.find(loc => {
        return targetDate >= loc.startDate && targetDate <= loc.endDate;
      });
      
      const providerTimezone = currentLocation?.timezone || 'America/New_York';

      // Find applicable advanced schedules for this date (use pre-fetched data)
      const applicableSchedules = advancedSchedules.filter(schedule => {
        // Check if schedule applies to this date
        if (schedule.isRecurring) {
          // Recurring schedule - check if date falls within recurrence pattern
          const scheduleStart = new Date(schedule.startDate);
          if (targetDate < scheduleStart) return false;
          
          if (schedule.endDate) {
            const scheduleEnd = new Date(schedule.endDate);
            if (targetDate > scheduleEnd) return false;
          }
          
          // Check recurrence pattern
          if (schedule.recurrenceType === 'WEEKLY') {
            // Weekly recurrence - always applies
            return true;
          } else if (schedule.recurrenceType === 'BIWEEKLY') {
            // Calculate weeks since start
            const daysDiff = Math.floor((targetDate.getTime() - scheduleStart.getTime()) / (1000 * 60 * 60 * 24));
            const weeksSinceStart = Math.floor(daysDiff / 7);
            return weeksSinceStart % 2 === 0;
          }
        } else {
          // One-time schedule - check date range
          const scheduleStart = new Date(schedule.startDate);
          const scheduleEnd = schedule.endDate ? new Date(schedule.endDate) : scheduleStart;
          return targetDate >= scheduleStart && targetDate <= scheduleEnd;
        }
        return false;
      });

      const hasAdvancedSchedules = applicableSchedules.length > 0;
      const advancedTimeSlots = hasAdvancedSchedules 
        ? applicableSchedules.flatMap(s => s.timeSlots)
        : [];

      // Process all durations for this date in parallel
      const durationProcessingPromises = durations.map(async (duration: number) => {
        try {
          // Generate available time slots from pre-fetched template data (no DB query!)
          const dayOfWeek = targetDate.getDay();
          const dayTimeSlots = templateTimeSlots.filter(slot => slot.dayOfWeek === dayOfWeek);
          
          const availableTimeSlots: string[] = [];
          for (const slot of dayTimeSlots) {
            const [startHours, startMinutes] = slot.startTime.split(':').map(Number);
            const [endHours, endMinutes] = slot.endTime.split(':').map(Number);
            
            const startTotalMinutes = startHours * 60 + startMinutes;
            const endTotalMinutes = endHours * 60 + endMinutes;
            
            // Generate 15-minute interval slots
            for (let minutes = startTotalMinutes; minutes + duration <= endTotalMinutes; minutes += 15) {
              const hours = Math.floor(minutes / 60);
              const mins = minutes % 60;
              availableTimeSlots.push(`${hours.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}`);
            }
          }

          // Use advanced schedule time slots if they exist
          let finalTimeSlots: string[];

          if (hasAdvancedSchedules) {
            // Use advanced schedule time slots
            const dayOfWeek = targetDate.getDay();
            const dayAdvancedSlots = advancedTimeSlots.filter(slot => slot.dayOfWeek === dayOfWeek);
            
            finalTimeSlots = [];
            for (const slot of dayAdvancedSlots) {
              const [startHours, startMinutes] = slot.startTime.split(':').map(Number);
              const [endHours, endMinutes] = slot.endTime.split(':').map(Number);
              
              const windowStart = startHours * 60 + startMinutes;
              const windowEnd = endHours * 60 + endMinutes;
              
              for (let minutes = windowStart; minutes + duration <= windowEnd; minutes += 15) {
                const hours = Math.floor(minutes / 60);
                const mins = minutes % 60;
                const timeSlot = `${hours.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}`;
                finalTimeSlots.push(timeSlot);
              }
            }
          } else {
            finalTimeSlots = availableTimeSlots;
          }

          // Filter out past times
          let availableCount = 0;
          for (const timeSlot of finalTimeSlots) {
            const [hours, minutes] = timeSlot.split(':').map(Number);
            const year = targetDate.getFullYear();
            const month = targetDate.getMonth();
            const day = targetDate.getDate();
            
            const localDateTime = new Date(year, month, day, hours, minutes, 0, 0);
            const slotStart = fromZonedTime(localDateTime, providerTimezone);
            
            if (slotStart > currentTimeWithBuffer) {
              availableCount++;
            }
          }

          return { duration, count: availableCount };
        } catch (error) {
          console.error(`Error processing duration ${duration} for date ${dateString}:`, error);
          return { duration, count: 0 };
        }
      });

      // Wait for all durations for this date to complete
      const durationResults = await Promise.all(durationProcessingPromises);
      
      // Build the counts for this date
      durationResults.forEach(({ duration, count }) => {
        dateCounts[duration] = count;
      });

      return { date: dateString, counts: dateCounts };
    });

    // Wait for all dates to complete processing
    const dateResults = await Promise.all(dateProcessingPromises);

    // Build final result map
    const slotCounts: Record<string, Record<number, number>> = {};
    dateResults.forEach(({ date, counts }) => {
      slotCounts[date] = counts;
    });

    const endTime = Date.now();
    const duration = endTime - startTime;
    console.log(`✅ Batch availability check completed in ${duration}ms`);

    return NextResponse.json({
      success: true,
      providerId,
      slotCounts,
      message: `Checked ${dates.length} dates × ${durations.length} durations in ${duration}ms`,
      processingTimeMs: duration,
    });

  } catch (error) {
    console.error("Batch slot availability API error:", error);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
