'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { secureFetch } from '@/lib/csrf';
import LocationSchedules from '@/components/LocationSchedules';
import { ProviderLocation, LocationSchedule } from '@/types/location';
import { useAlert } from '@/contexts/AlertContext';

interface LocationFormData {
  addressLine1?: string;
  addressLine2?: string;
  city: string;
  stateProvince: string;
  postalCode?: string;
  country: string;
  timezone?: string;
  description: string;
  startDate: string;
  endDate: string;
  isDefault: boolean;
}

export default function ManageLocationPage() {
  const { showConfirm } = useAlert();
  const [locations, setLocations] = useState<ProviderLocation[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formData, setFormData] = useState<LocationFormData>({
    timezone: '',
    addressLine1: '',
    addressLine2: '',
    city: '',
    stateProvince: '',
    postalCode: '',
    country: '',
    description: '',
    startDate: '',
    endDate: '',
    isDefault: false
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  
  // Schedule management state
  const [selectedLocationId, setSelectedLocationId] = useState<string | null>(null);
  const [locationSchedules, setLocationSchedules] = useState<{[key: string]: LocationSchedule[]}>({});

  const router = useRouter();
  const formRef = useRef<HTMLDivElement>(null);

  // Scroll to form when it opens
  useEffect(() => {
    if (showForm && formRef.current) {
      formRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, [showForm]);

  const fetchLocations = useCallback(async () => {
    try {
      const token = localStorage.getItem('providerToken');
      if (!token) {
        router.push('/login');
        return;
      }

      const response = await fetch('/api/provider/location', {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        if (response.status === 401) {
          localStorage.removeItem('providerToken');
          router.push('/login');
          return;
        }
        throw new Error('Failed to fetch locations');
      }

      const data = await response.json();
      setLocations(data.locations);
    } catch (error) {
      console.error('Error fetching locations:', error);
      setError('Failed to load locations');
    } finally {
      setIsLoading(false);
    }
  }, [router]);

  // Fetch schedules for a specific location
  const fetchLocationSchedules = useCallback(async (locationId: string) => {
    try {
      const token = localStorage.getItem('providerToken');
      if (!token) return;

      const response = await fetch(`/api/provider/location/${locationId}/schedules`, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      });

      if (response.ok) {
        const data = await response.json();
        setLocationSchedules(prev => ({
          ...prev,
          [locationId]: data.schedules || []
        }));
      }
    } catch (error) {
      console.error('Error fetching schedules:', error);
    }
  }, []);

  // Handle schedule addition
  const handleScheduleAdd = useCallback(async (locationId: string, scheduleData: Omit<LocationSchedule, 'id' | 'locationId' | 'createdAt' | 'updatedAt'>) => {
    try {
      const token = localStorage.getItem('providerToken');
      if (!token) return;

      const response = await secureFetch(`/api/provider/location/${locationId}/schedules`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(scheduleData),
      });

      if (response.ok) {
        await fetchLocationSchedules(locationId);
      } else {
        throw new Error('Failed to add schedule');
      }
    } catch (error) {
      console.error('Error adding schedule:', error);
      setError('Failed to add schedule');
    }
  }, [fetchLocationSchedules]);

  // Handle schedule editing
  const handleScheduleEdit = useCallback(async (locationId: string, scheduleId: string, scheduleData: Partial<LocationSchedule>) => {
    try {
      const token = localStorage.getItem('providerToken');
      if (!token) return;

      const response = await secureFetch(`/api/provider/location/${locationId}/schedules/${scheduleId}`, {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(scheduleData),
      });

      if (response.ok) {
        await fetchLocationSchedules(locationId);
      } else {
        throw new Error('Failed to update schedule');
      }
    } catch (error) {
      console.error('Error updating schedule:', error);
      setError('Failed to update schedule');
    }
  }, [fetchLocationSchedules]);

  // Handle schedule deletion
  const handleScheduleDelete = useCallback(async (locationId: string, scheduleId: string) => {
    try {
      const token = localStorage.getItem('providerToken');
      if (!token) return;

      const response = await secureFetch(`/api/provider/location/${locationId}/schedules/${scheduleId}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      });

      if (response.ok) {
        await fetchLocationSchedules(locationId);
      } else {
        throw new Error('Failed to delete schedule');
      }
    } catch (error) {
      console.error('Error deleting schedule:', error);
      setError('Failed to delete schedule');
    }
  }, [fetchLocationSchedules]);

  useEffect(() => {
    fetchLocations();
  }, [fetchLocations]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setError(null);

    try {
      const token = localStorage.getItem('providerToken');
      if (!token) {
        router.push('/login');
        return;
      }

      // Validate dates (only for non-default locations)
      if (!formData.isDefault) {
        if (!formData.startDate || !formData.endDate) {
          setError('Start date and end date are required for non-default locations');
          setIsSubmitting(false);
          return;
        }

        const startDate = new Date(formData.startDate);
        const endDate = new Date(formData.endDate);
        
        if (startDate >= endDate) {
          setError('Start date must be before end date');
          setIsSubmitting(false);
          return;
        }
      }

      const url = editingId ? `/api/provider/location/${editingId}` : '/api/provider/location';
      const method = editingId ? 'PUT' : 'POST';

      // Prepare data for submission - handle default locations properly
      const submitData = {
        ...formData,
        // For default locations, don't send empty date strings
        ...(formData.isDefault ? {
          startDate: undefined,
          endDate: undefined
        } : {})
      };

      const response = await secureFetch(url, {
        method,
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(submitData),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to save location');
      }

      // Reset form and refresh locations
      setFormData({
        addressLine1: '',
        addressLine2: '',
        city: '',
        stateProvince: '',
        postalCode: '',
        country: '',
        timezone: '',
        description: '',
        startDate: '',
        endDate: '',
        isDefault: false
      });
      setShowForm(false);
      setEditingId(null);
      await fetchLocations();
    } catch (error) {
      console.error('Error saving location:', error);
      setError(error instanceof Error ? error.message : 'Failed to save location');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleEdit = (location: ProviderLocation) => {
    setFormData({
      addressLine1: location.addressLine1 || '',
      addressLine2: location.addressLine2 || '',
      city: location.city,
      stateProvince: location.stateProvince,
      postalCode: location.postalCode || '',
      country: location.country,
      timezone: location.timezone,
      description: location.description || '',
      startDate: location.isDefault ? '' : location.startDate.split('T')[0], // Empty for default locations
      endDate: location.isDefault ? '' : location.endDate.split('T')[0],
      isDefault: location.isDefault
    });
    setEditingId(location.id);
    setShowForm(true);
  };

  const handleDelete = async (id: string) => {
    showConfirm(
      'Are you sure you want to delete this location?',
      async () => {
        try {
          const token = localStorage.getItem('providerToken');
          if (!token) {
            router.push('/login');
            return;
          }

          const response = await secureFetch(`/api/provider/location/${id}`, {
            method: 'DELETE',
            headers: {
              'Authorization': `Bearer ${token}`,
            },
          });

          if (!response.ok) {
            throw new Error('Failed to delete location');
          }

          await fetchLocations();
        } catch (error) {
          console.error('Error deleting location:', error);
          setError('Failed to delete location');
        }
      },
      'Delete Location'
    );
  };

  const handleSetDefault = async (id: string) => {
    try {
      const token = localStorage.getItem('providerToken');
      if (!token) {
        router.push('/login');
        return;
      }

      // Get the current location data to update it
      const locationToUpdate = locations.find(loc => loc.id === id);
      if (!locationToUpdate) return;

      const response = await secureFetch(`/api/provider/location/${id}`, {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          addressLine1: locationToUpdate.addressLine1 || '',
          addressLine2: locationToUpdate.addressLine2 || '',
          city: locationToUpdate.city,
          stateProvince: locationToUpdate.stateProvince,
          country: locationToUpdate.country,
          timezone: locationToUpdate.timezone,
          description: locationToUpdate.description,
          startDate: locationToUpdate.startDate,
          endDate: locationToUpdate.endDate,
          isDefault: true
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to set default location');
      }

      await fetchLocations(); // Refresh the list
    } catch (error) {
      console.error('Error setting default location:', error);
      setError('Failed to set default location');
    }
  };

  const handleCancel = () => {
    setFormData({
      timezone: '',
      addressLine1: '',
      addressLine2: '',
      city: '',
      stateProvince: '',
      country: '',
      description: '',
      startDate: '',
      endDate: '',
      isDefault: false
    });
    setShowForm(false);
    setEditingId(null);
    setError(null);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[calc(100vh-4rem)]">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto"></div>
          <p className="mt-2 text-gray-600">Loading locations...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto p-6">
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <div className="flex justify-between items-center mb-6">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">Manage Locations</h1>
              <p className="text-gray-600 mt-1">Set up locations and timeframes for client bookings</p>
            </div>
            <button
              onClick={() => setShowForm(true)}
              className="bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700 font-medium"
            >
              Add Location
            </button>
          </div>

          {/* User Education Section */}
          <div className="bg-gradient-to-r from-blue-50 to-indigo-50 rounded-lg p-6 mb-6 border border-blue-200">
            <div className="flex items-start space-x-3">
              <div className="flex-shrink-0">
                <div className="w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center">
                  <svg className="w-5 h-5 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </div>
              </div>
              <div className="flex-1">
                <h3 className="text-lg font-semibold text-gray-900 mb-3">How Locations Work</h3>
                <div className="space-y-3 text-sm text-gray-700">
                  <div>
                    <h4 className="font-medium text-gray-900 mb-1">📍 Location Types:</h4>
                    <ul className="list-disc list-inside ml-4 space-y-1">
                      <li><strong>Default Location:</strong> Your permanent, primary location (home office, main clinic). No time restrictions.</li>
                      <li><strong>Scheduled Locations:</strong> Temporary or time-specific locations with defined availability periods.</li>
                    </ul>
                  </div>
                  
                  <div>
                    <h4 className="font-medium text-gray-900 mb-1">⭐ Default Location Benefits:</h4>
                    <ul className="list-disc list-inside ml-4 space-y-1">
                      <li>Always available for bookings (unless you have specific schedules)</li>
                      <li>Used as fallback when other locations aren&apos;t available</li>
                      <li>Appears first in client booking options</li>
                    </ul>
                  </div>
                  
                  <div>
                    <h4 className="font-medium text-gray-900 mb-1">📅 Location Specific Schedules:</h4>
                    <ul className="list-disc list-inside ml-4 space-y-1">
                      <li><strong>Simple Schedules:</strong> Let clients know when you will be at a particular location between specific start and end dates</li>
                      <li><strong>Recurring Schedules:</strong> Complex, customizable patterns like &quot;Every Tuesday&quot; or &quot;First Monday of each month&quot;</li>
                      <li><strong>Multiple Schedules:</strong> Add several different time periods to the same location</li>
                    </ul>
                    <div className="mt-2 p-2 bg-blue-50 rounded border border-blue-200">
                      <p className="text-sm text-blue-800">
                        <strong>Note:</strong> These schedules define <em>when</em> you&apos;ll be at a location. 
                        For specific time-based availability (your working hours, availability windows for specific days of the week, etc.), customize your{' '}
                        <a 
                          href="/provider/availability-schedules" 
                          className="text-blue-600 hover:text-blue-800 underline font-medium"
                        >
                          availability schedules
                        </a>.
                      </p>
                    </div>
                  </div>
                  
                  <div className="bg-white rounded-md p-3 border border-blue-200">
                    <h4 className="font-medium text-blue-900 mb-2">💡 Example Use Cases:</h4>
                    <div className="text-xs space-y-1">
                      <p><strong>Consultant:</strong> Default office + client site every other week</p>
                      <p><strong>Therapist:</strong> Main practice + satellite clinic on Wednesdays</p>
                      <p><strong>Trainer:</strong> Home gym + community center weekends</p>
                      <p><strong>Doctor:</strong> Main clinic + hospital rounds on specific days</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-md mb-4">
              {error}
            </div>
          )}

          {showForm && (
            <div ref={formRef} className="bg-gray-50 rounded-lg p-6 mb-6 border border-gray-200">
              <h2 className="text-lg font-semibold text-gray-900 mb-4">
                {editingId ? 'Edit Location' : 'Add New Location'}
              </h2>
              
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-900 mb-1">
                      Address Line 1
                    </label>
                    <input
                      type="text"
                      value={formData.addressLine1}
                      onChange={(e) => setFormData(prev => ({ ...prev, addressLine1: e.target.value }))}
                      className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm text-gray-900 bg-white placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
                      placeholder="Street address, P.O. box"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-900 mb-1">
                      Address Line 2
                    </label>
                    <input
                      type="text"
                      value={formData.addressLine2}
                      onChange={(e) => setFormData(prev => ({ ...prev, addressLine2: e.target.value }))}
                      className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm text-gray-900 bg-white placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
                      placeholder="Apartment, suite, unit, building, floor, etc."
                    />
                  </div>  
                  
                  <div>
                    <label className="block text-sm font-medium text-gray-900 mb-1">
                      City *
                    </label>
                    <input
                      type="text"
                      value={formData.city}
                      onChange={(e) => setFormData(prev => ({ ...prev, city: e.target.value }))}
                      className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm text-gray-900 bg-white placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
                      placeholder="Enter city"
                      required
                    />
                  </div>
                  
                  <div>
                    <label className="block text-sm font-medium text-gray-900 mb-1">
                      State/Province *
                    </label>
                    <input
                      type="text"
                      value={formData.stateProvince}
                      onChange={(e) => setFormData(prev => ({ ...prev, stateProvince: e.target.value }))}
                      className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm text-gray-900 bg-white placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
                      placeholder="Enter state or province"
                      required
                    />
                  </div>
                  
                  <div>
                    <label className="block text-sm font-medium text-gray-900 mb-1">
                      ZIP/Postal Code
                    </label>
                    <input
                      type="text"
                      value={formData.postalCode}
                      onChange={(e) => setFormData(prev => ({ ...prev, postalCode: e.target.value }))}
                      className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm text-gray-900 bg-white placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
                      placeholder="Enter ZIP or postal code"
                    />
                  </div>
                  
                  <div>
                    <label className="block text-sm font-medium text-gray-900 mb-1">
                      Country *
                    </label>
                    <input
                      type="text"
                      value={formData.country}
                      onChange={(e) => setFormData(prev => ({ ...prev, country: e.target.value }))}
                      className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm text-gray-900 bg-white placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
                      placeholder="Enter country"
                      required
                    />
                  </div>
                </div>

                <div>
  <label className="block text-sm font-medium text-gray-900 mb-1">
    Timezone *
  </label>
  <select
    value={formData.timezone}
    onChange={(e) => setFormData(prev => ({ ...prev, timezone: e.target.value }))}
    className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm text-gray-900 bg-white placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
    required
  >
    <option value="">Select a timezone...</option>
    <option value="America/Chicago">Central Time (US & Canada)</option>
    <option value="America/Denver">Mountain Time (US & Canada)</option>
    <option value="America/New_York">Eastern Time (US & Canada)</option>
    <option value="America/Los_Angeles">Pacific Time (US & Canada)</option>
    <option value="Europe/London">London</option>
    <option value="Europe/Berlin">Berlin</option>
    <option value="Europe/Paris">Paris</option>
    <option value="Asia/Kolkata">Kolkata</option>
    <option value="Asia/Singapore">Singapore</option>
    <option value="Asia/Hong_Kong">Hong Kong</option>
    <option value="Asia/Taipei">Taipei</option>
    <option value="Asia/Seoul">Seoul</option>
    <option value="Asia/Tokyo">Tokyo</option>
  </select>
</div>

                <div>
                  <label className="block text-sm font-medium text-gray-900 mb-1">
                    Description (optional)
                  </label>
                  <textarea
                    value={formData.description}
                    onChange={(e) => setFormData(prev => ({ ...prev, description: e.target.value }))}
                    className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm text-gray-900 bg-white placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
                    placeholder="Optional description for this location"
                    rows={3}
                  />
                </div>

                <div>
                  <label className="flex items-center space-x-2">
                    <input
                      type="checkbox"
                      checked={formData.isDefault}
                      onChange={(e) => setFormData(prev => ({ ...prev, isDefault: e.target.checked }))}
                      className="rounded border-gray-300 text-blue-600 focus:ring-blue-500 focus:ring-2 h-4 w-4"
                    />
                    <span className="text-sm font-medium text-gray-900">Set as default location</span>
                  </label>
                  <div className="text-xs text-gray-500 mt-1 ml-6">
                    <p>Default locations don&apos;t require specific timeframes and will be used as your primary location.</p>
                    <p className="mt-1"><strong>Tip:</strong> You can only have one default location. Setting this will update your current default.</p>
                  </div>
                </div>

                {!formData.isDefault && (
                  <>
                    <div className="bg-yellow-50 rounded-md p-3 border border-yellow-200">
                      <div className="flex items-start space-x-2">
                        <svg className="w-4 h-4 text-yellow-600 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.732 16.5c-.77.833.192 2.5 1.732 2.5z" />
                        </svg>
                        <div className="text-xs text-yellow-800">
                          <p className="font-medium">Scheduled Location</p>
                          <p>This location requires specific start and end dates. You can add complex schedules after creating the location.</p>
                        </div>
                      </div>
                    </div>
                    
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-900 mb-1">
                        Start Date *
                      </label>
                      <input
                        type="date"
                        value={formData.startDate}
                        onChange={(e) => setFormData(prev => ({ ...prev, startDate: e.target.value }))}
                        className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm text-gray-900 bg-white focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
                        required
                      />
                    </div>
                    
                    <div>
                      <label className="block text-sm font-medium text-gray-900 mb-1">
                        End Date *
                      </label>
                      <input
                        type="date"
                        value={formData.endDate}
                        onChange={(e) => setFormData(prev => ({ ...prev, endDate: e.target.value }))}
                        className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm text-gray-900 bg-white focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
                        required
                      />
                    </div>
                  </div>
                  </>
                )}

                <div className="flex gap-3 pt-4">
                  <button
                    type="submit"
                    disabled={isSubmitting}
                    className="bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed font-medium"
                  >
                    {isSubmitting ? (editingId ? 'Updating...' : 'Adding...') : (editingId ? 'Update Location' : 'Add Location')}
                  </button>
                  <button
                    type="button"
                    onClick={handleCancel}
                    className="bg-gray-300 text-gray-700 px-4 py-2 rounded-md hover:bg-gray-400 font-medium"
                  >
                    Cancel
                  </button>
                </div>
              </form>
            </div>
          )}

          {locations.length === 0 && !showForm ? (
            <div className="text-center py-8">
              <div className="text-gray-400 text-5xl mb-4">📍</div>
              <h3 className="text-lg font-medium text-gray-900 mb-2">No locations added yet</h3>
              <p className="text-gray-600 mb-6">Get started by adding your first location</p>
              
              {/* Quick Start Guide */}
              <div className="bg-gray-50 rounded-lg p-6 mb-6 text-left max-w-2xl mx-auto">
                <h4 className="font-semibold text-gray-900 mb-3">Quick Start Guide:</h4>
                <div className="space-y-3 text-sm text-gray-700">
                  <div className="flex items-start space-x-3">
                    <span className="bg-blue-100 text-blue-800 font-medium px-2 py-1 rounded text-xs">1</span>
                    <div>
                      <p className="font-medium">Add your primary location</p>
                      <p className="text-gray-600">Start with your main office or workspace as a default location</p>
                    </div>
                  </div>
                  <div className="flex items-start space-x-3">
                    <span className="bg-blue-100 text-blue-800 font-medium px-2 py-1 rounded text-xs">2</span>
                    <div>
                      <p className="font-medium">Add scheduled locations (optional)</p>
                      <p className="text-gray-600">Set up additional locations where you work on specific days or time periods</p>
                    </div>
                  </div>
                  <div className="flex items-start space-x-3">
                    <span className="bg-blue-100 text-blue-800 font-medium px-2 py-1 rounded text-xs">3</span>
                    <div>
                      <p className="font-medium">Configure schedules</p>
                      <p className="text-gray-600">Use &quot;Manage Schedules&quot; to set up recurring patterns or multiple time periods for a specific location</p>
                    </div>
                  </div>
                </div>
              </div>
              
              <button
                onClick={() => setShowForm(true)}
                className="bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700 font-medium"
              >
                Add Your First Location
              </button>
            </div>
          ) : (
            <div className="space-y-4">
              {locations.map((location) => (
                <div key={location.id} className="space-y-4">
                  <div className={`border rounded-lg p-4 hover:bg-gray-50 ${
                    location.isDefault ? 'border-blue-300 bg-blue-50' : 'border-gray-200'
                  }`}>
                    <div className="flex flex-col lg:flex-row lg:justify-between lg:items-start gap-4">
                      <div className="flex-1 min-w-0">
                        <div className="flex flex-wrap items-center gap-2 mb-2">
                          <h3 className="font-semibold text-gray-900 break-words">
                            {location.city}, {location.stateProvince}, {location.country}
                          </h3>
                          {location.isDefault && (
                            <span className="px-2 py-1 text-xs rounded-full bg-blue-100 text-blue-800 font-medium whitespace-nowrap">
                              ⭐ Default
                            </span>
                          )}
                          <span className={`px-2 py-1 text-xs rounded-full whitespace-nowrap ${
                            location.isActive ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'
                          }`}>
                            {location.isActive ? 'Active' : 'Inactive'}
                          </span>
                        </div>
                        
                        {location.description && (
                          <p className="text-gray-600 text-sm mb-2 break-words">{location.description}</p>
                        )}
                        
                        <div className="text-sm text-gray-500">
                          {location.isDefault ? (
                            <span>Permanent location</span>
                          ) : (
                            <span className="break-words">📅 {new Date(location.startDate).toLocaleDateString()} - {new Date(location.endDate).toLocaleDateString()}</span>
                          )}
                        </div>
                      </div>
                      
                      <div className="flex flex-wrap gap-2 lg:ml-4">
                        <button
                          onClick={() => {
                            const isExpanded = selectedLocationId === location.id;
                            setSelectedLocationId(isExpanded ? null : location.id);
                            if (!isExpanded && !locationSchedules[location.id]) {
                              fetchLocationSchedules(location.id);
                            }
                          }}
                          className="text-purple-600 hover:text-purple-800 font-medium text-sm whitespace-nowrap"
                        >
                          {selectedLocationId === location.id ? 'Hide Schedules' : 'Manage Schedules'}
                        </button>
                        {!location.isDefault && (
                          <button
                            onClick={() => handleSetDefault(location.id)}
                            className="text-orange-600 hover:text-orange-800 font-medium text-sm whitespace-nowrap"
                          >
                            Set Default
                          </button>
                        )}
                        <button
                          onClick={() => handleEdit(location)}
                          className="text-blue-600 hover:text-blue-800 font-medium text-sm whitespace-nowrap"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => handleDelete(location.id)}
                          className="text-red-600 hover:text-red-800 font-medium text-sm whitespace-nowrap"
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  </div>
                  
                  {/* Schedule Management Section */}
                  {selectedLocationId === location.id && (
                    <div className="ml-6 p-4 bg-gray-50 rounded-lg border-l-4 border-purple-200">
                      <LocationSchedules
                        schedules={locationSchedules[location.id] || []}
                        onScheduleAdd={(scheduleData) => handleScheduleAdd(location.id, scheduleData)}
                        onScheduleEdit={(scheduleId, scheduleData) => handleScheduleEdit(location.id, scheduleId, scheduleData)}
                        onScheduleDelete={(scheduleId) => handleScheduleDelete(location.id, scheduleId)}
                      />
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
  );
}