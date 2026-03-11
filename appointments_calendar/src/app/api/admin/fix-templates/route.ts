import { NextRequest, NextResponse } from 'next/server';
import { AvailabilityService } from '@/lib/availability-service';

function isAuthorized(request: NextRequest): boolean {
  const authHeader = request.headers.get('authorization');
  const adminSecret = process.env.ADMIN_SECRET || 'change-this-secret-in-production';
  return authHeader === `Bearer ${adminSecret}`;
}

async function fixTemplates(request: NextRequest) {
  // Verify admin authentication
  if (!isAuthorized(request)) {
    return NextResponse.json(
      { error: 'Unauthorized' },
      { status: 401 }
    );
  }

  try {
    await AvailabilityService.fixAllMultipleDefaults();
    
    return NextResponse.json({ 
      success: true, 
      message: 'Fixed multiple default templates across all providers' 
    });
  } catch (error) {
    console.error('Error fixing templates:', error);
    return NextResponse.json(
      { error: 'Failed to fix templates' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  return fixTemplates(request);
}

export async function GET(request: NextRequest) {
  return fixTemplates(request);
}