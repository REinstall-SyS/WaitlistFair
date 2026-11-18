"use client";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowRight,
  ArrowUpRight,
  CalendarDays,
  Clock3,
  ListOrdered,
  ShieldCheck,
  Ticket,
  TrendingUp,
} from "lucide-react";
import { useApp, Empty, Badge } from "./workspace";
import { Button } from "./ui/button";
import { api, type Metrics, formatDate, formatTime } from "@/lib/api";
export function Overview() {
  const { me, org, data } = useApp();
  const staff = org.role !== "student";
  const upcoming = data.bookings
    .filter(
      (b) =>
        b.state === "confirmed" &&
        Date.parse(b.starts_at) > Date.parse(data.server_time),
    )
    .sort((a, b) => a.starts_at.localeCompare(b.starts_at));
  const offers = data.offers.filter((o) => o.state === "pending");
  const waitlists = data.waitlist.filter((w) => w.status === "active");
  const metrics = useQuery({
    queryKey: ["metrics", org.id, 30],
    queryFn: () => api<Metrics>(`/orgs/${org.id}/metrics?days=30`),
    enabled: org.role === "admin",
  });
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">
            {staff ? "A LITTLE LESS COORDINATION" : "MAKE ROOM FOR WHAT’S NEXT"}
          </span>
          <h1>
            {staff
              ? "Good things are lining up."
              : `Welcome back, ${me.user.display_name.split(" ")[0]}.`}
          </h1>
          <p>
            {staff
              ? "A clear view of your center, and the openings that become opportunities."
              : "Your next learning opportunity could be just around the corner."}
          </p>
        </div>
        <Button asChild variant="outline">
          <Link href={staff ? "/app/calendar" : "/app/find"}>
            <CalendarDays size={17} />
            {staff ? "View calendar" : "Find a session"}
          </Link>
        </Button>
      </div>
      <div className="stat-grid">
        <Stat
          label={staff ? "Upcoming bookings" : "Upcoming sessions"}
          value={upcoming.length}
          note={
            staff
              ? "Confirmed tutoring appointments"
              : "Time set aside for your learning"
          }
          icon={CalendarDays}
        />
        <Stat
          label={staff ? "Students waiting" : "Active waitlists"}
          value={waitlists.length}
          note={
            staff
              ? "Active entries across your subjects"
              : "We’ll look for a time that fits"
          }
          icon={ListOrdered}
        />
        <Stat
          label="Pending offers"
          value={offers.length}
          note={
            offers.length
              ? "A response is the next step"
              : "We’ll let you know when a spot opens"
          }
          icon={Ticket}
        />
      </div>
      {!staff && offers.length > 0 ? (
        <div className="opportunity-banner">
          <span className="opportunity-icon">
            <Ticket size={27} />
          </span>
          <div>
            <span className="eyebrow">YOUR TURN IS HERE</span>
            <h2>A new opening, just for you.</h2>
            <p>
              {offers[0].subject} with {offers[0].tutor} ·{" "}
              {formatDate(offers[0].starts_at, me.user.timezone)}
            </p>
          </div>
          <Button asChild>
            <Link href="/app/offers">
              Review your offer <ArrowRight size={17} />
            </Link>
          </Button>
        </div>
      ) : (
        <div className="welcome-banner">
          <div>
            <span className="eyebrow">
              {staff ? "EVERY OPENING MATTERS" : "GOOD TIMING STARTS WITH YOU"}
            </span>
            <h2>
              {staff
                ? "Turn a cancellation into someone’s next step."
                : "A little flexibility. A lot of possibility."}
            </h2>
            <p>
              {staff
                ? "When a booked session is canceled, we offer it to the first eligible student and keep the reason on record."
                : "Tell us when you’re free. When a matching appointment opens, we’ll save your place with a time-limited offer."}
            </p>
            <Link href={staff ? "/app/history" : "/app/waitlist"}>
              {staff ? "Explore allocation history" : "Set up your waitlist"}{" "}
              <ArrowRight size={16} />
            </Link>
          </div>
          <div className="banner-art" aria-hidden="true">
            <div className="art-calendar">
              <span>YOUR NEXT OPPORTUNITY</span>
              <CalendarDays size={52} strokeWidth={1.1} />
              <div>
                <span />
                <span />
                <span className="art-dot" />
                <span />
                <span />
              </div>
            </div>
            <span className="art-check">
              <ShieldCheck size={24} />
            </span>
          </div>
        </div>
      )}
      <div className="overview-columns">
        <section className="panel">
          <div className="panel-heading">
            <div>
              <h2>
                {staff ? "Coming up at your center" : "Your upcoming sessions"}
              </h2>
              <p>
                {staff
                  ? "Confirmed appointments, in order"
                  : "A little progress, already on the calendar"}
              </p>
            </div>
            <Link
              href={staff ? "/app/calendar" : "/app/appointments"}
              aria-label="View all appointments"
            >
              <ArrowUpRight size={21} />
            </Link>
          </div>
          {upcoming.length ? (
            upcoming.slice(0, 4).map((b) => (
              <div key={b.id} className="session-row">
                <div className="date-tile">
                  <span>
                    {new Intl.DateTimeFormat("en", {
                      month: "short",
                      timeZone: me.user.timezone,
                    }).format(new Date(b.starts_at))}
                  </span>
                  <strong>
                    {new Intl.DateTimeFormat("en", {
                      day: "numeric",
                      timeZone: me.user.timezone,
                    }).format(new Date(b.starts_at))}
                  </strong>
                </div>
                <div className="grow">
                  <h3>{b.subject}</h3>
                  <p>
                    {staff ? `${b.student} · ` : ""}
                    {b.tutor}
                  </p>
                  <small>
                    <Clock3 size={12} />
                    {formatTime(b.starts_at, me.user.timezone)} –{" "}
                    {formatTime(b.ends_at, me.user.timezone)}
                  </small>
                </div>
                <Badge state="confirmed" />
              </div>
            ))
          ) : (
            <Empty title="Your calendar has room">
              {staff
                ? "Create availability to get your tutoring schedule started."
                : "Book an open session or join a waitlist. Your confirmed appointments will appear here."}
            </Empty>
          )}
        </section>
        <section className="panel">
          <div className="panel-heading">
            <div>
              <h2>{staff ? "Waitlist at a glance" : "Your place in line"}</h2>
              <p>First come, first served among eligible students</p>
            </div>
            <ListOrdered size={20} />
          </div>
          {waitlists.length ? (
            waitlists.slice(0, 4).map((w) => (
              <div key={w.id} className="waitlist-summary">
                <span className="subject-icon">
                  <ListOrdered size={18} />
                </span>
                <div className="grow">
                  <h3>{w.subject}</h3>
                  <p>
                    {staff
                      ? w.display_name
                      : `${w.queue_ahead} active ${w.queue_ahead === 1 ? "entry" : "entries"} ahead`}
                  </p>
                </div>
                <Badge state="active" />
              </div>
            ))
          ) : (
            <Empty title="No active waitlists" icon={ListOrdered}>
              A waitlist keeps the next opportunity within reach.
            </Empty>
          )}
          <div className="panel-footnote">
            <ShieldCheck size={17} />
            <p>
              Availability and existing appointments determine who’s eligible
              for each opening. Queue position is not a guarantee.
            </p>
          </div>
        </section>
      </div>
      {org.role === "admin" && (
        <section className="panel metrics-panel">
          <div className="panel-heading">
            <div>
              <span className="eyebrow">OPPORTUNITIES RECOVERED</span>
              <h2>What your center made possible</h2>
              <p>Last 30 days · Based on recorded cancellations and offers</p>
            </div>
            <TrendingUp size={23} />
          </div>
          {metrics.isError ? (
            <p role="alert" className="error-box">
              Could not load metrics.
            </p>
          ) : !metrics.data || metrics.data.canceled === 0 ? (
            <Empty title="Your refill story starts here" icon={TrendingUp}>
              Once your center reallocates a canceled session, you’ll see its
              real impact here.
            </Empty>
          ) : (
            <div className="metrics-grid">
              <div>
                <strong>
                  {metrics.data.refilled}
                  <small> / {metrics.data.canceled}</small>
                </strong>
                <span>Canceled sessions refilled</span>
              </div>
              <div>
                <strong>{metrics.data.refill_rate ?? "—"}%</strong>
                <span>Refill rate</span>
              </div>
              <div>
                <strong>
                  {metrics.data.median_refill_seconds === null
                    ? "—"
                    : `${Math.round(metrics.data.median_refill_seconds / 60)}m`}
                </strong>
                <span>Median time to refill</span>
              </div>
              <div>
                <strong>{metrics.data.acceptance_rate ?? "—"}%</strong>
                <span>Offer acceptance rate</span>
              </div>
              <div>
                <strong>{metrics.data.expired}</strong>
                <span>Expired offers</span>
              </div>
              <div>
                <strong>{metrics.data.unfilled}</strong>
                <span>Currently unfilled</span>
              </div>
              <div>
                <strong>{metrics.data.offers_per_refill ?? "—"}</strong>
                <span>Offers per refill</span>
              </div>
              <div>
                <strong>{metrics.data.expired_rate ?? "—"}%</strong>
                <span>Expired offer rate</span>
              </div>
            </div>
          )}
        </section>
      )}
    </>
  );
}
function Stat({
  label,
  value,
  note,
  icon: Icon,
}: {
  label: string;
  value: number;
  note: string;
  icon: typeof CalendarDays;
}) {
  return (
    <div className="stat-card">
      <div>
        <span>{label}</span>
        <span className="stat-icon">
          <Icon size={19} />
        </span>
      </div>
      <strong>{value.toString().padStart(2, "0")}</strong>
      <p>{note}</p>
    </div>
  );
}
