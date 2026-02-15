'use client';

import React, { useState, useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Nav from '@/components/Nav';
import { ClientTokenMonitor } from '@/lib/client-token-monitor';

interface Provider {
  id: string;
  name: string;
  email: string;
  company: string | null;
  bio: string | null;
  phone: string;
  title: string | null;
  website: string | null;
  defaultBookingDuration: number;
  location?: string;
  locations?: Array<{
    id: string;
    city: string;
    stateProvince: string;
    country: string;
    isDefault: boolean;
  }>;
  stats?: {
    availableEvents: number;
    recentBookings: number;
  };
}

interface SearchResponse {
  success: boolean;
  providers: Provider[];
  total: number;
}

export default function ProviderSearch() {
  return (
    <Suspense fallback={<div className="max-w-6xl mx-auto py-8 px-4"><div className="text-center"><div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div><p className="mt-2">Loading search...</p></div></div>}>
      <ProviderSearchContent />
    </Suspense>
  );
}

function ProviderSearchContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [providers, setProviders] = useState<Provider[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState(searchParams.get('q') || '');
  const [filters, setFilters] = useState({
    city: searchParams.get('city') || '',
    state: searchParams.get('state') || '',
  });

  const searchProviders = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (searchQuery.trim()) params.append('q', searchQuery.trim());
      if (filters.city.trim()) params.append('city', filters.city.trim());
      if (filters.state.trim()) params.append('state', filters.state.trim());

      const response = await fetch(`/api/client/search-providers?${params}`);
      const data: SearchResponse = await response.json();
      
      if (data.success) {
        setProviders(data.providers);
      } else {
        console.error('Failed to search providers');
        setProviders([]);
      }
    } catch (error) {
      console.error('Error searching providers:', error);
      setProviders([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    searchProviders();
    
    // Trigger token maintenance check (free!)
    ClientTokenMonitor.checkAndMaintain();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    searchProviders();
  };

  const handleBookWithProvider = (providerId: string) => {
    router.push(`/client/booking?providerId=${providerId}`);
  };

  return (
    <>
      <Nav type="public" />
      <div className="max-w-6xl mx-auto py-8 px-4">
      <div className="mb-8">
        <h1 className="text-3xl font-bold mb-2 text-gray-900">Find a Service Provider</h1>
        <p className="text-gray-700">Search for providers and book appointments</p>
      </div>

      {/* Search Form */}
      <form onSubmit={handleSearch} className="bg-white p-6 rounded-lg border shadow-sm mb-6">
        <div className="grid gap-4 md:grid-cols-4">
          <div className="md:col-span-2">
            <label className="block text-sm font-medium mb-1 text-gray-900">
              Search by name, company, or email
            </label>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="e.g. John Smith, ABC Construction, john@example.com"
              className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-900"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1 text-gray-900">City</label>
            <input
              type="text"
              value={filters.city}
              onChange={(e) => setFilters(prev => ({ ...prev, city: e.target.value }))}
              placeholder="City"
              className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-900"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1 text-gray-900">State</label>
            <input
              type="text"
              value={filters.state}
              onChange={(e) => setFilters(prev => ({ ...prev, state: e.target.value }))}
              placeholder="State"
              className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-900"
            />
          </div>
        </div>
        <div className="mt-4 flex gap-3">
          <button
            type="submit"
            disabled={loading}
            className="bg-blue-600 text-white px-6 py-2 rounded-md hover:bg-blue-700 disabled:opacity-50"
          >
            {loading ? 'Searching...' : 'Search Providers'}
          </button>
          <button
            type="button"
            onClick={() => {
              setSearchQuery('');
              setFilters({ city: '', state: '' });
              searchProviders();
            }}
            className="bg-gray-200 text-gray-800 px-4 py-2 rounded-md hover:bg-gray-300"
          >
            Clear
          </button>
        </div>
      </form>

      {/* Results */}
      <div className="space-y-4">
        {loading ? (
          <div className="text-center py-8">
            <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
            <p className="mt-2 text-gray-800">Searching providers...</p>
          </div>
        ) : providers.length === 0 ? (
          <div className="text-center py-8 bg-gray-50 rounded-lg">
            <p className="text-gray-800">
              {searchQuery || filters.city || filters.state 
                ? 'No providers found matching your search criteria.' 
                : 'Enter search terms to find providers.'}
            </p>
          </div>
        ) : (
          <>
            <div className="mb-4">
              <p className="text-sm text-gray-700">
                Found {providers.length} provider{providers.length !== 1 ? 's' : ''}
              </p>
            </div>
            {providers.map((provider) => (
              <div key={provider.id} className="bg-white p-6 rounded-lg border shadow-sm hover:shadow-md transition-shadow">
                <div className="flex justify-between items-start">
                  <div className="flex-1">
                    <div className="flex items-center gap-3 mb-2">
                      <h3 className="text-xl font-semibold text-gray-900">
                        {provider.name}
                      </h3>
                      {provider.title && (
                        <span className="text-sm text-gray-800 bg-gray-200 px-2 py-1 rounded">
                          {provider.title}
                        </span>
                      )}
                    </div>
                    {provider.company && (
                      <p className="text-lg font-medium text-gray-800 mb-2">{provider.company}</p>
                    )}
                    {provider.bio && (
                      <p className="text-gray-800 mb-3 break-words">{provider.bio}</p>
                    )}
                    <div className="flex flex-wrap gap-4 text-sm text-gray-800 mb-4">
                      <div className="flex flex-col space-y-2 text-sm text-gray-800 mb-4">
                        <div>📧 <a href={`mailto:${provider.email}`} className="text-blue-600 hover:underline">{provider.email}</a></div>
                        <div>📞 {provider.phone}</div>
                        {provider.website && (
                          <div>
                            <a 
                              href={provider.website} 
                              target="_blank" 
                              rel="noopener noreferrer"
                              className="text-blue-600 hover:underline"
                            >
                              🌐 {provider.website}
                            </a>
                          </div>
                        )}
                      </div>
                    </div>
                   
                  </div>
                </div>
                <div className="flex justify-center mt-6">
                  <button
                    onClick={() => handleBookWithProvider(provider.id)}
                    className="bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700 whitespace-nowrap"
                  >
                    Book Appointment
                  </button>
                </div>
              </div>
            ))}
          </>
        )}
      </div>
    </div>
    </>
  );
}
