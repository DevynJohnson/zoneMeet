'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { useRouter, usePathname } from 'next/navigation';
import { secureFetch, clearCSRFToken } from '@/lib/csrf';

interface NavProps {
  type?: 'provider' | 'public';
}

interface User {
  id: string;
  email: string;
  name?: string;
  company?: string;
}

export default function Nav({ type = 'public' }: NavProps) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    const checkAuth = async () => {
      try {
        setIsLoading(true);
        
        // Only providers have authentication tokens
        // Clients use magic links and don't need persistent auth
        if (type !== 'provider') {
          setUser(null);
          setIsLoading(false);
          return;
        }

        const token = localStorage.getItem('providerToken');
        if (!token) {
          setUser(null);
          setIsLoading(false);
          return;
        }

        // Verify provider auth token
        const response = await fetch('/api/provider/auth/verify', {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });

        if (response.ok) {
          const userData = await response.json();
          setUser(userData.provider);
        } else {
          // Clean up invalid tokens silently
          const currentProviderEmail = localStorage.getItem('currentProviderEmail');
          localStorage.removeItem('providerToken');
          localStorage.removeItem('currentProviderEmail');
          if (currentProviderEmail) {
            localStorage.removeItem(`providerToken_${currentProviderEmail}`);
          }
          clearCSRFToken();
          setUser(null);
        }
      } catch (error) {
        // Only log unexpected errors, not auth failures
        if (error instanceof Error && !error.message.includes('401')) {
          console.error('Auth check failed:', error);
        }
        // Clean up tokens on any error
        const currentProviderEmail = localStorage.getItem('currentProviderEmail');
        localStorage.removeItem('providerToken');
        localStorage.removeItem('currentProviderEmail');
        if (currentProviderEmail) {
          localStorage.removeItem(`providerToken_${currentProviderEmail}`);
        }
        clearCSRFToken();
        setUser(null);
      } finally {
        setIsLoading(false);
      }
    };

    checkAuth();

    // Listen for storage changes (logout in other tabs)
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === 'providerToken' && !e.newValue) {
        setUser(null);
      }
    };

    window.addEventListener('storage', handleStorageChange);
    return () => window.removeEventListener('storage', handleStorageChange);
  }, [type, pathname]);

  const handleLogout = async () => {
    try {
      // Only providers have logout functionality
      // Clients use magic links and don't need to logout
      if (type === 'provider') {
        const token = localStorage.getItem('providerToken');
        
        // Call server logout endpoint to invalidate token
        if (token) {
          try {
            await secureFetch('/api/provider/auth/logout', {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${token}`,
              },
            });
          } catch (error) {
            console.warn('Server logout failed:', error);
            // Continue with client-side cleanup even if server call fails
          }
        }
        
        // Clear CSRF token cache
        clearCSRFToken();
        
        // Clear all provider-related localStorage items
        const currentProviderEmail = localStorage.getItem('currentProviderEmail');
        localStorage.removeItem('providerToken');
        localStorage.removeItem('currentProviderEmail');
        
        // Remove provider-specific token if exists
        if (currentProviderEmail) {
          localStorage.removeItem(`providerToken_${currentProviderEmail}`);
        }
        
        // Clear any other cached data that might be provider-specific
        const keysToRemove = [];
        for (let i = 0; i < localStorage.length; i++) {
          const key = localStorage.key(i);
          if (key && (key.startsWith('provider') || key.includes('calendar') || key.includes('appointment'))) {
            keysToRemove.push(key);
          }
        }
        keysToRemove.forEach(key => localStorage.removeItem(key));
        
        setUser(null);
        router.push('/');
      }
    } catch (error) {
      console.error('Logout failed:', error);
    }
  };

  const isActive = (path: string) => {
    // Special case for home page - only active if pathname is exactly '/'
    if (path === '/') {
      return pathname === '/';
    }
    // For other paths, check if pathname starts with the path
    return pathname === path || pathname.startsWith(path + '/');
  };

  // Provider Navigation Items
  const providerNavItems = [
    { href: '/provider/dashboard', label: 'Dashboard' },
    { href: '/provider/calendar/connect', label: 'Calendars' },
    { href: '/provider/location', label: 'Locations' },
    { href: '/provider/bookings', label: 'Bookings' },
    { href: '/provider/share', label: 'Share' },
    { href: '/provider/availability-schedules', label: 'Availability' },
  ];

  // Public Navigation Items (used for both public and customer since clients use magic links)
  const publicNavItems = [
    { href: '/', label: 'Home' },
    { href: '/client/booking', label: 'Book Appointment' },
    { href: '/client/search', label: 'Find Providers' },
    { href: '/about', label: 'About' },
  ];

  const getNavItems = () => {
    return type === 'provider' ? providerNavItems : publicNavItems;
  };

  const navItems = getNavItems();

  return (
    <nav className="bg-white shadow-sm border-b border-gray-200">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-20 py-3">
          {/* Logo/Brand - Far Left */}
          <div className="flex-shrink-0">
            <Link href={type === 'provider' ? '/' : '/'} className="flex items-center">
              <Image 
                src="/ZoneMeet_Logo.png" 
                alt="Zone Meet Logo" 
                width={120} 
                height={120} 
                className="hover:opacity-80 transition-opacity"
              />
            </Link>
          </div>

          {/* Desktop Navigation - Centered */}
          <div className="hidden md:flex md:items-center md:space-x-3 lg:space-x-4 flex-1 justify-center mx-4">
            {navItems.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className={`px-2 lg:px-3 py-2 rounded-md text-sm lg:text-base font-medium transition-colors ${
                  isActive(item.href)
                    ? 'bg-blue-100 text-blue-700'
                    : 'text-gray-700 hover:text-gray-900 hover:bg-gray-50'
                }`}
              >
                {item.label}
              </Link>
            ))}
          </div>

          {/* User Menu - Fixed Right */}
          <div className="hidden md:flex md:items-center md:space-x-2 flex-shrink-0">
            {isLoading ? (
              <div className="w-8 h-8 bg-gray-200 rounded-full animate-pulse"></div>
            ) : user ? (
              <>
                <Link
                  href="/provider/settings"
                  className="bg-gray-100 text-gray-700 px-3 py-2 rounded-md text-sm lg:text-base font-medium hover:bg-gray-200 transition-colors whitespace-nowrap"
                >
                  Settings
                </Link>
                <button
                  onClick={handleLogout}
                  className="bg-red-100 text-red-700 px-3 py-2 rounded-md text-sm lg:text-base font-medium hover:bg-red-200 transition-colors whitespace-nowrap"
                >
                  Logout
                </button>
              </>
            ) : (
              <Link
                href="/login"
                className="bg-blue-600 text-white px-3 py-2 rounded-md text-sm lg:text-base font-medium hover:bg-blue-700 transition-colors whitespace-nowrap"
              >
                Login
              </Link>
            )}
          </div>

          {/* Mobile menu button */}
          <div className="md:hidden flex items-center">
            <button
              onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
              className="inline-flex items-center justify-center p-2 rounded-md text-gray-400 hover:text-gray-500 hover:bg-gray-100"
            >
              <span className="sr-only">Open main menu</span>
              {isMobileMenuOpen ? (
                <svg className="block h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              ) : (
                <svg className="block h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                </svg>
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Mobile Navigation Menu */}
      {isMobileMenuOpen && (
        <div className="md:hidden">
          <div className="px-3 pt-3 pb-4 space-y-2 sm:px-4 bg-gray-50 border-t border-gray-200">
            {navItems.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className={`block px-4 py-3 rounded-md text-lg font-medium transition-colors ${
                  isActive(item.href)
                    ? 'bg-blue-100 text-blue-700'
                    : 'text-gray-700 hover:text-gray-900 hover:bg-gray-50'
                }`}
                onClick={() => setIsMobileMenuOpen(false)}
              >
                {item.label}
              </Link>
            ))}

            {/* Mobile User Menu */}
            <div className="border-t border-gray-200 pt-4 mt-4">
              {user ? (
                <div className="px-3 py-2">
                  <div className="text-base font-medium text-gray-900">
                    {user.name || user.email}
                  </div>
                  {user.company && (
                    <div className="text-sm text-gray-500">{user.company}</div>
                  )}
                  <div className="mt-3 space-y-2">
                    <Link
                      href="/provider/settings"
                      className="block w-full text-center bg-gray-100 text-gray-700 px-4 py-3 rounded-md text-lg font-medium hover:bg-gray-200 transition-colors"
                      onClick={() => setIsMobileMenuOpen(false)}
                    >
                      Settings
                    </Link>
                    <button
                      onClick={handleLogout}
                      className="w-full bg-red-100 text-red-700 px-4 py-3 rounded-md text-lg font-medium hover:bg-red-200 transition-colors"
                    >
                      Logout
                    </button>
                  </div>
                </div>
              ) : (
                <div className="px-4 py-3 space-y-3">
                  {type === 'provider' ? (
                    <>
                      <Link
                        href="/login"
                        className="block w-full text-center bg-gray-100 text-gray-700 px-4 py-3 rounded-md text-lg font-medium hover:bg-gray-200 transition-colors"
                        onClick={() => setIsMobileMenuOpen(false)}
                      >
                        Login
                      </Link>
                      <Link
                        href="/register"
                        className="block w-full text-center bg-blue-600 text-white px-4 py-3 rounded-md text-lg font-medium hover:bg-blue-700 transition-colors"
                        onClick={() => setIsMobileMenuOpen(false)}
                      >
                        Register
                      </Link>
                    </>
                  ) : (
                    <Link
                      href="/login"
                      className="block w-full text-center bg-gray-100 text-gray-700 px-4 py-3 rounded-md text-lg font-medium hover:bg-gray-200 transition-colors"
                      onClick={() => setIsMobileMenuOpen(false)}
                    >
                      Provider Login
                    </Link>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </nav>
  );
}
