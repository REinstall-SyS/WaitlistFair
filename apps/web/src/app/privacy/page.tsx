import Link from "next/link";
import { Logo } from "@/components/logo";
export default function Privacy() {
  return (
    <main className="document-page">
      <Logo />
      <h1>Your time. Your data.</h1>
      <p>
        WaitlistFair stores your name, email, time zone, availability
        preferences, bookings, and offer history to coordinate tutoring
        appointments. Your center’s administrators can see its operational
        records. Students can see only their own waitlist entries, bookings, and
        offers.
      </p>
      <h2>Notifications and sign-in</h2>
      <p>
        Sign-in links expire after 15 minutes and can be used once. Sessions
        expire after seven days. You can turn appointment email off in Settings;
        you will need to check your offers in the app. Email delivery may be
        delayed or duplicated, and the server always checks your offer deadline.
      </p>
      <h2>Retention and deletion</h2>
      <p>
        The worker removes expired sign-in credentials, sent notification events
        after 30 days, idempotency records after 30 days, and audit events after
        180 days. Historical scheduling records remain with your organization.
        Deleting an eligible student account replaces its name and email with
        anonymous placeholders. You must cancel future bookings and decline
        active offers first. Contact your center to arrange removal of any
        remaining scheduling details or staff responsibilities.
      </p>
      <p>
        Local demonstration accounts contain fictional data. This application
        has not been assessed for FERPA or other regulated student-record
        requirements.
      </p>
      <Link href="/app">Back to WaitlistFair</Link>
    </main>
  );
}
