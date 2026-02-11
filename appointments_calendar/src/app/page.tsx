import Link from "next/link";
import Nav from "@/components/Nav";

export default function Home() {
  return (
    <>
    <Nav type="public" />
    <div className="min-h-screen bg-gray-50">
      <div className="font-sans flex-1 flex flex-col items-center justify-center p-8 pb-20 gap-16 sm:p-20">
        <main className="flex flex-col gap-[32px] items-center max-w-4xl">
          <div className="text-center">
            <h1 className="text-4xl font-bold text-gray-900 mt-6 mb-4" style={{ textShadow: '2px 2px 4px rgba(0, 0, 0, 0.3)' }}>Welcome to Zone Meet!</h1>
            <h2 className="text-4xl font-bold text-gray-900 mt-6 mb-8" style={{ textShadow: '2px 2px 4px rgba(0, 0, 0, 0.3)' }}>
              The Location-Based Appointment Booking Platform
            </h2>
            <p className="text-xl text-gray-600 mb-8 max-w-2xl mx-auto">
              Book appointments with service providers who work across multiple locations—and actually know when they&apos;ll be in your area. Designed for professionals serving clients across large geographic areas, Zone Meet solves the challenge of coordinating both location and availability for contractors, consultants, specialists, and any service provider with a multi-location practice.
            </p>
            <p className="text-xl text-gray-600 mb-8 max-w-2xl mx-auto">
              Providers manage multiple locations with ease: set a main office as default, schedule specific dates for each location, or create recurring schedules that automatically update. Integrated calendar sync with Outlook, Google, Teams, and Apple iCloud ensures every appointment fits seamlessly into existing commitments.
            </p>
            <p className="text-xl text-gray-600 mb-8 max-w-2xl mx-auto">
              Advanced availability controls let providers define exactly when they accept appointments—by day, time, location, or rotating pattern. This precision reduces scheduling conflicts and ensures every booking works for both provider and client.
            </p>
            <p className="text-xl text-gray-600 mb-8 max-w-2xl mx-auto">
              Find your provider, see their availability across all locations for the upcoming weeks, and filter by your preferred area if desired. Choose your time and location, book instantly, and it&apos;s automatically added to their calendar. It&apos;s scheduling without the back-and-forth.
            </p>
          </div>

          <div className="flex gap-4 items-center justify-center flex-col sm:flex-row">
            <Link
              className="rounded-full border border-solid border-transparent transition-colors flex items-center justify-center bg-blue-600 text-white gap-2 hover:bg-blue-700 font-medium text-sm sm:text-base h-10 sm:h-12 px-4 sm:px-5 sm:w-auto"
              href="/client/booking"
            >
              Book an Appointment
            </Link>
            <Link
              className="rounded-full border border-solid border-gray-300 transition-colors flex items-center justify-center hover:bg-gray-50 font-medium text-sm sm:text-base h-10 sm:h-12 px-4 sm:px-5 w-full sm:w-auto"
              href="/register"
            >
              Join as a Service Provider
            </Link>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mt-12 w-full">
            <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200">
              <div className="text-2xl mb-3">📍</div>
              <h3 className="font-semibold text-lg mb-2">Location-Based</h3>
              <p className="text-gray-600">Find providers in your area and book appointments based on their actual location and schedule.</p>
            </div>
            <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200">
              <div className="text-2xl mb-3">📅</div>
              <h3 className="font-semibold text-lg mb-2">Calendar Sync</h3>
              <p className="text-gray-600">Automatic sync with Outlook, Google Calendar, Teams, and Apple iCloud calendars.</p>
            </div>
            <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200">
              <div className="text-2xl mb-3">⚡</div>
              <h3 className="font-semibold text-lg mb-2">Real-Time Updates</h3>
              <p className="text-gray-600">Instant availability updates when providers&apos; schedules change.</p>
            </div>
          </div>
        </main>
      </div>
    </div>
  </>
  );
}
