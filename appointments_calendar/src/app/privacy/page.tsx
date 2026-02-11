import Link from 'next/link'

export default function PrivacyPolicy() {
  return (
    <div className="min-h-screen bg-gray-50 py-12">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="bg-white shadow-lg rounded-lg p-8">
          <h1 className="text-3xl font-bold text-gray-900 mb-8">Privacy Policy</h1>
          
          <div className="prose prose-lg max-w-none">
            <p className="text-gray-600 mb-6">
              <strong>Last Updated:</strong> {new Date().toLocaleDateString()}
            </p>

            <section className="mb-8">
              <h2 className="text-2xl font-semibold text-gray-900 mb-4">1. Introduction</h2>
              <p className="text-gray-700 mb-4">
                Welcome to Appointments Calendar (&ldquo;we,&rdquo; &ldquo;our,&rdquo; or &ldquo;us&rdquo;). This Privacy Policy explains how we collect, use, disclose, and safeguard your information when you use our Zone Meet management service (&ldquo;Service&rdquo;).
              </p>
              <p className="text-gray-700">
                By using our Service, you consent to the data practices described in this Privacy Policy.
              </p>
            </section>

            <section className="mb-8">
              <h2 className="text-2xl font-semibold text-gray-900 mb-4">2. Information We Collect</h2>
              
              <h3 className="text-lg font-medium text-gray-900 mb-2">Personal Information</h3>
              <p className="text-gray-700 mb-4">
                We may collect personally identifiable information, including but not limited to:
              </p>
              <ul className="list-disc list-inside text-gray-700 mb-4 space-y-1">
                <li>Name and contact information (email address, phone number)</li>
                <li>Business information (organization name, job title)</li>
                <li>Account credentials and authentication information</li>
                <li>Profile information and preferences</li>
              </ul>

              <h3 className="text-lg font-medium text-gray-900 mb-2">Calendar Data</h3>
              <p className="text-gray-700 mb-4">
                When you connect your calendar accounts, we may access and store:
              </p>
              <ul className="list-disc list-inside text-gray-700 mb-4 space-y-1">
                <li>Calendar events, appointments, and scheduling information</li>
                <li>Event details including titles, descriptions, dates, and times</li>
                <li>Attendee information for events you create or manage</li>
                <li>Calendar metadata and synchronization settings</li>
              </ul>

              <h3 className="text-lg font-medium text-gray-900 mb-2">Usage Information</h3>
              <ul className="list-disc list-inside text-gray-700 mb-4 space-y-1">
                <li>Log data including IP addresses, browser type, and usage patterns</li>
                <li>Device information and operating system details</li>
                <li>Session information and authentication tokens</li>
                <li>Performance and error tracking data</li>
              </ul>
            </section>

            <section className="mb-8">
              <h2 className="text-2xl font-semibold text-gray-900 mb-4">3. How We Use Your Information</h2>
              <p className="text-gray-700 mb-4">We use the collected information for:</p>
              <ul className="list-disc list-inside text-gray-700 space-y-2">
                <li>Providing and maintaining our Zone Meet service</li>
                <li>Synchronizing and managing your calendar data across platforms</li>
                <li>Authenticating your identity and securing your account</li>
                <li>Sending appointment notifications and reminders</li>
                <li>Improving our Service through usage analytics</li>
                <li>Providing customer support and technical assistance</li>
                <li>Detecting and preventing fraud or security breaches</li>
                <li>Complying with legal obligations and enforcing our Terms of Service</li>
              </ul>
            </section>

            <section className="mb-8">
              <h2 className="text-2xl font-semibold text-gray-900 mb-4">4. Information Sharing and Disclosure</h2>
              <p className="text-gray-700 mb-4">We do not sell, trade, or otherwise transfer your personal information to third parties except:</p>
              
              <h3 className="text-lg font-medium text-gray-900 mb-2">Service Providers</h3>
              <p className="text-gray-700 mb-4">
                We may share information with trusted third-party service providers who assist us in operating our Service:
              </p>
              <ul className="list-disc list-inside text-gray-700 mb-4 space-y-1">
                <li>Cloud hosting and database services (Supabase, Render)</li>
                <li>Calendar platform APIs (Google Calendar, Microsoft Outlook, Apple Calendar)</li>
                <li>Authentication and security services</li>
                <li>Analytics and performance monitoring tools</li>
              </ul>

              <h3 className="text-lg font-medium text-gray-900 mb-2">Legal Requirements</h3>
              <p className="text-gray-700 mb-4">
                We may disclose your information when required by law or in response to valid legal processes.
              </p>

              <h3 className="text-lg font-medium text-gray-900 mb-2">Business Transfers</h3>
              <p className="text-gray-700">
                In the event of a merger, acquisition, or sale of assets, your information may be transferred as part of that transaction.
              </p>
            </section>

            <section className="mb-8">
              <h2 className="text-2xl font-semibold text-gray-900 mb-4">5. Data Security</h2>
              <p className="text-gray-700 mb-4">
                We implement appropriate security measures to protect your personal information:
              </p>
              <ul className="list-disc list-inside text-gray-700 space-y-2">
                <li>Encryption of data in transit and at rest</li>
                <li>Secure authentication protocols (OAuth 2.0)</li>
                <li>Regular security audits and vulnerability assessments</li>
                <li>Access controls and employee training on data protection</li>
                <li>Rate limiting and fraud detection mechanisms</li>
              </ul>
            </section>

            <section className="mb-8">
              <h2 className="text-2xl font-semibold text-gray-900 mb-4">6. Data Retention</h2>
              <p className="text-gray-700 mb-4">
                We retain your information only as long as necessary to provide our Service and comply with legal obligations:
              </p>
              <ul className="list-disc list-inside text-gray-700 space-y-1">
                <li>Account information: Retained while your account is active</li>
                <li>Calendar data: Synchronized and retained according to your preferences</li>
                <li>Usage logs: Retained for up to 12 months for security and analytics</li>
                <li>Deleted data: Permanently removed within 30 days of account deletion</li>
              </ul>
            </section>

            <section className="mb-8">
              <h2 className="text-2xl font-semibold text-gray-900 mb-4">7. Your Rights and Choices</h2>
              <p className="text-gray-700 mb-4">You have the following rights regarding your personal information:</p>
              
              <h3 className="text-lg font-medium text-gray-900 mb-2">Access and Portability</h3>
              <ul className="list-disc list-inside text-gray-700 mb-4 space-y-1">
                <li>Request access to your personal data</li>
                <li>Receive a copy of your information in a portable format</li>
              </ul>

              <h3 className="text-lg font-medium text-gray-900 mb-2">Correction and Deletion</h3>
              <ul className="list-disc list-inside text-gray-700 mb-4 space-y-1">
                <li>Update or correct your personal information</li>
                <li>Delete your account and associated data</li>
                <li>Remove specific calendar connections</li>
              </ul>

              <h3 className="text-lg font-medium text-gray-900 mb-2">Consent Management</h3>
              <ul className="list-disc list-inside text-gray-700 space-y-1">
                <li>Withdraw consent for data processing</li>
                <li>Opt-out of non-essential communications</li>
                <li>Manage calendar synchronization preferences</li>
              </ul>
            </section>

            <section className="mb-8">
              <h2 className="text-2xl font-semibold text-gray-900 mb-4">8. Third-Party Services</h2>
              <p className="text-gray-700 mb-4">
                Our Service integrates with third-party calendar platforms. Each platform has its own privacy policy:
              </p>
              <ul className="list-disc list-inside text-gray-700 space-y-2">
                <li>
                  <strong>Google Calendar:</strong> 
                  <a href="https://policies.google.com/privacy" className="text-blue-600 hover:text-blue-800 ml-2">
                    Google Privacy Policy
                  </a>
                </li>
                <li>
                  <strong>Microsoft Outlook:</strong> 
                  <a href="https://privacy.microsoft.com/privacystatement" className="text-blue-600 hover:text-blue-800 ml-2">
                    Microsoft Privacy Statement
                  </a>
                </li>
                <li>
                  <strong>Apple Calendar:</strong> 
                  <a href="https://www.apple.com/privacy/" className="text-blue-600 hover:text-blue-800 ml-2">
                    Apple Privacy Policy
                  </a>
                </li>
              </ul>
            </section>

            <section className="mb-8">
              <h2 className="text-2xl font-semibold text-gray-900 mb-4">9. International Data Transfers</h2>
              <p className="text-gray-700">
                Your information may be transferred to and processed in countries other than your country of residence. 
                We ensure appropriate safeguards are in place to protect your personal information in accordance with 
                applicable data protection laws.
              </p>
            </section>

            <section className="mb-8">
              <h2 className="text-2xl font-semibold text-gray-900 mb-4">10. Children&apos;s Privacy</h2>
              <p className="text-gray-700">
                Our Service is not intended for children under the age of 13. We do not knowingly collect personal 
                information from children under 13. If you are a parent or guardian and believe we have collected 
                information about your child, please contact us immediately.
              </p>
            </section>

            <section className="mb-8">
              <h2 className="text-2xl font-semibold text-gray-900 mb-4">11. Changes to This Privacy Policy</h2>
              <p className="text-gray-700">
                We may update this Privacy Policy from time to time. We will notify you of any material changes by 
                posting the updated policy on our website and updating the &ldquo;Last Updated&rdquo; date. Your continued use 
                of the Service after such changes constitutes acceptance of the updated Privacy Policy.
              </p>
            </section>

            <section className="mb-8">
              <h2 className="text-2xl font-semibold text-gray-900 mb-4">12. Contact Information</h2>
              <p className="text-gray-700 mb-4">
                If you have any questions about this Privacy Policy or our data practices, please contact us:
              </p>
              <div className="bg-gray-50 p-4 rounded-lg">
                <p className="text-gray-700">
                  <strong>Email:</strong> info@devynjohnsondigitalsolutions.com <br />
                </p>
              </div>
            </section>
          </div>

          <div className="mt-8 pt-6 border-t border-gray-200">
            <Link 
              href="/"
              className="text-blue-600 hover:text-blue-800 font-medium"
            >
              ← Back to Home
            </Link>
          </div>
        </div>
      </div>
    </div>
  )
}