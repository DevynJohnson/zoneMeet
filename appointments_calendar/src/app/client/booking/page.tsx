'use client';

import React, { useEffect, useState, useCallback, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import Nav from '@/components/Nav';
import { secureFetch } from '@/lib/csrf';

interface AvailabilityDay {
  date: string;
  dayOfWeek: string;
  hasAvailability: boolean;
  availableDurations: number[];
  timeWindows: Array<{ start: string; end: string }>;
  location?: {
    city: string;
    stateProvince: string;
    country: string;
    description?: string;
    addressLine1?: string;
    addressLine2?: string;
  } | null;
}

interface Slot {
  id: string;
  eventId: string;
  startTime: string;
  endTime: string;
  duration: number;
  provider: {
    id: string;
    name: string;
  };
  location: {
    display: string;
  };
  availableServices: string[];
  eventTitle: string;
  slotsRemaining: number;
  type?: string; // 'automatic' or 'manual'
}

interface BookingFormData {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  serviceType: string;
  notes: string;
}

export default function ClientBooking() {
  return (
    <Suspense fallback={<div className="p-6">Loading booking page...</div>}>
      <ClientBookingContent />
    </Suspense>
  );
}

function ClientBookingContent() {
  const searchParams = useSearchParams();
  const urlProviderId = searchParams.get('providerId');
  
  const [slots, setSlots] = useState<Slot[]>([]);
  const [availabilityPreview, setAvailabilityPreview] = useState<AvailabilityDay[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [providerInfo, setProviderInfo] = useState<{ id: string; name: string; timezone?: string } | null>(null);
  const [providerLocations, setProviderLocations] = useState<Array<{
    id: string;
    addressLine1?: string;
    addressLine2?: string;
    city: string;
    stateProvince: string;
    country: string;
    description?: string;
  }>>([]);
  const [filters, setFilters] = useState({
    providerId: urlProviderId || '',
    selectedLocation: '',
    daysAhead: '14', // Default to 2 weeks for better UX
    mode: 'auto', // Use automatic slots - calendar events are treated as busy time
  });
  const [selectedSlot, setSelectedSlot] = useState<Slot | null>(null);
  const [selectedTimeByDate, setSelectedTimeByDate] = useState<Record<string, string>>({});
  const [selectedDurationByDate, setSelectedDurationByDate] = useState<Record<string, number>>({});
  const [bookingForm, setBookingForm] = useState<BookingFormData>(() => {
    // Load saved form data from localStorage if available
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('bookingFormData');
      if (saved) {
        try {
          return JSON.parse(saved);
        } catch {
          // If parsing fails, use defaults
        }
      }
    }
    return {
      firstName: '',
      lastName: '',
      email: '',
      phone: '',
      serviceType: 'consultation',
      notes: '',
    };
  });
  const [isBooking, setIsBooking] = useState(false);
  const [slotCounts, setSlotCounts] = useState<Record<string, Record<number, number>>>({});

  // Batch check slot counts for all dates and durations via single API call
  const checkSlotAvailability = useCallback(async (availability: AvailabilityDay[]) => {
    const startTime = Date.now();
    
    // Extract dates and durations from availability data
    const dates = availability
      .filter(day => day.hasAvailability)
      .map(day => day.date);
    
    if (dates.length === 0) {
      setSlotCounts({});
      return;
    }
    
    // Get unique durations across all days
    const durationSet = new Set<number>();
    availability.forEach(day => {
      day.availableDurations.forEach(d => durationSet.add(d));
    });
    const durations = Array.from(durationSet);

    console.log(`🔍 Checking availability for ${dates.length} dates × ${durations.length} durations...`);

    try {
      const response = await secureFetch('/api/client/batch-slot-availability', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          providerId: filters.providerId,
          dates,
          durations,
        }),
      });

      const data = await response.json();
      
      if (data.success) {
        setSlotCounts(data.slotCounts);
        const endTime = Date.now();
        console.log(`✅ Batch availability check: ${data.message} (client total: ${endTime - startTime}ms)`);
      } else {
        console.error('Failed to check batch availability:', data.error);
        setSlotCounts({});
      }
    } catch (error) {
      console.error('Error checking batch availability:', error);
      setSlotCounts({});
    }
  }, [filters.providerId]);

  const fetchAvailabilityPreview = useCallback(async () => {
    if (!filters.providerId) {
      if (urlProviderId) {
        setFilters(prev => ({ ...prev, providerId: urlProviderId }));
        return;
      } else {
        setLoading(false);
        return;
      }
    }

    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.append('providerId', filters.providerId);
      params.append('daysAhead', filters.daysAhead);

      const response = await fetch(`/api/client/availability-preview?${params}`);
      const data = await response.json();
      
      if (data.success) {
        setAvailabilityPreview(data.availability);
        setProviderInfo(data.provider);
        
        // Extract unique locations from availability data
        const uniqueLocations = new Map();
        data.availability.forEach((day: AvailabilityDay) => {
          if (day.location) {
            const locationKey = `${day.location.city}-${day.location.stateProvince}`;
            if (!uniqueLocations.has(locationKey)) {
              uniqueLocations.set(locationKey, {
                id: locationKey,
                addressLine1: day.location.addressLine1,
                addressLine2: day.location.addressLine2,
                city: day.location.city,
                stateProvince: day.location.stateProvince,
                country: day.location.country,
                description: day.location.description,
              });
            }
          }
        });
        setProviderLocations(Array.from(uniqueLocations.values()));
        
        // Check actual slot availability using batch API (fast!)
        await checkSlotAvailability(data.availability);
      } else {
        console.error('Failed to fetch availability preview');
        setAvailabilityPreview([]);
      }
    } catch (error) {
      console.error('Error fetching availability preview:', error);
      setAvailabilityPreview([]);
    } finally {
      setLoading(false);
    }
  }, [filters, urlProviderId, checkSlotAvailability]);

  const fetchSlotsForDateAndDuration = async (date: string, duration: number) => {
    setLoadingSlots(true);
    try {
      const params = new URLSearchParams();
      params.append('providerId', filters.providerId);
      params.append('date', date);
      params.append('duration', duration.toString());

      console.log('Fetching slots for:', { providerId: filters.providerId, date, duration });

      const response = await fetch(`/api/client/slots-on-demand?${params}`);
      const data = await response.json();
      
      console.log('Slots API response:', data);
      
      if (data.success) {
        return data.slots;
      } else {
        console.error('Failed to fetch slots:', data.error);
        return [];
      }
    } catch (error) {
      console.error('Error fetching slots:', error);
      return [];
    } finally {
      setLoadingSlots(false);
    }
  };

  useEffect(() => {
    fetchAvailabilityPreview();
  }, [fetchAvailabilityPreview]);

  const handleBookingSubmit = async () => {
  if (!selectedSlot) return;

  console.log('🔍 BOOKING SUBMISSION DEBUG');
  console.log('Selected slot:', selectedSlot);
  console.log('Slot start time:', selectedSlot.startTime);
  console.log('Slot type:', selectedSlot.type);

  setIsBooking(true);
  try {
    const isAutoSlot = selectedSlot.eventTitle === 'Available Appointment' || 
                      selectedSlot.eventId?.startsWith('auto-') ||
                      selectedSlot.type === 'automatic';
    
    const payload = {
      eventId: isAutoSlot ? null : selectedSlot.eventId,
      providerId: selectedSlot.provider.id,
      scheduledAt: selectedSlot.startTime,
      duration: selectedSlot.duration,
      slotType: isAutoSlot ? 'automatic' : 'manual',
      customer: {
        firstName: bookingForm.firstName,
        lastName: bookingForm.lastName,
        email: bookingForm.email,
        phone: bookingForm.phone,
      },
      serviceType: bookingForm.serviceType,
      notes: bookingForm.notes,
    };
    
    console.log('📤 Payload being sent:', payload);

    // ADD THIS LINE - the actual fetch call
    const response = await secureFetch('/api/client/book-appointment', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    const data = await response.json();
    
    if (data.success) {
      alert(data.message || 'Booking request submitted! Please check your email for a confirmation link.');
      
      // Save form data (except notes) to localStorage for future bookings
      const dataToSave = {
        ...bookingForm,
        notes: '', // Don't save notes
      };
      localStorage.setItem('bookingFormData', JSON.stringify(dataToSave));
      
      setSelectedSlot(null);
      setBookingForm({
        ...bookingForm,
        notes: '', // Clear only notes after successful booking
      });
      fetchAvailabilityPreview();
    } else {
      alert(`Booking failed: ${data.error}`);
    }
  } catch (error) {
    console.error('Booking error:', error);
    alert('Failed to book appointment. Please try again.');
  } finally {
    setIsBooking(false);
  }
};

  const copyBookingLink = () => {
    const currentUrl = window.location.href;
    navigator.clipboard.writeText(currentUrl).then(() => {
      alert('Booking link copied to clipboard!');
    }).catch(() => {
      prompt('Copy this booking link:', currentUrl);
    });
  };

  const formatDateTime = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });
  };

  const formatTimeInUserTimezone = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });
  };

  const handleDurationSelection = async (dateKey: string, duration: number) => {
    console.log('Duration selected:', { dateKey, duration });
    setSelectedDurationByDate(prev => ({ ...prev, [dateKey]: duration }));
    // Reset time selection when duration changes
    setSelectedTimeByDate(prev => ({ ...prev, [dateKey]: '' }));
    // Fetch slots for this date and duration
    const slotsForSelection = await fetchSlotsForDateAndDuration(dateKey, duration);
    console.log('Fetched slots:', slotsForSelection);
    // Store slots for this specific date/duration combination
    setSlots(prev => {
      // Remove any existing slots for this date/duration and add new ones
      const filtered = prev.filter(slot => 
        !(slot.startTime.split('T')[0] === dateKey && slot.duration === duration)
      );
      return [...filtered, ...slotsForSelection];
    });
  };

  const handleTimeSelection = (dateKey: string, slotId: string) => {
    setSelectedTimeByDate(prev => ({ ...prev, [dateKey]: slotId }));
    const slot = slots.find(s => s.id === slotId);
    if (slot) {
      setSelectedSlot(slot);
      if (slot.availableServices.length === 1) {
        setBookingForm(prev => ({ ...prev, serviceType: slot.availableServices[0] }));
      }
    }
  };

  // Filter availability based on selected location and actual slot counts
  const filteredAvailability = availabilityPreview.filter(day => {
    if (!day.hasAvailability) return false;
    
    // Check if this date has any available slots across all durations
    const dateSlotCounts = slotCounts[day.date];
    if (dateSlotCounts) {
      const hasAnySlots = Object.values(dateSlotCounts).some(count => count > 0);
      if (!hasAnySlots) {
        console.log(`Filtering out ${day.date} - no slots available for any duration`);
        return false;
      }
    }
    
    // If no location is selected, show all days
    if (!filters.selectedLocation) return true;
    
    // If a location is selected, only show days that match
    if (day.location) {
      const dayLocationKey = `${day.location.city}-${day.location.stateProvince}`;
      return dayLocationKey === filters.selectedLocation;
    }
    
    return false;
  });

  return (
    <>
      <Nav type="public" />
      <div className="max-w-4xl mx-auto py-8 px-4">
      {/* Header */}
      <div className="mb-8">
        <div className="flex justify-between items-start">
          <div>
            <h1 className="text-3xl font-bold">Book an Appointment</h1>
            {providerInfo && (
              <p className="text-lg text-gray-800 mt-1">with {providerInfo.name}</p>
            )}
            {!urlProviderId && (
              <p className="text-gray-700 mt-2">Select a provider to see available appointments</p>
            )}
          </div>
          <div className="flex gap-2">
            {urlProviderId && (
              <button
                onClick={copyBookingLink}
                className="bg-gray-100 text-gray-700 px-3 py-2 rounded hover:bg-gray-200 text-sm"
              >
                📋 Share
              </button>
            )}
            <a
              href="/client/search"
              className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700 text-sm"
            >
              {urlProviderId ? '🔍 Find Other Providers' : '🔍 Find a Provider'}
            </a>
          </div>
        </div>
      </div>

      {!urlProviderId ? (
        /* No Provider Selected - Show Search Prompt */
        <div className="text-center py-12">
          <div className="mb-6">
            <div className="mx-auto w-16 h-16 bg-blue-100 rounded-full flex items-center justify-center mb-4">
              <span className="text-2xl">🔍</span>
            </div>
            <h2 className="text-2xl font-semibold mb-2">Find Your Provider</h2>
            <p className="text-gray-800 max-w-md mx-auto">
              Search for service providers by name, company, or location to book an appointment.
            </p>
          </div>
          <a
            href="/client/search"
            className="inline-block bg-blue-600 text-white px-6 py-3 rounded-lg hover:bg-blue-700 font-medium"
          >
            Search Providers →
          </a>
        </div>
      ) : (
        <>
          {/* Simple Filters for Clients */}
          <div className="mb-6 p-4 bg-gray-50 rounded-lg">
            <h2 className="text-lg font-semibold mb-3">Customize Your Search</h2>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium mb-1">Provider Location</label>
                <select
                  value={filters.selectedLocation}
                  onChange={(e) => setFilters(prev => ({ ...prev, selectedLocation: e.target.value }))}
                  className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">All Locations</option>
                  {providerLocations.map((location) => (
                    <option key={location.id} value={location.id}>
                      {location.city}, {location.stateProvince}
                      {location.description && ` (${location.description})`}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Time Period</label>
                <select
                  value={filters.daysAhead}
                  onChange={(e) => setFilters(prev => ({ ...prev, daysAhead: e.target.value }))}
                  className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="7">Next week</option>
                  <option value="14">Next 2 weeks</option>
                  <option value="30">Next month</option>
                </select>
              </div>
            </div>
          </div>

          {/* Results */}
          {loading ? (
            <div className="text-center py-8">
              <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
              <p className="mt-2">Finding available appointments...</p>
              <p className="text-sm text-gray-600 mt-1">Checking slot availability across all dates...</p>
            </div>
          ) : filteredAvailability.length === 0 ? (
            <div className="text-center py-8 bg-white rounded-lg border">
              <div className="mb-4">
                <span className="text-4xl">📅</span>
              </div>
              <h3 className="text-lg font-semibold mb-2">No Available Appointments</h3>
              <p className="text-gray-800 mb-4">
                No appointments are currently available for the selected {filters.selectedLocation ? 'location and ' : ''}time period.
              </p>
              <div className="space-y-2">
                {filters.selectedLocation && (
                  <button
                    onClick={() => setFilters(prev => ({ ...prev, selectedLocation: '' }))}
                    className="block mx-auto bg-green-100 text-green-700 px-4 py-2 rounded hover:bg-green-200 text-sm"
                  >
                    Show all locations
                  </button>
                )}
                <button
                  onClick={() => setFilters(prev => ({ ...prev, daysAhead: '30' }))}
                  className="block mx-auto bg-blue-100 text-blue-700 px-4 py-2 rounded hover:bg-blue-200 text-sm"
                >
                  Try looking further ahead
                </button>
                <a
                  href="/client/search"
                  className="block text-blue-600 hover:underline text-sm"
                >
                  Or find a different provider
                </a>
              </div>
            </div>
          ) : (
            <div>
              <div className="mb-4 flex justify-between items-center">
                <p className="text-sm text-gray-800">
                  {filteredAvailability.length} day{filteredAvailability.length !== 1 ? 's' : ''} with availability
                  {filters.selectedLocation && (
                    <span className="ml-2 text-gray-600">
                      at {providerLocations.find(loc => loc.id === filters.selectedLocation)?.city}, {providerLocations.find(loc => loc.id === filters.selectedLocation)?.stateProvince}
                    </span>
                  )}
                </p>
                <div className="text-xs text-gray-700">
                  Showing next {filters.daysAhead} days
                </div>
              </div>
              
              <div className="space-y-4">
                {filteredAvailability.map((dayInfo) => {
                  const dateKey = dayInfo.date;
                  const selectedDuration = selectedDurationByDate[dateKey];
                  const availableSlotsForDay = slots.filter(slot => {
  // Convert UTC time to local date for comparison
  const slotDate = new Date(slot.startTime).toLocaleDateString('en-CA'); // YYYY-MM-DD format
  const durationMatch = !selectedDuration || slot.duration === selectedDuration;
  return slotDate === dateKey && durationMatch;
});
                  
                  console.log('Available slots for day:', { dateKey, selectedDuration, availableSlotsForDay });
                  
                  return (
                    <div key={dateKey} className="bg-white border rounded-lg p-4">
                      <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-4">
                        <div className="flex-1">
                          <h3 className="font-semibold text-lg text-gray-900 mb-2">
                            {dayInfo.dayOfWeek}, {(() => {
                              // Parse the YYYY-MM-DD date string as local date to avoid timezone shifts
                              const [year, month, day] = dayInfo.date.split('-').map(Number);
                              const localDate = new Date(year, month - 1, day); // month is 0-indexed
                              return localDate.toLocaleDateString('en-US', { 
                                month: 'long', 
                                day: 'numeric' 
                              });
                            })()}
                            {dayInfo.location && (
                              <span className="ml-3 text-sm font-normal text-gray-600">
                                📍 {dayInfo.location.city}, {dayInfo.location.stateProvince}
                                {dayInfo.location.description && (
                                  <span className="ml-1">({dayInfo.location.description})</span>
                                )}
                              </span>
                            )}
                          </h3>
                          
                         
                  
                          <div className="space-y-4">
                            {/* Duration Selection */}
                            <div>
                              <label className="block text-sm font-medium text-gray-700 mb-2">
                                Appointment Duration:
                              </label>
                             <select
  value={selectedDuration || ''}
  onChange={(e) => handleDurationSelection(dateKey, parseInt(e.target.value))}
  className="w-full md:w-64 px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
>
  {!selectedDuration && <option value="">Choose duration...</option>}
  {dayInfo.availableDurations
    .filter((duration: number) => {
      // Only show durations that have available slots
      const dateSlotCounts = slotCounts[dateKey];
      return !dateSlotCounts || dateSlotCounts[duration] > 0;
    })
    .map((duration: number) => {
      const dateSlotCounts = slotCounts[dateKey];
      const slotCount = dateSlotCounts?.[duration];
      return (
        <option key={duration} value={duration}>
          {duration} minutes{slotCount ? ` (${slotCount} available)` : ''}
        </option>
      );
    })
  }
</select>
                            </div>

                            {/* Time Selection - Show loading or slots */}
                            {selectedDuration && (
                              <div>
                                <label className="block text-sm font-medium text-gray-700 mb-2">
                                  Select a time:
                                </label>
                                {loadingSlots ? (
                                  <div className="flex items-center space-x-2">
                                    <div className="inline-block animate-spin rounded-full h-4 w-4 border-b-2 border-blue-600"></div>
                                    <span className="text-sm text-gray-600">Loading available times...</span>
                                  </div>
                                ) : (
                                  <select
                                    value={selectedTimeByDate[dateKey] || ''}
                                    onChange={(e) => handleTimeSelection(dateKey, e.target.value)}
                                    className="w-full md:w-64 px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                                  >
                                    <option value="">Choose a time...</option>
                                    {(() => {
                                      return availableSlotsForDay.map(slot => {
                                        return (
                                          <option key={slot.id} value={slot.id}>
                                            {formatTimeInUserTimezone(slot.startTime)}
                                            {slot.slotsRemaining > 1 && ` (${slot.slotsRemaining} slots available)`}
                                          </option>
                                        );
                                      });
                                    })()}
                                  </select>
                                )}
                              </div>
                            )}
                          </div>
                          
                          {selectedTimeByDate[dateKey] && (
                            <div className="mt-4 p-3 bg-blue-50 rounded-md">
                              {(() => {
                                const selectedSlotForDay = availableSlotsForDay.find(s => s.id === selectedTimeByDate[dateKey]);
                                return selectedSlotForDay ? (
                                  <>
                                    <p className="text-sm font-medium text-blue-900">
                                      Selected: {formatTimeInUserTimezone(selectedSlotForDay.startTime)} - {formatTimeInUserTimezone(selectedSlotForDay.endTime)}
                                    </p>
                                    <p className="text-xs text-blue-700 mt-1">
                                      {selectedSlotForDay.duration} minutes • {selectedSlotForDay.eventTitle}
                                    </p>
                                  </>
                                ) : null;
                              })()}
                            </div>
                          )}
                        </div>
                        
                        <div className="md:ml-4">
                          <button
                            onClick={() => {
                              const selectedSlotId = selectedTimeByDate[dateKey];
                              if (selectedSlotId) {
                                handleTimeSelection(dateKey, selectedSlotId);
                              }
                            }}
                            disabled={!selectedTimeByDate[dateKey]}
                            className="w-full md:w-auto bg-blue-600 text-white px-6 py-2 rounded-lg hover:bg-blue-700 font-medium disabled:bg-gray-300 disabled:cursor-not-allowed"
                          >
                            Book Selected Time
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </>
      )}

      {/* Booking Modal */}
      {selectedSlot && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg max-w-md w-full max-h-[90vh] overflow-y-auto">
            <div className="p-6">
              <div className="flex justify-between items-start mb-4">
                <h2 className="text-xl font-semibold">Book Appointment</h2>
                <button
                  onClick={() => setSelectedSlot(null)}
                  className="text-gray-600 hover:text-gray-800"
                >
                  ✕
                </button>
              </div>
              
              <div className="bg-blue-50 p-3 rounded mb-4">
                <p className="font-medium">{formatDateTime(selectedSlot.startTime)}</p>
                <p className="text-sm text-gray-800">
                  {selectedSlot.duration} minutes with {selectedSlot.provider.name}
                </p>
              </div>

              <form onSubmit={(e) => { e.preventDefault(); handleBookingSubmit(); }} className="space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-sm font-medium mb-1">First Name *</label>
                    <input
                      type="text"
                      required
                      autoComplete="given-name"
                      value={bookingForm.firstName}
                      onChange={(e) => setBookingForm(prev => ({ ...prev, firstName: e.target.value }))}
                      className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-1">Last Name *</label>
                    <input
                      type="text"
                      required
                      autoComplete="family-name"
                      value={bookingForm.lastName}
                      onChange={(e) => setBookingForm(prev => ({ ...prev, lastName: e.target.value }))}
                      className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium mb-1">Email *</label>
                  <input
                    type="email"
                    required
                    autoComplete="email"
                    value={bookingForm.email}
                    onChange={(e) => setBookingForm(prev => ({ ...prev, email: e.target.value }))}
                    className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium mb-1">Phone (Optional)</label>
                  <input
                    type="tel"
                    autoComplete="tel"
                    value={bookingForm.phone}
                    onChange={(e) => setBookingForm(prev => ({ ...prev, phone: e.target.value }))}
                    className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium mb-1">Service Type</label>
                  <select
                    value={bookingForm.serviceType}
                    onChange={(e) => setBookingForm(prev => ({ ...prev, serviceType: e.target.value }))}
                    className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="consultation">Consultation</option>
                    <option value="maintenance">Maintenance</option>
                    <option value="emergency">Emergency</option>
                    <option value="follow-up">Follow-up</option>
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium mb-1">Notes (Optional)</label>
                  <textarea
                    value={bookingForm.notes}
                    onChange={(e) => setBookingForm(prev => ({ ...prev, notes: e.target.value }))}
                    rows={3}
                    className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="Any additional information..."
                  />
                </div>

                <div className="flex gap-3 pt-4">
                  <button
                    type="button"
                    onClick={() => setSelectedSlot(null)}
                    className="flex-1 bg-gray-200 text-gray-700 py-2 rounded hover:bg-gray-300"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={isBooking}
                    className="flex-1 bg-blue-600 text-white py-2 rounded hover:bg-blue-700 disabled:opacity-50"
                  >
                    {isBooking ? 'Booking...' : 'Confirm Booking'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}
    </div>
    </>
  );
}
