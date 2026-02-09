import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { AvailabilityService } from "@/lib/availability-service";
import { AdvancedAvailabilityService } from "@/lib/advanced-availability-service";

/**
 * Preview API - Shows available days and duration counts without generating full slots
 * Much faster than full slot generation
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const providerId = searchParams.get("providerId");
    const daysAhead = parseInt(searchParams.get("daysAhead") || "14");

    if (!providerId) {
      return NextResponse.json({ error: "Provider ID required" }, { status: 400 });
    }

    // Fetch provider details
    const provider = await prisma.provider.findUnique({
      where: { id: providerId },
      select: {
        id: true,
        name: true,
        allowedDurations: true,
        advanceBookingDays: true,
        availabilityTemplates: {
          where: { isActive: true, isDefault: true },
          select: {
            id: true,
            timezone: true,
          },
          take: 1,
        },
        locations: {
          where: { isActive: true },
          select: {
            id: true,
            city: true,
            stateProvince: true,
            country: true,
            description: true,
            startDate: true,
            endDate: true,
            isDefault: true,
          },
          orderBy: [
            { isDefault: 'desc' },
            { startDate: 'asc' },
          ],
        },
      },
    });

    if (!provider) {
      return NextResponse.json({ error: "Provider not found" }, { status: 404 });
    }

    // Calculate date range
    const now = new Date();
    const maxDate = new Date();
    maxDate.setDate(now.getDate() + Math.min(daysAhead, provider.advanceBookingDays || 30));

    const allowedDurations = provider.allowedDurations || [15, 30, 45, 60, 90];

    // Get availability preview from templates
    const availabilityPreview = await AvailabilityService.getAvailabilityPreview(
      providerId,
      now,
      maxDate,
      allowedDurations
    );

    // Get the default template id for advanced schedule lookup
    const defaultTemplateId = provider.availabilityTemplates?.[0]?.id;
    
    // Enhance availability preview by checking for advanced schedules
    const enhancedAvailability = await Promise.all(
      availabilityPreview.map(async (day) => {
        // Parse the date string as local date, not UTC
const [year, month, dayNum] = day.date.split('-').map(Number);
const dayDate = new Date(year, month - 1, dayNum); // months are 0-indexed in JS
        
        let advancedAvailability: {
          timeSlots: Array<{ dayOfWeek: number; startTime: string; endTime: string }>;
          appliedSchedules: Array<{ id: string; name: string; priority: number }>;
        } = { timeSlots: [], appliedSchedules: [] };
        
        console.log(`[ADVANCED SCHEDULES] Lookup params for date ${day.date}: templateId=${defaultTemplateId}, dayDate=${dayDate.toISOString()}`);
        
        if (defaultTemplateId) {
          advancedAvailability = await AdvancedAvailabilityService.getEffectiveAvailabilityForDate(
            defaultTemplateId,
            dayDate
          );
        }
        
        // Debug logging for advanced schedules
        if (advancedAvailability.appliedSchedules.length > 0) {
          console.log(`[ADVANCED SCHEDULES] Found for date ${day.date}:`, advancedAvailability.appliedSchedules);
          console.log(`[ADVANCED SCHEDULES] Time slots for date ${day.date}:`, advancedAvailability.timeSlots);
          console.log(`[DEBUG] Date string: ${day.date}, Date object: ${dayDate}, Day of week: ${dayDate.getDay()}`);
        } else {
          console.log(`[ADVANCED SCHEDULES] None found for date ${day.date}`);
        }
        
        // If advanced schedules exist for this date, they take precedence
        if (advancedAvailability.appliedSchedules.length > 0) {
          // Get the day of week for filtering time slots
          const dayOfWeek = dayDate.getDay();
          
          // Get time windows from advanced schedule for this specific day
          const advancedTimeWindows = AdvancedAvailabilityService.getTimeWindowsForDay(
            advancedAvailability.timeSlots,
            dayOfWeek
          );
          
          console.log(`[ADVANCED SCHEDULES] Time windows for date ${day.date} (day ${dayOfWeek}):`, advancedTimeWindows);
          
          // If no time slots for this day of week, mark as unavailable
          if (advancedTimeWindows.length === 0) {
            console.log(`[ADVANCED SCHEDULES] No time slots defined for day ${dayOfWeek}, marking unavailable`);
            return {
              ...day,
              hasAvailability: false,
              availableDurations: [],
              timeWindows: [],
              usingAdvancedSchedules: true,
              schedulesApplied: advancedAvailability.appliedSchedules.length
            };
          }
          
          // Return enhanced day info with advanced schedule time windows
          return {
            ...day,
            hasAvailability: true,
            availableDurations: allowedDurations,
            timeWindows: advancedTimeWindows, // FIXED: Use advanced schedule time windows
            usingAdvancedSchedules: true,
            schedulesApplied: advancedAvailability.appliedSchedules.length
          };
        }
        
        // No advanced schedules, use template availability as-is
        return {
          ...day,
          usingAdvancedSchedules: false,
          schedulesApplied: 0
        };
      })
    );

    // Helper function to get location for a specific date
    const getLocationForDate = (date: string) => {
      // Parse as local date to avoid timezone conversion issues
      const [year, month, day] = date.split('-').map(Number);
      const targetDate = new Date(year, month - 1, day);
      
      // Find location that covers this date (prioritize non-default)
      const applicableLocation = provider.locations
        .filter(location => {
          const [sYear, sMonth, sDay] = location.startDate.toISOString().split('T')[0].split('-').map(Number);
          const [eYear, eMonth, eDay] = location.endDate.toISOString().split('T')[0].split('-').map(Number);
          const startDate = new Date(sYear, sMonth - 1, sDay);
          const endDate = new Date(eYear, eMonth - 1, eDay);
          return targetDate >= startDate && targetDate <= endDate;
        })
        .sort((a, b) => {
          // Non-default locations first
          if (a.isDefault !== b.isDefault) return a.isDefault ? 1 : -1;
          return 0;
        })[0];
      
      // If no specific location found, use default location
      if (!applicableLocation) {
        const defaultLocation = provider.locations.find(loc => loc.isDefault);
        return defaultLocation ? {
          city: defaultLocation.city,
          stateProvince: defaultLocation.stateProvince,
          country: defaultLocation.country,
          description: defaultLocation.description,
        } : null;
      }
      
      return {
        city: applicableLocation.city,
        stateProvince: applicableLocation.stateProvince,
        country: applicableLocation.country,
        description: applicableLocation.description,
      };
    };

    // Add location information to each availability day
    const availabilityWithLocation = enhancedAvailability.map(day => ({
      ...day,
      location: getLocationForDate(day.date),
    }));

    return NextResponse.json({
      success: true,
      provider: {
        id: provider.id,
        name: provider.name,
      },
      allowedDurations,
      availability: availabilityWithLocation,
      message: "Preview data - enhanced with advanced scheduling support",
      availabilitySystem: {
        usingTemplates: true,
        usingAdvancedSchedules: true,
        totalDaysWithAdvancedSchedules: availabilityWithLocation.filter(day => day.usingAdvancedSchedules).length
      }
    });

  } catch (error) {
    console.error("Availability preview API error:", error);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}