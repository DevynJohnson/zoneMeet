import { NextRequest, NextResponse } from 'next/server';
import { ProviderAuthService } from '@/lib/provider-auth';
import { prisma } from '@/lib/db';


export async function GET(request: NextRequest) {
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

    const locations = await prisma.providerLocation.findMany({
      where: { providerId: provider.id },
      orderBy: [
        { isDefault: 'desc' }, // Default location first
        { startDate: 'asc' }
      ]
    });

    return NextResponse.json({ locations });
  } catch (error) {
    console.error('Error fetching provider locations:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
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

    const { addressLine1, addressLine2, timezone, city, stateProvince, postalCode, country, description, startDate, endDate, isDefault } = await request.json();

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
          isDefault: true 
        },
        data: { isDefault: false }
      });
    }

    const location = await prisma.providerLocation.create({
      data: {
        addressLine1,
        addressLine2,
        timezone,
        providerId: provider.id,
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

    return NextResponse.json({ location }, { status: 201 });
  } catch (error) {
    console.error('Error creating provider location:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}