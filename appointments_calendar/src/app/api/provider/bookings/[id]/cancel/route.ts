// API endpoint for cancelling/denying a booking
import { NextRequest, NextResponse } from 'next/server';
import { extractAndVerifyJWT } from '@/lib/jwt-utils';
import { prisma } from '@/lib/db';
import { emailService } from '@/lib/maileroo-email-service';

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  return handleCancelBooking(request, context);
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  return handleCancelBooking(request, context);
}

async function handleCancelBooking(
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

    // Find the booking and verify it belongs to this provider (if authenticated)
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
              select: {
                email: true,
              },
              take: 1,
            },
          },
        },
      },
    });

    if (!booking) {
      return NextResponse.json(
        { error: 'Booking not found or access denied' },
        { status: 404 }
      );
    }

    if (booking.status === 'CANCELLED') {
      return NextResponse.json(
        { error: 'Booking is already cancelled' },
        { status: 400 }
      );
    }

    // Update booking status to cancelled
    const updatedBooking = await prisma.booking.update({
      where: { id: bookingId },
      data: { 
        status: 'CANCELLED',
        updatedAt: new Date(),
      },
      include: {
        customer: true,
        provider: true,
      },
    });

    // Send cancellation email to customer
    // Use the default calendar email if available, otherwise use provider signup email
    const providerNotificationEmail = booking.provider.calendarConnections?.[0]?.email || updatedBooking.provider.email;
    
    try {
      const bookingDetails = {
        id: updatedBooking.id,
        customerName: `${updatedBooking.customer.firstName || ''} ${updatedBooking.customer.lastName || ''}`.trim() || 'Valued Customer',
        customerEmail: updatedBooking.customer.email,
        providerName: updatedBooking.provider.name,
        providerEmail: providerNotificationEmail, // Use default calendar email
        scheduledAt: updatedBooking.scheduledAt,
        duration: updatedBooking.duration,
        serviceType: updatedBooking.serviceType,
        notes: updatedBooking.notes || undefined,
      };
      
      await emailService.sendBookingCancellation(bookingDetails);
    } catch (error) {
      console.error('Failed to send cancellation email:', error);
      // Don't fail the cancellation if email sending fails
    }

    const actionType = booking.status === 'PENDING' ? 'denied' : 'cancelled';

    // Return different responses based on request method
    if (request.method === 'GET') {
      // Return HTML page for email links
      const successHtml = `
        <!DOCTYPE html>
        <html>
          <head>
            <meta charset="utf-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Booking ${actionType.charAt(0).toUpperCase() + actionType.slice(1)} - Zone Meet</title>
          </head>
          <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 50px auto; padding: 20px;">
            <div style="text-align: center; margin-bottom: 30px;">
              <img src="https://www.zone-meet.com/_next/image?url=%2FZoneMeet_Logo.png&w=256&q=75" 
                   alt="Zone Meet Logo" 
                   style="max-width: 200px; height: auto; margin-bottom: 10px;">
              <h1 style="color: #2563eb; margin: 0;">Zone Meet</h1>
            </div>
            
            <div style="background-color: #fef3c7; border: 1px solid #fbbf24; padding: 20px; border-radius: 8px; text-align: center;">
              <h2 style="color: #d97706; margin-top: 0;">❌ Booking ${actionType.charAt(0).toUpperCase() + actionType.slice(1)}</h2>
              <p>You have successfully ${actionType} the appointment with <strong>${updatedBooking.customer.firstName} ${updatedBooking.customer.lastName}</strong>.</p>
              
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
              
              <p style="color: #d97706; font-weight: bold;">The customer has been notified via email.</p>
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
      message: `Booking ${actionType} successfully`,
      booking: {
        id: updatedBooking.id,
        status: updatedBooking.status,
        scheduledAt: updatedBooking.scheduledAt,
        customerName: `${updatedBooking.customer.firstName} ${updatedBooking.customer.lastName}`,
        providerName: updatedBooking.provider.name,
      }
    });

  } catch (error) {
    console.error('Error cancelling booking:', error);
    
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
              <img src="https://www.zone-meet.com/_next/image?url=%2FZoneMeet_Logo.png&w=256&q=75" 
                   alt="Zone Meet Logo" 
                   style="max-width: 200px; height: auto; margin-bottom: 10px;">
              <h1 style="color: #2563eb; margin: 0;">Zone Meet</h1>
            </div>
            
            <div style="background-color: #fee2e2; border: 1px solid #fecaca; padding: 20px; border-radius: 8px; text-align: center;">
              <h2 style="color: #dc2626; margin-top: 0;">❌ Error</h2>
              <p>Sorry, we couldn't cancel this booking. Please try again or contact support.</p>
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
      { error: 'Failed to cancel booking' },
      { status: 500 }
    );
  }
}