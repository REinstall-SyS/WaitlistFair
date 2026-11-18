"use client";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { ListOrdered, Plus, ShieldCheck } from "lucide-react";
import { useApp, Empty, Badge } from "./workspace";
import { Button } from "./ui/button";
import { Modal } from "./ui/dialog";
import { type Entry, formatDate } from "@/lib/api";
const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const schema = z
  .object({
    service_id: z.string().min(1, "Choose a subject."),
    timezone: z.string().min(1),
    start: z.string().regex(/^\d{2}:\d{2}$/),
    end: z.string().regex(/^\d{2}:\d{2}$/),
    days: z.array(z.string()).min(1, "Choose at least one day."),
  })
  .refine((v) => v.end > v.start, {
    message: "End time must be after start time.",
    path: ["end"],
  });
type Values = z.infer<typeof schema>;
export function Waitlists() {
  const { me, org, data, run, busy } = useApp();
  const [open, setOpen] = useState(false);
  const [withdraw, setWithdraw] = useState<Entry | null>(null);
  const [filter, setFilter] = useState("");
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: {
      timezone: me.user.timezone,
      start: "09:00",
      end: "18:00",
      days: ["1", "2", "3", "4", "5"],
    },
  });
  const admin = org.role === "admin";
  async function submit(v: Values) {
    if (
      await run(
        `/orgs/${org.id}/waitlist`,
        {
          service_id: v.service_id,
          preferences: {
            timezone: v.timezone,
            windows: v.days.map((day) => ({
              day: Number(day),
              start: v.start,
              end: v.end,
            })),
          },
        },
        "POST",
        "You’re on the waitlist. We’ll look for an opening that fits.",
      )
    ) {
      setOpen(false);
      reset();
    }
  }
  const entries = data.waitlist.filter((w) => !filter || w.status === filter);
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">
            {admin ? "A CLEAR PLACE IN LINE" : "STAY OPEN TO WHAT’S NEXT"}
          </span>
          <h1>
            {admin
              ? "People. Preferences. Possibility."
              : "Your next chance starts here."}
          </h1>
          <p>
            {admin
              ? "See who’s waiting and the times that work for them."
              : "Join a subject’s waitlist and we’ll offer you a matching canceled appointment."}
          </p>
        </div>
        {!admin && (
          <Button onClick={() => setOpen(true)}>
            <Plus size={17} />
            Join a waitlist
          </Button>
        )}
      </div>
      <div className="policy-banner">
        <ShieldCheck size={23} />
        <div>
          <strong>First come, first served. With a time that fits.</strong>
          <p>
            We choose the earliest active entry that matches the subject,
            availability, and participation rules, with no conflicting
            reservation. No hidden scores.
          </p>
        </div>
        <span className="badge badge-soft">FIFO · v1</span>
      </div>
      <div className="filter-bar">
        <select
          aria-label="Waitlist status"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        >
          <option value="">All entries</option>
          <option value="active">Active</option>
          <option value="paused">Paused</option>
          <option value="satisfied">Satisfied</option>
          <option value="withdrawn">Withdrawn</option>
        </select>
        <span>
          {entries.length} {entries.length === 1 ? "entry" : "entries"}
        </span>
      </div>
      {entries.length ? (
        <section className="panel">
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  {admin && <th>Student</th>}
                  <th>Subject</th>
                  <th>Availability</th>
                  <th>Joined</th>
                  <th>Status</th>
                  <th>{admin ? "Queue" : "Manage"}</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((w) => (
                  <tr key={w.id}>
                    {admin && (
                      <td>
                        <strong>{w.display_name}</strong>
                        <small>{w.email}</small>
                      </td>
                    )}
                    <td>
                      <strong>{w.subject}</strong>
                      {!admin && w.status === "active" && (
                        <small>
                          {w.queue_ahead} active entries ahead · eligibility
                          varies
                        </small>
                      )}
                    </td>
                    <td>
                      <span className="availability-days">
                        {[
                          ...new Set(
                            w.preferences.windows.map((x) => days[x.day]),
                          ),
                        ].join(", ")}
                      </span>
                      <small>
                        {w.preferences.windows[0]?.start}–
                        {w.preferences.windows[0]?.end} ·{" "}
                        {w.preferences.timezone}
                      </small>
                    </td>
                    <td>{formatDate(w.joined_at, me.user.timezone)}</td>
                    <td>
                      <Badge state={w.status} />
                    </td>
                    <td>
                      {admin
                        ? `${w.queue_ahead} ahead`
                        : (w.status === "active" || w.status === "paused") && (
                            <div className="button-row">
                              <Button
                                variant="ghost"
                                size="sm"
                                disabled={busy}
                                onClick={() =>
                                  run(
                                    `/orgs/${org.id}/waitlist/${w.id}`,
                                    {
                                      status:
                                        w.status === "active"
                                          ? "paused"
                                          : "active",
                                    },
                                    "PATCH",
                                  )
                                }
                              >
                                {w.status === "active" ? "Pause" : "Resume"}
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                disabled={busy}
                                onClick={() => setWithdraw(w)}
                              >
                                Leave
                              </Button>
                            </div>
                          )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : (
        <section className="panel">
          <Empty
            title={
              admin
                ? "No students waiting yet"
                : "Make room for your next opportunity"
            }
            icon={ListOrdered}
          >
            {admin
              ? "Active waitlist entries will appear as students join."
              : "Pick a subject and a few times you’re free. We’ll take it from there."}
          </Empty>
        </section>
      )}
      <Modal
        open={open}
        onOpenChange={setOpen}
        title="Find a time that fits you"
        description="These are your local recurring availability windows. You can pause or leave the waitlist at any time."
      >
        <form onSubmit={handleSubmit(submit)} className="form-grid">
          <label htmlFor="wait-subject">What would you like help with?</label>
          <select id="wait-subject" {...register("service_id")}>
            <option value="">Choose a subject</option>
            {data.services.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          {errors.service_id && (
            <p className="field-error">{errors.service_id.message}</p>
          )}
          <fieldset>
            <legend>Days that work for you</legend>
            <div className="day-picker">
              {days.map((d, i) => (
                <label key={d}>
                  <input type="checkbox" value={i} {...register("days")} />
                  <span>{d}</span>
                </label>
              ))}
            </div>
          </fieldset>
          {errors.days && <p className="field-error">{errors.days.message}</p>}
          <div className="two-fields">
            <div>
              <label htmlFor="wait-start">From</label>
              <input id="wait-start" type="time" {...register("start")} />
            </div>
            <div>
              <label htmlFor="wait-end">Until</label>
              <input id="wait-end" type="time" {...register("end")} />
            </div>
          </div>
          {errors.end && <p className="field-error">{errors.end.message}</p>}
          <label htmlFor="wait-zone">Your IANA time zone</label>
          <input id="wait-zone" {...register("timezone")} />
          <p className="muted">
            An appointment must fit entirely inside your window. Daylight-saving
            changes follow this time zone.
          </p>
          <Button type="submit" disabled={busy}>
            Join waitlist
          </Button>
        </form>
      </Modal>
      <Modal
        open={!!withdraw}
        onOpenChange={(v) => {
          if (!v) setWithdraw(null);
        }}
        title="Leave this waitlist?"
        description="You can join again later, with a new place in line. Your existing confirmed appointments won’t change."
      >
        <div className="button-row">
          <Button variant="outline" onClick={() => setWithdraw(null)}>
            Stay on waitlist
          </Button>
          <Button
            variant="destructive"
            disabled={busy}
            onClick={async () => {
              if (
                withdraw &&
                (await run(
                  `/orgs/${org.id}/waitlist/${withdraw.id}`,
                  { status: "withdrawn" },
                  "PATCH",
                  "You’ve left this waitlist.",
                ))
              )
                setWithdraw(null);
            }}
          >
            Leave waitlist
          </Button>
        </div>
      </Modal>
    </>
  );
}
