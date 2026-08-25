import Link from "next/link";
import { ArrowRight, CheckCircle2, CloudSun, Droplets, ShieldCheck, Sparkles, Sprout } from "lucide-react";
import { Brand } from "@/components/Brand";
import { ThemeToggle } from "@/components/ThemeToggle";

export default function Landing() {
  return (
    <main className="landing">
      <nav className="landing-nav">
        <Brand />
        <div className="nav-actions">
          <ThemeToggle/>
          <Link className="btn btn-ghost" href="/auth/login">Sign in</Link>
          <Link className="btn btn-primary" href="/auth/register">Start secure workspace <ArrowRight size={16} /></Link>
        </div>
      </nav>
      <section className="hero">
        <div>
          <span className="eyebrow"><Sparkles size={14} /> Secure farm operations platform</span>
          <h1>One product for <em>farmers, services and field teams.</em></h1>
          <p className="hero-copy">
            FarmBrain turns each farm&apos;s crop, stage, soil, weather, sensors and history into clear priorities,
            then connects the next action to verified transporters, input shops, machinery providers and workers.
          </p>
          <div className="hero-actions">
            <Link className="btn btn-primary" href="/auth/login">Open working platform <ArrowRight size={17} /></Link>
            <Link className="btn btn-ghost" href="#how">See operations flow</Link>
          </div>
          <div className="trust-row">
            <span><ShieldCheck size={15} /> Secure farm isolation</span>
            <span><CheckCircle2 size={15} /> Verified provider sectors</span>
            <span><CloudSun size={15} /> Multilingual assistant</span>
          </div>
        </div>
        <div className="mock">
          <div className="mock-main product-glass">
            <div className="mock-top">
              <div>
                <small className="muted">Current workspace</small>
                <h3 style={{ margin: "5px 0" }}>Syam Paddy Production Farm</h3>
              </div>
              <span className="secure-pill">SECURE</span>
            </div>
            <div className="health-ring"><b>86%</b></div>
            <p style={{ textAlign: "center", fontWeight: 700 }}>Farm health - ready for action</p>
            <div className="mock-alert"><b>Linked action</b><br /><small>Moisture alert connected to irrigation service and transporter availability.</small></div>
          </div>
          <div className="sensor-float"><Droplets size={21} /><strong>35%</strong><small>Soil moisture - protected farm context</small></div>
        </div>
      </section>
      <section id="how" style={{ maxWidth: 1180, margin: "auto", padding: "0 28px 100px" }}>
        <div className="grid grid-3">
          <div className="card"><Sprout /><h3>1. Farmer workspace</h3><p className="muted">Each farmer sees only authorized farms, crops, sensors, requirements and bookings.</p></div>
          <div className="card"><CloudSun /><h3>2. AI + rule engine</h3><p className="muted">The assistant explains requirements in English, Telugu and Hindi with safety boundaries.</p></div>
          <div className="card"><ArrowRight /><h3>3. Sector execution</h3><p className="muted">Transporters, input shops, machinery providers and workers get separate operational dashboards.</p></div>
        </div>
      </section>
    </main>
  );
}
