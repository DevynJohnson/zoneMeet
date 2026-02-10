// Microsoft Calendar OAuth callback
import { NextRequest, NextResponse } from 'next/server';
import { CalendarConnectionService } from '@/lib/calendar-connections';
import { CalendarPlatform } from '@prisma/client';

export async function GET(request: NextRequest) {
  // Use environment-specific base URL
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || new URL(request.url).origin;
  
  try {
    const searchParams = request.nextUrl.searchParams;
    const code = searchParams.get('code');
    const state = searchParams.get('state');
    const error = searchParams.get('error');

    // Handle OAuth error
    if (error) {
      return NextResponse.redirect(
        new URL('/provider/calendar/connect?error=oauth_failed', baseUrl)
      );
    }

    // Validate required parameters
    if (!code) {
      return NextResponse.redirect(
        new URL('/provider/calendar/connect?error=missing_code', baseUrl)
      );
    }

    // Extract provider ID, platform, and re-auth info from state parameter
    let providerId: string;
    let platform: 'outlook' | 'teams' = 'outlook'; // Default to outlook
    let connectionId: string | undefined;
    let isReauth: boolean = false;
    try {
      if (state) {
        const stateData = JSON.parse(decodeURIComponent(state));
        providerId = stateData.providerId;
        platform = stateData.platform || 'outlook'; // Get platform from state
        connectionId = stateData.connectionId;
        isReauth = stateData.isReauth || false;
      } else {
        throw new Error('Missing state parameter');
      }
    } catch {
      return NextResponse.redirect(
        new URL('/provider/calendar/connect?error=invalid_state', baseUrl)
      );
    }

    // Exchange authorization code for tokens
    const tokenResponse = await fetch(
      `https://login.microsoftonline.com/common/oauth2/v2.0/token`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          client_id: platform === 'teams' ? process.env.TEAMS_CLIENT_ID! : process.env.OUTLOOK_CLIENT_ID!,
          client_secret: platform === 'teams' ? process.env.TEAMS_CLIENT_SECRET! : process.env.OUTLOOK_CLIENT_SECRET!,
          code,
          grant_type: 'authorization_code',
          redirect_uri: platform === 'teams' ? process.env.TEAMS_REDIRECT_URI! : process.env.OUTLOOK_REDIRECT_URI!,
          scope: 'https://graph.microsoft.com/Calendars.Read https://graph.microsoft.com/Calendars.ReadWrite https://graph.microsoft.com/User.Read offline_access',
        }),
      }
    );
    
    if (!tokenResponse.ok) {
      const errorData = await tokenResponse.text();
      console.error('❌ Microsoft token exchange failed:', {
        status: tokenResponse.status,
        statusText: tokenResponse.statusText,
        error: errorData,
        clientId: platform === 'teams' ? process.env.TEAMS_CLIENT_ID : process.env.OUTLOOK_CLIENT_ID,
        redirectUri: platform === 'teams' ? process.env.TEAMS_REDIRECT_URI : process.env.OUTLOOK_REDIRECT_URI,
      });
      return NextResponse.redirect(
        new URL('/provider/calendar/connect?error=token_exchange_failed', baseUrl)
      );
    }

    const tokens = await tokenResponse.json();

    // Get user's profile and calendar info
    const profileResponse = await fetch(
      'https://graph.microsoft.com/v1.0/me',
      {
        headers: {
          'Authorization': `Bearer ${tokens.access_token}`,
        },
      }
    );

    if (!profileResponse.ok) {
      return NextResponse.redirect(
        new URL('/provider/calendar/connect?error=profile_access_failed', baseUrl)
      );
    }

    const profile = await profileResponse.json();

    // Get calendar info
    const calendarResponse = await fetch(
      'https://graph.microsoft.com/v1.0/me/calendar',
      {
        headers: {
          'Authorization': `Bearer ${tokens.access_token}`,
        },
      }
    );

    const calendarInfo = await calendarResponse.json();

    const userEmail = profile.mail || profile.userPrincipalName;

    if (!userEmail) {
      return NextResponse.redirect(
        new URL('/provider/calendar/connect?error=no_email_found', baseUrl)
      );
    }

    // Save or update calendar connection
    if (isReauth && connectionId) {
      // Update the existing connection with new tokens
      await CalendarConnectionService.updateConnection(connectionId, {
        email: userEmail,
        calendarId: calendarInfo.id,
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        tokenExpiry: tokens.expires_in 
          ? new Date(Date.now() + tokens.expires_in * 1000)
          : null,
      });

      // Redirect back to the management page
      return NextResponse.redirect(
        new URL(`/provider/calendar/manage/${connectionId}?success=reauth_success`, baseUrl)
      );
    } else {
      // Create new connection
      await CalendarConnectionService.createConnection({
        providerId,
        platform: platform === 'teams' ? CalendarPlatform.TEAMS : CalendarPlatform.OUTLOOK,
        email: userEmail,
        calendarId: calendarInfo.id,
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        tokenExpiry: tokens.expires_in 
          ? new Date(Date.now() + tokens.expires_in * 1000)
          : null,
      });

      // Redirect back to calendar connect page with success
      const successParam = platform === 'teams' ? 'teams_connected' : 'microsoft_connected';
      return NextResponse.redirect(
        new URL(`/provider/calendar/connect?success=${successParam}`, baseUrl)
      );
    }

  } catch (error) {
    console.error('❌ Microsoft OAuth callback failed:', error);
    if (error instanceof Error) {
      console.error('Error details:', {
        message: error.message,
        stack: error.stack,
      });
    }
    return NextResponse.redirect(
      new URL('/provider/calendar/connect?error=callback_failed', baseUrl)
    );
  }
}
