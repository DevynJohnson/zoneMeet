// API endpoint for rescheduling a booking
import { NextRequest, NextResponse } from 'next/server';
import { extractAndVerifyJWT } from '@/lib/jwt-utils';
import { prisma } from '@/lib/db';
import { emailService } from '@/lib/maileroo-email-service';

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    // Extract and verify the JWT token
    const authHeader = request.headers.get('Authorization');
    const jwtResult = extractAndVerifyJWT(authHeader);
    
    if (!jwtResult.success) {
      return NextResponse.json(
        { error: jwtResult.error },
        { status: 401 }
      );
    }

    const providerId = jwtResult.payload!.providerId;
    const params = await context.params;
    const bookingId = params.id;

    // Parse request body for new datetime
    const body = await request.json().catch(() => ({}));
    const { newDateTime } = body;

    if (!newDateTime) {
      return NextResponse.json(
        { error: 'New date and time is required' },
        { status: 400 }
      );
    }

    // Validate the new datetime
    const newDate = new Date(newDateTime);
    if (isNaN(newDate.getTime())) {
      return NextResponse.json(
        { error: 'Invalid date format' },
        { status: 400 }
      );
    }

    if (newDate <= new Date()) {
      return NextResponse.json(
        { error: 'New appointment time must be in the future' },
        { status: 400 }
      );
    }

    // Find the booking and verify it belongs to this provider
    const booking = await prisma.booking.findFirst({
      where: {
        id: bookingId,
        providerId: providerId,
      },
      include: {
        customer: true,
        provider: {
          include: {
            locations: {
              where: {
                isActive: true,
              },
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
        { error: 'Cannot reschedule a cancelled booking' },
        { status: 400 }
      );
    }

    // Update the booking with new datetime and set to PENDING for customer confirmation
    const updatedBooking = await prisma.booking.update({
      where: { id: bookingId },
      data: { 
        status: 'PENDING', // Customer needs to confirm the new time
        scheduledAt: newDate,
        updatedAt: new Date(),
      },
      include: {
        customer: true,
        provider: {
          include: {
            locations: {
              where: {
                isActive: true,
              },
            },
          },
        },
      },
    });

    // Get provider timezone from their active locations
    const providerTimezone = updatedBooking.provider.locations?.find(loc => loc.isDefault)?.timezone 
      || updatedBooking.provider.locations?.[0]?.timezone 
      || 'America/New_York';

    // Send reschedule confirmation request to customer with action buttons
    try {
      const bookingDetails = {
        id: updatedBooking.id,
        customerName: `${updatedBooking.customer.firstName || ''} ${updatedBooking.customer.lastName || ''}`.trim() || 'Valued Customer',
        customerEmail: updatedBooking.customer.email,
        providerName: updatedBooking.provider.name,
        providerEmail: updatedBooking.provider.email,
        scheduledAt: updatedBooking.scheduledAt, // New scheduled time
        duration: updatedBooking.duration,
        serviceType: updatedBooking.serviceType,
        notes: updatedBooking.notes || undefined,
      };
      
      await emailService.sendRescheduleConfirmationRequest(bookingDetails, providerTimezone);
    } catch (error) {
      console.error('Failed to send reschedule confirmation email:', error);
      // Don't fail the reschedule if email sending fails
    }

    return NextResponse.json({
      success: true,
      message: 'Booking rescheduled successfully',
      booking: {
        id: updatedBooking.id,
        status: updatedBooking.status,
        scheduledAt: updatedBooking.scheduledAt,
        customerName: `${updatedBooking.customer.firstName} ${updatedBooking.customer.lastName}`,
        providerName: updatedBooking.provider.name,
      }
    });

  } catch (error) {
    console.error('Error rescheduling booking:', error);
    return NextResponse.json(
      { error: 'Failed to reschedule booking' },
      { status: 500 }
    );
  }
}