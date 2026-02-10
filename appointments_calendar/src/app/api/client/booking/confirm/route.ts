// API endpoint for confirming bookings via magic link
import { NextRequest, NextResponse } from 'next/server';
import { emailService } from '@/lib/maileroo-email-service';
import { prisma } from '@/lib/db';

interface CalendarConnection {
  id: string;
  platform: string;
  calendarId: string;
  accessToken: string;
  refreshToken?: string | null;
}

interface BookingWithRelations {
  id: string;
  scheduledAt: Date;
  duration: number;
  serviceType: string;
  notes?: string | null;
  customer: {
    firstName: string | null;
    lastName: string | null;
    email: string;
  };
  provider: {
    name: string;
    email: string;
  };
  calendarEvent?: {
    location?: string | null;
  } | null;
}

interface CalendarEventData {
  summary: string;
  description: string;
  start: {
    dateTime: string;
  };
  end: {
    dateTime: string;
  };
  attendees: Array<{
    email: string;
    displayName: string;
  }>;
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const token = searchParams.get('token');

  if (!token) {
    return NextResponse.json({ error: 'Missing token' }, { status: 400 });
  }

  try {
    // Verify the magic link token
    const linkData = emailService.verifyMagicLinkToken(token);
    
    if (!linkData) {
      return NextResponse.json({ error: 'Invalid or expired link' }, { status: 400 });
    }

    // Find the booking
    const booking = await prisma.booking.findUnique({
      where: { id: linkData.bookingId },
      include: {
        customer: true,
        provider: {
          include: {
            calendarConnections: {
              where: {
                isDefaultForBookings: true,
                isActive: true,
              },
              select: {
                id: true,
                platform: true,
                calendarId: true,
                accessToken: true,
                refreshToken: true,
                email: true,
              },
            },
          },
        },
        calendarEvent: true,
      },
    });

    if (!booking) {
      return NextResponse.json({ error: 'Booking not found' }, { status: 404 });
    }

    // Verify the customer email matches
    if (booking.customer.email !== linkData.customerEmail) {
      return NextResponse.json({ error: 'Invalid link' }, { status: 403 });
    }

    if (linkData.action === 'confirm') {
      // Confirm the booking
      if (booking.status === 'CONFIRMED') {
        return NextResponse.json({ 
          message: 'Booking already confirmed',
          booking: {
            id: booking.id,
            status: booking.status,
            scheduledAt: booking.scheduledAt,
            customerName: `${booking.customer.firstName} ${booking.customer.lastName}`,
            providerName: booking.provider.name,
          }
        });
      }

      // Update booking status to confirmed
      const confirmedBooking = await prisma.booking.update({
        where: { id: booking.id },
        data: { status: 'CONFIRMED' },
        include: {
          customer: true,
          provider: true,
          calendarEvent: true,
        },
      });

      // Create calendar event in provider's default calendar
      if (booking.provider.calendarConnections.length > 0) {
        await createCalendarEvent(confirmedBooking, booking.provider.calendarConnections[0]);
      }

      // Send confirmation emails
      // Use the default calendar email if available, otherwise use provider signup email
      const providerNotificationEmail = booking.provider.calendarConnections[0]?.email || confirmedBooking.provider.email;
      
      const bookingDetails = {
  id: confirmedBooking.id,
  customerName: `${confirmedBooking.customer.firstName || 'Unknown'} ${confirmedBooking.customer.lastName || 'Customer'}`,
  customerEmail: confirmedBooking.customer.email,
  providerName: confirmedBooking.provider.name,
  providerEmail: providerNotificationEmail, // Use default calendar email
  scheduledAt: confirmedBooking.scheduledAt,
  duration: confirmedBooking.duration,
  serviceType: confirmedBooking.serviceType,
  notes: confirmedBooking.notes || undefined,
  location: confirmedBooking.calendarEvent?.location || undefined,
};

// Fetch provider timezone for email formatting
const providerLocation = await prisma.providerLocation.findFirst({
  where: { 
    providerId: confirmedBooking.providerId,
    isDefault: true 
  },
  select: { timezone: true }
});

const providerTimezone = providerLocation?.timezone || 'America/New_York';

await emailService.sendBookingConfirmation(bookingDetails, providerTimezone);

      return NextResponse.json({
        success: true,
        message: 'Booking confirmed successfully!',
        booking: {
          id: confirmedBooking.id,
          status: confirmedBooking.status,
          scheduledAt: confirmedBooking.scheduledAt,
          customerName: `${confirmedBooking.customer.firstName} ${confirmedBooking.customer.lastName}`,
          providerName: confirmedBooking.provider.name,
        }
      });

    } else if (linkData.action === 'cancel') {
      // Cancel the booking
      if (booking.status === 'CANCELLED') {
        return NextResponse.json({ 
          message: 'Booking already cancelled',
          booking: {
            id: booking.id,
            status: booking.status,
          }
        });
      }

      await prisma.booking.update({
        where: { id: booking.id },
        data: { status: 'CANCELLED' },
      });

      return NextResponse.json({
        success: true,
        message: 'Booking cancelled successfully.',
        booking: {
          id: booking.id,
          status: 'CANCELLED',
        }
      });
    }

  } catch (error) {
    console.error('Magic link confirmation error:', error);
    return NextResponse.json(
      { error: 'Failed to process confirmation' },
      { status: 500 }
    );
  }
}

