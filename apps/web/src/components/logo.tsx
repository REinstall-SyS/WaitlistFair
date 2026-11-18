import { ArrowUpRight } from "lucide-react";
export function Logo() {
  return (
    <span className="brand">
      <span className="brand-mark">
        <ArrowUpRight size={24} strokeWidth={2.6} />
      </span>
      <span>
        Waitlist<span className="brand-light">Fair</span>
        <span className="brand-dot">.</span>
      </span>
    </span>
  );
}
