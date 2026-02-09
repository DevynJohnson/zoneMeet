import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { AvailabilityService } from "@/lib/availability-service";
import { AdvancedAvailabilityService } from "@/lib/advanced-availability-service";
import { fromZonedTime } from 'date-fns-tz';

/**
 * On-demand slot generation API
 * Generates specific slots only when user selects a date and duration
 */

interface SlotWithTempStart {
  id: string;
  eventId: string;
  startTime: string;
  endTime: string;
  duration: number;
  provider: { id: string; name: string };
  location: { display: string };
  availableServices: string[];
  eventTitle: string;
  slotsRemaining: number;
  type: string;
  slotStart: Date;
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const providerId = searchParams.get("providerId");
    const date = searchParams.get("date");
    const duration = searchParams.get("duration");

    if (!providerId || !date || !duration) {
      return NextResponse.json({ 
        error: "Provider ID, date, and duration are required" 
      }, { status: 400 });
    }

    // Parse date in local timezone to avoid UTC midnight conversion issues
    const targetDate = new Date(date + 'T00:00:00');
    const slotDuration = parseInt(duration);

    // Validate date is not in the past (allow same day)
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    if (targetDate < today) {
      return NextResponse.json({ 
        error: "Cannot book appointments in the past" 
      }, { status: 400 });
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
          where: { isDefault: true },
          select: { id: true },
          take: 1,
        },
      },
    });

    if (!provider) {
      return NextResponse.json({ error: "Provider not found" }, { status: 404 });
    }

    // Validate duration is allowed
    const allowedDurations = provider.allowedDurations || [15, 30, 45, 60, 90];
    if (!allowedDurations.includes(slotDuration)) {
      return NextResponse.json({ 
        error: "Duration not allowed for this provider" 
      }, { status: 400 });
    }

    console.log('Slots on-demand request:', { providerId, date, duration: slotDuration });

    // First get basic availability from templates
    const availableTimeSlots = await AvailabilityService.getAvailableSlots(
      providerId,
      targetDate,
      slotDuration
    );

    // Check for advanced availability schedules that might override template availability
    const defaultTemplate = provider.availabilityTemplates?.[0];
    const templateId = defaultTemplate?.id;
    const advancedAvailability = templateId
      ? await AdvancedAvailabilityService.getEffectiveAvailabilityForDate(templateId, targetDate)
      : { timeSlots: [], appliedSchedules: [] };

   // Use advanced schedule time slots if they exist, otherwise use template slots
let finalTimeSlots: string[];

if (advancedAvailability.appliedSchedules.length > 0) {
  // Generate time slots from advanced schedule time windows
  const timeWindows = AdvancedAvailabilityService.getTimeWindowsForDay(
    advancedAvailability.timeSlots,
    targetDate.getDay()
  );
  
  // Generate 15-minute interval slots within each time window
  finalTimeSlots = [];
  for (const window of timeWindows) {
    const [startHours, startMinutes] = window.start.split(':').map(Number);
    const [endHours, endMinutes] = window.end.split(':').map(Number);
    
    const windowStart = startHours * 60 + startMinutes;
    const windowEnd = endHours * 60 + endMinutes;
    
    // Generate slots in 15-minute intervals
    for (let minutes = windowStart; minutes + slotDuration <= windowEnd; minutes += 15) {
      const hours = Math.floor(minutes / 60);
      const mins = minutes % 60;
      const timeSlot = `${hours.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}`;
      finalTimeSlots.push(timeSlot);
    }
  }
} else {
  finalTimeSlots = availableTimeSlots;
}

    console.log('Available time slots from service:', availableTimeSlots);
    console.log('Advanced schedules found:', advancedAvailability.appliedSchedules.length);
    console.log('Final time slots to use:', finalTimeSlots);

    // Get provider locations for timezone and location display
    // Prioritize custom (non-default) locations over default location
    const providerLocations = await prisma.providerLocation.findMany({
      where: {
        providerId: providerId,
        startDate: { lte: targetDate },
        endDate: { gte: targetDate },
        isActive: true,
      },
      select: {
        id: true,
        timezone: true,
        city: true,
        stateProvince: true,
        country: true,
        description: true,
        isDefault: true,
      },
      orderBy: [
        { isDefault: 'asc' },  // Non-default (false) comes first
        { startDate: 'desc' }
      ]
    });

   // Get timezone and location from the first location (already filtered for target date)
   // After fixing orderBy, this will be the custom location if one exists, otherwise default
