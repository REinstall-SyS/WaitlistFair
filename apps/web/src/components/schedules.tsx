"use client";
import { useMemo, useState } from "react";
import { CalendarDays, Clock3, Plus, Search } from "lucide-react";
import { useApp, Empty, Badge } from "./workspace";
import { Button } from "./ui/button";
import { Modal } from "./ui/dialog";
import { type Slot, formatDate, formatTime } from "@/lib/api";
import { localInstants } from "@/lib/local-time";
export function Schedules({ mode }: { mode: string }) {
  const { me, org, data, busy, run } = useApp();
  const [subject, setSubject] = useState("");
  const [status, setStatus] = useState("");
  const [creating, setCreating] = useState(false);
  const [creatingSubject, setCreatingSubject] = useState("");
  const [localStart, setLocalStart] = useState("");
  const [occurrence, setOccurrence] = useState("");
  const browserZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const startChoices = useMemo(
    () => localInstants(localStart, browserZone),
    [localStart, browserZone],
  );
  const [action, setAction] = useState<{
    slot: Slot;
    kind: "book" | "cancel" | "close";
  } | null>(null);
  const staff = org.role !== "student";
  const history = mode === "appointments";
  const filtered = data.slots.filter(
    (s) =>
      (!subject || s.service_id === subject) &&
      (!status || s.state === status) &&
      (staff || (s.state === "available" && !s.allocation_requested)) &&
      (staff || Date.parse(s.starts_at) > Date.parse(data.server_time)),
  );
  const bookings = data.bookings.filter(
    (b) =>
      !subject ||
      data.slots.find((s) => s.id === b.slot_id)?.service_id === subject,
  );
  async function create(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const start = startChoices.length === 1 ? startChoices[0] : occurrence;
    if (!start || !startChoices.includes(start)) return;
    if (
      await run(
        `/orgs/${org.id}/slots`,
        {
          service_id: form.get("service_id"),
          tutor_id: form.get("tutor_id"),
          starts_at: start,
        },
        "POST",
        "Availability added to your center’s calendar.",
      )
    )
      setCreating(false);
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">
            {staff
              ? "MAKE EVERY OPENING COUNT"
              : history
                ? "TIME FOR A LITTLE PROGRESS"
                : "FIND YOUR NEXT OPPORTUNITY"}
          </span>
          <h1>
            {staff
              ? "Your center’s calendar."
              : history
                ? "Your appointments."
                : "Good help. At a good time."}
          </h1>
          <p>
            {staff
              ? "Manage tutoring sessions and put canceled time back to work."
              : history
                ? "Everything you’ve booked, in one place."
                : "Choose a subject, find a time, and take the next step."}
          </p>
        </div>
        {staff && (
          <Button onClick={() => setCreating(true)}>
            <Plus size={17} />
            Create availability
          </Button>
        )}
      </div>
      <div className="filter-bar">
        <div className="filter-select">
          <Search size={17} />
          <select
            aria-label="Filter by subject"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
          >
            <option value="">All subjects</option>
            {data.services.map((s) => (
              <option value={s.id} key={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>
        {staff && (
          <select
            aria-label="Filter by status"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
          >
            <option value="">All statuses</option>
            <option value="available">Available</option>
            <option value="booked">Booked</option>
            <option value="offer_pending">Offer pending</option>
            <option value="closed">Closed</option>
          </select>
        )}
        <span>Times in {me.user.timezone}</span>
      </div>
      {history ? (
        <section className="panel">
          {bookings.length ? (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Subject & tutor</th>
                    <th>Date</th>
                    <th>Time</th>
                    <th>Status</th>
                    <th>
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {bookings.map((b) => (
                    <tr key={b.id}>
                      <td>
                        <strong>{b.subject}</strong>
                        <small>{b.tutor}</small>
                      </td>
                      <td>{formatDate(b.starts_at, me.user.timezone)}</td>
                      <td>
                        {formatTime(b.starts_at, me.user.timezone)} –{" "}
                        {formatTime(b.ends_at, me.user.timezone)}
                      </td>
                      <td>
                        <Badge state={b.state} />
                      </td>
                      <td>
                        {b.state === "confirmed" &&
                          Date.parse(b.starts_at) >
                            Date.parse(data.server_time) && (
                            <Button
                              variant="ghost"
                              size="sm"
                              disabled={busy}
                              onClick={() => {
                                const slot = data.slots.find(
                                  (s) => s.id === b.slot_id,
                                );
                                if (slot) setAction({ slot, kind: "cancel" });
                              }}
                            >
                              Cancel appointment
                            </Button>
                          )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty title="Your next session starts here">
              Book an available appointment or accept a waitlist offer to add a
              session to your calendar.
            </Empty>
          )}
        </section>
      ) : filtered.length ? (
        <div className={staff ? "calendar-list" : "slot-grid"}>
          {filtered.map((s) => (
            <article
              className={`panel slot-card ${staff ? "calendar-slot" : ""}`}
              key={s.id}
            >
              <div className="slot-date">
                <CalendarDays size={19} />
                <strong>{formatDate(s.starts_at, me.user.timezone)}</strong>
              </div>
              <div className="slot-information">
                <h2>{s.subject}</h2>
                <p>{s.tutor} · One-on-one tutoring</p>
                <span className="slot-time">
                  <Clock3 size={14} />
                  {formatTime(s.starts_at, me.user.timezone)} –{" "}
                  {formatTime(s.ends_at, me.user.timezone)}
                </span>
              </div>
              <div className="slot-actions">
                <Badge state={s.state} />
                {!staff ? (
                  <Button
                    disabled={busy}
                    onClick={() => setAction({ slot: s, kind: "book" })}
                  >
                    Book session
                  </Button>
                ) : (
                  <div className="button-row">
                    {s.state === "booked" && (
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={busy}
                        onClick={() => setAction({ slot: s, kind: "cancel" })}
                      >
                        Cancel booking
                      </Button>
                    )}
                    {s.state !== "closed" && (
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={busy}
                        onClick={() => setAction({ slot: s, kind: "close" })}
                      >
                        Close slot
                      </Button>
                    )}
                  </div>
                )}
              </div>
            </article>
          ))}
        </div>
      ) : (
        <section className="panel">
          <Empty
            title={
              staff ? "A little room to plan" : "No openings that match yet"
            }
          >
            {staff
              ? "Create availability or adjust your filters to see more sessions."
              : "Join a subject’s waitlist and tell us when you can attend. We’ll look for a matching cancellation."}
          </Empty>
        </section>
      )}
      <Modal
        open={creating}
        onOpenChange={setCreating}
        title="Make time for learning"
        description="Create one tutoring appointment. Its duration follows the subject’s settings."
      >
        <form onSubmit={create} className="form-grid">
          <label htmlFor="slot-subject">Subject</label>
          <select
            id="slot-subject"
            name="service_id"
            required
            value={creatingSubject}
            onChange={(e) => setCreatingSubject(e.target.value)}
          >
            <option value="">Choose a subject</option>
            {data.services.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} · {s.duration_minutes} min
              </option>
            ))}
          </select>
          <label htmlFor="slot-tutor">Tutor</label>
          <select id="slot-tutor" name="tutor_id" required>
            <option value="">Choose a tutor</option>
            {data.tutors
              .filter(
                (t) =>
                  (!creatingSubject ||
                    t.service_ids.includes(creatingSubject)) &&
                  (org.role !== "tutor" || t.user_id === me.user.id),
              )
              .map((t) => (
                <option key={t.id} value={t.id}>
                  {t.display_name}
                </option>
              ))}
          </select>
          <label htmlFor="slot-start">Start date and time</label>
          <input
            id="slot-start"
            name="starts_at"
            type="datetime-local"
            value={localStart}
            onChange={(e) => {
              setLocalStart(e.target.value);
              setOccurrence("");
            }}
            required
          />
          {localStart && startChoices.length === 0 && (
            <p role="alert" className="field-error">
              This local time doesn’t exist because clocks change. Choose a
              different time.
            </p>
          )}
          {startChoices.length > 1 && (
            <>
              <label htmlFor="slot-occurrence">
                When clocks repeat, which occurrence?
              </label>
              <select
                id="slot-occurrence"
                value={occurrence}
                onChange={(e) => setOccurrence(e.target.value)}
                required
              >
                <option value="">Choose an occurrence</option>
                {startChoices.map((instant, index) => (
                  <option key={instant} value={instant}>
                    {index === 0 ? "First" : "Second"} occurrence ·{" "}
                    {new Intl.DateTimeFormat("en-US", {
                      timeZone: browserZone,
                      hour: "numeric",
                      minute: "2-digit",
                      timeZoneName: "longOffset",
                    }).format(new Date(instant))}
                  </option>
                ))}
              </select>
            </>
          )}
          <p className="muted">
            Enter the time in your browser’s time zone:{" "}
            {Intl.DateTimeFormat().resolvedOptions().timeZone}. The saved
            appointment is an exact instant.
          </p>
          <Button
            type="submit"
            disabled={
              busy ||
              startChoices.length === 0 ||
              (startChoices.length > 1 && !occurrence)
            }
          >
            Create appointment
          </Button>
        </form>
      </Modal>
      <Modal
        open={!!action}
        onOpenChange={(open) => {
          if (!open) setAction(null);
        }}
        title={
          action?.kind === "book"
            ? "Make this time yours?"
            : action?.kind === "close"
              ? "Close this appointment slot?"
              : "Cancel this booking?"
        }
        description={
          action?.kind === "book"
            ? "We’ll confirm this appointment if it is still available and doesn’t overlap your other sessions."
            : action?.kind === "close"
              ? "This removes the opening from circulation and revokes any pending offer. No replacement student will be selected."
              : "This opens the appointment for the first eligible waitlisted student. The existing booking will be canceled."
        }
      >
        {action && (
          <div className="confirmation-detail">
            <strong>{action.slot.subject}</strong>
            <span>
              {formatDate(action.slot.starts_at, me.user.timezone)} ·{" "}
              {formatTime(action.slot.starts_at, me.user.timezone)}
            </span>
          </div>
        )}
        <div className="button-row">
          <Button variant="outline" onClick={() => setAction(null)}>
            Go back
          </Button>
          <Button
            disabled={busy}
            variant={action?.kind === "book" ? "default" : "destructive"}
            onClick={async () => {
              if (
                action &&
                (await run(
                  `/orgs/${org.id}/slots/${action.slot.id}/${action.kind}`,
                  undefined,
                  "POST",
                  action.kind === "book"
                    ? "Appointment confirmed. We’ll see you there!"
                    : action.kind === "close"
                      ? "Slot closed. Any pending offer has been revoked."
                      : "Booking canceled. We’ve checked the waitlist for a match.",
                ))
              )
                setAction(null);
            }}
          >
            {action?.kind === "book"
              ? "Confirm booking"
              : action?.kind === "close"
                ? "Close appointment"
                : "Confirm cancellation"}
          </Button>
        </div>
      </Modal>
    </>
  );
}
