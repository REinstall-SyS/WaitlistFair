export type Organization = {
  id: string;
  name: string;
  timezone: string;
  demo: boolean;
  role: "admin" | "tutor" | "student";
  offer_seconds: number;
};
export type User = {
  id: string;
  email: string;
  display_name: string;
  timezone: string;
  notifications: boolean;
  csrf: string;
};
export type Me = { user: User; organizations: Organization[] };
export type Slot = {
  id: string;
  service_id: string;
  tutor_id: string;
  starts_at: string;
  ends_at: string;
  state: string;
  subject: string;
  tutor: string;
  canceled_at: string | null;
  allocation_requested: boolean;
};
export type Booking = {
  id: string;
  slot_id: string;
  state: string;
  starts_at: string;
  ends_at: string;
  subject: string;
  tutor: string;
  student: string;
  created_at: string;
};
export type Offer = {
  id: string;
  slot_id: string;
  state: string;
  created_at: string;
  expires_at: string;
  starts_at: string;
  ends_at: string;
  subject: string;
  tutor: string;
  explanation: string;
};
export type Preferences = {
  timezone: string;
  windows: { day: number; start: string; end: string }[];
};
export type Entry = {
  id: string;
  student_id: string;
  subject: string;
  status: string;
  joined_at: string;
  preferences: Preferences;
  display_name: string;
  email: string;
  queue_ahead: number;
};
export type Subject = { id: string; name: string; duration_minutes: number };
export type Tutor = {
  id: string;
  user_id: string;
  display_name: string;
  service_ids: string[];
};
export type Member = {
  id: string;
  display_name: string;
  email: string;
  role: string;
  enabled: boolean;
};
export type Dashboard = {
  server_time: string;
  services: Subject[];
  tutors: Tutor[];
  slots: Slot[];
  bookings: Booking[];
  offers: Offer[];
  waitlist: Entry[];
  members?: Member[];
};
export type Decision = {
  id: string;
  slot_id: string;
  created_at: string;
  policy_version: string;
  selected_entry_id: string | null;
  subject: string;
  starts_at: string;
  offer_state: string | null;
  explanation: {
    considered: number;
    eligible: number;
    excluded: number;
    exclusion_reasons: Record<string, number>;
    selected_eligible_position: number;
    tie_breaker: string;
    result: string;
    candidates: { entry_id: string; reasons: string[] | null }[];
    offer_id?: string;
  };
};
export type Metrics = {
  days: number;
  canceled: number;
  refilled: number;
  unfilled: number;
  refill_rate: number | null;
  median_refill_seconds: number | null;
  offers: number;
  accepted: number;
  expired: number;
  acceptance_rate: number | null;
  expired_rate: number | null;
  offers_per_refill: number | null;
};
export async function api<T>(
  path: string,
  options: {
    method?: string;
    body?: unknown;
    csrf?: string;
    key?: string;
  } = {},
): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method: options.method || "GET",
    credentials: "same-origin",
    headers: {
      ...(options.body !== undefined
        ? { "Content-Type": "application/json" }
        : {}),
      ...(options.csrf ? { "X-CSRF-Token": options.csrf } : {}),
      ...(options.key ? { "Idempotency-Key": options.key } : {}),
    },
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Please try again.");
  return data;
}
export function timeLeft(expires: string, now: number) {
  const seconds = Math.max(0, Math.floor((Date.parse(expires) - now) / 1000));
  return seconds >= 3600
    ? `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`
    : `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}
export function formatTime(iso: string, timezone: string) {
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: timezone,
  }).format(new Date(iso));
}
export function formatDate(iso: string, timezone: string) {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: timezone,
  }).format(new Date(iso));
}
