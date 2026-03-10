// Apple iCloud Calendar connection using CalDAV
import { NextRequest, NextResponse } from 'next/server';
import { ProviderAuthService } from '@/lib/provider-auth';
import { CalendarConnectionService } from '@/lib/calendar-connections';
import { CalendarPlatform } from '@prisma/client';

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

    const { appleId, appPassword } = await request.json();

    if (!appleId || !appPassword) {
      return NextResponse.json(
        { error: 'Apple ID and App-Specific Password are required' },
        { status: 400 }
      );
    }

    // Validate Apple ID format
    if (!appleId.includes('@') || !appleId.includes('.')) {
      return NextResponse.json(
        { error: 'Please enter a valid Apple ID email address' },
        { status: 400 }
      );
    }

    // Test CalDAV connection to iCloud
    // Apple CalDAV requires a principal discovery process
    const authString = Buffer.from(`${appleId}:${appPassword}`).toString('base64');
    
    try {
      // Step 1: Principal discovery - find the user's calendar home
      const principalResponse = await fetch('https://caldav.icloud.com/', {
        method: 'PROPFIND',
        headers: {
          'Authorization': `Basic ${authString}`,
          'Content-Type': 'application/xml; charset=utf-8',
          'Depth': '0'
        },
        body: `<?xml version="1.0" encoding="utf-8" ?>
<D:propfind xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">
  <D:prop>
    <C:calendar-home-set />
    <D:current-user-principal />
  </D:prop>
</D:propfind>`
      });
      
      if (principalResponse.status === 401) {
        return NextResponse.json(
          { error: 'Invalid Apple ID or App-Specific Password. Please check your credentials and regenerate the App-Specific Password if needed.' },
          { status: 400 }
        );
      }
      
      if (!principalResponse.ok) {
        return NextResponse.json(
          { error: `Failed to authenticate with Apple Calendar (${principalResponse.status}). Please verify your Apple ID and App-Specific Password.` },
          { status: 400 }
        );
      }

      // If we get here, authentication worked

      // Save the Apple Calendar connection with properly formatted credentials
      // Store as base64-encoded JSON for consistency with the sync code
      const credentials = {
        appleId: appleId,
        appSpecificPassword: appPassword
      };
      const encodedCredentials = Buffer.from(JSON.stringify(credentials)).toString('base64');

      await CalendarConnectionService.createConnection({
        providerId: provider.id,
        platform: CalendarPlatform.APPLE,
        email: appleId,
        calendarId: 'primary',
        accessToken: encodedCredentials, // Store encoded JSON credentials
        refreshToken: undefined, // Apple doesn't use refresh tokens
        tokenExpiry: undefined, // App passwords don't expire (until manually revoked)
      });

      return NextResponse.json({
        success: true,
        message: 'Apple Calendar connected successfully'
      });

    } catch (caldavError) {
      return NextResponse.json(
        { 
          error: 'Failed to connect to Apple Calendar. Please check your Apple ID and App-Specific Password.',
          success: false,
          details: String(caldavError)
        },
        { status: 400 }
      );
    }

  } catch {
    return NextResponse.json(
      { error: 'Failed to connect Apple Calendar' },
      { status: 500 }
    );
  }
}
