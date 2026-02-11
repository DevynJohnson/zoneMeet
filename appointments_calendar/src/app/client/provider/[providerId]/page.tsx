'use client';

import React, { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import { useAlert } from '@/contexts/AlertContext';

interface Provider {
  id: string;
  name: string;
  email: string;
  company: string | null;
  bio: string | null;
  phone: string;
  title: string | null;
  website: string | null;
}

export default function ProviderBookingPage() {
  const params = useParams();
  const { showSuccess } = useAlert();
  const providerId = params.providerId as string;
  const [provider, setProvider] = useState<Provider | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchProvider = async () => {
      try {
        const response = await fetch(`/api/client/search-providers?q=${providerId}`);
        const data = await response.json();
        
        if (data.success && data.providers.length > 0) {
          // Try to find exact match by ID, otherwise use first result
          const matchedProvider = data.providers.find((p: Provider) => p.id === providerId) || data.providers[0];
          setProvider(matchedProvider);
        }
      } catch (error) {
        console.error('Error fetching provider:', error);
      } finally {
        setLoading(false);
      }
    };

    if (providerId) {
      fetchProvider();
    }
  }, [providerId]);

  const shareViaEmail = () => {
    const subject = encodeURIComponent(`Book an appointment with ${provider?.name}`);
    const body = encodeURIComponent(
      `I'd like to share this booking link for ${provider?.name}${provider?.company ? ` at ${provider.company}` : ''}.\n\n` +
      `You can book an appointment directly using this link:\n${window.location.href}\n\n` +
      `Best regards`
    );
    window.open(`mailto:?subject=${subject}&body=${body}`);
  };

  const shareViaSMS = () => {
    const message = encodeURIComponent(
      `Book an appointment with ${provider?.name}: ${window.location.href}`
    );
    window.open(`sms:?body=${message}`);
  };

  const shareViaWhatsApp = () => {
    const message = encodeURIComponent(
      `Book an appointment with ${provider?.name}: ${window.location.href}`
    );
    window.open(`https://wa.me/?text=${message}`);
  };

  const copyLink = () => {
    navigator.clipboard.writeText(window.location.href).then(() => {
      showSuccess('Booking link copied to clipboard!');
    }).catch(() => {
      prompt('Copy this booking link:', window.location.href);
    });
  };

  if (loading) {
    return (
      <div className="max-w-4xl mx-auto py-8 px-4">
        <div className="text-center">
          <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
          <p className="mt-2">Loading provider information...</p>
        </div>
      </div>
    );
  }

  if (!provider) {
    return (
      <div className="max-w-4xl mx-auto py-8 px-4">
        <div className="text-center">
          <h1 className="text-2xl font-bold mb-4">Provider Not Found</h1>
          <p className="text-gray-800 mb-4">The provider you&apos;re looking for could not be found.</p>
          <a href="/client/search" className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700">
            Search Providers
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto py-8 px-4">
      {/* Provider Info Header */}
      <div className="bg-white p-6 rounded-lg border shadow-sm mb-6">
        <div className="flex justify-between items-start">
          <div className="flex-1">
            <div className="flex items-center gap-3 mb-2">
              <h1 className="text-2xl font-bold text-gray-900">{provider.name}</h1>
              {provider.title && (
                <span className="text-sm text-gray-800 bg-gray-200 px-2 py-1 rounded">
                  {provider.title}
                </span>
              )}
            </div>
            
            {provider.company && (
              <p className="text-lg text-gray-700 mb-2">{provider.company}</p>
            )}
            
            {provider.bio && (
              <p className="text-gray-800 mb-3">{provider.bio}</p>
            )}
            
            <div className="flex flex-wrap gap-4 text-sm text-gray-800">
              <span>📧 {provider.email}</span>
              <span>📞 {provider.phone}</span>
              {provider.website && (
                <a 
                  href={provider.website} 
                  target="_blank" 
                  rel="noopener noreferrer"
                  className="text-blue-600 hover:underline"
                >
                  🌐 Website
                </a>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Booking Section */}
      <div className="bg-white p-6 rounded-lg border shadow-sm mb-6">
        <h2 className="text-xl font-semibold mb-4">Book Your Appointment</h2>
        <div className="bg-blue-50 p-4 rounded-lg mb-4">
          <p className="text-blue-800">
            Click the button below to view available appointment times and book directly with {provider.name}.
          </p>
        </div>
        <a 
          href={`/client/booking?providerId=${provider.id}`}
          className="inline-block bg-blue-600 text-white px-6 py-3 rounded-lg hover:bg-blue-700 font-medium"
        >
          View Available Times →
        </a>
      </div>

      {/* Share Options */}
      <div className="bg-white p-6 rounded-lg border shadow-sm">
        <h2 className="text-xl font-semibold mb-4">Share This Booking Link</h2>
        <p className="text-gray-800 mb-4">
          Help others book appointments with {provider.name} by sharing this link:
        </p>
        
        <div className="bg-gray-50 p-3 rounded mb-4 break-all text-sm font-mono">
          {typeof window !== 'undefined' ? window.location.href : ''}
        </div>
        
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <button
            onClick={copyLink}
            className="flex items-center justify-center gap-2 bg-gray-100 text-gray-700 px-4 py-2 rounded hover:bg-gray-200"
          >
            📋 Copy Link
          </button>
          <button
            onClick={shareViaEmail}
            className="flex items-center justify-center gap-2 bg-blue-100 text-blue-700 px-4 py-2 rounded hover:bg-blue-200"
          >
            📧 Email
          </button>
          <button
            onClick={shareViaSMS}
            className="flex items-center justify-center gap-2 bg-green-100 text-green-700 px-4 py-2 rounded hover:bg-green-200"
          >
            💬 SMS
          </button>
          <button
            onClick={shareViaWhatsApp}
            className="flex items-center justify-center gap-2 bg-green-100 text-green-700 px-4 py-2 rounded hover:bg-green-200"
          >
            📱 WhatsApp
          </button>
        </div>
        
        <div className="mt-4 p-3 bg-yellow-50 rounded">
          <p className="text-xs text-yellow-800">
            💡 <strong>Tip:</strong> Providers can bookmark this page and share the URL with clients 
            for easy appointment booking. The link works on any device and doesn&apos;t require any apps.
          </p>
        </div>
      </div>
      
      {/* Footer */}
      <div className="mt-6 text-center">
        <a href="/client/search" className="text-blue-600 hover:underline">
          ← Search for other providers
        </a>
      </div>
    </div>
  );
}
