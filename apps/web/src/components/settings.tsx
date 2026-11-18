"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { History, Plus, ShieldCheck } from "lucide-react";
import { useApp, Empty, Badge } from "./workspace";
import { Button } from "./ui/button";
import { Modal } from "./ui/dialog";
import { api, type Decision, formatDate, formatTime } from "@/lib/api";
export function HistoryView() {
  const { org, me } = useApp();
  const [tab, setTab] = useState("decisions");
  const [offset, setOffset] = useState(0);
  const [selected, setSelected] = useState<Decision | null>(null);
  const decisions = useQuery({
    queryKey: ["decisions", org.id, offset],
    queryFn: () =>
      api<{ items: Decision[] }>(
        `/orgs/${org.id}/decisions?limit=20&offset=${offset}`,
      ),
    enabled: org.role === "admin",
    refetchInterval: 10000,
  });
  const audit = useQuery({
    queryKey: ["audit", org.id, offset],
    queryFn: () =>
      api<{
        items: {
          id: number;
          action: string;
          actor: string;
          created_at: string;
          target_id: string;
        }[];
      }>(`/orgs/${org.id}/audit?limit=20&offset=${offset}`),
    enabled: org.role === "admin" && tab === "audit",
    refetchInterval: 10000,
  });
  if (org.role !== "admin")
    return (
      <Empty title="Administrator access required">
        Your center administrator can review allocation history.
      </Empty>
    );
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">EVERY SELECTION HAS A REASON</span>
          <h1>Fairness you can follow.</h1>
          <p>
            A real record of who was eligible, which policy ran, and what
            happened next.
          </p>
        </div>
        <span className="badge badge-soft">
          <ShieldCheck size={14} />
          FIFO · v1
        </span>
      </div>
      <div className="tabs">
        <button
          className={tab === "decisions" ? "selected" : ""}
          onClick={() => {
            setTab("decisions");
            setOffset(0);
          }}
        >
          Allocation decisions
        </button>
        <button
          className={tab === "audit" ? "selected" : ""}
          onClick={() => {
            setTab("audit");
            setOffset(0);
          }}
        >
          Audit trail
        </button>
      </div>
      <section className="panel">
        {decisions.isError || audit.isError ? (
          <p className="error-box" role="alert">
            Unable to load history. Refresh to try again.
          </p>
        ) : tab === "decisions" ? (
          decisions.data?.items.length ? (
            <div className="decision-list">
              {decisions.data.items.map((d) => (
                <button
                  className="decision-row"
                  key={d.id}
                  onClick={() => setSelected(d)}
                >
                  <span className="subject-icon">
                    <History size={20} />
                  </span>
                  <div className="grow">
                    <h3>{d.subject}</h3>
                    <p>
                      {d.explanation.considered} evaluated ·{" "}
                      {d.explanation.excluded} excluded ·{" "}
                      {d.explanation.eligible} eligible
                    </p>
                    <small>
                      {formatDate(d.created_at, me.user.timezone)} ·{" "}
                      {formatTime(d.created_at, me.user.timezone)} ·{" "}
                      {d.policy_version}
                    </small>
                  </div>
                  <Badge state={d.offer_state || "no_match"} />
                  <span className="detail-link">View reason →</span>
                </button>
              ))}
            </div>
          ) : (
            <Empty title="The story is waiting to begin" icon={History}>
              Cancel a booked appointment to see the eligibility engine evaluate
              the waitlist and record its selection.
            </Empty>
          )
        ) : audit.data?.items.length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Action</th>
                  <th>Actor</th>
                  <th>When</th>
                  <th>Record</th>
                </tr>
              </thead>
              <tbody>
                {audit.data.items.map((e) => (
                  <tr key={e.id}>
                    <td>{e.action.replace(/([a-z])([A-Z])/g, "$1 $2")}</td>
                    <td>{e.actor}</td>
                    <td>
                      {formatDate(e.created_at, me.user.timezone)} ·{" "}
                      {formatTime(e.created_at, me.user.timezone)}
                    </td>
                    <td>
                      <code>{e.target_id?.slice(0, 8) || "—"}</code>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty title="No events yet">
            Your center’s scheduling activity will appear here.
          </Empty>
        )}
      </section>
      <div className="pagination">
        <Button
          variant="outline"
          disabled={offset === 0}
          onClick={() => setOffset(Math.max(0, offset - 20))}
        >
          Previous
        </Button>
        <span>Page {offset / 20 + 1}</span>
        <Button
          variant="outline"
          disabled={
            (tab === "decisions"
              ? decisions.data?.items.length
              : audit.data?.items.length) !== 20
          }
          onClick={() => setOffset(offset + 20)}
        >
          Next
        </Button>
      </div>
      <Modal
        open={!!selected}
        onOpenChange={(v) => {
          if (!v) setSelected(null);
        }}
        title="Why this student was next"
        description="Fairness here means following the declared allocation policy. It does not establish demographic or moral fairness."
      >
        {selected && (
          <div className="explanation">
            <div className="explanation-summary">
              <strong>{selected.explanation.considered}</strong>
              <span>waitlist entries evaluated</span>
            </div>
            <dl>
              <div>
                <dt>Policy</dt>
                <dd>{selected.policy_version}</dd>
              </div>
              <div>
                <dt>Eligible / excluded</dt>
                <dd>
                  {selected.explanation.eligible} /{" "}
                  {selected.explanation.excluded}
                </dd>
              </div>
              <div>
                <dt>Selected eligible position</dt>
                <dd>
                  {selected.selected_entry_id
                    ? "1 — earliest eligible"
                    : "No eligible candidate"}
                </dd>
              </div>
              <div>
                <dt>Tie-breaker</dt>
                <dd>Join time, then stable entry ID</dd>
              </div>
              <div>
                <dt>Outcome</dt>
                <dd>
                  <Badge
                    state={selected.offer_state || selected.explanation.result}
                  />
                </dd>
              </div>
            </dl>
            <h3>Recorded exclusion reasons</h3>
            {Object.keys(selected.explanation.exclusion_reasons).length ? (
              <ul className="reason-list">
                {Object.entries(selected.explanation.exclusion_reasons).map(
                  ([reason, count]) => (
                    <li key={reason}>
                      <span>{reason.replaceAll("_", " ")}</span>
                      <strong>{count}</strong>
                    </li>
                  ),
                )}
              </ul>
            ) : (
              <p className="muted">All evaluated entries were eligible.</p>
            )}
            <p className="muted">
              One entry can have more than one exclusion reason. Counts reflect
              the recorded evaluation; selected candidates are rechecked while
              locked.
            </p>
            <details>
              <summary>Candidate evidence and identifiers</summary>
              <pre>{JSON.stringify(selected.explanation, null, 2)}</pre>
            </details>
          </div>
        )}
      </Modal>
    </>
  );
}
export function OrganizationSettings() {
  const { org, data, run, busy } = useApp();
  const [modal, setModal] = useState("");
  if (org.role !== "admin")
    return (
      <Empty title="Administrator access required">
        Ask your center administrator to update organization settings.
      </Empty>
    );
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    let path = "",
      body: unknown;
    if (modal === "subject") {
      path = "services";
      body = {
        name: f.get("name"),
        duration_minutes: Number(f.get("duration")),
      };
    } else if (modal === "member") {
      path = "members";
      body = {
        display_name: f.get("name"),
        email: f.get("email"),
        role: f.get("role"),
      };
    } else {
      path = "tutors";
      body = {
        user_id: f.get("user_id"),
        service_ids: f.getAll("service_ids"),
      };
    }
    if (await run(`/orgs/${org.id}/${path}`, body)) setModal("");
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">A CENTER THAT RUNS A LITTLE SMOOTHER</span>
          <h1>The details that make it work.</h1>
          <p>Manage your subjects, tutors, memberships, and offer windows.</p>
        </div>
      </div>
      <section className="panel settings-panel">
        <div>
          <h2>Offer response window</h2>
          <p>
            New offers use this duration, capped at the appointment start time.
            Existing deadlines stay fixed.
          </p>
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            void run(
              `/orgs/${org.id}/settings`,
              { offer_seconds: Number(f.get("minutes")) * 60 },
              "PATCH",
            );
          }}
          className="inline-form"
        >
          <label className="sr-only" htmlFor="offer-minutes">
            Response window in minutes
          </label>
          <input
            id="offer-minutes"
            name="minutes"
            type="number"
            min="1"
            max="1440"
            defaultValue={org.offer_seconds / 60}
            required
          />
          <span>minutes</span>
          <Button disabled={busy} type="submit">
            Save window
          </Button>
        </form>
      </section>
      <section className="panel history-panel">
        <div className="panel-heading">
          <div>
            <h2>Subjects</h2>
            <p>What your center helps students learn</p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setModal("subject")}
          >
            <Plus size={15} />
            Add subject
          </Button>
        </div>
        {data.services.map((s) => (
          <div key={s.id} className="setting-row">
            <strong>{s.name}</strong>
            <span>{s.duration_minutes} minutes</span>
          </div>
        ))}
        {!data.services.length && (
          <p className="table-empty">Add your first subject to get started.</p>
        )}
      </section>
      <section className="panel history-panel">
        <div className="panel-heading">
          <div>
            <h2>Tutors</h2>
            <p>Connect a staff member with the subjects they teach</p>
          </div>
          <Button variant="outline" size="sm" onClick={() => setModal("tutor")}>
            <Plus size={15} />
            Assign tutor
          </Button>
        </div>
        {data.tutors.map((t) => (
          <div className="setting-row" key={t.id}>
            <strong>{t.display_name}</strong>
            <span>
              {data.services
                .filter((s) => t.service_ids.includes(s.id))
                .map((s) => s.name)
                .join(", ")}
            </span>
          </div>
        ))}
        {!data.tutors.length && (
          <p className="table-empty">
            Add a tutor member, then assign their subjects.
          </p>
        )}
      </section>
      <section className="panel history-panel">
        <div className="panel-heading">
          <div>
            <h2>Membership</h2>
            <p>
              Add students and staff by email. They’ll sign in with a secure
              link.
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setModal("member")}
          >
            <Plus size={15} />
            Add member
          </Button>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Role</th>
              </tr>
            </thead>
            <tbody>
              {data.members?.map((m) => (
                <tr key={m.id}>
                  <td>{m.display_name}</td>
                  <td>{m.email}</td>
                  <td>
                    <Badge state={m.role} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <Modal
        open={!!modal}
        onOpenChange={(v) => {
          if (!v) setModal("");
        }}
        title={
          modal === "subject"
            ? "A new subject to explore"
            : modal === "member"
              ? "Make room for someone new"
              : "Connect a tutor with their subjects"
        }
      >
        <form className="form-grid" onSubmit={submit}>
          {modal === "subject" ? (
            <>
              <label htmlFor="subject-name">Subject name</label>
              <input id="subject-name" name="name" required maxLength={100} />
              <label htmlFor="subject-duration">
                Appointment duration in minutes
              </label>
              <input
                id="subject-duration"
                name="duration"
                type="number"
                min="15"
                max="240"
                defaultValue={45}
                required
              />
            </>
          ) : modal === "member" ? (
            <>
              <label htmlFor="member-name">Display name</label>
              <input id="member-name" name="name" required maxLength={100} />
              <label htmlFor="member-email">Email</label>
              <input id="member-email" name="email" type="email" required />
              <label htmlFor="member-role">Role</label>
              <select id="member-role" name="role">
                <option value="student">Student</option>
                <option value="tutor">Tutor</option>
                <option value="admin">Administrator</option>
              </select>
              <p className="muted">
                Adding an existing email updates its role in this center.
              </p>
            </>
          ) : (
            <>
              <label htmlFor="tutor-member">Staff member</label>
              <select id="tutor-member" name="user_id" required>
                <option value="">Choose a member</option>
                {data.members
                  ?.filter((m) => m.role !== "student")
                  .map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.display_name}
                    </option>
                  ))}
              </select>
              <fieldset>
                <legend>Supported subjects</legend>
                {data.services.map((s) => (
                  <label className="checkbox-row" key={s.id}>
                    <input type="checkbox" name="service_ids" value={s.id} />
                    {s.name}
                  </label>
                ))}
              </fieldset>
            </>
          )}
          <Button type="submit" disabled={busy}>
            Save changes
          </Button>
        </form>
      </Modal>
    </>
  );
}
export function Profile() {
  const router = useRouter();
  const { me, run, busy } = useApp();
  const [deleting, setDeleting] = useState(false);
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">MAKE YOURSELF AT HOME</span>
          <h1>A few things about you.</h1>
          <p>Keep your profile, time zone, and email preferences up to date.</p>
        </div>
      </div>
      <section className="panel profile-panel">
        <h2>Personal details</h2>
        <form
          className="form-grid"
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            void run(
              "/account",
              {
                display_name: f.get("name"),
                timezone: f.get("timezone"),
                notifications: f.get("notifications") === "on",
              },
              "PATCH",
            );
          }}
        >
          <label htmlFor="profile-name">Display name</label>
          <input
            id="profile-name"
            name="name"
            defaultValue={me.user.display_name}
            required
            maxLength={100}
          />
          <label htmlFor="profile-email">Email address</label>
          <input id="profile-email" value={me.user.email} disabled />
          <label htmlFor="profile-zone">IANA time zone</label>
          <input
            id="profile-zone"
            name="timezone"
            defaultValue={me.user.timezone}
            required
          />
          <label className="checkbox-row">
            <input
              type="checkbox"
              name="notifications"
              defaultChecked={me.user.notifications}
            />
            Email me about offers and appointments
          </label>
          <p className="muted">
            If you turn off emails, check My offers regularly. Offer deadlines
            still apply. Sign-in emails are always sent.
          </p>
          <Button type="submit" disabled={busy}>
            Save profile
          </Button>
        </form>
      </section>
      <section className="panel danger-panel">
        <h2>Delete your account</h2>
        <p>
          Cancel upcoming appointments and decline active offers first. Staff
          must transfer their responsibilities through their administrator.
        </p>
        <Button variant="destructive" onClick={() => setDeleting(true)}>
          Delete account
        </Button>
      </section>
      <Modal
        open={deleting}
        onOpenChange={setDeleting}
        title="Delete your account?"
        description="Your sign-in access will be removed and your name and email will be anonymized. Historical scheduling records stay with your center."
      >
        <div className="button-row">
          <Button variant="outline" onClick={() => setDeleting(false)}>
            Keep account
          </Button>
          <Button
            variant="destructive"
            disabled={busy}
            onClick={async () => {
              if (
                await run("/account", undefined, "DELETE", "Account deleted.")
              )
                router.replace("/login");
            }}
          >
            Permanently delete account
          </Button>
        </div>
      </Modal>
    </>
  );
}
