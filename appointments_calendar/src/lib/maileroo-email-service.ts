// Unified email service using Maileroo for all Zone Meet notifications
import jwt from 'jsonwebtoken';

interface BookingDetails {
  id: string;
  customerName: string;
  customerEmail: string;
  providerName: string;
  providerEmail: string;
  scheduledAt: Date;
  duration: number;
  serviceType: string;
  notes?: string;
  location?: string;
}

interface MagicLinkData {
  bookingId: string;
  customerEmail: string;
  action: 'confirm' | 'cancel' | 'reschedule';
  exp: number;
}

interface VerificationData {
  providerId: string;
  email: string;
  exp: number;
}

interface PasswordResetData {
  providerId: string;
  email: string;
  exp: number;
}

export class ZoneMeetEmailService {
  private apiKey: string;
  private apiUrl: string = 'https://smtp.maileroo.com/api/v2/emails';
  private fromEmail: string;

  constructor() {
    if (!process.env.MAILEROO_API_KEY) {
      throw new Error('MAILEROO_API_KEY environment variable is required');
    }
    if (!process.env.MAILEROO_FROM_EMAIL) {
      throw new Error('MAILEROO_FROM_EMAIL environment variable is required');
    }
    
    this.apiKey = process.env.MAILEROO_API_KEY;
    this.fromEmail = process.env.MAILEROO_FROM_EMAIL;
  }

  /**
   * Capitalize service type for display
   */
  private capitalizeServiceType(serviceType: string): string {
    return serviceType
      .split(/[-_\s]+/)
      .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
      .join(' ');
  }

  /**
   * Generate branded email header with Zone Meet logo
   */
  private getBrandedHeader(): string {
    // Use the live Zone Meet domain with Next.js optimized image
    const logoUrl = 'https://www.zone-meet.com/_next/image?url=%2FZoneMeet_Logo_v3.png&w=256&q=75';
    
    return `
      <div style="text-align: center; margin-bottom: 30px; padding: 20px; background-color: #f8fafc; border-radius: 8px;">
        <img src="${logoUrl}" 
             alt="Zone Meet Logo" 
             style="max-width: 200px; height: auto; margin-bottom: 10px;"
             onerror="this.style.display='none'" />
        <h1 style="color: #2563eb; margin: 0; font-size: 28px;">Zone Meet</h1>
        <p style="color: #666; margin: 5px 0; font-size: 16px;">Professional Appointment Booking</p>
      </div>
    `;
  }

