// Provider Bookings Management Page
'use client';

import { useState, useEffect, useCallback, useRef, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { secureFetch } from '@/lib/csrf';
import { format, addDays } from 'date-fns';
import { useAlert } from '@/contexts/AlertContext';

interface Customer {
  firstName: string | null;
  lastName: string | null;
  email: string;
}

interface Provider {
  id: string;
  name: string;
  email: string;
}

interface Booking {
  id: string;
  scheduledAt: string;
  duration: number;
  serviceType: string;
  notes: string | null;
  status: 'PENDING' | 'CONFIRMED' | 'COMPLETED' | 'CANCELLED';
  customer: Customer;
  provider: Provider;
  createdAt: string;
  updatedAt: string;
}

type BookingStatus = 'ALL' | 'PENDING' | 'CONFIRMED' | 'COMPLETED' | 'CANCELLED';

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

export default function ProviderBookings() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
          <p className="mt-4 text-gray-800">Loading bookings...</p>
        </div>
      </div>
    }>
      <ProviderBookingsContent />
    </Suspense>
  );
}

function ProviderBookingsContent() {
  const { showConfirm } = useAlert();
  const searchParams = useSearchParams();
  const highlightId = searchParams.get('highlight');
  const action = searchParams.get('action');
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [filteredBookings, setFilteredBookings] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [statusFilter, setStatusFilter] = useState<BookingStatus>('ALL');
  const [searchTerm, setSearchTerm] = useState('');
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [rescheduleModal, setRescheduleModal] = useState<Booking | null>(null);
  const [selectedDate, setSelectedDate] = useState<string>('');
  const [selectedSlot, setSelectedSlot] = useState<TimeSlot | null>(null);
  const [availableSlots, setAvailableSlots] = useState<TimeSlot[]>([]);
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [clearAllModal, setClearAllModal] = useState(false);
  const bookingRefs = useRef<{ [key: string]: HTMLDivElement | null }>({});
  const router = useRouter();

  const loadBookings = useCallback(async () => {
    try {
      const token = localStorage.getItem('providerToken');
      if (!token) {
        // Store the current URL to return to after login
        const currentPath = window.location.pathname + window.location.search;
        router.push(`/login?returnTo=${encodeURIComponent(currentPath)}`);
        return;
      }

      const response = await fetch('/api/provider/bookings', {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!response.ok) {
        throw new Error('Failed to load bookings');
      }

      const data = await response.json();
      setBookings(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load bookings');
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => {
    loadBookings();
  }, [loadBookings]);

  // Handle query parameters for highlighting and auto-opening reschedule modal
  useEffect(() => {
    if (highlightId && bookings.length > 0 && !loading) {
      const booking = bookings.find(b => b.id === highlightId);
      if (booking) {
        // Scroll to the highlighted booking
        setTimeout(() => {
          bookingRefs.current[highlightId]?.scrollIntoView({ 
            behavior: 'smooth', 
            block: 'center' 
          });
        }, 100);

        // Auto-open reschedule modal if action is reschedule
        if (action === 'reschedule' && !rescheduleModal) {
          setRescheduleModal(booking);
        }
      }
    }
  }, [highlightId, action, bookings, loading, rescheduleModal]);

  // Filter bookings based on status and search term
  useEffect(() => {
    let filtered = bookings;

    // Filter by status
    if (statusFilter !== 'ALL') {
      filtered = filtered.filter(booking => booking.status === statusFilter);
    }

    // Filter by search term (customer name, email, or service type)
    if (searchTerm) {
      const searchLower = searchTerm.toLowerCase();
      filtered = filtered.filter(booking => {
        const customerName = `${booking.customer.firstName || ''} ${booking.customer.lastName || ''}`.toLowerCase();
        const customerEmail = booking.customer.email.toLowerCase();
        const serviceType = booking.serviceType.toLowerCase();
        
        return customerName.includes(searchLower) || 
               customerEmail.includes(searchLower) || 
               serviceType.includes(searchLower);
      });
    }

    setFilteredBookings(filtered);
  }, [bookings, statusFilter, searchTerm]);

  // Load available slots when date is selected in reschedule modal
  useEffect(() => {
    if (!selectedDate || !rescheduleModal) return;

    setLoadingSlots(true);
    setSelectedSlot(null);

    fetch(`/api/client/slots-on-demand?providerId=${rescheduleModal.provider.id}&date=${selectedDate}&duration=${rescheduleModal.duration}`)
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
  }, [selectedDate, rescheduleModal]);

  const handleBookingAction = async (bookingId: string, action: 'confirm' | 'cancel' | 'reschedule') => {
    // For reschedule, open the modal instead of direct API call
    if (action === 'reschedule') {
      const booking = bookings.find(b => b.id === bookingId);
      if (booking) {
        setRescheduleModal(booking);
      }
      return;
    }

    setActionLoading(bookingId);
    try {
      const token = localStorage.getItem('providerToken');
      const response = await secureFetch(`/api/provider/bookings/${bookingId}/${action}`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        throw new Error(`Failed to ${action} booking`);
      }

      // Reload bookings to reflect changes
      await loadBookings();
    } catch (err) {
      setError(err instanceof Error ? err.message : `Failed to ${action} booking`);
    } finally {
      setActionLoading(null);
    }
  };

  const handleDelete = async (bookingId: string) => {
    showConfirm(
      'Are you sure you want to delete this booking? This action cannot be undone.',
      async () => {
        setActionLoading(bookingId);
        try {
          const token = localStorage.getItem('providerToken');
          const response = await secureFetch(`/api/provider/bookings/${bookingId}`, {
            method: 'DELETE',
            headers: {
              'Authorization': `Bearer ${token}`,
              'Content-Type': 'application/json',
            },
          });

          if (!response.ok) {
            const data = await response.json();
            throw new Error(data.error || 'Failed to delete booking');
          }

          // Reload bookings to reflect changes
          await loadBookings();
        } catch (err) {
          setError(err instanceof Error ? err.message : 'Failed to delete booking');
        } finally {
          setActionLoading(null);
        }
      },
      'Delete Booking'
    );
  };

  const handleClearAll = async () => {
    setClearAllModal(false);
    setActionLoading('clear-all');
    try {
      const token = localStorage.getItem('providerToken');
      const response = await secureFetch('/api/provider/bookings', {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to clear bookings');
      }

      const data = await response.json();
      
      // Reload bookings to reflect changes
      await loadBookings();
      
      // Show success message
      if (data.deletedCount === 0) {
        setError('No old bookings to clear (cancelled or completed).');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to clear bookings');
    } finally {
      setActionLoading(null);
    }
  };

  const handleRescheduleSubmit = async () => {
    if (!rescheduleModal || !selectedDate || !selectedSlot) return;

    setActionLoading(rescheduleModal.id);
    try {
      // selectedSlot.startTime is already a full ISO datetime string from the API
      const newDateTime = new Date(selectedSlot.startTime);

      const token = localStorage.getItem('providerToken');
      const response = await secureFetch(`/api/provider/bookings/${rescheduleModal.id}/reschedule`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          newDateTime: newDateTime.toISOString(),
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to reschedule booking');
      }

      // Close modal and reload bookings
      setRescheduleModal(null);
      setSelectedDate('');
      setSelectedSlot(null);
      await loadBookings();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to reschedule booking');
    } finally {
      setActionLoading(null);
    }
  };

  const formatDateTime = (dateString: string) => {
    const date = new Date(dateString);
    return {
      date: date.toLocaleDateString('en-US', {
        weekday: 'short',
        year: 'numeric',
        month: 'short',
        day: 'numeric'
      }),
      time: date.toLocaleTimeString('en-US', {
        hour: 'numeric',
        minute: '2-digit',
        hour12: true
      })
    };
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'PENDING':
        return 'bg-yellow-100 text-yellow-800 border-yellow-200';
      case 'CONFIRMED':
        return 'bg-green-100 text-green-800 border-green-200';
      case 'COMPLETED':
        return 'bg-blue-100 text-blue-800 border-blue-200';
      case 'CANCELLED':
        return 'bg-red-100 text-red-800 border-red-200';
      default:
        return 'bg-gray-100 text-gray-800 border-gray-200';
    }
  };

  const getStatusCounts = () => {
    return {
      ALL: bookings.length,
      PENDING: bookings.filter(b => b.status === 'PENDING').length,
      CONFIRMED: bookings.filter(b => b.status === 'CONFIRMED').length,
      COMPLETED: bookings.filter(b => b.status === 'COMPLETED').length,
      CANCELLED: bookings.filter(b => b.status === 'CANCELLED').length,
    };
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
          <p className="mt-4 text-gray-800">Loading bookings...</p>
        </div>
      </div>
    );
  }

  const statusCounts = getStatusCounts();

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      {/* Page Header */}
      <div className="mb-8">
        <div className="flex justify-between items-start">
          <div>
            <h1 className="text-3xl font-bold text-gray-900 mb-2">Booking Management</h1>
            <p className="text-gray-600">Review and manage your appointment requests</p>
          </div>
          <button
            onClick={() => router.push('/provider/dashboard')}
            className="bg-gray-600 text-white px-4 py-2 rounded-md hover:bg-gray-700 transition-colors text-sm font-medium"
          >
            ← Back to Dashboard
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-6 bg-red-50 border border-red-200 text-red-600 px-4 py-3 rounded">
          {error}
        </div>
      )}

      {/* Status Filter Tabs */}
      <div className="mb-6">
        <div className="border-b border-gray-200">
          <nav className="-mb-px flex space-x-8">
            {(Object.keys(statusCounts) as BookingStatus[]).map((status) => (
              <button
                key={status}
                onClick={() => setStatusFilter(status)}
                className={`py-2 px-1 border-b-2 font-medium text-sm ${
                  statusFilter === status
                    ? 'border-blue-500 text-blue-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }`}
              >
                {status.charAt(0) + status.slice(1).toLowerCase()} ({statusCounts[status]})
              </button>
            ))}
          </nav>
        </div>
      </div>

      {/* Search and Actions Bar */}
      <div className="mb-6 flex flex-col sm:flex-row gap-4 items-center justify-between">
        <div className="flex-1 max-w-md">
          <input
            type="text"
            placeholder="Search by customer name, email, or service..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
          />
        </div>
        <div className="flex items-center space-x-3">
          <span className="text-sm text-gray-600">
            Showing {filteredBookings.length} of {bookings.length} bookings
          </span>
          <button
            onClick={() => setClearAllModal(true)}
            disabled={loading || actionLoading === 'clear-all' || (statusCounts.CANCELLED + statusCounts.COMPLETED) === 0}
            className="bg-red-600 text-white px-4 py-2 rounded-md hover:bg-red-700 transition-colors text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
            title="Delete all old bookings (cancelled and completed)"
          >
            {actionLoading === 'clear-all' ? 'Clearing...' : 'Clear All Old'}
          </button>
          <button
            onClick={loadBookings}
            disabled={loading}
            className="bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700 transition-colors text-sm font-medium disabled:opacity-50"
          >
            Refresh
          </button>
        </div>
      </div>

      {/* Bookings List */}
      <div className="bg-white shadow rounded-lg">
        {filteredBookings.length === 0 ? (
          <div className="p-8 text-center">
            <div className="text-gray-400 text-4xl mb-4">📅</div>
            <h3 className="text-lg font-medium text-gray-900 mb-2">
              {statusFilter === 'ALL' ? 'No bookings found' : `No ${statusFilter.toLowerCase()} bookings`}
            </h3>
            <p className="text-gray-600">
              {searchTerm 
                ? 'Try adjusting your search criteria.'
                : statusFilter === 'PENDING'
                ? 'New booking requests will appear here.'
                : 'Bookings matching this status will appear here.'
              }
            </p>
          </div>
        ) : (
          <div className="divide-y divide-gray-200">
            {filteredBookings.map((booking) => {
              const { date, time } = formatDateTime(booking.scheduledAt);
              const customerName = `${booking.customer.firstName || ''} ${booking.customer.lastName || ''}`.trim() || 'Unknown Customer';
              const isHighlighted = highlightId === booking.id;
              
              return (
                <div 
                  key={booking.id} 
                  ref={(el) => { bookingRefs.current[booking.id] = el; }}
                  className={`p-6 ${isHighlighted ? 'bg-blue-50 border-l-4 border-blue-500' : ''}`}
                >
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center space-x-3 mb-2">
                        <h3 className="text-lg font-medium text-gray-900">{customerName}</h3>
                        <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border ${getStatusColor(booking.status)}`}>
                          {booking.status}
                        </span>
                      </div>
                      
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm text-gray-600">
                        <div>
                          <p><span className="font-medium">Email:</span> {booking.customer.email}</p>
                          <p><span className="font-medium">Service:</span> {booking.serviceType}</p>
                        </div>
                        <div>
                          <p><span className="font-medium">Date:</span> {date}</p>
                          <p><span className="font-medium">Time:</span> {time}</p>
                          <p><span className="font-medium">Duration:</span> {booking.duration} minutes</p>
                        </div>
                        <div>
                          <p><span className="font-medium">Requested:</span> {new Date(booking.createdAt).toLocaleDateString()}</p>
                          {booking.notes && (
                            <p><span className="font-medium">Notes:</span> {booking.notes}</p>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Action Buttons */}
                    {booking.status === 'PENDING' && (
                      <div className="flex flex-col md:flex-row md:items-center gap-2 md:ml-4 mt-4 md:mt-0">
                        <button
                          onClick={() => handleBookingAction(booking.id, 'confirm')}
                          disabled={actionLoading === booking.id}
                          className="bg-green-600 text-white px-3 py-1.5 rounded text-sm font-medium hover:bg-green-700 transition-colors disabled:opacity-50"
                        >
                          {actionLoading === booking.id ? '...' : 'Confirm'}
                        </button>
                        <button
                          onClick={() => handleBookingAction(booking.id, 'reschedule')}
                          disabled={actionLoading === booking.id}
                          className="bg-blue-600 text-white px-3 py-1.5 rounded text-sm font-medium hover:bg-blue-700 transition-colors disabled:opacity-50"
                        >
                          {actionLoading === booking.id ? '...' : 'Reschedule'}
                        </button>
                        <button
                          onClick={() => handleBookingAction(booking.id, 'cancel')}
                          disabled={actionLoading === booking.id}
                          className="bg-red-600 text-white px-3 py-1.5 rounded text-sm font-medium hover:bg-red-700 transition-colors disabled:opacity-50"
                        >
                          {actionLoading === booking.id ? '...' : 'Deny'}
                        </button>
                      </div>
                    )}
                    
                    {booking.status === 'CONFIRMED' && (
                      <div className="flex flex-col md:flex-row md:items-center gap-2 md:ml-4 mt-4 md:mt-0">
                        <button
                          onClick={() => handleBookingAction(booking.id, 'cancel')}
                          disabled={actionLoading === booking.id}
                          className="bg-red-600 text-white px-3 py-1.5 rounded text-sm font-medium hover:bg-red-700 transition-colors disabled:opacity-50"
                        >
                          {actionLoading === booking.id ? '...' : 'Cancel'}
                        </button>
                      </div>
                    )}
                    
                    {(booking.status === 'CANCELLED' || booking.status === 'COMPLETED') && (
                      <div className="flex flex-col md:flex-row md:items-center gap-2 md:ml-4 mt-4 md:mt-0">
                        <button
                          onClick={() => handleDelete(booking.id)}
                          disabled={actionLoading === booking.id}
                          className="bg-gray-600 text-white px-3 py-1.5 rounded text-sm font-medium hover:bg-gray-700 transition-colors disabled:opacity-50"
                        >
                          {actionLoading === booking.id ? '...' : 'Delete'}
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Reschedule Modal */}
      {rescheduleModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
            <div className="p-6">
              {/* Modal Header */}
              <div className="flex justify-between items-start mb-6">
                <div>
                  <h2 className="text-2xl font-bold text-gray-900">Reschedule Appointment</h2>
                  <p className="text-gray-600 mt-1">Select a new date and time for this appointment</p>
                </div>
                <button
                  onClick={() => {
                    setRescheduleModal(null);
                    setSelectedDate('');
                    setSelectedSlot(null);
                  }}
                  className="text-gray-400 hover:text-gray-600"
                >
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              {/* Current Booking Details */}
              <div className="mb-6 p-4 bg-gray-50 border border-gray-200 rounded-lg">
                <h3 className="font-semibold text-gray-900 mb-3">Current Appointment</h3>
                <div className="space-y-2 text-sm text-gray-700">
                  <p><strong>Customer:</strong> {`${rescheduleModal.customer.firstName || ''} ${rescheduleModal.customer.lastName || ''}`.trim()}</p>
                  <p><strong>Service:</strong> {rescheduleModal.serviceType}</p>
                  <p><strong>Current Time:</strong> {new Date(rescheduleModal.scheduledAt).toLocaleString()}</p>
                  <p><strong>Duration:</strong> {rescheduleModal.duration} minutes</p>
                  {rescheduleModal.notes && <p><strong>Notes:</strong> {rescheduleModal.notes}</p>}
                </div>
              </div>

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
                  {Array.from({ length: 14 }, (_, i) => {
                    const date = addDays(new Date(), i + 1);
                    const dateStr = format(date, 'yyyy-MM-dd');
                    return (
                      <option key={dateStr} value={dateStr}>
                        {format(date, 'EEEE, MMMM d, yyyy')}
                      </option>
                    );
                  })}
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
                    <div className="grid grid-cols-4 gap-2">
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
                            className="px-3 py-2 rounded text-sm font-medium transition-colors bg-white border border-gray-300 text-gray-700 hover:bg-gray-50 data-[selected=true]:bg-blue-600 data-[selected=true]:text-white"
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

              {/* Modal Actions */}
              <div className="flex justify-end space-x-4 pt-4 border-t">
                <button
                  onClick={() => {
                    setRescheduleModal(null);
                    setSelectedDate('');
                    setSelectedSlot(null);
                  }}
                  className="px-4 py-2 border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleRescheduleSubmit}
                  disabled={!selectedDate || !selectedSlot || actionLoading === rescheduleModal.id}
                  className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {actionLoading === rescheduleModal.id ? 'Rescheduling...' : 'Confirm Reschedule'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Clear All Confirmation Modal */}
      {clearAllModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full">
            <div className="p-6">
              <div className="flex items-center justify-center w-12 h-12 mx-auto mb-4 bg-red-100 rounded-full">
                <svg className="w-6 h-6 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
              </div>
              <h3 className="text-lg font-semibold text-gray-900 text-center mb-2">
                Clear All Old Bookings?
              </h3>
              <p className="text-gray-600 text-center mb-6">
                This will permanently delete all old bookings - cancelled and completed ({statusCounts.CANCELLED + statusCounts.COMPLETED} total). This action cannot be undone.
              </p>
              <div className="flex justify-end space-x-4">
                <button
                  onClick={() => setClearAllModal(false)}
                  className="px-4 py-2 border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleClearAll}
                  className="px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700 transition-colors"
                >
                  Delete All
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}