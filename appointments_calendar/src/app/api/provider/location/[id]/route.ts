import { NextRequest, NextResponse } from 'next/server';
import { ProviderAuthService } from '@/lib/provider-auth';
import { prisma } from '@/lib/db';

export async function PUT(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const authHeader = request.headers.get('authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return NextResponse.json(
        { error: 'Missing or invalid authorization header' },
        { status: 401 }
      );
    }

    const token = authHeader.substring(7);
    const provider = await ProviderAuthService.verifyToken(token);
    const { id } = await context.params;

    // Add timezone, addressLine1, addressLine2 to destructuring
    const { 
      timezone, 
      addressLine1, 
      addressLine2, 
      city, 
      stateProvince, 
      postalCode,
      country, 
      description, 
      startDate, 
      endDate, 
      isDefault 
    } = await request.json();

    // Validate required fields (dates not required for default locations)
    if (!city || !stateProvince || !country) {
      return NextResponse.json({ 
        error: 'City, state/province, and country are required' 
      }, { status: 400 });
    }

    // For non-default locations, require dates
    if (!isDefault && (!startDate || !endDate)) {
      return NextResponse.json({ 
        error: 'Start date and end date are required for non-default locations' 
      }, { status: 400 });
    }

    // Set up dates for storage
    let start: Date, end: Date;
    if (isDefault) {
      // For default locations, use indefinite timeframe
      start = new Date('1900-01-01'); // Far past date
      end = new Date('2099-12-31');   // Far future date
    } else {
      start = new Date(startDate);
      end = new Date(endDate);
      
      // Validate date range for non-default locations
      if (start >= end) {
        return NextResponse.json({ 
          error: 'Start date must be before end date' 
        }, { status: 400 });
      }
    }

    // If setting as default, remove default from other locations
    if (isDefault) {
      await prisma.providerLocation.updateMany({
        where: { 
          providerId: provider.id,
          isDefault: true,
          NOT: { id } // Exclude current location
        },
        data: { isDefault: false }
      });
    }

    const location = await prisma.providerLocation.update({
      where: { 
        id,
        providerId: provider.id // Ensure provider owns this location
      },
      data: {
        timezone,           // Add this
        addressLine1,       // Add this
        addressLine2,       // Add this
        city,
        stateProvince,
        postalCode: postalCode || null,
        country,
        description: description || null,
        startDate: start,
        endDate: end,
        isDefault: Boolean(isDefault)
      }
    });

    return NextResponse.json({ location });
  } catch (error) {
    console.error('Error updating provider location:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const authHeader = request.headers.get('authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return NextResponse.json(
        { error: 'Missing or invalid authorization header' },
        { status: 401 }
      );
    }

    const token = authHeader.substring(7);
    const provider = await ProviderAuthService.verifyToken(token);
    const { id } = await context.params;

    await prisma.providerLocation.delete({
      where: { 
        id,
        providerId: provider.id // Ensure provider owns this location
      }
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error deleting provider location:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}