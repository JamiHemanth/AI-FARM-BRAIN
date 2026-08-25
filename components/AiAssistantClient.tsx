"use client";

import { FormEvent, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Bot, Send, Sparkles } from "lucide-react";
import { api, post } from "@/lib/client";
import { AppShell, FarmSummary } from "@/components/AppShell";
import { useI18n } from "@/lib/i18n";

type User = { name: string; role: string };
type Message = { role: "user" | "ai"; text: string };

export function AiAssistantClient() {
  const { language, t, tx } = useI18n();
  const params = useSearchParams();
  const [farms, setFarms] = useState<FarmSummary[]>([]);
  const [user, setUser] = useState<User>();
  const [farmId, setFarmId] = useState(params.get("farm") || "");
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false);
  const [messages, setMessages] = useState<Message[]>([
    {
      role: "ai",
      text: "Select a farm, then ask what it needs today. I keep every answer inside that farm's crop, stage, sensor, weather and history context."
    }
  ]);

  useEffect(() => {
    Promise.all([api<FarmSummary[]>("/api/farms"), api<User>("/api/auth/me")]).then(([f, u]) => {
      setFarms(f);
      setUser(u);
      if (!farmId && f[0]) setFarmId(f[0].id);
    });
  }, [farmId]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!farmId || !question.trim()) return;
    const q = question;
    setQuestion("");
    setMessages((current) => [...current, { role: "user", text: q }]);
    setBusy(true);
    try {
      const result = await post<{ answer: string; safety: string }>("/api/ai/chat", { farmId, question: q, language });
      setMessages((current) => [...current, { role: "ai", text: `${result.answer}\n\n${result.safety}` }]);
    } catch (error) {
      setMessages((current) => [...current, { role: "ai", text: error instanceof Error ? error.message : "I could not analyze this farm." }]);
    } finally {
      setBusy(false);
    }
  }

  if (!user) return <div className="loader" />;

  return (
    <AppShell farms={farms} selectedFarmId={farmId} user={user}>
      <div className="content" style={{ maxWidth: 920 }}>
        <div className="page-head">
          <div>
            <span className="eyebrow"><Sparkles size={13} /> {t("Farm-context assistant")}</span>
            <h1 style={{ marginTop: 13 }}>{t("Ask your Farm Brain")}</h1>
            <p className="muted">
              {language === "te"
                ? "సమాధానాలు ఎంచుకున్న ఒక ఫారం డేటాను మాత్రమే ఉపయోగిస్తాయి. ఇతర ఫారాల డేటాను కలపవు."
                : language === "hi"
                  ? "उत्तर केवल चुने हुए खेत के डेटा पर आधारित होते हैं. दूसरे खेत का डेटा नहीं मिलाया जाता."
                  : "Answers use one selected farm only. They never borrow another farm's data."}
            </p>
          </div>
        </div>
        <div className="card">
          <div className="field">
            <label>{t("Farm context")}</label>
            <select className="select" value={farmId} onChange={(event) => setFarmId(event.target.value)}>
              <option value="">{t("Select a farm")}</option>
              {farms.map((farm) => (
                <option key={farm.id} value={farm.id}>{tx(farm.name)} - {tx(farm.crops[0]?.crop.name)}</option>
              ))}
            </select>
          </div>
          <div className="chat-window">
            {messages.map((message, index) => (
              <div className={`bubble ${message.role}`} key={index} style={{ whiteSpace: "pre-line" }}>
                {message.role === "ai" && <Bot size={15} />} {message.text}
              </div>
            ))}
            {busy && <div className="bubble ai">{t("Analyzing the selected farm...")}</div>}
          </div>
          <form className="chat-compose" onSubmit={submit}>
            <input className="input" value={question} onChange={(event) => setQuestion(event.target.value)} placeholder={t("What does this farm need today?")} />
            <button className="btn btn-primary" disabled={busy || !farmId} aria-label="Send"><Send size={17} /></button>
          </form>
        </div>
      </div>
    </AppShell>
  );
}
