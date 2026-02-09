// API endpoint to get booking details from a magic link token
import { NextRequest, NextResponse } from 'next/server';
import { emailService } from '@/lib/maileroo-email-service';
import { prisma } from '@/lib/db';

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
        customer: {
          select: {
            firstName: true,
            lastName: true,
            email: true,
          },
        },
        provider: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
      },
    });

    if (!booking) {
      return NextResponse.json({ error: 'Booking not found' }, { status: 404 });
    }

    // Verify the customer email matches
    if (booking.customer.email !== linkData.customerEmail) {
      return NextResponse.json({ error: 'Invalid link' }, { status: 403 });
    }

    // Check if booking can be rescheduled
    if (booking.status === 'CANCELLED') {
      return NextResponse.json({ error: 'This booking has been cancelled and cannot be rescheduled' }, { status: 400 });
    }

    return NextResponse.json({
      success: true,
      booking: {
        id: booking.id,
        scheduledAt: booking.scheduledAt.toISOString(),
        duration: booking.duration,
        serviceType: booking.serviceType,
        notes: booking.notes,
        status: booking.status,
        customer: booking.customer,
        provider: booking.provider,
      },
    });
  } catch (error) {
    console.error('Error fetching booking details:', error);
    return NextResponse.json(
      { error: 'Failed to fetch booking details' },
      { status: 500 }
    );
  }
}
