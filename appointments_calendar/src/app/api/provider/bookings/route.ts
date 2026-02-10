// API endpoint to fetch all bookings for the authenticated provider
import { NextRequest, NextResponse } from 'next/server';
import { extractAndVerifyJWT } from '@/lib/jwt-utils';
import { prisma } from '@/lib/db';

export async function GET(request: NextRequest) {
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

    // Fetch all bookings for this provider
    const bookings = await prisma.booking.findMany({
      where: {
        providerId: providerId,
      },
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
      orderBy: [
        {
          status: 'asc', // PENDING first
        },
        {
          scheduledAt: 'asc', // Then by date
        },
      ],
    });

    // Transform the data for the frontend
    const transformedBookings = bookings.map(booking => ({
      id: booking.id,
      scheduledAt: booking.scheduledAt.toISOString(),
      duration: booking.duration,
      serviceType: booking.serviceType,
      notes: booking.notes,
      status: booking.status,
      customer: booking.customer,
      provider: booking.provider,
      createdAt: booking.createdAt.toISOString(),
      updatedAt: booking.updatedAt.toISOString(),
    }));

    return NextResponse.json(transformedBookings);
  } catch (error) {
    console.error('Error fetching provider bookings:', error);
    return NextResponse.json(
      { error: 'Failed to fetch bookings' },
      { status: 500 }
    );
  }
}

// Bulk delete endpoint for clearing old bookings
export async function DELETE(request: NextRequest) {
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

    // Delete all CANCELLED and COMPLETED bookings for this provider
    const result = await prisma.booking.deleteMany({
      where: {
        providerId: providerId,
        status: {
          in: ['CANCELLED', 'COMPLETED'],
        },
      },
    });

    return NextResponse.json({
      success: true,
      message: `Successfully deleted ${result.count} booking(s)`,
      deletedCount: result.count,
    });
  } catch (error) {
    console.error('Error bulk deleting bookings:', error);
    return NextResponse.json(
      { error: 'Failed to delete bookings' },
      { status: 500 }
    );
  }
}