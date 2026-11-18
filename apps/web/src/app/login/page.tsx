"use client";
import Link from "next/link";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  ArrowRight,
  Check,
  Clock3,
  Mail,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Logo } from "@/components/logo";
import { api } from "@/lib/api";
const schema = z.object({ email: z.email("Enter a valid email address.") });
export default function Login() {
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);
  const {
    register,
    handleSubmit,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<z.infer<typeof schema>>({ resolver: zodResolver(schema) });
  async function submit(values: z.infer<typeof schema>) {
    setError("");
    try {
      await api("/auth/request", { method: "POST", body: values });
      setSent(true);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <main className="login-page">
      <section className="login-story">
        <Logo />
        <div className="story-body">
          <span className="eyebrow light">LESS WAITING. MORE LEARNING.</span>
          <h1>
            A canceled spot.
            <br />A new possibility.
          </h1>
          <p>
            Good tutoring time shouldn’t go to waste. We help the next eligible
            student get there, with a clear place in line and a little less
            back-and-forth.
          </p>
          <div className="journey">
            <div>
              <span>
                <Clock3 size={19} />
              </span>
              <p>
                A spot opens<small>A student cancels their session</small>
              </p>
              <Check size={16} />
            </div>
            <div>
              <span>
                <Sparkles size={19} />
              </span>
              <p>
                You’re next<small>We match your subject and availability</small>
              </p>
              <Check size={16} />
            </div>
            <div>
              <span>
                <Check size={19} />
              </span>
              <p>
                Make it yours<small>Accept your offer before it expires</small>
              </p>
              <ArrowRight size={16} />
            </div>
          </div>
        </div>
        <footer>Built for learning. Designed to be fair.</footer>
      </section>
      <section className="login-form">
        <div className="login-card">
          <span className="eyebrow">YOUR NEXT CHAPTER STARTS HERE</span>
          <h2>{sent ? "Check your inbox" : "A better way to be next."}</h2>
          <p className="muted">
            {sent
              ? "If your address can receive email, your single-use sign-in link will arrive shortly. It expires in 15 minutes."
              : "Sign in to book a session, find an opening, or manage your tutoring center."}
          </p>
          {sent ? (
            <div className="sent-panel">
              <Mail size={30} />
              <h3>Your link is on its way</h3>
              <p>
                Open the email on this device, then choose “Continue to
                WaitlistFair.”
              </p>
              <Button variant="outline" onClick={() => setSent(false)}>
                Use another email
              </Button>
            </div>
          ) : (
            <form onSubmit={handleSubmit(submit)} noValidate>
              <label htmlFor="email">Email address</label>
              <input
                id="email"
                type="email"
                autoComplete="email"
                placeholder="you@university.edu"
                {...register("email")}
                aria-invalid={!!errors.email}
                aria-describedby="email-error"
              />
              <p id="email-error" className="field-error">
                {errors.email?.message}
              </p>
              <Button type="submit" disabled={isSubmitting} className="full">
                {isSubmitting ? "Sending your link…" : "Send sign-in link"}
                <ArrowRight size={17} />
              </Button>
            </form>
          )}
          {error && (
            <p role="alert" className="error-box">
              {error}
            </p>
          )}
          <p className="secure-note">
            <ShieldCheck size={15} /> A secure link. No password to remember.
          </p>
          {process.env.NEXT_PUBLIC_DEMO === "true" && (
            <div className="demo-login">
              <span className="badge badge-amber">LOCAL DEMONSTRATION</span>
              <p>Explore with fictional accounts. Email is captured locally.</p>
              <div className="demo-chips">
                <button
                  onClick={() => {
                    setSent(false);
                    setValue("email", "admin@demo.waitlistfair.test");
                  }}
                >
                  Admin · Alex
                </button>
                <button
                  onClick={() => {
                    setSent(false);
                    setValue("email", "maya@demo.waitlistfair.test");
                  }}
                >
                  Student · Maya
                </button>
                <button
                  onClick={() => {
                    setSent(false);
                    setValue("email", "leo@demo.waitlistfair.test");
                  }}
                >
                  Student · Leo
                </button>
              </div>
              <a href="http://localhost:8025" target="_blank" rel="noreferrer">
                Open Mailpit inbox <ArrowRight size={14} />
              </a>
            </div>
          )}
          <p className="login-footer">
            By continuing, you agree to use your center’s scheduling rules.
            <br />
            <Link href="/privacy">How we look after your data</Link>
          </p>
        </div>
      </section>
    </main>
  );
}
