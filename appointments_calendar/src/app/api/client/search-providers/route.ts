import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

export async function GET(request: NextRequest) {
  try {

    const { searchParams } = new URL(request.url);
    const query = searchParams.get('q') || '';
    const city = searchParams.get('city') || '';
    const state = searchParams.get('state') || '';
    const limit = parseInt(searchParams.get('limit') || '50');

    console.log('Search params:', { query, city, state, limit });

    // Simple query to get all providers with their locations
    const providers = await prisma.provider.findMany({
      where: {
        isActive: true
      },
      include: {
        locations: {
          select: {
            id: true,
            city: true,
            stateProvince: true,
            country: true,
            isDefault: true
          }
        }
      },
      take: limit,
      orderBy: [
        { company: 'asc' },
        { name: 'asc' }
      ]
    });

    // Format response
    const formattedProviders = providers.map((provider) => {
      // Format location display
      const primaryLocation = provider.locations.find(loc => loc.isDefault) || provider.locations[0];
      const locationDisplay = primaryLocation 
        ? `${primaryLocation.city}, ${primaryLocation.stateProvince}`
        : 'Location not specified';

      return {
        id: provider.id,
        name: provider.name,
        email: provider.email,
        company: provider.company,
        bio: provider.bio,
        phone: provider.phone,
        title: provider.title,
        website: provider.website,
        defaultBookingDuration: provider.defaultBookingDuration,
        location: locationDisplay,
        locations: provider.locations
      };
    });

    return NextResponse.json({
      success: true,
      providers: formattedProviders,
      total: formattedProviders.length
    });

  } catch (error) {
    console.error('Failed to search providers:', error);
    return NextResponse.json(
      { 
        error: 'Failed to search providers',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}
