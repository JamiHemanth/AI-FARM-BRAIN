"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Brand } from "@/components/Brand";
import { ThemeToggle } from "@/components/ThemeToggle";

async function send(url: string, payload: unknown) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  const json = await response.json();
  if (!response.ok) throw new Error(json.message || "Request failed");
  return json.data;
}

export function AuthForm({ mode }: { mode: "login" | "register" }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      if (mode === "register") {
        await send("/api/auth/register", { name, email, password });
      } else {
        await send("/api/auth/login", { email, password });
      }
      router.push("/dashboard");
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Request failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="route-page">
      <form className="auth-card" onSubmit={submit}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <Link href="/"><Brand /></Link>
          <ThemeToggle />
        </div>
        <h1>{mode === "login" ? "Welcome back" : "Create your account"}</h1>
        <p className="muted">{mode === "login" ? "Your farms are waiting for you." : "Start with your first farm in a few minutes."}</p>
        {mode === "register" && (
          <div className="field">
            <label>Full name</label>
            <input className="input" value={name} onChange={(event) => setName(event.target.value)} autoComplete="name" required />
          </div>
        )}
        <div className="field">
          <label>Email address</label>
          <input className="input" type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" required />
        </div>
        <div className="field">
          <label>Password</label>
          <input className="input" type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete={mode === "login" ? "current-password" : "new-password"} required minLength={8} />
        </div>
        {error && <p className="form-error">{error}</p>}
        <button className="btn btn-primary full" disabled={busy}>
          {busy ? "Please wait..." : mode === "login" ? "Sign in" : "Create account"}
        </button>
        <p className="muted" style={{ textAlign: "center", fontSize: 13, marginTop: 20 }}>
          {mode === "login" ? (
            <>New to FarmBrain? <Link href="/auth/register" style={{ color: "var(--green)", fontWeight: 700 }}>Create an account</Link></>
          ) : (
            <>Already have an account? <Link href="/auth/login" style={{ color: "var(--green)", fontWeight: 700 }}>Sign in</Link></>
          )}
        </p>
      </form>
    </main>
  );
}
