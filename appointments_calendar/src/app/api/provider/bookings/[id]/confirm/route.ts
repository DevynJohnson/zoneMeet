// API endpoint for confirming a booking
import { NextRequest, NextResponse } from 'next/server';
import { extractAndVerifyJWT } from '@/lib/jwt-utils';
import { prisma } from '@/lib/db';
import { emailService } from '@/lib/maileroo-email-service';

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

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  return handleConfirmBooking(request, context);
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  return handleConfirmBooking(request, context);
}

async function handleConfirmBooking(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const params = await context.params;
    const bookingId = params.id;
    
    // For GET requests (email links), we'll verify the booking exists and is pending
    // For POST requests, we'll use JWT authentication
    let providerId: string | null = null;
    
    if (request.method === 'POST') {
      // Extract and verify the JWT token for POST requests
      const authHeader = request.headers.get('Authorization');
      const jwtResult = extractAndVerifyJWT(authHeader);
      
      if (!jwtResult.success) {
        return NextResponse.json(
          { error: jwtResult.error },
          { status: 401 }
        );
      }
      
      providerId = jwtResult.payload!.providerId;
    }

    // Find the booking
    const whereClause: { id: string; providerId?: string } = { id: bookingId };
    if (providerId) {
      whereClause.providerId = providerId;
    }

    const booking = await prisma.booking.findFirst({
      where: whereClause,
      include: {
        customer: true,
        provider: {
          include: {
            calendarConnections: {
              where: {
                isDefaultForBookings: true,
                isActive: true,
              },
            },
          },
        },
        calendarEvent: true,
      },
    });

    if (!booking) {
      return NextResponse.json(
        { error: 'Booking not found or access denied' },
        { status: 404 }
      );
    }

    if (booking.status !== 'PENDING') {
      return NextResponse.json(
        { error: `Booking is already ${booking.status.toLowerCase()}` },
        { status: 400 }
      );
    }

    // Update booking status to confirmed
    const updatedBooking = await prisma.booking.update({
      where: { id: bookingId },
      data: { 
        status: 'CONFIRMED',
        updatedAt: new Date(),
      },
      include: {
        customer: true,
        provider: true,
        calendarEvent: true,
      },
    });

    // Create calendar event if provider has a default calendar
    if (booking.provider.calendarConnections.length > 0) {
      try {
        await createCalendarEvent(updatedBooking, booking.provider.calendarConnections[0]);
      } catch (error) {
        console.error('Failed to create calendar event:', error);
        // Don't fail the booking confirmation if calendar creation fails
      }
    }

    // Send confirmation emails to both parties
    // Use the default calendar email if available, otherwise use provider signup email
    const providerNotificationEmail = booking.provider.calendarConnections[0]?.email || updatedBooking.provider.email;
    
    const bookingDetails = {
  id: updatedBooking.id,
  customerName: `${updatedBooking.customer.firstName || 'Unknown'} ${updatedBooking.customer.lastName || 'Customer'}`,
  customerEmail: updatedBooking.customer.email,
  providerName: updatedBooking.provider.name,
  providerEmail: providerNotificationEmail, // Use default calendar email
  scheduledAt: updatedBooking.scheduledAt,
  duration: updatedBooking.duration,
  serviceType: updatedBooking.serviceType,
  notes: updatedBooking.notes || undefined,
  location: updatedBooking.calendarEvent?.location || undefined,
};

// Fetch provider timezone for email formatting
const providerLocation = await prisma.providerLocation.findFirst({
  where: { 
    providerId: updatedBooking.providerId,
    isDefault: true 
  },
  select: { timezone: true }
});

const providerTimezone = providerLocation?.timezone || 'America/New_York';

try {
  await emailService.sendBookingConfirmation(bookingDetails, providerTimezone);
} catch (error) {
  console.error('Failed to send confirmation emails:', error);
  // Don't fail the booking confirmation if email sending fails
}

    // Return different responses based on request method
    if (request.method === 'GET') {
      // Return HTML page for email links
      const successHtml = `
        <!DOCTYPE html>
        <html>
          <head>
            <meta charset="utf-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Booking Confirmed - Zone Meet</title>
          </head>
          <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 50px auto; padding: 20px;">
            <div style="text-align: center; margin-bottom: 30px;">
              <img src="https://www.zone-meet.com/_next/image?url=%2FZoneMeet_Logo_v3.png&w=256&q=75" 
                   alt="Zone Meet Logo" 
                   style="max-width: 200px; height: auto; margin-bottom: 10px;">
              <h1 style="color: #2563eb; margin: 0;">Zone Meet</h1>
            </div>
            
            <div style="background-color: #dcfce7; border: 1px solid #bbf7d0; padding: 20px; border-radius: 8px; text-align: center;">
              <h2 style="color: #16a34a; margin-top: 0;">✅ Booking Confirmed!</h2>
              <p>You have successfully confirmed the appointment with <strong>${updatedBooking.customer.firstName} ${updatedBooking.customer.lastName}</strong>.</p>
              
              <div style="background-color: white; padding: 15px; border-radius: 5px; margin: 20px 0; text-align: left;">
                <h3 style="margin-top: 0; color: #1f2937;">Appointment Details:</h3>
                <p><strong>Service:</strong> ${updatedBooking.serviceType}</p>
                <p><strong>Date & Time:</strong> ${updatedBooking.scheduledAt.toLocaleDateString('en-US', {
                  weekday: 'long',
                  year: 'numeric',
                  month: 'long',
                  day: 'numeric',
                  hour: 'numeric',
                  minute: '2-digit',
                  hour12: true
                })}</p>
                <p><strong>Duration:</strong> ${updatedBooking.duration} minutes</p>
                <p><strong>Customer:</strong> ${updatedBooking.customer.email}</p>
              </div>
              
              <p style="color: #059669; font-weight: bold;">Confirmation emails have been sent to both you and the customer.</p>
            </div>
            
            <div style="text-align: center; margin-top: 30px;">
              <a href="https://www.zone-meet.com/provider/dashboard" 
                 style="background-color: #2563eb; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px; display: inline-block; margin: 0 10px;">
                View Dashboard
              </a>
              <a href="https://www.zone-meet.com" 
                 style="background-color: #6b7280; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px; display: inline-block; margin: 0 10px;">
                Return to Home
              </a>
            </div>
          </body>
        </html>
      `;
      
      return new NextResponse(successHtml, {
        status: 200,
        headers: { 'Content-Type': 'text/html' },
      });
    }

    // Return JSON for API calls (POST requests)
    return NextResponse.json({
      success: true,
      message: 'Booking confirmed successfully',
      booking: {
        id: updatedBooking.id,
        status: updatedBooking.status,
        scheduledAt: updatedBooking.scheduledAt,
        customerName: `${updatedBooking.customer.firstName} ${updatedBooking.customer.lastName}`,
        providerName: updatedBooking.provider.name,
      }
    });

  } catch (error) {
    console.error('Error confirming booking:', error);
    
    if (request.method === 'GET') {
      // Return HTML error page for email links
      const errorHtml = `
        <!DOCTYPE html>
        <html>
          <head>
            <meta charset="utf-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Error - Zone Meet</title>
          </head>
          <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 50px auto; padding: 20px;">
            <div style="text-align: center; margin-bottom: 30px;">
              <img src="https://www.zone-meet.com/_next/image?url=%2FZoneMeet_Logo_v3.png&w=256&q=75" 
                   alt="Zone Meet Logo" 
                   style="max-width: 200px; height: auto; margin-bottom: 10px;">
              <h1 style="color: #2563eb; margin: 0;">Zone Meet</h1>
            </div>
            
            <div style="background-color: #fee2e2; border: 1px solid #fecaca; padding: 20px; border-radius: 8px; text-align: center;">
              <h2 style="color: #dc2626; margin-top: 0;">❌ Error</h2>
              <p>Sorry, we couldn't confirm this booking. Please try again or contact support.</p>
            </div>
            
            <div style="text-align: center; margin-top: 30px;">
              <a href="https://www.zone-meet.com" 
                 style="background-color: #2563eb; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px; display: inline-block;">
                Return to Zone Meet
              </a>
            </div>
          </body>
        </html>
      `;
      
      return new NextResponse(errorHtml, {
        status: 500,
        headers: { 'Content-Type': 'text/html' },
      });
    }
    
    return NextResponse.json(
      { error: 'Failed to confirm booking' },
      { status: 500 }
    );
  }
}

// Helper function to create calendar event (reused from client confirmation)
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

  } catch (error) {
    console.error('Failed to create calendar event:', error);
    throw error;
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