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

interface TeamsCalendarManagementProps {
  connection: CalendarConnection;
  onConnectionUpdate?: (connection: CalendarConnection) => void;
}

export default function TeamsCalendarManagement({ connection, onConnectionUpdate }: TeamsCalendarManagementProps) {
  const { showSuccess, showError } = useAlert();
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Form state
  const [isActive, setIsActive] = useState(connection.isActive);

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
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load calendar data');
    }
  }, [connection.id]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleSaveSettings = async () => {
    setSaving(true);
    try {
      const token = localStorage.getItem('providerToken');
      
      const updateData = {
        isActive,
      };

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

      showSuccess('Teams Calendar settings saved successfully!');
      await loadData();
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

      console.log('🔄 Teams sync completed successfully');
      
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
      
      showSuccess('Teams Calendar synced successfully!');
    } catch (err) {
      console.error('❌ Teams sync error:', err);
      setError(err instanceof Error ? err.message : 'Failed to sync Teams Calendar');
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
      
      // Use the Teams auth URL for re-authentication, but modify the state to include connection ID
      if (data.teams) {
        // Parse the existing URL to modify the state parameter
        const url = new URL(data.teams);
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
        throw new Error('Teams authentication URL not available');
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
                  <span className="ml-4 text-sm font-medium text-gray-900">Teams Calendar Management</span>
                </div>
              </li>
            </ol>
          </nav>
          
          <div className="mt-4">
            <h1 className="text-3xl font-bold text-gray-900 flex items-center">
              <svg className="w-8 h-8 mr-3 text-purple-600" fill="currentColor" viewBox="0 0 24 24">
                <path d="M21.19 2.84A2.84 2.84 0 0018.35 0h-5.7A2.84 2.84 0 009.81 2.84v5.7a2.84 2.84 0 002.84 2.84h5.7a2.84 2.84 0 002.84-2.84v-5.7zM14.16 21.16A2.84 2.84 0 0011.32 24h-5.7A2.84 2.84 0 002.78 21.16v-5.7A2.84 2.84 0 005.62 12.62h5.7a2.84 2.84 0 002.84 2.84v5.7zM9.81 0H5.62A2.84 2.84 0 002.78 2.84v5.7a2.84 2.84 0 002.84 2.84h4.19V0zM21.19 12.62H18.35a2.84 2.84 0 00-2.84 2.84v5.7a2.84 2.84 0 002.84 2.84h2.84V12.62z"/>
              </svg>
              Microsoft Teams - {connection.email}
            </h1>
            <p className="mt-2 text-gray-600">
              Manage your Microsoft Teams Calendar connection and sync settings
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
                        className="rounded border-gray-300 text-purple-600 shadow-sm focus:border-purple-300 focus:ring focus:ring-purple-200 focus:ring-opacity-50"
                      />
                      <span className="ml-2 text-sm font-medium text-gray-900">
                        Active Connection
                      </span>
                    </label>
                    <p className="mt-1 text-sm text-gray-500">
                      When disabled, this Teams Calendar will not sync events or be available for bookings
                    </p>
                  </div>

                  {/* Action Buttons */}
                  <div className="flex space-x-4">
                    <button
                      onClick={handleSaveSettings}
                      disabled={saving}
                      className="bg-purple-600 text-white px-4 py-2 rounded-md hover:bg-purple-700 disabled:opacity-50"
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

            {/* Teams Calendar Info */}
            <div className="mt-6 bg-purple-50 border border-purple-200 rounded-lg p-6">
              <div className="flex">
                <div className="flex-shrink-0">
                  <svg className="h-5 w-5 text-purple-400" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
                  </svg>
                </div>
                <div className="ml-3">
                  <h3 className="text-sm font-medium text-purple-800">Teams Calendar Sync Information</h3>
                  <div className="mt-2 text-sm text-purple-700">
                    <ul className="list-disc pl-5 space-y-1">
                      <li>Teams Calendar integrates with Microsoft Graph API</li>
                      <li>Supports real-time meeting notifications and updates</li>
                      <li>Full calendar access including Teams meetings and regular events</li>
                      <li>Automatic Teams meeting link detection and management</li>
                      <li>Supports advanced Teams features like meeting recordings and transcripts</li>
                      <li>Webhook support for instant synchronization</li>
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
                <h3 className="text-lg font-medium text-gray-900">Teams Connection Info</h3>
              </div>
              <div className="p-6">
                <dl className="space-y-3">
                  <div>
                    <dt className="text-sm font-medium text-gray-500">Platform</dt>
                    <dd className="text-sm text-gray-900 flex items-center">
                      <svg className="w-4 h-4 mr-1 text-purple-600" fill="currentColor" viewBox="0 0 24 24">
                        <path d="M21.19 2.84A2.84 2.84 0 0018.35 0h-5.7A2.84 2.84 0 009.81 2.84v5.7a2.84 2.84 0 002.84 2.84h5.7a2.84 2.84 0 002.84-2.84v-5.7zM14.16 21.16A2.84 2.84 0 0011.32 24h-5.7A2.84 2.84 0 002.78 21.16v-5.7A2.84 2.84 0 005.62 12.62h5.7a2.84 2.84 0 002.84 2.84v5.7zM9.81 0H5.62A2.84 2.84 0 002.78 2.84v5.7a2.84 2.84 0 002.84 2.84h4.19V0zM21.19 12.62H18.35a2.84 2.84 0 00-2.84 2.84v5.7a2.84 2.84 0 002.84 2.84h2.84V12.62z"/>
                      </svg>
                      Microsoft Teams
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
                <h3 className="text-lg font-medium text-gray-900">Recent Teams Events</h3>
              </div>
              <div className="p-6">
                {events.length > 0 ? (
                  <div className="space-y-3">
                    {events.slice(0, 5).map((event) => (
                      <div key={event.id} className="border-l-4 border-purple-400 pl-3 hover:border-purple-600 transition-colors">
                        <p className="text-sm font-medium text-gray-900 flex items-center">
                          {event.title}
                          {event.location?.includes('teams.microsoft.com') && (
                            <svg className="w-4 h-4 ml-2 text-purple-600" fill="currentColor" viewBox="0 0 24 24">
                              <path d="M21.19 2.84A2.84 2.84 0 0018.35 0h-5.7A2.84 2.84 0 009.81 2.84v5.7a2.84 2.84 0 002.84 2.84h5.7a2.84 2.84 0 002.84-2.84v-5.7z"/>
                            </svg>
                          )}
                        </p>
                        <p className="text-xs text-gray-500">
                          {formatDate(event.startTime)} - {formatDate(event.endTime)}
                        </p>
                        {event.location && (
                          <p className="text-xs text-gray-500">
                            {event.location.includes('teams.microsoft.com') ? '🎥 Teams Meeting' : `📍 ${event.location}`}
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-4">
                    <svg className="mx-auto h-8 w-8 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3a4 4 0 118 0v4m-4 12v6m0-6V9m0 4h.01" />
                    </svg>
                    <p className="text-gray-500 text-sm mt-2">No recent Teams Calendar events</p>
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
