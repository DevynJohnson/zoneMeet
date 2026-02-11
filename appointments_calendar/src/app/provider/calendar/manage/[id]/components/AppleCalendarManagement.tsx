'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { secureFetch } from '@/lib/csrf';
import { useAlert } from '@/contexts/AlertContext';

interface CalendarConnection {
  id: string;
  platform: string;
  email: string;
  calendarId: string;
  calendarName?: string;
  isActive: boolean;
  lastSyncAt: string | null;
  syncFrequency: number;
  createdAt: string;
  accessToken?: string;
  isDefaultForBookings?: boolean;
  syncEvents?: boolean;
  selectedCalendars?: string[];
  calendarSettings?: {[key: string]: {syncEvents: boolean}};
}

interface AvailableCalendar {
  id: string;
  name: string;
  description?: string;
  isDefault?: boolean;
  canWrite?: boolean;
  color?: string;
}

interface CalendarEvent {
  id: string;
  title: string;
  startTime: string;
  endTime: string;
  location: string;
  maxBookings: number;
  currentBookings: number;
}

interface AppleCalendarManagementProps {
  connection: CalendarConnection;
  onConnectionUpdate?: (connection: CalendarConnection) => void;
}

export default function AppleCalendarManagement({ connection, onConnectionUpdate }: AppleCalendarManagementProps) {
  const { showSuccess, showError } = useAlert();
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Form state
  const [isActive, setIsActive] = useState(connection.isActive);

  // Apple-specific credentials state
  const [appleId, setAppleId] = useState('');
  const [appPassword, setAppPassword] = useState('');

  // Multi-calendar state
  const [availableCalendars, setAvailableCalendars] = useState<AvailableCalendar[]>([]);
  const [loadingCalendars, setLoadingCalendars] = useState(false);
  const [selectedCalendars, setSelectedCalendars] = useState<string[]>(connection.selectedCalendars || []);
  const [calendarSettings, setCalendarSettings] = useState<{[key: string]: {syncEvents: boolean}}>(connection.calendarSettings || {});

  const loadCalendars = useCallback(async () => {
    const token = localStorage.getItem('providerToken');
    setLoadingCalendars(true);
    setError(null);
    
    try {
      if (connection.id) {
        const calendarsResponse = await fetch(`/api/provider/calendar/available-calendars?platform=APPLE&connectionId=${encodeURIComponent(connection.id)}`, {
          headers: { Authorization: `Bearer ${token}` },
        });

        if (calendarsResponse.ok) {
          const calendarsData = await calendarsResponse.json();
          setAvailableCalendars(calendarsData.calendars || []);
          
          // Initialize selected calendars if not already set
          if (!connection.selectedCalendars || connection.selectedCalendars.length === 0) {
            const primaryCalendar = calendarsData.calendars?.find((cal: AvailableCalendar) => cal.isDefault) || calendarsData.calendars?.[0];
            if (primaryCalendar) {
              setSelectedCalendars([primaryCalendar.id]);
            }
          }
          
          // Initialize calendar settings if not already set
          const initialCalendarSettings: {[key: string]: {syncEvents: boolean}} = {};
          calendarsData.calendars?.forEach((cal: AvailableCalendar) => {
            const savedCalendarSetting = connection.calendarSettings?.[cal.id];
            initialCalendarSettings[cal.id] = {
              syncEvents: savedCalendarSetting?.syncEvents ?? connection.syncEvents ?? true,
            };
          });
          setCalendarSettings(initialCalendarSettings);
        } else {
          const errorText = await calendarsResponse.text();
          console.error('Failed to fetch calendars:', errorText);
          
          // Parse error for better messaging
          let errorMessage = 'Failed to load Apple calendars.';
          try {
            const errorData = JSON.parse(errorText);
            if (errorData.error?.includes('credentials not found')) {
              errorMessage = 'Apple Calendar credentials not configured. Please enter your Apple ID and App-Specific Password below, then click "Save Settings" to update your connection.';
            } else {
              errorMessage = errorData.error || errorMessage;
            }
          } catch {
            errorMessage = 'Failed to load Apple calendars. Please check your credentials.';
          }
          
          setError(errorMessage);
        }
      } else {
        setError('No connection found. Please reconnect your Apple Calendar.');
      }
    } catch (calErr) {
      console.error('Failed to load calendars:', calErr);
      setError('Failed to load available calendars. Please check your network connection.');
    } finally {
      setLoadingCalendars(false);
    }
  }, [connection.id, connection.selectedCalendars, connection.syncEvents, connection.calendarSettings]);

  const loadData = useCallback(async () => {
    try {
      const token = localStorage.getItem('providerToken');

      // Load events for this connection
      const eventsResponse = await fetch(`/api/provider/calendar/events?connectionId=${connection.id}`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (eventsResponse.ok) {
        const eventsData = await eventsResponse.json();
        setEvents(eventsData.events || []);
      }

      // Load available Apple calendars
      await loadCalendars();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load calendar data');
    }
  }, [connection.id, loadCalendars]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleSaveSettings = async () => {
    setSaving(true);
    try {
      const token = localStorage.getItem('providerToken');
      
      // For now, use the settings from the primary calendar (connection.calendarId) 
      // or default values if no specific settings are set
      const primaryCalendarSettings = calendarSettings[connection.calendarId] || { syncEvents: true };
      
      const updateData: {
        isActive: boolean;
        accessToken?: string;
        syncEvents?: boolean;
        selectedCalendars?: string[];
        calendarSettings?: {[key: string]: {syncEvents: boolean}};
      } = {
        isActive,
        syncEvents: primaryCalendarSettings.syncEvents,
        selectedCalendars,
        calendarSettings,
      };

      // For Apple connections, include updated credentials if provided
      if (appleId && appPassword) {
        console.log('🍎 Encoding Apple credentials:', { appleId, appPasswordLength: appPassword.length });
        const credentials = Buffer.from(`${appleId}:${appPassword}`).toString('base64');
        console.log('🔐 Encoded credentials length:', credentials.length);
        updateData.accessToken = credentials;
      }

      const response = await fetch(`/api/provider/calendar/connections/${connection.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(updateData),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to save settings');
      }

      setError(null);
      showSuccess('Apple Calendar settings saved successfully!');
      
      // Clear password field after successful save
      setAppPassword('');
      
      // Reload calendars if credentials were updated
      if (appleId && appPassword) {
        await loadCalendars();
      }
      
      await loadData(); // Reload to get updated data
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save settings');
    } finally {
      setSaving(false);
    }
  };

  const handleSyncNow = async () => {
    try {
      setError(null);
      const token = localStorage.getItem('providerToken');
      const response = await secureFetch(`/api/provider/calendar/sync/${connection.id}`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ 
          fullSync: true,
          debug: true 
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        setError(errorData.error || errorData.message || `HTTP ${response.status}: Failed to sync calendar`);
        return;
      }

      console.log('🔄 Apple sync completed successfully');
      
      // Update the connection state immediately with the new lastSyncAt timestamp
      if (onConnectionUpdate) {
        const updatedConnection = {
          ...connection,
          lastSyncAt: new Date().toISOString()
        };
        onConnectionUpdate(updatedConnection);
      } else {
        // Fallback to reloading data if no callback is provided
        await loadData();
      }
      
      showSuccess('Apple Calendar synced successfully!');
    } catch (err) {
      console.error('❌ Apple sync error:', err);
      setError(err instanceof Error ? err.message : 'Failed to sync Apple Calendar');
    }
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleString();
  };

  const formatSyncFrequency = (minutes: number) => {
    if (minutes < 60) return `${minutes} minutes`;
    const hours = Math.floor(minutes / 60);
    return `${hours} hour${hours > 1 ? 's' : ''}`;
  };

  return (
    <div className="min-h-screen bg-gray-50 py-8">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="mb-8">
          <nav className="flex" aria-label="Breadcrumb">
            <ol className="flex items-center space-x-4">
              <li>
                <Link href="/provider/dashboard" className="text-gray-500 hover:text-gray-700">
                  Dashboard
                </Link>
              </li>
              <li>
                <div className="flex items-center">
                  <svg className="flex-shrink-0 h-5 w-5 text-gray-400" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z" clipRule="evenodd" />
                  </svg>
                  <span className="ml-4 text-sm font-medium text-gray-900">Apple Calendar Management</span>
                </div>
              </li>
            </ol>
          </nav>
          
          <div className="mt-4">
            <h1 className="text-3xl font-bold text-gray-900 flex items-center">
              <svg className="w-8 h-8 mr-3 text-gray-800" fill="currentColor" viewBox="0 0 24 24">
                <path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.81-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z"/>
              </svg>
              Apple Calendar - {connection.email}
            </h1>
            <p className="mt-2 text-gray-600">
              Manage your Apple iCloud Calendar connection and sync settings
            </p>
          </div>
        </div>

        {error && (
          <div className="mb-6 bg-red-50 border border-red-200 rounded-md p-4">
            <div className="flex">
              <div className="flex-shrink-0">
                <svg className="h-5 w-5 text-red-400" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                </svg>
              </div>
              <div className="ml-3">
                <h3 className="text-sm font-medium text-red-800">Configuration Required</h3>
                <div className="mt-2 text-sm text-red-700">
                  <p>{error}</p>
                  {error.includes('credentials') && (
                    <div className="mt-3 text-sm">
                      <p className="font-medium">To fix this:</p>
                      <ol className="list-decimal list-inside mt-1 space-y-1">
                        <li>Enter your Apple ID in the form below</li>
                        <li>Generate an App-Specific Password at <a href="https://appleid.apple.com" target="_blank" rel="noopener noreferrer" className="underline hover:text-red-800">appleid.apple.com</a></li>
                        <li>Enter the App-Specific Password</li>
                        <li>Click &quot;Save Settings&quot;</li>
                        <li>Your calendars will load automatically</li>
                      </ol>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Settings Panel */}
          <div className="lg:col-span-2">
            <div className="bg-white shadow rounded-lg">
              <div className="px-6 py-4 border-b border-gray-200">
                <h2 className="text-lg font-medium text-gray-900 flex items-center">
                  <svg className="w-5 h-5 mr-2 text-green-600" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M11.49 3.17c-.38-1.56-2.6-1.56-2.98 0a1.532 1.532 0 01-2.286.948c-1.372-.836-2.942.734-2.106 2.106.54.886.061 2.042-.947 2.287-1.561.379-1.561 2.6 0 2.978a1.532 1.532 0 01.947 2.287c-.836 1.372.734 2.942 2.106 2.106a1.532 1.532 0 012.287.947c.379 1.561 2.6 1.561 2.978 0a1.533 1.533 0 012.287-.947c1.372.836 2.942-.734 2.106-2.106a1.533 1.533 0 01.947-2.287c1.561-.379 1.561-2.6 0-2.978a1.532 1.532 0 01-.947-2.287c.836-1.372-.734-2.942-2.106-2.106a1.532 1.532 0 01-2.287-.947zM10 13a3 3 0 100-6 3 3 0 000 6z" clipRule="evenodd" />
                  </svg>
                  Connection Settings
                </h2>
              </div>
              
              <div className="p-6">
                <div className="space-y-6">
                  {/* Connection Status */}
                  <div>
                    <label className="flex items-center">
                      <input
                        type="checkbox"
                        checked={isActive}
                        onChange={(e) => setIsActive(e.target.checked)}
                        className="rounded border-gray-300 text-blue-600 shadow-sm focus:border-blue-300 focus:ring focus:ring-blue-200 focus:ring-opacity-50"
                      />
                      <span className="ml-2 text-sm font-medium text-gray-900">
                        Active Connection
                      </span>
                    </label>
                    <p className="mt-1 text-sm text-gray-500">
                      When disabled, this Apple Calendar will not sync events or be available for bookings
                    </p>
                  </div>

                  {/* Apple-specific credentials */}
                  <div className="border border-gray-200 rounded-md p-4 bg-gray-50">
                    <h3 className="text-sm font-medium text-gray-900 mb-3 flex items-center">
                      <svg className="w-4 h-4 mr-2 text-gray-600" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z" clipRule="evenodd" />
                      </svg>
                      Apple iCloud Credentials
                    </h3>
                    <div className="space-y-4">
                      <div>
                        <label htmlFor="appleId" className="block text-sm font-medium text-gray-700">
                          Apple ID / iCloud Email
                        </label>
                        <input
                          type="email"
                          id="appleId"
                          value={appleId}
                          onChange={(e) => setAppleId(e.target.value)}
                          placeholder="your.email@icloud.com"
                          className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-300 focus:ring focus:ring-blue-200 focus:ring-opacity-50"
                        />
                        <p className="mt-1 text-xs text-gray-500">
                          Your Apple ID that has access to iCloud Calendar
                        </p>
                      </div>
                      <div>
                        <label htmlFor="appPassword" className="block text-sm font-medium text-gray-700">
                          App-Specific Password
                        </label>
                        <input
                          type="password"
                          id="appPassword"
                          value={appPassword}
                          onChange={(e) => setAppPassword(e.target.value)}
                          placeholder="xxxx-xxxx-xxxx-xxxx"
                          className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-300 focus:ring focus:ring-blue-200 focus:ring-opacity-50"
                        />
                        <div className="mt-1 text-xs text-gray-500">
                          <p className="mb-1">Generate this in your Apple ID account settings:</p>
                          <ol className="list-decimal list-inside space-y-1 ml-2">
                            <li>Go to appleid.apple.com</li>
                            <li>Sign In &amp; Security → App-Specific Passwords</li>
                            <li>Generate a new password for &quot;Calendar Access&quot;</li>
                            <li>Use the generated password here</li>
                          </ol>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Action Buttons */}
                  <div className="flex flex-wrap gap-4">
                    <button
                      onClick={handleSaveSettings}
                      disabled={saving}
                      className="bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700 disabled:opacity-50"
                    >
                      {saving ? 'Saving...' : 'Save Settings'}
                    </button>
                    
                    <button
                      onClick={loadCalendars}
                      disabled={loadingCalendars}
                      className="bg-purple-600 text-white px-4 py-2 rounded-md hover:bg-purple-700 disabled:opacity-50"
                    >
                      {loadingCalendars ? 'Loading...' : 'Load Calendars'}
                    </button>
                    
                    <button
                      onClick={handleSyncNow}
                      className="bg-green-600 text-white px-4 py-2 rounded-md hover:bg-green-700"
                    >
                      Sync Now
                    </button>
                  </div>
                </div>
              </div>
            </div>

            {/* Multi-Calendar Management for Apple */}
            <div className="mt-6 bg-white shadow rounded-lg">
              <div className="px-6 py-4 border-b border-gray-200">
                <h2 className="text-lg font-medium text-gray-900 flex items-center">
                  <svg className="w-5 h-5 mr-2 text-purple-600" fill="currentColor" viewBox="0 0 20 20">
                    <path d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  Apple Calendar Selection
                </h2>
                <p className="text-sm text-gray-500">Choose which Apple iCloud Calendars to sync and manage</p>
              </div>
              
              <div className="p-6">
                {loadingCalendars ? (
                  <div className="text-center py-4">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto"></div>
                    <p className="mt-2 text-sm text-gray-600">Loading Apple Calendars...</p>
                  </div>
                ) : availableCalendars.length > 0 ? (
                  <div className="space-y-3">
                    {availableCalendars.map((calendar) => (
                      <div key={calendar.id} className="border border-gray-200 rounded-md p-4 hover:border-blue-300 transition-colors">
                        <div className="flex items-start justify-between">
                          <div className="flex-1">
                            <h3 className="font-medium text-gray-900 flex items-center">
                              {calendar.color && (
                                <span 
                                  className="w-3 h-3 rounded-full mr-2" 
                                  style={{ backgroundColor: calendar.color }}
                                />
                              )}
                              {calendar.name}
                            </h3>
                            {calendar.description && (
                              <p className="text-sm text-gray-500 mt-1">{calendar.description}</p>
                            )}
                            <div className="flex items-center mt-2 space-x-4">
                              {calendar.isDefault && (
                                <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
                                  Primary Calendar
                                </span>
                              )}
                              {calendar.canWrite && (
                                <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
                                  Can Create Events
                                </span>
                              )}
                            </div>
                          </div>
                          <div className="flex flex-col space-y-2 ml-4">
                            <label className="flex items-center">
                              <input
                                type="checkbox"
                                checked={calendarSettings[calendar.id]?.syncEvents || false}
                                onChange={(e) => {
                                  const newSettings = {
                                    ...calendarSettings,
                                    [calendar.id]: {
                                      ...calendarSettings[calendar.id],
                                      syncEvents: e.target.checked,
                                    }
                                  };
                                  setCalendarSettings(newSettings);
                                  
                                  // Update selectedCalendars based on syncEvents
                                  if (e.target.checked) {
                                    if (!selectedCalendars.includes(calendar.id)) {
                                      setSelectedCalendars([...selectedCalendars, calendar.id]);
                                    }
                                  } else {
                                    setSelectedCalendars(selectedCalendars.filter(id => id !== calendar.id));
                                  }
                                }}
                                className="rounded border-gray-300 text-blue-600 shadow-sm focus:border-blue-300 focus:ring focus:ring-blue-200 focus:ring-opacity-50"
                              />
                              <span className="ml-2 text-sm font-medium text-gray-700">
                                Sync Events
                              </span>
                            </label>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-6 text-gray-500">
                    <svg className="mx-auto h-12 w-12 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                    </svg>
                    <p className="mt-2 text-sm">No calendars available. Please check your Apple ID credentials.</p>
                  </div>
                )}
              </div>
            </div>

            {/* Apple Calendar Info */}
            <div className="mt-6 bg-blue-50 border border-blue-200 rounded-lg p-6">
              <div className="flex">
                <div className="flex-shrink-0">
                  <svg className="h-5 w-5 text-blue-400" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
                  </svg>
                </div>
                <div className="ml-3">
                  <h3 className="text-sm font-medium text-blue-800">Apple Calendar Sync Information</h3>
                  <div className="mt-2 text-sm text-blue-700">
                    <ul className="list-disc pl-5 space-y-1">
                      <li>Apple Calendar uses CalDAV protocol for synchronization</li>
                      <li>Requires an App-Specific Password for security</li>
                      <li>Sync frequency is limited by Apple&apos;s rate limiting</li>
                      <li>Changes may take a few minutes to appear</li>
                      <li>Supports read-only access to your calendar events</li>
                    </ul>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Info Panel */}
          <div className="space-y-6">
            {/* Connection Info */}
            <div className="bg-white shadow rounded-lg">
              <div className="px-6 py-4 border-b border-gray-200">
                <h3 className="text-lg font-medium text-gray-900">Apple Connection Info</h3>
              </div>
              <div className="p-6">
                <dl className="space-y-3">
                  <div>
                    <dt className="text-sm font-medium text-gray-500">Platform</dt>
                    <dd className="text-sm text-gray-900 flex items-center">
                      <svg className="w-4 h-4 mr-1 text-gray-800" fill="currentColor" viewBox="0 0 24 24">
                        <path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.81-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z"/>
                      </svg>
                      Apple iCloud Calendar
                    </dd>
                  </div>
                  <div>
                    <dt className="text-sm font-medium text-gray-500">Email</dt>
                    <dd className="text-sm text-gray-900">{connection.email}</dd>
                  </div>
                  <div>
                    <dt className="text-sm font-medium text-gray-500">Status</dt>
                    <dd className="text-sm">
                      <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                        connection.isActive 
                          ? 'bg-green-100 text-green-800' 
                          : 'bg-red-100 text-red-800'
                      }`}>
                        {connection.isActive ? 'Active' : 'Inactive'}
                      </span>
                    </dd>
                  </div>
                  <div>
                    <dt className="text-sm font-medium text-gray-500">Last Sync</dt>
                    <dd className="text-sm text-gray-900">
                      {connection.lastSyncAt ? formatDate(connection.lastSyncAt) : 'Never'}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-sm font-medium text-gray-500">Connected</dt>
                    <dd className="text-sm text-gray-900">
                      {connection.createdAt ? formatDate(connection.createdAt) : 'Unknown'}
                    </dd>
                  </div>
                </dl>
              </div>
            </div>

            {/* Recent Events */}
            <div className="bg-white shadow rounded-lg">
              <div className="px-6 py-4 border-b border-gray-200">
                <h3 className="text-lg font-medium text-gray-900">Recent Apple Events</h3>
              </div>
              <div className="p-6">
                {events.length > 0 ? (
                  <div className="space-y-3">
                    {events.slice(0, 5).map((event) => (
                      <div key={event.id} className="border-l-4 border-gray-400 pl-3 hover:border-gray-600 transition-colors">
                        <p className="text-sm font-medium text-gray-900">{event.title}</p>
                        <p className="text-xs text-gray-500">
                          {formatDate(event.startTime)} - {formatDate(event.endTime)}
                        </p>
                        {event.location && (
                          <p className="text-xs text-gray-500">📍 {event.location}</p>
                        )}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-4">
                    <svg className="mx-auto h-8 w-8 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3a4 4 0 118 0v4m-4 12v6m0-6V9m0 4h.01" />
                    </svg>
                    <p className="text-gray-500 text-sm mt-2">No recent Apple Calendar events</p>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
