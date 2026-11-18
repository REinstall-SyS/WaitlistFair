"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Logo } from "@/components/logo";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
export default function Verify() {
  const [token, setToken] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const router = useRouter();
  useEffect(() => {
    setToken(
      new URLSearchParams(window.location.hash.slice(1)).get("token") || "",
    );
    history.replaceState(null, "", window.location.pathname);
  }, []);
  async function verify() {
    setBusy(true);
    try {
      await api("/auth/verify", { method: "POST", body: { token } });
      router.replace("/app");
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }
  return (
    <main className="center-page">
      <Logo />
      <div className="panel verify-card">
        <span className="eyebrow">ONE LAST STEP</span>
        <h1>You’re almost in.</h1>
        <p className="muted">Continue to securely sign in on this device.</p>
        {error && (
          <p role="alert" className="error-box">
            {error}
          </p>
        )}
        <Button onClick={verify} disabled={!token || busy}>
          {busy ? "Signing you in…" : "Continue to WaitlistFair"}
        </Button>
        <Link href="/login">Request a new sign-in link</Link>
      </div>
    </main>
  );
}
