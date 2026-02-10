// API endpoint for deleting a booking
import { NextRequest, NextResponse } from 'next/server';
import { extractAndVerifyJWT } from '@/lib/jwt-utils';
import { prisma } from '@/lib/db';

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const params = await context.params;
    const bookingId = params.id;
    
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

    // Find the booking and verify it belongs to this provider
    const booking = await prisma.booking.findFirst({
      where: {
        id: bookingId,
        providerId: providerId,
      },
      select: {
        id: true,
        status: true,
      },
    });

    if (!booking) {
      return NextResponse.json(
        { error: 'Booking not found or access denied' },
        { status: 404 }
      );
    }

    // Only allow deletion of CANCELLED or COMPLETED bookings
    // to prevent accidental deletion of active bookings
    if (booking.status !== 'CANCELLED' && booking.status !== 'COMPLETED') {
      return NextResponse.json(
        { error: 'Only cancelled or completed bookings can be deleted' },
        { status: 400 }
      );
    }

    // Delete the booking
    await prisma.booking.delete({
      where: { id: bookingId },
    });

    return NextResponse.json(
      { success: true, message: 'Booking deleted successfully' },
      { status: 200 }
    );
  } catch (error) {
    console.error('Error deleting booking:', error);
    return NextResponse.json(
      { error: 'Failed to delete booking' },
      { status: 500 }
    );
  }
}
