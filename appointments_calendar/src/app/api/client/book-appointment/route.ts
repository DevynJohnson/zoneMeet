// Enhanced booking API that handles both manual events and automatic slots
import { NextRequest, NextResponse } from 'next/server';
import { AdvancedAvailabilityService } from '@/lib/advanced-availability-service';
import { prisma } from '@/lib/db';

export async function POST(request: NextRequest) {
  try {
    const {
      eventId,
      providerId,
      scheduledAt,
      duration,
      customer,
      serviceType,
      notes,
      slotType = 'manual' // 'manual' or 'automatic'
    } = await request.json();

    // Validate required fields
    if (!scheduledAt || !duration || !customer || !providerId) {
      return NextResponse.json({ 
        error: 'Missing required fields: providerId, scheduledAt, duration, customer' 
      }, { status: 400 });
    }

    if (!customer.email) {
      return NextResponse.json({ 
        error: 'Customer email is required' 
      }, { status: 400 });
    }

    const appointmentStart = new Date(scheduledAt);
    const appointmentEnd = new Date(appointmentStart.getTime() + (duration * 60 * 1000));

    // Validate provider exists
    const provider = await prisma.provider.findUnique({
      where: { id: providerId },
      select: { 
        id: true, 
        name: true, 
        email: true, 
        phone: true, 
        bufferTime: true,
        calendarConnections: {
          where: {
            isDefaultForBookings: true,
            isActive: true,
          },
          select: {
            email: true,
          },
          take: 1,
        }
      }
    });

    if (!provider) {
      return NextResponse.json({ error: 'Provider not found' }, { status: 404 });
    }

    // Use the default calendar email if available, otherwise use provider signup email
    const providerNotificationEmail = provider.calendarConnections[0]?.email || provider.email;

    // Fetch provider location early - needed for both manual and automatic bookings (for email formatting and location info)
    const providerLocation = await prisma.providerLocation.findFirst({
      where: { 
        providerId: providerId,
        isDefault: true 
      },
      select: { 
        timezone: true,
        city: true,
        stateProvince: true,
        postalCode: true,
        country: true,
        description: true,
        addressLine1: true,
        addressLine2: true
      }
    });
    
    const providerTimezone = providerLocation?.timezone || 'America/New_York';
    console.log('Provider timezone:', providerTimezone);
    
    // Format location display string for email
    const formatLocation = () => {
      if (!providerLocation) return 'To be confirmed';
      
      // Build address line
      const addressParts = [];
      if (providerLocation.addressLine1) addressParts.push(providerLocation.addressLine1);
      if (providerLocation.addressLine2) addressParts.push(providerLocation.addressLine2);
      
      // Build city/state/postal/country line
      const locationParts = [];
      if (providerLocation.city) locationParts.push(providerLocation.city);
      
      // Combine state and postal code
      const statePostal = [];
      if (providerLocation.stateProvince) statePostal.push(providerLocation.stateProvince);
      if (providerLocation.postalCode) statePostal.push(providerLocation.postalCode);
      if (statePostal.length > 0) locationParts.push(statePostal.join(' '));
      
      if (providerLocation.country) locationParts.push(providerLocation.country);
      
      // Combine address and location
      const fullAddress = [...addressParts, locationParts.join(', ')].filter(Boolean).join(', ');
      
      // Add description on separate line if it exists
      if (providerLocation.description) {
        return fullAddress ? `${fullAddress}<br/>Location Details: ${providerLocation.description}` : providerLocation.description;
      }
      
      return fullAddress || 'To be confirmed';
    };
    
    const locationDisplay = formatLocation();

    let calendarEvent = null;

    if (slotType === 'manual' && eventId) {
      // Handle manual calendar event booking
      calendarEvent = await prisma.calendarEvent.findUnique({
        where: { id: eventId },
        include: {
          bookings: {
            where: {
              status: {
                in: ['CONFIRMED', 'PENDING']
              }
            }
          }
        }
      });

      if (!calendarEvent) {
        return NextResponse.json({ error: 'Calendar event not found' }, { status: 404 });
      }

      if (!calendarEvent.allowBookings) {
        return NextResponse.json({ error: 'Bookings not allowed for this event' }, { status: 400 });
      }

      // Check if event has available slots
      if (calendarEvent.bookings.length >= calendarEvent.maxBookings) {
        return NextResponse.json({ error: 'No available slots for this event' }, { status: 400 });
      }

      // Validate the scheduled time is within the event window
      const eventStart = new Date(calendarEvent.startTime);
      const eventEnd = new Date(calendarEvent.endTime);

      if (appointmentStart < eventStart || appointmentEnd > eventEnd) {
        return NextResponse.json({ 
          error: 'Appointment time must be within the calendar event window' 
        }, { status: 400 });
      }
    } else if (slotType === 'automatic') {
      console.log('🔍 BOOKING DEBUG: Validating automatic slot');
      console.log('Provider ID:', providerId);
      console.log('Appointment start (UTC):', appointmentStart.toISOString());
      console.log('Duration:', duration);
      
      // Fetch provider template
      const providerWithTemplate = await prisma.provider.findUnique({
        where: { id: providerId },
        select: {
          id: true,
          availabilityTemplates: {
            where: { isDefault: true },
            select: { id: true },
            take: 1
          }
        }
      });
      
      if (!providerWithTemplate || !providerWithTemplate.availabilityTemplates[0]) {
        console.log('❌ No template found for provider');
        return NextResponse.json({ 
          error: 'Provider availability template not found' 
        }, { status: 404 });
      }
      
      const templateId = providerWithTemplate.availabilityTemplates[0].id;
      
      console.log('Template ID:', templateId);
      console.log('Provider timezone:', providerTimezone);
      
      // Convert UTC time to provider's local timezone
      const { toZonedTime } = await import('date-fns-tz');
      const localAppointmentStart = toZonedTime(appointmentStart, providerTimezone);
      
      // Get HH:MM in provider's timezone
      const appointmentTime = localAppointmentStart.toTimeString().slice(0, 5);
      const dayOfWeek = localAppointmentStart.getDay();
      
      console.log('Local appointment time:', appointmentTime, 'Day:', dayOfWeek);
      console.log('Checking availability for:', { appointmentTime, dayOfWeek });
      
      const { timeSlots } = await AdvancedAvailabilityService.getEffectiveAvailabilityForDate(templateId, localAppointmentStart);
      console.log('Time slots returned:', JSON.stringify(timeSlots, null, 2));
      
      const requestedStartMinutes = parseInt(appointmentTime.split(':')[0], 10) * 60 + parseInt(appointmentTime.split(':')[1], 10);
      const requestedEndMinutes = requestedStartMinutes + duration;
      console.log('Requested minutes (local):', { start: requestedStartMinutes, end: requestedEndMinutes });
      
      const isAvailable = timeSlots.some((slot: { startTime: string; endTime: string; isEnabled: boolean; dayOfWeek: number }) => {
        const slotStartMinutes = parseInt(slot.startTime.split(':')[0], 10) * 60 + parseInt(slot.startTime.split(':')[1], 10);
        const slotEndMinutes = parseInt(slot.endTime.split(':')[0], 10) * 60 + parseInt(slot.endTime.split(':')[1], 10);
        const matches = slot.isEnabled &&
          slot.dayOfWeek === dayOfWeek &&
          slotStartMinutes <= requestedStartMinutes &&
          slotEndMinutes >= requestedEndMinutes;
        
        console.log('Checking slot:', { 
          slotDay: slot.dayOfWeek, 
          requestedDay: dayOfWeek,
          slotStart: slot.startTime, 
          slotEnd: slot.endTime,
          slotStartMin: slotStartMinutes,
          slotEndMin: slotEndMinutes,
          requestedStartMin: requestedStartMinutes,
          requestedEndMin: requestedEndMinutes,
          enabled: slot.isEnabled,
          matches 
        });
        
        return matches;
      });

      console.log('Is available:', isAvailable);

      if (!isAvailable) {
        console.log('❌ Slot validation failed');
        return NextResponse.json({ 
          error: 'Selected time slot is no longer available'
        }, { status: 400 });
      }
      
      console.log('✅ Slot validated successfully');

      // For automatic slots, create a virtual calendar event
      calendarEvent = {
        id: 'auto-' + Date.now(), // Virtual ID
        title: 'Available Time Slot',
        location: locationDisplay, // Use provider's actual location
        providerId: providerId,
        startTime: appointmentStart,
        endTime: appointmentEnd,
        allowBookings: true,
        maxBookings: 1,
        bookings: []
      };
    }

    // Check for scheduling conflicts with ALL bookings for this provider
    const bufferTime = provider.bufferTime || 15;
    
    const existingBookings = await prisma.booking.findMany({
      where: {
        providerId: providerId,
        status: {
          in: ['CONFIRMED', 'PENDING']
        },
        scheduledAt: {
          gte: new Date(appointmentStart.getTime() - (2 * 60 * 60 * 1000)), // 2 hours before
          lte: new Date(appointmentEnd.getTime() + (2 * 60 * 60 * 1000)) // 2 hours after
        }
      },
      select: {
        id: true,
        scheduledAt: true,
        duration: true
      }
    });

    const hasConflict = existingBookings.some((booking: { scheduledAt: Date; duration: number }) => {
      const existingStart = new Date(booking.scheduledAt);
      const existingEnd = new Date(existingStart.getTime() + (booking.duration * 60 * 1000));
      
      const bufferStart = new Date(existingStart.getTime() - (bufferTime * 60 * 1000));
      const bufferEnd = new Date(existingEnd.getTime() + (bufferTime * 60 * 1000));

      return (
        (appointmentStart >= bufferStart && appointmentStart < bufferEnd) ||
        (appointmentEnd > bufferStart && appointmentEnd <= bufferEnd) ||
        (appointmentStart <= bufferStart && appointmentEnd >= bufferEnd)
      );
    });

    if (hasConflict) {
      return NextResponse.json({ 
        error: 'Appointment conflicts with existing booking (including buffer time)' 
      }, { status: 400 });
    }

    // Check for conflicts with calendar events (if not booking within one)
    if (slotType === 'automatic') {
      const conflictingEvents = await prisma.calendarEvent.findMany({
        where: {
          providerId: providerId,
          startTime: {
            lt: appointmentEnd
          },
          endTime: {
            gt: appointmentStart
          }
        }
      });

      if (conflictingEvents.length > 0) {
        return NextResponse.json({ 
          error: 'Appointment conflicts with existing calendar event' 
        }, { status: 400 });
      }
    }

    // Create or update the customer (upsert to always use latest information)
    const user = await prisma.user.upsert({
      where: { email: customer.email },
      update: {
        firstName: customer.firstName,
        lastName: customer.lastName,
        phone: customer.phone,
      },
      create: {
        email: customer.email,
        firstName: customer.firstName,
        lastName: customer.lastName,
        phone: customer.phone,
      }
    });

    // Create the booking
    const booking = await prisma.booking.create({
      data: {
        customerId: user.id,
        providerId: providerId,
        calendarEventId: slotType === 'manual' ? eventId : null, // null for automatic slots
        scheduledAt: appointmentStart,
        duration: duration,
        status: 'PENDING',
        serviceType: serviceType || 'consultation',
        notes: notes,
      },
      include: {
        customer: true,
        ...(slotType === 'manual' && eventId ? {
          calendarEvent: {
            select: {
              title: true,
              location: true,
            }
          }
        } : {}),
        provider: {
          select: {
            name: true,
            email: true,
            phone: true,
          }
        }
      }
    });

    // Safely extract data from booking result
    const bookingResult = booking as {
      id: string;
      scheduledAt: Date;
      duration: number;
      status: string;
      serviceType: string;
      customer: { firstName: string; lastName: string; email: string };
      calendarEvent?: { title: string; location: string } | null;
      provider: { name: string; email: string; phone: string };
    };

    // Send magic link email to customer and notification to provider
    try {
      const { emailService } = await import('@/lib/maileroo-email-service');

      const bookingDetails = {
        id: bookingResult.id,
        customerName: `${bookingResult.customer.firstName} ${bookingResult.customer.lastName}`,
        customerEmail: bookingResult.customer.email,
        providerName: bookingResult.provider.name,
        providerEmail: providerNotificationEmail, // Use default calendar email
        scheduledAt: bookingResult.scheduledAt,
        duration: bookingResult.duration,
        serviceType: bookingResult.serviceType,
        notes: notes,
        location: bookingResult.calendarEvent?.location || calendarEvent?.location || 'To be confirmed',
      };

      // Send booking notification to provider with timezone for proper formatting
      await emailService.sendBookingNotificationToProvider(bookingDetails, providerTimezone);

    } catch (emailError) {
      console.error('Failed to send emails:', emailError);
      // Don't fail the booking if email sending fails
    }

    return NextResponse.json({
      success: true,
      message: 'Booking request submitted successfully! The provider will review your request and send you a confirmation.',
      booking: {
        id: bookingResult.id,
        scheduledAt: bookingResult.scheduledAt,
        duration: bookingResult.duration,
        status: bookingResult.status,
        serviceType: bookingResult.serviceType,
        slotType: slotType,
        event: {
          title: bookingResult.calendarEvent?.title || calendarEvent?.title || 'Appointment',
          location: bookingResult.calendarEvent?.location || calendarEvent?.location || 'To be confirmed',
        },
        provider: {
          name: bookingResult.provider.name,
          email: bookingResult.provider.email,
          phone: bookingResult.provider.phone,
        }
      }
    });

  } catch (error) {
    console.error('Failed to create booking:', error);
    return NextResponse.json(
      { 
        error: 'Failed to create booking',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}