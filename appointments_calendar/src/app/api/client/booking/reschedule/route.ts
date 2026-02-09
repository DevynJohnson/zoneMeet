// API endpoint for customers to reschedule their bookings
import { NextRequest, NextResponse } from 'next/server';
import { emailService } from '@/lib/maileroo-email-service';
import { prisma } from '@/lib/db';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { token, newDateTime } = body;

    if (!token || !newDateTime) {
      return NextResponse.json(
        { error: 'Missing required fields' },
        { status: 400 }
      );
    }

    // Verify the magic link token
    const linkData = emailService.verifyMagicLinkToken(token);
    
    if (!linkData) {
      return NextResponse.json(
        { error: 'Invalid or expired link' },
        { status: 400 }
      );
    }

    // Find the booking
    const booking = await prisma.booking.findUnique({
      where: { id: linkData.bookingId },
      include: {
        customer: true,
        provider: true,
      },
    });

    if (!booking) {
      return NextResponse.json(
        { error: 'Booking not found' },
        { status: 404 }
      );
    }

    // Verify the customer email matches
    if (booking.customer.email !== linkData.customerEmail) {
      return NextResponse.json(
        { error: 'Invalid link' },
        { status: 403 }
      );
    }

    // Check if booking can be rescheduled
    if (booking.status === 'CANCELLED') {
      return NextResponse.json(
        { error: 'This booking has been cancelled and cannot be rescheduled' },
        { status: 400 }
      );
    }

    // Parse and validate the new datetime
    const newDate = new Date(newDateTime);
    if (isNaN(newDate.getTime())) {
      return NextResponse.json(
        { error: 'Invalid date format' },
        { status: 400 }
      );
    }

    // Validate the new datetime is in the future
    if (newDate <= new Date()) {
      return NextResponse.json(
        { error: 'New appointment time must be in the future' },
        { status: 400 }
      );
    }

    // Update the booking with new time and set status to PENDING (provider needs to confirm)
    const updatedBooking = await prisma.booking.update({
      where: { id: booking.id },
      data: {
        scheduledAt: newDate,
        status: 'PENDING', // Requires provider confirmation
        updatedAt: new Date(),
      },
      include: {
        customer: true,
        provider: true,
      },
    });

    // Send notification to provider about the reschedule request
    try {
      const bookingDetails = {
        id: updatedBooking.id,
        customerName: `${updatedBooking.customer.firstName || ''} ${updatedBooking.customer.lastName || ''}`.trim() || 'Customer',
        customerEmail: updatedBooking.customer.email,
        providerName: updatedBooking.provider.name,
        providerEmail: updatedBooking.provider.email,
        scheduledAt: updatedBooking.scheduledAt,
        duration: updatedBooking.duration,
        serviceType: updatedBooking.serviceType,
        notes: updatedBooking.notes || undefined,
      };

      await emailService.sendBookingNotificationToProvider(bookingDetails);
      
      // Also send reschedule notification to customer
      await emailService.sendBookingReschedule(bookingDetails, newDate);
    } catch (emailError) {
      console.error('Failed to send notifications:', emailError);
      // Don't fail the reschedule if email sending fails
    }

    return NextResponse.json({
      success: true,
      message: 'Reschedule request submitted successfully',
      booking: {
        id: updatedBooking.id,
        scheduledAt: updatedBooking.scheduledAt,
        status: updatedBooking.status,
      },
    });
  } catch (error) {
    console.error('Error processing reschedule:', error);
    return NextResponse.json(
      { error: 'Failed to process reschedule request' },
      { status: 500 }
    );
  }
}
