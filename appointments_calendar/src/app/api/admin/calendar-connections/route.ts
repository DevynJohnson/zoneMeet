// Admin endpoint to view calendar connections
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

function isAuthorized(request: NextRequest): boolean {
  const authHeader = request.headers.get('authorization');
  const adminSecret = process.env.ADMIN_SECRET || 'change-this-secret-in-production';
  return authHeader === `Bearer ${adminSecret}`;
}

export async function GET(request: NextRequest) {
  // Verify admin authentication
  if (!isAuthorized(request)) {
    return NextResponse.json(
      { error: 'Unauthorized' },
      { status: 401 }
    );
  }

  try {
    const connections = await prisma.calendarConnection.findMany({
      include: {
        provider: {
          select: {
            name: true,
            email: true,
          }
        }
      },
      orderBy: { createdAt: 'desc' }
    });

    return NextResponse.json({
      count: connections.length,
      connections
    });
  } catch (error) {
    console.error('Failed to get calendar connections:', error);
    return NextResponse.json(
      { error: 'Failed to get calendar connections' },
      { status: 500 }
    );
  }
}
