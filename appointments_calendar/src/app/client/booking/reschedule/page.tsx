'use client';

import React, { useEffect, useState, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import Nav from '@/components/Nav';
import { format, addDays } from 'date-fns';

interface BookingDetails {
  id: string;
  scheduledAt: string;
  duration: number;
  serviceType: string;
  notes?: string;
  customer: {
    firstName: string | null;
    lastName: string | null;
    email: string;
  };
  provider: {
    id: string;
    name: string;
    email: string;
  };
}

interface TimeSlot {
  id: string;
  eventId: string;
  startTime: string; // ISO datetime string
  endTime: string; // ISO datetime string
  duration: number;
  provider: { id: string; name: string };
  location: { display: string };
  availableServices: string[];
  eventTitle: string;
  slotsRemaining: number;
  type: string;
}

export default function ReschedulePage() {
  return (
    <Suspense fallback={<div className="p-6">Loading...</div>}>
      <RescheduleContent />
    </Suspense>
  );
}

function RescheduleContent() {
  const searchParams = useSearchParams();
  const token = searchParams.get('token');

  const [booking, setBooking] = useState<BookingDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedDate, setSelectedDate] = useState<string>('');
  const [selectedSlot, setSelectedSlot] = useState<TimeSlot | null>(null);
  const [availableSlots, setAvailableSlots] = useState<TimeSlot[]>([]);
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);

  // Load booking details
  useEffect(() => {
    if (!token) {
      setError('Invalid reschedule link. No token provided.');
      setLoading(false);
      return;
    }

    fetch(`/api/client/booking/details?token=${encodeURIComponent(token)}`)
      .then(res => res.json())
      .then(data => {
        if (data.error) {
          setError(data.error);
        } else {
          setBooking(data.booking);
        }
      })
      .catch(err => {
        console.error('Failed to load booking:', err);
        setError('Failed to load booking details');
      })
      .finally(() => setLoading(false));
  }, [token]);

  // Load available slots when date is selected
  useEffect(() => {
    if (!selectedDate || !booking) return;

    setLoadingSlots(true);
    setSelectedSlot(null);

    fetch(`/api/client/slots-on-demand?providerId=${booking.provider.id}&date=${selectedDate}&duration=${booking.duration}`)
      .then(res => res.json())
      .then(data => {
        if (data.slots) {
          setAvailableSlots(data.slots);
        } else {
          setAvailableSlots([]);
        }
      })
      .catch(err => {
        console.error('Failed to load slots:', err);
        setAvailableSlots([]);
      })
      .finally(() => setLoadingSlots(false));
  }, [selectedDate, booking]);

  const handleReschedule = async () => {
    if (!token || !selectedSlot || !selectedDate) {
      return;
    }

    setSubmitting(true);
    try {
      // selectedSlot.startTime is already a full ISO datetime string from the API
      const newDateTime = new Date(selectedSlot.startTime);

      const response = await fetch('/api/client/booking/reschedule', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token,
          newDateTime: newDateTime.toISOString(),
        }),
      });

      const data = await response.json();
      if (data.success) {
        setSuccess(true);
      } else {
        setError(data.error || 'Failed to reschedule appointment');
      }
    } catch (err) {
      console.error('Reschedule error:', err);
      setError('Failed to process reschedule request');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-600">Loading booking details...</p>
        </div>
      </div>
    );
  }

  if (error && !booking) {
    return (
      <>
        <Nav type="public" />
        <div className="min-h-screen flex items-center justify-center bg-gray-50">
          <div className="max-w-md p-6 bg-white rounded-lg shadow">
            <div className="text-center">
              <div className="mx-auto h-16 w-16 flex items-center justify-center rounded-full bg-red-100 mb-4">
                <svg className="h-8 w-8 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </div>
              <h2 className="text-2xl font-bold text-gray-900 mb-2">Error</h2>
              <p className="text-gray-600">{error}</p>
            </div>
          </div>
        </div>
      </>
    );
  }

  if (success) {
    return (
      <>
        <Nav type="public" />
        <div className="min-h-screen flex items-center justify-center bg-gray-50">
          <div className="max-w-md p-6 bg-white rounded-lg shadow">
            <div className="text-center">
              <div className="mx-auto h-16 w-16 flex items-center justify-center rounded-full bg-green-100 mb-4">
                <svg className="h-8 w-8 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <h2 className="text-2xl font-bold text-gray-900 mb-2">Reschedule Request Sent!</h2>
              <p className="text-gray-600">
                Your reschedule request has been submitted. The provider will review and confirm your new appointment time.
                You&apos;ll receive an email notification once it&apos;s been confirmed.
              </p>
            </div>
          </div>
        </div>
      </>
    );
  }

  if (!booking) return null;

  // Generate next 14 days for date selection
  const availableDates = Array.from({ length: 14 }, (_, i) => {
    const date = addDays(new Date(), i + 1);
    return format(date, 'yyyy-MM-dd');
  });

  return (
    <>
      <Nav type="public" />
      <div className="min-h-screen bg-gray-50 py-12 px-4 sm:px-6 lg:px-8">
        <div className="max-w-3xl mx-auto">
          <div className="bg-white shadow rounded-lg p-6">
            <h1 className="text-3xl font-bold text-gray-900 mb-6">Reschedule Appointment</h1>

            {/* Current Booking Details */}
            <div className="mb-8 p-4 bg-blue-50 border border-blue-200 rounded-lg">
              <h2 className="text-lg font-semibold text-gray-900 mb-3">Current Appointment</h2>
              <div className="space-y-2 text-sm text-gray-700">
                <p><strong>Provider:</strong> {booking.provider.name}</p>
                <p><strong>Service:</strong> {booking.serviceType}</p>
                <p><strong>Current Date & Time:</strong> {new Date(booking.scheduledAt).toLocaleString()}</p>
                <p><strong>Duration:</strong> {booking.duration} minutes</p>
                {booking.notes && <p><strong>Notes:</strong> {booking.notes}</p>}
              </div>
            </div>

            {error && (
              <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg">
                <p className="text-red-800">{error}</p>
              </div>
            )}

            {/* Date Selection */}
            <div className="mb-6">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Select New Date
              </label>
              <select
                value={selectedDate}
                onChange={(e) => setSelectedDate(e.target.value)}
                className="w-full px-4 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              >
                <option value="">Choose a date...</option>
                {availableDates.map(date => (
                  <option key={date} value={date}>
                    {format(new Date(date), 'EEEE, MMMM d, yyyy')}
                  </option>
                ))}
              </select>
            </div>

            {/* Time Slot Selection */}
            {selectedDate && (
              <div className="mb-6">
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Select New Time
                </label>
                {loadingSlots ? (
                  <div className="text-center py-8">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto"></div>
                    <p className="text-gray-600 mt-2">Loading available times...</p>
                  </div>
                ) : availableSlots.length === 0 ? (
                  <p className="text-gray-500 py-4">No available time slots for this date.</p>
                ) : (
                  <div className="grid grid-cols-3 gap-2">
                    {availableSlots.map((slot, idx) => {
                      const slotTime = new Date(slot.startTime).toLocaleTimeString('en-US', {
                        hour: 'numeric',
                        minute: '2-digit',
                        hour12: true
                      });
                      return (
                        <button
                          key={idx}
                          onClick={() => setSelectedSlot(slot)}
                          className="px-4 py-2 rounded text-sm font-medium transition-colors bg-white border border-gray-300 text-gray-700 hover:bg-gray-50 data-[selected=true]:bg-blue-600 data-[selected=true]:text-white"
                          data-selected={selectedSlot?.startTime === slot.startTime}
                        >
                          {slotTime}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {/* Submit Button */}
            {selectedDate && selectedSlot && (
              <div className="flex justify-end space-x-4">
                <button
                  onClick={() => window.history.back()}
                  className="px-6 py-2 border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleReschedule}
                  disabled={submitting}
                  className="px-6 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors disabled:opacity-50"
                >
                  {submitting ? 'Submitting...' : 'Confirm Reschedule'}
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
