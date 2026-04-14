// Google Calendar OAuth callback
import { NextRequest, NextResponse } from 'next/server';
import { CalendarConnectionService } from '@/lib/calendar-connections';
import { prisma } from '@/lib/db';
import { CalendarPlatform } from '@prisma/client';

export async function GET(request: NextRequest) {
  // Use environment-specific base URL
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || new URL(request.url).origin;
  
  try {
    console.log('🔍 Google OAuth Callback Started');
    
    const searchParams = request.nextUrl.searchParams;
    const code = searchParams.get('code');
    const state = searchParams.get('state');
    const error = searchParams.get('error');

    console.log('📋 OAuth callback parameters:', {
      hasCode: !!code,
      hasState: !!state,
      hasError: !!error,
      fullUrl: baseUrl,
    });

    // Handle OAuth error
    if (error) {
      console.log('❌ OAuth error received:', error);
      return NextResponse.redirect(
        new URL('/provider/calendar/connect?error=oauth_failed', baseUrl)
      );
    }

    // Validate required parameters
    if (!code) {
      console.log('❌ Missing authorization code');
      return NextResponse.redirect(
        new URL('/provider/calendar/connect?error=missing_code', baseUrl)
      );
    }

    // Extract provider ID and re-auth info from state parameter
    let providerId: string;
    let connectionId: string | undefined;
    let isReauth: boolean = false;
    try {
      if (state) {
        console.log('🔐 Parsing state parameter:', state);
        const stateData = JSON.parse(decodeURIComponent(state));
        providerId = stateData.providerId;
        connectionId = stateData.connectionId;
        isReauth = stateData.isReauth || false;
        console.log('✅ State data extracted:', { providerId, connectionId, isReauth });
      } else {
        console.log('❌ Missing state parameter');
        throw new Error('Missing state parameter');
      }
    } catch (stateError) {
      console.log('❌ Failed to parse state parameter:', stateError);
      return NextResponse.redirect(
        new URL('/provider/calendar/connect?error=invalid_state', baseUrl)
      );
    }

    // Exchange authorization code for tokens
    console.log('🔄 Exchanging authorization code for tokens...');
    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        client_id: process.env.GOOGLE_CLIENT_ID!,
        client_secret: process.env.GOOGLE_CLIENT_SECRET!,
        code,
        grant_type: 'authorization_code',
        redirect_uri: process.env.GOOGLE_REDIRECT_URI!,
      }),
    });

    if (!tokenResponse.ok) {
      const errorText = await tokenResponse.text();
      console.log('❌ Token exchange failed:', {
        status: tokenResponse.status,
        statusText: tokenResponse.statusText,
        error: errorText
      });
      return NextResponse.redirect(
        new URL('/provider/calendar/connect?error=token_exchange_failed', baseUrl)
      );
    }

    const tokens = await tokenResponse.json();
    console.log('✅ Tokens received successfully');

    // Get user's calendar info
    const calendarResponse = await fetch(
      'https://www.googleapis.com/calendar/v3/users/me/calendarList/primary',
      {
        headers: {
          'Authorization': `Bearer ${tokens.access_token}`,
        },
      }
    );

    if (!calendarResponse.ok) {
      return NextResponse.redirect(
        new URL('/provider/calendar/connect?error=calendar_access_failed', baseUrl)
      );
    }

    const calendarInfo = await calendarResponse.json();

    // Get user profile for email
    const profileResponse = await fetch(
      'https://www.googleapis.com/oauth2/v2/userinfo',
      {
        headers: {
          'Authorization': `Bearer ${tokens.access_token}`,
        },
      }
    );

    const profile = await profileResponse.json();

    // Try to get email from profile, fallback to calendar ID (which is the email)
    let userEmail = profile.email;
    
    if (!userEmail && calendarInfo.id) {
      userEmail = calendarInfo.id;
    }
    
    if (!userEmail) {
      return NextResponse.redirect(
        new URL('/provider/calendar/connect?error=no_email_access', baseUrl)
      );
    }
    

    // Save or update calendar connection
    if (isReauth && connectionId) {
      console.log('� Re-authenticating existing connection...', {
        connectionId,
        email: userEmail,
        calendarId: calendarInfo.id
      });

      const existingConnection = await prisma.calendarConnection.findUnique({
        where: { id: connectionId },
        select: { refreshToken: true }
      });

      if (!tokens.refresh_token && !existingConnection?.refreshToken) {
        console.log('❌ Re-auth did not return a refresh token and no existing refresh token is stored');
        return NextResponse.redirect(
          new URL('/provider/calendar/connect?error=missing_refresh_token', baseUrl)
        );
      }
      
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
      
      console.log('✅ Google calendar connection re-authenticated successfully');

      // Redirect back to the management page
      return NextResponse.redirect(
        new URL(`/provider/calendar/manage/${connectionId}?success=reauth_success`, baseUrl)
      );
    } else {
      console.log('💾 Creating new Google calendar connection...', {
        providerId,
        email: userEmail,
        calendarId: calendarInfo.id
      });

      if (!tokens.refresh_token) {
        console.log('❌ New Google auth completed without refresh token');
        return NextResponse.redirect(
          new URL('/provider/calendar/connect?error=missing_refresh_token', baseUrl)
        );
      }
      
      await CalendarConnectionService.createConnection({
        providerId,
        platform: CalendarPlatform.GOOGLE,
        email: userEmail,
        calendarId: calendarInfo.id,
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        tokenExpiry: tokens.expires_in 
          ? new Date(Date.now() + tokens.expires_in * 1000)
          : null,
      });
      
      console.log('✅ Google calendar connection created successfully');

      // Redirect back to calendar connect page with success
      return NextResponse.redirect(
        new URL('/provider/calendar/connect?success=google_connected', baseUrl)
      );
    }

  } catch (callbackError) {
    console.log('❌ Google OAuth callback failed:', callbackError);
    return NextResponse.redirect(
      new URL('/provider/calendar/connect?error=callback_failed', baseUrl)
    );
  }
}
