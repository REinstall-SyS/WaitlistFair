"use client";
import { useEffect, useState } from "react";
import { Clock3, ShieldCheck, Ticket } from "lucide-react";
import { useApp, Empty, Badge } from "./workspace";
import { Button } from "./ui/button";
import { Modal } from "./ui/dialog";
import { type Offer, formatDate, formatTime, timeLeft } from "@/lib/api";
export function Offers() {
  const { me, org, data, run, busy } = useApp();
  const [now, setNow] = useState(() => Date.parse(data.server_time));
  const [declining, setDeclining] = useState<Offer | null>(null);
  useEffect(() => {
    const serverStart = Date.parse(data.server_time);
    const started = performance.now();
    setNow(serverStart);
    const timer = setInterval(
      () => setNow(serverStart + performance.now() - started),
      1000,
    );
    return () => clearInterval(timer);
  }, [data.server_time]);
  const pending = data.offers.filter((o) => o.state === "pending");
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">A SPOT WITH YOUR NAME ON IT</span>
          <h1>Your offers.</h1>
          <p>
            Review a matching appointment and decide if the timing is right.
          </p>
        </div>
      </div>
      <p className="timezone-note">
        All appointment times shown in {me.user.timezone}. Offer deadlines are
        checked by the server.
      </p>
      {pending.length ? (
        <div className="offer-grid">
          {pending.map((o) => {
            const expired = Date.parse(o.expires_at) <= now;
            return (
              <article className="panel offer-card" key={o.id}>
                <div className="offer-card-top">
                  <span className="subject-icon">
                    <Ticket size={23} />
                  </span>
                  <span
                    className={`offer-countdown ${expired ? "expired" : ""}`}
                  >
                    <Clock3 size={15} />
                    {expired
                      ? "Deadline passed"
                      : `${timeLeft(o.expires_at, now)} remaining`}
                  </span>
                </div>
                <h2>{o.subject}</h2>
                <p className="muted">with {o.tutor}</p>
                <div className="offer-details">
                  <strong>{formatDate(o.starts_at, me.user.timezone)}</strong>
                  <span>
                    {formatTime(o.starts_at, me.user.timezone)} –{" "}
                    {formatTime(o.ends_at, me.user.timezone)}
                  </span>
                  <small>
                    Respond by {formatDate(o.expires_at, me.user.timezone)},{" "}
                    {formatTime(o.expires_at, me.user.timezone)}
                  </small>
                </div>
                <div className="offer-reason">
                  <ShieldCheck size={19} />
                  <p>{o.explanation}</p>
                </div>
                <div className="button-row">
                  <Button
                    disabled={busy || expired}
                    onClick={() =>
                      run(
                        `/orgs/${org.id}/offers/${o.id}/accept`,
                        undefined,
                        "POST",
                        "You’re booked! Find the details in My appointments.",
                      )
                    }
                  >
                    Accept appointment
                  </Button>
                  <Button
                    variant="outline"
                    disabled={busy || expired}
                    onClick={() => setDeclining(o)}
                  >
                    Decline
                  </Button>
                </div>
                {expired && (
                  <p className="muted">
                    This offer can no longer be accepted. We’re updating its
                    status.
                  </p>
                )}
              </article>
            );
          })}
        </div>
      ) : (
        <section className="panel">
          <Empty title="The next opportunity is on its way" icon={Ticket}>
            When an appointment matches your waitlist preferences, your offer
            will appear here. Check your email too.
          </Empty>
        </section>
      )}
      <section className="panel history-panel">
        <div className="panel-heading">
          <h2>Previous offers</h2>
        </div>
        {data.offers.filter((o) => o.state !== "pending").length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Subject</th>
                  <th>Appointment</th>
                  <th>Tutor</th>
                  <th>Outcome</th>
                </tr>
              </thead>
              <tbody>
                {data.offers
                  .filter((o) => o.state !== "pending")
                  .map((o) => (
                    <tr key={o.id}>
                      <td>{o.subject}</td>
                      <td>
                        {formatDate(o.starts_at, me.user.timezone)} ·{" "}
                        {formatTime(o.starts_at, me.user.timezone)}
                      </td>
                      <td>{o.tutor}</td>
                      <td>
                        <Badge state={o.state} />
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="table-empty">No previous offers yet.</p>
        )}
      </section>
      <Modal
        open={!!declining}
        onOpenChange={(v) => {
          if (!v) setDeclining(null);
        }}
        title="Pass on this appointment?"
        description="We’ll offer this opening to the next eligible student. Your waitlist entry stays active for other appointments."
      >
        <div className="button-row">
          <Button variant="outline" onClick={() => setDeclining(null)}>
            Keep offer
          </Button>
          <Button
            disabled={busy}
            onClick={async () => {
              if (
                declining &&
                (await run(
                  `/orgs/${org.id}/offers/${declining.id}/decline`,
                  undefined,
                  "POST",
                  "Offer declined. You’re still on the waitlist for other openings.",
                ))
              )
                setDeclining(null);
            }}
          >
            Decline offer
          </Button>
        </div>
      </Modal>
    </>
  );
}