async function createCalendarEvent(booking: BookingWithRelations, calendarConnection: CalendarConnection) {
  try {
    const startTime = new Date(booking.scheduledAt);
    const endTime = new Date(startTime.getTime() + (booking.duration * 60 * 1000));
    
    const eventData = {
      summary: `Appointment with ${booking.customer.firstName} ${booking.customer.lastName}`,
      description: `Service: ${booking.serviceType}${booking.notes ? `\\nNotes: ${booking.notes}` : ''}\\nClient: ${booking.customer.email}`,
      start: {
        dateTime: startTime.toISOString(),
      },
      end: {
        dateTime: endTime.toISOString(),
      },
      attendees: [
        { email: booking.customer.email, displayName: `${booking.customer.firstName} ${booking.customer.lastName}` },
        { email: booking.provider.email, displayName: booking.provider.name },
      ],
    };

    if (calendarConnection.platform === 'GOOGLE') {
      await createGoogleCalendarEvent(calendarConnection.accessToken, calendarConnection.calendarId, eventData);
    } else if (calendarConnection.platform === 'OUTLOOK' || calendarConnection.platform === 'TEAMS') {
      await createOutlookCalendarEvent(calendarConnection.accessToken, calendarConnection.calendarId, eventData);
    }
    // Add other platforms as needed

  } catch (error) {
    console.error('Failed to create calendar event:', error);
    // Don't fail the booking if calendar creation fails
  }
}

async function createGoogleCalendarEvent(accessToken: string, calendarId: string, eventData: CalendarEventData) {
  const response = await fetch(`https://www.googleapis.com/calendar/v3/calendars/${calendarId}/events`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(eventData),
  });

  if (!response.ok) {
    throw new Error(`Google Calendar API error: ${response.status}`);
  }

  return response.json();
}

async function createOutlookCalendarEvent(accessToken: string, calendarId: string, eventData: CalendarEventData) {
  const outlookEvent = {
    subject: eventData.summary,
    body: {
      contentType: 'Text',
      content: eventData.description,
    },
    start: {
      dateTime: eventData.start.dateTime,
      timeZone: 'UTC',
    },
    end: {
      dateTime: eventData.end.dateTime,
      timeZone: 'UTC',
    },
    attendees: eventData.attendees.map((attendee) => ({
      emailAddress: {
        address: attendee.email,
        name: attendee.displayName,
      },
    })),
  };

  const response = await fetch(`https://graph.microsoft.com/v1.0/me/calendars/${calendarId}/events`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(outlookEvent),
  });

  if (!response.ok) {
    throw new Error(`Outlook Calendar API error: ${response.status}`);
  }

  return response.json();
}