const currentLocation = providerLocations[0];
const providerTimezone = currentLocation?.timezone || 'America/New_York';

    // Helper function to get location display
    const getLocationDisplay = (): string => {
      if (currentLocation) {
        const locationParts = [];
        if (currentLocation.city) locationParts.push(currentLocation.city);
        if (currentLocation.stateProvince) locationParts.push(currentLocation.stateProvince);
        if (currentLocation.country) locationParts.push(currentLocation.country);
        
        let locationString = locationParts.join(', ');
        if (currentLocation.description) {
          locationString += ` - ${currentLocation.description}`;
        }
        return locationString || "Contact provider for location details";
      }
      return "Contact provider for location details";
    };

    // Convert to slot format and filter out past times
    const currentTimeWithBuffer = new Date(now.getTime() + (15 * 60 * 1000)); // 15 minute buffer

    const slots = finalTimeSlots
      .map((timeSlot: string) => {
        const [hours, minutes] = timeSlot.split(':').map(Number);
        const year = targetDate.getFullYear();
        const month = targetDate.getMonth();
        const day = targetDate.getDate();
        
        // Create a LOCAL date representing the time in the provider's timezone
        const localDateTime = new Date(year, month, day, hours, minutes, 0, 0);
        
        // Convert from provider's timezone to UTC
        const slotStart = fromZonedTime(localDateTime, providerTimezone);
        
        const slotEnd = new Date(slotStart);
        slotEnd.setMinutes(slotEnd.getMinutes() + slotDuration);

        console.log(`🔧 SLOTS-ON-DEMAND: ${timeSlot} → Local: ${localDateTime.toISOString()} → UTC (${providerTimezone}): ${slotStart.toISOString()}`);

        return {
          id: `slot-${slotStart.getTime()}-${slotDuration}`,
          eventId: `auto-${slotStart.getTime()}-${slotDuration}`,
          startTime: slotStart.toISOString(),
          endTime: slotEnd.toISOString(),
          duration: slotDuration,
          provider: {
            id: provider.id,
            name: provider.name,
          },
          location: {
            display: getLocationDisplay(),
          },
          availableServices: ['consultation', 'maintenance', 'emergency', 'follow-up'],
          eventTitle: 'Available Appointment',
          slotsRemaining: 1,
          type: 'automatic',
          slotStart, // temporary for filtering
        };
      })
      .filter((slot: SlotWithTempStart) => {
        // Filter out past times
        if (slot.slotStart <= currentTimeWithBuffer) {
          console.log(`🔧 FILTERING PAST SLOT: ${slot.slotStart.toLocaleString()} is before current time + buffer`);
          return false;
        }
        return true;
      })
      .map((slot: SlotWithTempStart) => {
        // Remove the temporary slotStart property
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { slotStart, ...cleanSlot } = slot;
        return cleanSlot;
      });

    console.log('Generated slots:', slots);

    return NextResponse.json({
      success: true,
      date: date,
      duration: slotDuration,
      provider: {
        id: provider.id,
        name: provider.name,
        timezone: providerTimezone,
      },
      slots,
      totalSlots: slots.length,
      // Add information about which availability system was used
      availabilitySystem: {
        usingTemplates: true,
        usingAdvancedSchedules: true,
        advancedSchedulesApplied: advancedAvailability.appliedSchedules.length > 0,
        schedulesFound: advancedAvailability.appliedSchedules.length
      }
    });

  } catch (error) {
    console.error("On-demand slots API error:", error);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}