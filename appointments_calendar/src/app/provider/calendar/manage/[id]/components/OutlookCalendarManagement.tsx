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

interface OutlookCalendarManagementProps {
  connection: CalendarConnection;
  onConnectionUpdate?: (connection: CalendarConnection) => void;
}

export default function OutlookCalendarManagement({ connection, onConnectionUpdate }: OutlookCalendarManagementProps) {
  const { showSuccess, showError } = useAlert();
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Form state
  const [isActive, setIsActive] = useState(connection.isActive);

  // Multi-calendar state
  const [availableCalendars, setAvailableCalendars] = useState<AvailableCalendar[]>([]);
  const [loadingCalendars, setLoadingCalendars] = useState(false);
  const [selectedCalendars, setSelectedCalendars] = useState<string[]>(connection.selectedCalendars || []);
  const [calendarSettings, setCalendarSettings] = useState<{[key: string]: {syncEvents: boolean}}>(connection.calendarSettings || {});

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

      // Load available Outlook calendars
      setLoadingCalendars(true);
      try {
        if (connection.id) {
          const calendarsResponse = await fetch(`/api/provider/calendar/available-calendars?platform=OUTLOOK&connectionId=${encodeURIComponent(connection.id)}`, {
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
              initialCalendarSettings[cal.id] = {
                syncEvents: connection.syncEvents ?? true,
              };
            });
            setCalendarSettings(initialCalendarSettings);
          } else {
            console.error('Failed to fetch calendars:', await calendarsResponse.text());
            setError('Failed to load Outlook calendars. Try re-authenticating your connection.');
          }
        } else {
          setError('No connection found. Please re-authenticate your Outlook connection.');
        }
      } catch (calErr) {
        console.error('Failed to load calendars:', calErr);
        setError('Failed to load available calendars');
      } finally {
        setLoadingCalendars(false);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load calendar data');
    }
  }, [connection.id, connection.selectedCalendars, connection.syncEvents]);

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
      
      const updateData = {
        isActive,
        syncEvents: primaryCalendarSettings.syncEvents,
        selectedCalendars,
        calendarSettings,
      };

      const response = await secureFetch(`/api/provider/calendar/connections/${connection.id}`, {
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

      showSuccess('Outlook Calendar settings saved successfully!');
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

      console.log('🔄 Outlook sync completed successfully');
      
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
      
      showSuccess('Outlook Calendar synced successfully!');
    } catch (err) {
      console.error('❌ Outlook sync error:', err);
      setError(err instanceof Error ? err.message : 'Failed to sync Outlook Calendar');
    }
  };

  const handleReauth = async () => {
    try {
      const token = localStorage.getItem('providerToken');
      const response = await fetch(`/api/provider/calendar/auth-urls`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!response.ok) {
        throw new Error('Failed to get authentication URL');
      }

      const data = await response.json();
      
      // Use the Outlook auth URL for re-authentication, but modify the state to include connection ID
      if (data.outlook) {
        // Parse the existing URL to modify the state parameter
        const url = new URL(data.outlook);
        const currentState = url.searchParams.get('state');
        
        if (currentState) {
          // Parse existing state and add connection ID for re-auth
          const stateData = JSON.parse(decodeURIComponent(currentState));
          stateData.connectionId = connection.id;
          stateData.isReauth = true;
          
          // Update the state parameter
          url.searchParams.set('state', encodeURIComponent(JSON.stringify(stateData)));
          
          window.location.href = url.toString();
        } else {
          throw new Error('Invalid authentication URL format');
        }
      } else {
        throw new Error('Outlook authentication URL not available');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to initiate re-authentication');
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
                  <span className="ml-4 text-sm font-medium text-gray-900">Outlook Calendar Management</span>
                </div>
              </li>
            </ol>
          </nav>
          
          <div className="mt-4">
            <h1 className="text-3xl font-bold text-gray-900 flex items-center">
              <svg className="w-8 h-8 mr-3 text-blue-700" fill="currentColor" viewBox="0 0 24 24">
                <path d="M7.88 12.04q0 .45-.11.87-.1.41-.33.74-.22.33-.58.52-.37.2-.87.2t-.85-.2q-.35-.21-.57-.55-.22-.33-.33-.75-.1-.42-.1-.83 0-.42.1-.84.11-.41.33-.73.22-.32.57-.51.36-.2.85-.2t.87.2q.36.19.58.51.22.32.33.73.11.42.11.84m-3.24-.02q0 .56.2.94.2.39.63.39.43 0 .64-.39.2-.38.2-.94 0-.57-.2-.95-.21-.37-.64-.37-.43 0-.63.37-.2.38-.2.95M14.64 8.5h-3.03v.85h3.03zm-3.03 1.96h1.65v.85h-1.65zm6.5-3.96h-17.72C.38 6.5 0 6.88 0 7.35v9.3c0 .47.38.85.85.85h18.3c.47 0 .85-.38.85-.85v-9.3c0-.47-.38-.85-.85-.85zM7.8 13.5c-.15.15-.33.26-.54.33-.2.07-.42.1-.65.1-.55 0-1.01-.2-1.38-.61-.37-.4-.56-.93-.56-1.59 0-.66.19-1.19.56-1.59.37-.4.83-.61 1.38-.61.23 0 .45.04.65.11.21.07.39.18.54.33l-.45.58c-.08-.08-.18-.14-.29-.18-.11-.04-.24-.06-.38-.06-.32 0-.58.13-.77.38-.2.25-.29.59-.29 1.02s.09.77.29 1.02c.19.25.45.38.77.38.14 0 .27-.02.38-.06.11-.04.21-.1.29-.18zm9.55-4.5h-4.05v4.5h4.05z"/>
              </svg>
              Outlook Calendar - {connection.email}
            </h1>
            <p className="mt-2 text-gray-600">
              Manage your Microsoft Outlook Calendar connections and multi-calendar settings
            </p>
          </div>
        </div>

        {error && (
          <div className="mb-6 bg-red-50 border border-red-200 rounded-md p-4">
            <div className="flex">
              <div className="ml-3">
                <h3 className="text-sm font-medium text-red-800">Error</h3>
                <div className="mt-2 text-sm text-red-700">
                  <p>{error}</p>
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
                      When disabled, this Outlook Calendar will not sync events or be available for bookings
                    </p>
                  </div>

                  {/* Action Buttons */}
                  <div className="flex space-x-4">
                    <button
                      onClick={handleSaveSettings}
                      disabled={saving}
                      className="bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700 disabled:opacity-50"
                    >
                      {saving ? 'Saving...' : 'Save Settings'}
                    </button>
                    
                    <button
                      onClick={handleSyncNow}
                      className="bg-green-600 text-white px-4 py-2 rounded-md hover:bg-green-700"
                    >
                      Sync Now
                    </button>
                    
                    <button
                      onClick={handleReauth}
                      className="bg-yellow-600 text-white px-4 py-2 rounded-md hover:bg-yellow-700"
                    >
                      Re-authenticate
                    </button>
                  </div>
                </div>
              </div>
            </div>

            {/* Multi-Calendar Management for Outlook */}
            <div className="mt-6 bg-white shadow rounded-lg">
              <div className="px-6 py-4 border-b border-gray-200">
                <h2 className="text-lg font-medium text-gray-900 flex items-center">
                  <svg className="w-5 h-5 mr-2 text-purple-600" fill="currentColor" viewBox="0 0 20 20">
                    <path d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  Outlook Calendar Selection
                </h2>
                <p className="text-sm text-gray-500">Choose which Outlook Calendars to sync and manage</p>
              </div>
              
              <div className="p-6">
                {loadingCalendars ? (
                  <div className="text-center py-4">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto"></div>
                    <p className="mt-2 text-sm text-gray-600">Loading Outlook Calendars...</p>
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
                                  setCalendarSettings({
                                    ...calendarSettings,
                                    [calendar.id]: {
                                      ...calendarSettings[calendar.id],
                                      syncEvents: e.target.checked
                                    }
                                  });
                                  
                                  // Update selected calendars list
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
                              <span className="ml-2 text-sm font-medium text-gray-900">Sync Events</span>
                            </label>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-4">
                    <svg className="mx-auto h-8 w-8 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3a4 4 0 118 0v4m-4 12v6m0-6V9m0 4h.01" />
                    </svg>
                    <p className="text-gray-500 text-sm mt-2">No Outlook calendars available. Try re-authenticating your connection.</p>
                  </div>
                )}
              </div>
            </div>

            {/* Outlook Calendar Info */}
            <div className="mt-6 bg-blue-50 border border-blue-200 rounded-lg p-6">
              <div className="flex">
                <div className="flex-shrink-0">
                  <svg className="h-5 w-5 text-blue-400" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
                  </svg>
                </div>
                <div className="ml-3">
                  <h3 className="text-sm font-medium text-blue-800">Outlook Multi-Calendar Sync Information</h3>
                  <div className="mt-2 text-sm text-blue-700">
                    <ul className="list-disc pl-5 space-y-1">
                      <li>Select individual calendars for sync</li>
                      <li><strong>Sync Events:</strong> Pull existing events from this calendar to block booking times</li>
                      <li>Outlook Calendar uses Microsoft Graph API for synchronization</li>
                      <li>Supports real-time updates via webhooks when available</li>
                      <li>Changes appear almost instantly across all selected calendars</li>
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
                <h3 className="text-lg font-medium text-gray-900">Outlook Connection Info</h3>
              </div>
              <div className="p-6">
                <dl className="space-y-3">
                  <div>
                    <dt className="text-sm font-medium text-gray-500">Platform</dt>
                    <dd className="text-sm text-gray-900 flex items-center">
                      <svg className="w-4 h-4 mr-1 text-blue-700" fill="currentColor" viewBox="0 0 24 24">
                        <path d="M7.88 12.04q0 .45-.11.87-.1.41-.33.74-.22.33-.58.52-.37.2-.87.2t-.85-.2q-.35-.21-.57-.55-.22-.33-.33-.75-.1-.42-.1-.83 0-.42.1-.84.11-.41.33-.73.22-.32.57-.51.36-.2.85-.2t.87.2q.36.19.58.51.22.32.33.73.11.42.11.84m-3.24-.02q0 .56.2.94.2.39.63.39.43 0 .64-.39.2-.38.2-.94 0-.57-.2-.95-.21-.37-.64-.37-.43 0-.63.37-.2.38-.2.95M14.64 8.5h-3.03v.85h3.03zm-3.03 1.96h1.65v.85h-1.65zm6.5-3.96h-17.72C.38 6.5 0 6.88 0 7.35v9.3c0 .47.38.85.85.85h18.3c.47 0 .85-.38.85-.85v-9.3c0-.47-.38-.85-.85-.85zM7.8 13.5c-.15.15-.33.26-.54.33-.2.07-.42.1-.65.1-.55 0-1.01-.2-1.38-.61-.37-.4-.56-.93-.56-1.59 0-.66.19-1.19.56-1.59.37-.4.83-.61 1.38-.61.23 0 .45.04.65.11.21.07.39.18.54.33l-.45.58c-.08-.08-.18-.14-.29-.18-.11-.04-.24-.06-.38-.06-.32 0-.58.13-.77.38-.2.25-.29.59-.29 1.02s.09.77.29 1.02c.19.25.45.38.77.38.14 0 .27-.02.38-.06.11-.04.21-.1.29-.18zm9.55-4.5h-4.05v4.5h4.05z"/>
                      </svg>
                      Microsoft Outlook
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
                <h3 className="text-lg font-medium text-gray-900">Recent Outlook Events</h3>
              </div>
              <div className="p-6">
                {events.length > 0 ? (
                  <div className="space-y-3">
                    {events.slice(0, 5).map((event) => (
                      <div key={event.id} className="border-l-4 border-blue-400 pl-3 hover:border-blue-600 transition-colors">
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
                    <p className="text-gray-500 text-sm mt-2">No recent Outlook Calendar events</p>
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