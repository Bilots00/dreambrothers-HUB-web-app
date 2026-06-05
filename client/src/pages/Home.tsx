import { Button } from "@/components/ui/button";
import { Activity, Bot, ChevronRight, Cpu, Shield, Target, TrendingUp, Zap } from "lucide-react";
import { useLocation } from "wouter";

const features = [
  { icon: Target, title: "Goal-Based Agent", desc: "Imposta un obiettivo e un budget. L'AI lavora in autonomia per raggiungerlo." },
  { icon: TrendingUp, title: "Ottimizzazione Real-Time", desc: "L'agente accende e spegne inserzioni in base alle performance, riallocando il budget verso le ads vincenti." },
  { icon: Cpu, title: "Audit AI Automatico", desc: "Analisi completa dello storico dell'account con report generato da LLM per identificare opportunità." },
  { icon: Bot, title: "Copy Generator AI", desc: "Generazione automatica di testi e descrizioni per inserzioni basata su dati storici e obiettivo campagna." },
  { icon: Activity, title: "A/B Testing Intelligente", desc: "Creazione e monitoraggio automatico di varianti con valutazione statistica dei risultati." },
  { icon: Shield, title: "Disaster Recovery", desc: "Sistema di alert attivo che notifica il supervisore in caso di anomalie critiche o spesa anomala." },
];

export default function Home() {
  const [, navigate] = useLocation();
  const goToDashboard = () => navigate("/dashboard");

  return (
    <div className="min-h-screen" style={{ background: "oklch(0.1 0.01 260)" }}>
      <header className="flex items-center justify-between px-8 py-5" style={{ borderBottom: "1px solid oklch(0.18 0.015 260)" }}>
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: "var(--gradient-primary)" }}>
            <Bot className="w-5 h-5 text-white" />
          </div>
          <div>
            <div className="font-bold text-foreground">META AI Media Buyer</div>
            <div className="text-xs text-muted-foreground">Autonomous Advertising Agent</div>
          </div>
        </div>
        <Button onClick={goToDashboard} style={{ background: "var(--gradient-primary)" }} className="font-semibold">
          Accedi alla piattaforma <ChevronRight className="w-4 h-4 ml-1" />
        </Button>
      </header>

      <section className="max-w-5xl mx-auto px-8 py-24 text-center">
        <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full text-xs font-medium mb-8" style={{ background: "oklch(0.65 0.2 265 / 0.1)", border: "1px solid oklch(0.65 0.2 265 / 0.25)", color: "oklch(0.75 0.15 265)" }}>
          <div className="pulse-dot pulse-dot-running" />
          Agente AI autonomo per META Ads
        </div>
        <h1 className="text-5xl font-bold text-foreground mb-6 leading-tight">
          Il tuo <span className="text-gradient">Media Buyer AI</span><br />che lavora per te
        </h1>
        <p className="text-lg text-muted-foreground max-w-2xl mx-auto mb-10 leading-relaxed">
          Imposta l'obiettivo, definisci il budget massimo. L'agente AI gestisce autonomamente le tue campagne META — analizza, ottimizza, accende e spegne inserzioni in tempo reale per massimizzare il ROAS.
        </p>
        <Button size="lg" onClick={goToDashboard} className="px-8 font-semibold text-base" style={{ background: "var(--gradient-primary)" }}>
          Inizia ora <ChevronRight className="w-5 h-5 ml-1" />
        </Button>

        <div className="grid grid-cols-4 gap-4 mt-16 max-w-3xl mx-auto">
          {[
            { label: "ROAS Medio", value: "4.2x", color: "oklch(0.65 0.18 145)" },
            { label: "CPA Ridotto", value: "-38%", color: "oklch(0.65 0.2 265)" },
            { label: "Ads Ottimizzate", value: "24/7", color: "oklch(0.72 0.18 75)" },
            { label: "Campagne Gestite", value: "∞", color: "oklch(0.68 0.2 45)" },
          ].map((stat) => (
            <div key={stat.label} className="card-premium rounded-2xl p-5 text-center">
              <div className="text-2xl font-bold mb-1" style={{ color: stat.color }}>{stat.value}</div>
              <div className="text-xs text-muted-foreground">{stat.label}</div>
            </div>
          ))}
        </div>
      </section>

      <section className="max-w-5xl mx-auto px-8 pb-24">
        <h2 className="text-2xl font-bold text-center text-foreground mb-12">
          Tutto ciò che un Media Buyer esperto fa, <span className="text-gradient">automatizzato dall'AI</span>
        </h2>
        <div className="grid grid-cols-3 gap-5">
          {features.map((f) => {
            const Icon = f.icon;
            return (
              <div key={f.title} className="card-premium rounded-2xl p-6 kpi-card">
                <div className="w-10 h-10 rounded-xl flex items-center justify-center mb-4" style={{ background: "oklch(0.65 0.2 265 / 0.1)", border: "1px solid oklch(0.65 0.2 265 / 0.2)" }}>
                  <Icon className="w-5 h-5" style={{ color: "oklch(0.65 0.2 265)" }} />
                </div>
                <h3 className="font-semibold text-foreground mb-2">{f.title}</h3>
                <p className="text-sm text-muted-foreground leading-relaxed">{f.desc}</p>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