  /**
   * Send email via Maileroo API
   */
  private async sendEmail(emailData: {
    to: string[];
    subject: string;
    html: string;
    cc?: string[];
    bcc?: string[];
  }) {
    try {
      console.log('🔄 Sending email via Maileroo...');
      console.log('📧 To:', emailData.to);
      console.log('📝 Subject:', emailData.subject);
      console.log('🔗 API URL:', this.apiUrl);
      
      const payload = {
        from: {
          address: this.fromEmail,
          display_name: "Zone Meet"
        },
        to: emailData.to.map(email => ({
          address: email
        })),
        cc: (emailData.cc || []).map(email => ({
          address: email
        })),
        bcc: (emailData.bcc || []).map(email => ({
          address: email
        })),
        subject: emailData.subject,
        html: emailData.html,
        tracking: true
      };
      
      console.log('📦 Payload:', JSON.stringify(payload, null, 2));
      
      const response = await fetch(this.apiUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(30000) // 30 second timeout
      });

      console.log('📡 Response status:', response.status);
      console.log('📡 Response headers:', Object.fromEntries(response.headers.entries()));

      if (!response.ok) {
        const errorData = await response.text();
        console.error('❌ Maileroo API error:', response.status, errorData);
        throw new Error(`Maileroo API error: ${response.status} - ${errorData}`);
      }

      const result = await response.json();
      console.log('✅ Email sent successfully:', result);
      return result;
    } catch (error) {
      console.error('Failed to send email:', error);
      throw error;
    }
  }

  /**
   * 1. Account verification email for new service providers
   */
  async sendAccountVerification(providerId: string, email: string, providerName: string): Promise<void> {
    if (!process.env.JWT_SECRET) {
      throw new Error('JWT_SECRET environment variable is required');
    }

    const verificationData: VerificationData = {
      providerId,
      email,
      exp: Math.floor(Date.now() / 1000) + (24 * 60 * 60) // 24 hours
    };

    const token = jwt.sign(verificationData, process.env.JWT_SECRET);
    const verificationUrl = `${process.env.NEXT_PUBLIC_APP_URL}/provider/verify?token=${token}`;

    const html = `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>Verify Your Zone Meet Account</title>
        </head>
        <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
          ${this.getBrandedHeader()}
          
          <h2 style="color: #1f2937;">Welcome to Zone Meet, ${providerName}!</h2>
          
          <p>Thank you for registering as a service provider with Zone Meet. To complete your account setup and start accepting appointments, please verify your email address.</p>
          
          <div style="text-align: center; margin: 30px 0;">
            <a href="${verificationUrl}" 
               style="background-color: #2563eb; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px; display: inline-block; font-weight: bold;">
              Verify Your Account
            </a>
          </div>
          
          <p>If the button doesn't work, copy and paste this link into your browser:</p>
          <p style="word-break: break-all; color: #2563eb;">${verificationUrl}</p>
          
          <p><strong>This verification link will expire in 24 hours.</strong></p>
          
          <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 30px 0;">
          
          <p style="color: #666; font-size: 14px;">
            If you didn't create a Zone Meet account, please ignore this email.
          </p>
          
          <p style="color: #666; font-size: 14px;">
            This is an automated message from Zone Meet.
          </p>
        </body>
      </html>
    `;

    await this.sendEmail({
      to: [email],
      subject: 'Verify Your Zone Meet Account',
      html
    });
  }

  /**
   * 2. Password reset email for service providers
   */
  async sendPasswordReset(providerId: string, email: string, providerName: string): Promise<void> {
    if (!process.env.JWT_SECRET) {
      throw new Error('JWT_SECRET environment variable is required');
    }

    const resetData: PasswordResetData = {
      providerId,
      email,
      exp: Math.floor(Date.now() / 1000) + (60 * 60) // 1 hour
    };

    const token = jwt.sign(resetData, process.env.JWT_SECRET);
    const resetUrl = `${process.env.NEXT_PUBLIC_APP_URL}/provider/reset-password?token=${token}`;

    const html = `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>Reset Your Zone Meet Password</title>
        </head>
        <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
          ${this.getBrandedHeader()}
          
          <h2 style="color: #1f2937;">Password Reset Request</h2>
          
          <p>Hello ${providerName},</p>
          
          <p>We received a request to reset your Zone Meet password. If you made this request, click the button below to set a new password:</p>
          
          <div style="text-align: center; margin: 30px 0;">
            <a href="${resetUrl}" 
               style="background-color: #dc2626; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px; display: inline-block; font-weight: bold;">
              Reset Password
            </a>
          </div>
          
          <p>If the button doesn't work, copy and paste this link into your browser:</p>
          <p style="word-break: break-all; color: #dc2626;">${resetUrl}</p>
          
          <p><strong>This reset link will expire in 1 hour.</strong></p>
          
          <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 30px 0;">
          
          <p style="color: #666; font-size: 14px;">
            If you didn't request a password reset, please ignore this email. Your password will remain unchanged.
          </p>
          
          <p style="color: #666; font-size: 14px;">
            This is an automated message from Zone Meet.
          </p>
        </body>
      </html>
    `;

    await this.sendEmail({
      to: [email],
      subject: 'Reset Your Zone Meet Password',
      html
    });
  }

  /**
   * 3. Magic link for client booking authentication
   */
  async sendMagicLink(bookingId: string, customerEmail: string, customerName: string, providerName: string): Promise<void> {
    if (!process.env.JWT_SECRET) {
      throw new Error('JWT_SECRET environment variable is required');
    }

    const magicLinkData: MagicLinkData = {
      bookingId,
      customerEmail,
      action: 'confirm',
      exp: Math.floor(Date.now() / 1000) + (24 * 60 * 60) // 24 hours
    };

    const token = jwt.sign(magicLinkData, process.env.JWT_SECRET);
    const magicUrl = `${process.env.NEXT_PUBLIC_APP_URL}/client/booking/confirm?token=${token}`;

    const html = `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>Confirm Your Zone Meet Appointment</title>
        </head>
        <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
          ${this.getBrandedHeader()}
          
          <h2 style="color: #1f2937;">Confirm Your Appointment Request</h2>
          
          <p>Hello ${customerName},</p>
          
          <p>You've requested an appointment with <strong>${providerName}</strong>. To complete your booking, please confirm your request by clicking the button below:</p>
          
          <div style="text-align: center; margin: 30px 0;">
            <a href="${magicUrl}" 
               style="background-color: #16a34a; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px; display: inline-block; font-weight: bold;">
              Confirm Appointment
            </a>
          </div>
          
          <p>If the button doesn't work, copy and paste this link into your browser:</p>
          <p style="word-break: break-all; color: #16a34a;">${magicUrl}</p>
          
          <p><strong>This confirmation link will expire in 24 hours.</strong></p>
          
          <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 30px 0;">
          
          <p style="color: #666; font-size: 14px;">
            If you didn't request this appointment, please ignore this email.
          </p>
          
          <p style="color: #666; font-size: 14px;">
            This is an automated message from Zone Meet.
          </p>
        </body>
      </html>
    `;

    await this.sendEmail({
      to: [customerEmail],
      subject: 'Confirm Your Zone Meet Appointment',
      html
    });
  }

  /**
   * 4. Email to service provider about new booking request
   */
  async sendBookingNotificationToProvider(booking: BookingDetails, providerTimezone?: string): Promise<void> {
  // Import date-fns-tz for timezone conversion
  const { toZonedTime, format } = await import('date-fns-tz');
  
  // Use provider's timezone or default to Eastern
  const timezone = providerTimezone || 'America/New_York';
  
  // Convert UTC time to provider's local timezone
  const localScheduledAt = toZonedTime(booking.scheduledAt, timezone);
  
  // Format using date-fns format (simpler, more reliable)
  const formattedDate = format(localScheduledAt, 'EEEE, MMMM d, yyyy', { timeZone: timezone });
  const formattedTime = format(localScheduledAt, 'h:mm a', { timeZone: timezone });

    // Generate direct action URLs for provider
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL;
    const confirmUrl = `${baseUrl}/api/provider/bookings/${booking.id}/confirm`;
    const denyUrl = `${baseUrl}/api/provider/bookings/${booking.id}/cancel`;
    const rescheduleUrl = `${baseUrl}/provider/bookings?highlight=${booking.id}&action=reschedule`;

    const html = `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>New Appointment Request - Zone Meet</title>
        </head>
        <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
          ${this.getBrandedHeader()}
          
          <h2 style="color: #1f2937;">New Appointment Request</h2>
          
          <p>Hello ${booking.providerName},</p>
          
          <p>You have received a new appointment request from <strong>${booking.customerName}</strong>.</p>
          
          <div style="background-color: #f3f4f6; padding: 20px; border-radius: 8px; margin: 20px 0;">
            <h3 style="margin-top: 0; color: #1f2937; text-align: center;">Appointment Details</h3>
            <p><strong>Client:</strong> ${booking.customerName}</p>
            <p><strong>Email:</strong> ${booking.customerEmail}</p>
            <p><strong>Service:</strong> ${this.capitalizeServiceType(booking.serviceType)}</p>
            <p><strong>Date:</strong> ${formattedDate}</p>
            <p><strong>Time:</strong> ${formattedTime}</p>
            <p><strong>Duration:</strong> ${booking.duration} minutes</p>
            ${booking.location ? `<p><strong>Location:</strong> ${booking.location}</p>` : ''}
            ${booking.notes ? `<p><strong>Notes:</strong> ${booking.notes}</p>` : ''}
          </div>
          
          <p style="text-align: center;">Please review this request and take action below:</p>
          
          <div style="text-align: center; margin: 30px 0;">
            <table style="margin: 0 auto; width: 100%; max-width: 300px;">
              <tr>
                <td style="padding: 8px 0;">
                  <a href="${confirmUrl}" 
                     style="background-color: #16a34a; color: white; padding: 14px 24px; text-decoration: none; border-radius: 5px; display: block; font-weight: bold; text-align: center; width: 100%; box-sizing: border-box;">
                    ✅ Confirm
                  </a>
                </td>
              </tr>
              <tr>
                <td style="padding: 8px 0;">
                  <a href="${denyUrl}" 
                     style="background-color: #dc2626; color: white; padding: 14px 24px; text-decoration: none; border-radius: 5px; display: block; font-weight: bold; text-align: center; width: 100%; box-sizing: border-box;">
                    ❌ Deny
                  </a>
                </td>
              </tr>
              <tr>
                <td style="padding: 8px 0;">
                  <a href="${rescheduleUrl}" 
                     style="background-color: #f59e0b; color: white; padding: 14px 24px; text-decoration: none; border-radius: 5px; display: block; font-weight: bold; text-align: center; width: 100%; box-sizing: border-box;">
                    📅 Reschedule
                  </a>
                </td>
              </tr>
            </table>
          </div>
          
          <div style="text-align: center; margin: 20px 0;">
            <a href="${process.env.NEXT_PUBLIC_APP_URL}/provider/bookings" 
               style="background-color: #6b7280; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px; display: inline-block; font-weight: bold;">
              📋 View All Bookings
            </a>
          </div>
          
          <div style="background-color: #f8fafc; border: 1px solid #e2e8f0; padding: 15px; border-radius: 5px; margin: 20px 0;">
            <p style="margin: 0; font-size: 14px; color: #475569;">
              <strong>💡 Quick Actions:</strong> Click "Confirm" to instantly approve and add to your calendar, "Deny" to decline the request, or "Reschedule" to propose a different time. 
              All actions will automatically notify the client.
            </p>
          </div>
          
          <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 30px 0;">
          
          <p style="color: #666; font-size: 14px;">
            This is an automated notification from Zone Meet.
          </p>
        </body>
      </html>
    `;

    await this.sendEmail({
      to: [booking.providerEmail],
      subject: `New Appointment Request from ${booking.customerName}`,
      html
    });
  }

  /**
   * 5. Confirmation to both client and provider after booking is confirmed
   */
  async sendBookingConfirmation(booking: BookingDetails, providerTimezone?: string): Promise<void> {
  // Import date-fns-tz for timezone conversion
  const { toZonedTime, format } = await import('date-fns-tz');
  
  // Use provider's timezone or default to Eastern
  const timezone = providerTimezone || 'America/New_York';
  
  // Convert UTC time to provider's local timezone
  const localScheduledAt = toZonedTime(booking.scheduledAt, timezone);
  
  // Format using date-fns format
  const formattedDate = format(localScheduledAt, 'EEEE, MMMM d, yyyy', { timeZone: timezone });
  const formattedTime = format(localScheduledAt, 'h:mm a', { timeZone: timezone });

    // Generate management tokens
    if (!process.env.JWT_SECRET) {
      throw new Error('JWT_SECRET environment variable is required');
    }

    const cancelData: MagicLinkData = {
      bookingId: booking.id,
      customerEmail: booking.customerEmail,
      action: 'cancel',
      exp: Math.floor(Date.now() / 1000) + (7 * 24 * 60 * 60) // 7 days
    };

    const rescheduleData: MagicLinkData = {
      bookingId: booking.id,
      customerEmail: booking.customerEmail,
      action: 'reschedule',
      exp: Math.floor(Date.now() / 1000) + (7 * 24 * 60 * 60) // 7 days
    };

    const cancelToken = jwt.sign(cancelData, process.env.JWT_SECRET);
    const rescheduleToken = jwt.sign(rescheduleData, process.env.JWT_SECRET);

    const cancelUrl = `${process.env.NEXT_PUBLIC_APP_URL}/client/booking/confirm?token=${cancelToken}`;
    const rescheduleUrl = `${process.env.NEXT_PUBLIC_APP_URL}/client/booking/reschedule?token=${rescheduleToken}`;
    const providerDashboard = `${process.env.NEXT_PUBLIC_APP_URL}/provider/dashboard`;

    // Email to customer
    const customerHtml = `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>Appointment Confirmed - Zone Meet</title>
        </head>
        <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
          ${this.getBrandedHeader()}
          
          <h2 style="color: #16a34a;">✓ Appointment Confirmed</h2>
          
          <p>Hello ${booking.customerName},</p>
          
          <p>Great news! Your appointment with <strong>${booking.providerName}</strong> has been confirmed.</p>
          
          <div style="background-color: #f0fdf4; border-left: 4px solid #16a34a; padding: 20px; margin: 20px 0;">
            <h3 style="margin-top: 0; color: #15803d; text-align: center;">Your Appointment Details</h3>
            <p><strong>Provider:</strong> ${booking.providerName}</p>
            <p><strong>Service:</strong> ${this.capitalizeServiceType(booking.serviceType)}</p>
            <p><strong>Date:</strong> ${formattedDate}</p>
            <p><strong>Time:</strong> ${formattedTime}</p>
            <p><strong>Duration:</strong> ${booking.duration} minutes</p>
            ${booking.location ? `<p><strong>Location:</strong> ${booking.location}</p>` : ''}
            ${booking.notes ? `<p><strong>Notes:</strong> ${booking.notes}</p>` : ''}
          </div>
          
          <p>We've added this appointment to your calendar. Please make sure to arrive on time.</p>
          
          <h3 style="color: #1f2937;">Need to Make Changes?</h3>
          
          <div style="text-align: center; margin: 20px 0;">
            <table style="margin: 0 auto; width: 100%; max-width: 300px;">
              <tr>
                <td style="padding: 8px 0;">
                  <a href="${rescheduleUrl}" 
                     style="background-color: #f59e0b; color: white; padding: 12px 20px; text-decoration: none; border-radius: 5px; display: block; font-weight: bold; text-align: center; width: 100%; box-sizing: border-box;">
                    📅 Reschedule
                  </a>
                </td>
              </tr>
              <tr>
                <td style="padding: 8px 0;">
                  <a href="${cancelUrl}" 
                     style="background-color: #dc2626; color: white; padding: 12px 20px; text-decoration: none; border-radius: 5px; display: block; font-weight: bold; text-align: center; width: 100%; box-sizing: border-box;">
                    ❌ Cancel
                  </a>
                </td>
              </tr>
            </table>
          </div>
          
          <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 30px 0;">
          
          <p style="color: #666; font-size: 14px;">
            This is an automated confirmation from Zone Meet. If you have any questions, please contact ${booking.providerName} directly.
          </p>
        </body>
      </html>
    `;

    // Email to provider
    const providerHtml = `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>Appointment Status Update - Zone Meet</title>
        </head>
        <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
          ${this.getBrandedHeader()}
          
          <h2 style="color: #2563eb;">📋 Appointment Confirmed</h2>
          
          <p>Hello ${booking.providerName},</p>
          
          <p>You have successfully confirmed an appointment with <strong>${booking.customerName}</strong>.</p>
          
          <div style="background-color: #f0fdf4; border-left: 4px solid #16a34a; padding: 20px; margin: 20px 0;">
            <h3 style="margin-top: 0; color: #15803d; text-align: center;">Appointment Details</h3>
            <p><strong>Client:</strong> ${booking.customerName}</p>
            <p><strong>Email:</strong> ${booking.customerEmail}</p>
            <p><strong>Service:</strong> ${this.capitalizeServiceType(booking.serviceType)}</p>
            <p><strong>Date:</strong> ${formattedDate}</p>
            <p><strong>Time:</strong> ${formattedTime}</p>
            <p><strong>Duration:</strong> ${booking.duration} minutes</p>
            ${booking.location ? `<p><strong>Location:</strong> ${booking.location}</p>` : ''}
            ${booking.notes ? `<p><strong>Notes:</strong> ${booking.notes}</p>` : ''}
          </div>
          
          <p>This appointment has been added to your connected calendar and the client has been notified.</p>
          
          <div style="text-align: center; margin: 30px 0;">
            <a href="${providerDashboard}" 
               style="background-color: #2563eb; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px; display: inline-block; font-weight: bold;">
              View Dashboard
            </a>
          </div>
          
          <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 30px 0;">
          
          <p style="color: #666; font-size: 14px;">
            This is an automated confirmation from Zone Meet.
          </p>
        </body>
      </html>
    `;

    // Send both emails
    await Promise.all([
      this.sendEmail({
        to: [booking.customerEmail],
        subject: 'Appointment Confirmed - Zone Meet',
        html: customerHtml
      }),
      this.sendEmail({
        to: [booking.providerEmail],
        subject: 'Appointment Confirmed - Zone Meet',
        html: providerHtml
      })
    ]);
  }

  /**
   * Generate magic link token for booking management
   */
  generateMagicLinkToken(bookingId: string, customerEmail: string, action: 'confirm' | 'cancel' | 'reschedule'): string {
    if (!process.env.JWT_SECRET) {
      throw new Error('JWT_SECRET environment variable is required');
    }

    const data: MagicLinkData = {
      bookingId,
      customerEmail,
      action,
      exp: Math.floor(Date.now() / 1000) + (24 * 60 * 60) // 24 hours
    };

    return jwt.sign(data, process.env.JWT_SECRET);
  }

  /**
   * Verify magic link token
   */
  verifyMagicLinkToken(token: string): MagicLinkData | null {
    try {
      if (!process.env.JWT_SECRET) {
        throw new Error('JWT_SECRET environment variable is required');
      }

      return jwt.verify(token, process.env.JWT_SECRET) as MagicLinkData;
    } catch (error) {
      console.error('Invalid magic link token:', error);
      return null;
    }
  }

  /**
   * 6. Email to customer when booking is cancelled/denied by provider
   */
  async sendBookingCancellation(booking: BookingDetails): Promise<void> {
    const customerName = booking.customerName || 'Valued Customer';
    
    const formattedDate = booking.scheduledAt.toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });
    
    const formattedTime = booking.scheduledAt.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true
    });

    const html = `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>Appointment Cancelled - Zone Meet</title>
        </head>
        <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
          ${this.getBrandedHeader()}
          
          <h2 style="color: #dc2626;">❌ Appointment Cancelled</h2>
          
          <p>Dear ${customerName},</p>
          
          <p>We regret to inform you that your appointment with <strong>${booking.providerName}</strong> has been cancelled.</p>
          
          <div style="background-color: #fee2e2; border: 1px solid #fecaca; padding: 20px; border-radius: 8px; margin: 20px 0;">
            <h3 style="margin-top: 0; color: #991b1b; text-align: center;">Cancelled Appointment Details</h3>
            <p><strong>Service:</strong> ${this.capitalizeServiceType(booking.serviceType)}</p>
            <p><strong>Date:</strong> ${formattedDate}</p>
            <p><strong>Time:</strong> ${formattedTime}</p>
            <p><strong>Duration:</strong> ${booking.duration} minutes</p>
            ${booking.notes ? `<p><strong>Notes:</strong> ${booking.notes}</p>` : ''}
          </div>
          
          <p>If you would like to reschedule or book a new appointment, please visit our booking page.</p>
          
          <div style="text-align: center; margin: 30px 0;">
            <a href="${process.env.NEXT_PUBLIC_APP_URL}" 
               style="background-color: #2563eb; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px; display: inline-block; font-weight: bold;">
              Book New Appointment
            </a>
          </div>
          
          <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 30px 0;">
          
          <p style="color: #666; font-size: 14px;">
            This is an automated notification from Zone Meet. If you have any questions, please contact ${booking.providerName} directly.
          </p>
        </body>
      </html>
    `;

    await this.sendEmail({
      to: [booking.customerEmail],
      subject: 'Appointment Cancelled - Zone Meet',
      html
    });
  }

  /**
   * 7. Email to customer requesting confirmation of provider-rescheduled appointment
   */
  async sendRescheduleConfirmationRequest(booking: BookingDetails, providerTimezone?: string): Promise<void> {
    if (!process.env.JWT_SECRET) {
      throw new Error('JWT_SECRET environment variable is required');
    }

    // Import date-fns-tz for timezone conversion
    const { toZonedTime, format } = await import('date-fns-tz');
    
    // Use provider's timezone or default to Eastern
    const timezone = providerTimezone || 'America/New_York';
    
    // Convert UTC time to provider's local timezone
    const localScheduledAt = toZonedTime(booking.scheduledAt, timezone);
    
    // Format using date-fns format
    const formattedDate = format(localScheduledAt, 'EEEE, MMMM d, yyyy', { timeZone: timezone });
    const formattedTime = format(localScheduledAt, 'h:mm a', { timeZone: timezone });

    // Generate magic link tokens for customer actions
    const confirmData: MagicLinkData = {
      bookingId: booking.id,
      customerEmail: booking.customerEmail,
      action: 'confirm',
      exp: Math.floor(Date.now() / 1000) + (7 * 24 * 60 * 60) // 7 days
    };

    const cancelData: MagicLinkData = {
      bookingId: booking.id,
      customerEmail: booking.customerEmail,
      action: 'cancel',
      exp: Math.floor(Date.now() / 1000) + (7 * 24 * 60 * 60) // 7 days
    };

    const rescheduleData: MagicLinkData = {
      bookingId: booking.id,
      customerEmail: booking.customerEmail,
      action: 'reschedule',
      exp: Math.floor(Date.now() / 1000) + (7 * 24 * 60 * 60) // 7 days
    };

    const confirmToken = jwt.sign(confirmData, process.env.JWT_SECRET);
    const cancelToken = jwt.sign(cancelData, process.env.JWT_SECRET);
    const rescheduleToken = jwt.sign(rescheduleData, process.env.JWT_SECRET);

    const confirmUrl = `${process.env.NEXT_PUBLIC_APP_URL}/client/booking/confirm?token=${confirmToken}`;
    const cancelUrl = `${process.env.NEXT_PUBLIC_APP_URL}/client/booking/confirm?token=${cancelToken}`;
    const rescheduleUrl = `${process.env.NEXT_PUBLIC_APP_URL}/client/booking/reschedule?token=${rescheduleToken}`;

    const html = `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>Confirm Rescheduled Appointment - Zone Meet</title>
        </head>
        <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
          ${this.getBrandedHeader()}
          
          <h2 style="color: #f59e0b;">📅 Your Appointment Has Been Rescheduled</h2>
          
          <p>Hello ${booking.customerName},</p>
          
          <p><strong>${booking.providerName}</strong> has rescheduled your appointment to a new time. Please review the details below and confirm if this works for you.</p>
          
          <div style="background-color: #dbeafe; border-left: 4px solid #3b82f6; padding: 20px; margin: 20px 0;">
            <h3 style="margin-top: 0; color: #1e40af; text-align: center;">New Appointment Details</h3>
            <p><strong>Provider:</strong> ${booking.providerName}</p>
            <p><strong>Service:</strong> ${this.capitalizeServiceType(booking.serviceType)}</p>
            <p><strong>Date:</strong> ${formattedDate}</p>
            <p><strong>Time:</strong> ${formattedTime}</p>
            <p><strong>Duration:</strong> ${booking.duration} minutes</p>
            ${booking.location ? `<p><strong>Location:</strong> ${booking.location}</p>` : ''}
            ${booking.notes ? `<p><strong>Notes:</strong> ${booking.notes}</p>` : ''}
          </div>
          
          <h3 style="color: #1f2937;">Please Choose an Action</h3>
          <p>If the new time works for you, please confirm. If not, you can reschedule to a different time or cancel.</p>
          
          <div style="text-align: center; margin: 20px 0;">
            <table style="margin: 0 auto; width: 100%; max-width: 300px;">
              <tr>
                <td style="padding: 8px 0;">
                  <a href="${confirmUrl}" 
                     style="background-color: #16a34a; color: white; padding: 14px 24px; text-decoration: none; border-radius: 5px; display: block; font-weight: bold; text-align: center; width: 100%; box-sizing: border-box;">
                    ✅ Confirm New Time
                  </a>
                </td>
              </tr>
              <tr>
                <td style="padding: 8px 0;">
                  <a href="${rescheduleUrl}" 
                     style="background-color: #f59e0b; color: white; padding: 14px 24px; text-decoration: none; border-radius: 5px; display: block; font-weight: bold; text-align: center; width: 100%; box-sizing: border-box;">
                    📅 Pick Different Time
                  </a>
                </td>
              </tr>
              <tr>
                <td style="padding: 8px 0;">
                  <a href="${cancelUrl}" 
                     style="background-color: #dc2626; color: white; padding: 14px 24px; text-decoration: none; border-radius: 5px; display: block; font-weight: bold; text-align: center; width: 100%; box-sizing: border-box;">
                    ❌ Cancel Appointment
                  </a>
                </td>
              </tr>
            </table>
          </div>

          <p style="color: #dc2626; font-weight: bold;">⏰ Please respond within 7 days, or this appointment may be automatically cancelled.</p>
          
          <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 30px 0;">
          
          <p style="color: #666; font-size: 14px;">
            This is an automated message from Zone Meet. If you have questions, please contact ${booking.providerName} directly.
          </p>
        </body>
      </html>
    `;

    await this.sendEmail({
      to: [booking.customerEmail],
      subject: 'Confirm Your Rescheduled Appointment - Zone Meet',
      html
    });
  }

  /**
   * 8. Email to customer when booking is rescheduled by provider (notification only - deprecated, use sendRescheduleConfirmationRequest instead)
   */
  async sendBookingReschedule(booking: BookingDetails, newDateTime?: Date): Promise<void> {
    const customerName = booking.customerName || 'Valued Customer';
    
    const originalDate = booking.scheduledAt.toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });
    
    const originalTime = booking.scheduledAt.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true
    });

    let newDateSection = '';
    if (newDateTime) {
      const formattedNewDate = newDateTime.toLocaleDateString('en-US', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric'
      });
      const formattedNewTime = newDateTime.toLocaleTimeString('en-US', {
        hour: 'numeric',
        minute: '2-digit',
        hour12: true
      });
      
      newDateSection = `
        <div style="background-color: #dbeafe; border: 1px solid #93c5fd; padding: 20px; border-radius: 8px; margin: 20px 0;">
          <h3 style="margin-top: 0; color: #1e40af; text-align: center;">New Appointment Time</h3>
          <p><strong>New Date:</strong> ${formattedNewDate}</p>
          <p><strong>New Time:</strong> ${formattedNewTime}</p>
        </div>
      `;
    }

    const html = `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>Appointment Rescheduled - Zone Meet</title>
        </head>
        <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
          ${this.getBrandedHeader()}
          
          <h2 style="color: #f59e0b;">📅 Appointment Rescheduled</h2>
          
          <p>Dear ${customerName},</p>
          
          <p>Your appointment with <strong>${booking.providerName}</strong> has been rescheduled.</p>
          
          <div style="background-color: #fef3c7; border: 1px solid #fbbf24; padding: 20px; border-radius: 8px; margin: 20px 0;">
            <h3 style="margin-top: 0; color: #92400e; text-align: center;">Original Appointment Details</h3>
            <p><strong>Service:</strong> ${this.capitalizeServiceType(booking.serviceType)}</p>
            <p><strong>Original Date:</strong> ${originalDate}</p>
            <p><strong>Original Time:</strong> ${originalTime}</p>
            <p><strong>Duration:</strong> ${booking.duration} minutes</p>
          </div>
          
          ${newDateSection}
          
          ${!newDateTime ? `
            <p>The provider will contact you shortly to arrange a new time that works for both of you.</p>
          ` : `
            <p>Please confirm your availability for the new time. If this doesn't work, the provider will contact you to find an alternative.</p>
          `}
          
          <div style="text-align: center; margin: 30px 0;">
            <a href="mailto:${booking.providerEmail}" 
               style="background-color: #2563eb; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px; display: inline-block; font-weight: bold;">
              Contact Provider
            </a>
          </div>
          
          <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 30px 0;">
          
          <p style="color: #666; font-size: 14px;">
            This is an automated notification from Zone Meet. Please contact ${booking.providerName} directly at ${booking.providerEmail} to finalize the new appointment time.
          </p>
        </body>
      </html>
    `;

    await this.sendEmail({
      to: [booking.customerEmail],
      subject: 'Appointment Rescheduled - Zone Meet',
      html
    });
  }

  /**
   * Verify account verification token
   */
  verifyAccountToken(token: string): VerificationData | null {
    try {
      if (!process.env.JWT_SECRET) {
        throw new Error('JWT_SECRET environment variable is required');
      }

      return jwt.verify(token, process.env.JWT_SECRET) as VerificationData;
    } catch (error) {
      console.error('Invalid verification token:', error);
      return null;
    }
  }

  /**
   * Verify password reset token
   */
  verifyPasswordResetToken(token: string): PasswordResetData | null {
    try {
      if (!process.env.JWT_SECRET) {
        throw new Error('JWT_SECRET environment variable is required');
      }

      return jwt.verify(token, process.env.JWT_SECRET) as PasswordResetData;
    } catch (error) {
      console.error('Invalid password reset token:', error);
      return null;
    }
  }
}

// Export singleton instance
export const emailService = new ZoneMeetEmailService();