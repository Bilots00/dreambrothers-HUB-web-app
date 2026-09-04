import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { useLocation } from "wouter";
import { Fragment, useMemo, useState } from "react";
import {
  Bar, BarChart, CartesianGrid, Cell, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import {
  Activity, AlertTriangle, ArrowDown, ArrowUp, Bot, CandlestickChart, ChevronDown, ChevronRight, Info, RefreshCw, ShieldCheck, Skull, Target, Trophy, Wallet,
} from "lucide-react";

/**
 * Trading Lab — il fondo personale, a confronto col non fare niente.
 *
 * La pagina segue la regola della guida TradingLab: mostra, non calcola e non
 * decide. I numeri arrivano dal VPS (ciclo del trader) passando dal server; il
 * colore segue la metrica, non il segno; un dato che non esiste si dichiara
 * assente, mai zero. E accanto a ogni numero verde c'e' la riga piccola che dice
 * se il campione basta a crederci.
 */

type LibroId = "principale" | "intraday";

const LIBRI: Record<LibroId, { nome: string; sotto: string; colore: string }> = {
  principale: { nome: "Trader COT · paziente", sotto: "Estremi del posizionamento, poche operazioni al mese", colore: "oklch(0.65 0.2 265)" },
  intraday: { nome: "Trader intraday · copy", sotto: "Setup propri + posizionamento dei conti vincenti (Hyperliquid), esecuzione Bybit demo", colore: "oklch(0.72 0.18 75)" },
};

const VERDE = "oklch(0.65 0.18 145)";
const ROSSO = "oklch(0.55 0.22 25)";
const BTC = "oklch(0.72 0.18 75)";
const MUTO = "oklch(0.55 0.02 260)";

const n = (x: number | null | undefined, d = 2) => (x == null || Number.isNaN(x) ? "—" : x.toFixed(d));
const pct = (x: number | null | undefined, d = 2) => (x == null || Number.isNaN(x) ? "—" : `${x >= 0 ? "+" : ""}${x.toFixed(d)}%`);
const usd = (x: number | null | undefined) => (x == null || Number.isNaN(x) ? "—" : `${x.toLocaleString("it-IT", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} $`);
const ora = (t: string | null | undefined) => (t ? new Date(t).toLocaleString("it-IT", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "—");
const giornoBreve = (t: string) => t.slice(5, 10).split("-").reverse().join("/");
const colorePnl = (x: number | null | undefined) => (x == null ? MUTO : x > 0 ? VERDE : x < 0 ? ROSSO : MUTO);

// Le schede hanno un blu piu' chiaro dello sfondo e un bordo visibile: il contrasto e'
// quello che rende leggibile una dashboard a colpo d'occhio, non la finezza dei grigi.
const SCHEDA = { background: "oklch(0.22 0.035 262)", border: "1px solid oklch(0.34 0.045 262)" } as const;
const RIQUADRO = { background: "oklch(0.19 0.03 262)", border: "1px solid oklch(0.3 0.04 262)" } as const;

function Riquadro({ label, value, sub, color, icon: Icon }: { label: string; value: string; sub?: string; color: string; icon: React.ElementType }) {
  return (
    <div className="rounded-2xl p-5" style={SCHEDA}>
      <div className="flex items-start justify-between mb-3">
        <div className="text-sm uppercase tracking-wider text-muted-foreground font-semibold">{label}</div>
        <div className="w-9 h-9 rounded-lg flex items-center justify-center" style={{ background: `${color}18`, border: `1px solid ${color}30` }}>
          <Icon className="w-4 h-4" style={{ color }} />
        </div>
      </div>
      <div className="text-3xl font-bold text-foreground tabular-nums">{value}</div>
      {sub && <div className="text-sm mt-1.5 font-medium" style={{ color }}>{sub}</div>}
    </div>
  );
}

function Stat({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="rounded-xl p-4 text-center" style={RIQUADRO}>
      <div className="text-2xl font-bold tabular-nums" style={{ color: color ?? "inherit" }}>{value}</div>
      <div className="text-xs uppercase tracking-wider text-muted-foreground mt-1">{label}</div>
    </div>
  );
}

type Intervallo = "7g" | "30g" | "tutto";
const giornoUtc = (d: Date) => d.toISOString().slice(0, 10);

/** I giorni dell'intervallo, dal piu' vecchio a oggi: cosi' il grafico ha sempre lo stesso asse. */
function giorniIntervallo(n: number): string[] {
  const out: string[] = [];
  for (let i = n - 1; i >= 0; i--) out.push(giornoUtc(new Date(Date.now() - i * 86_400_000)));
  return out;
}

function SelettoreIntervallo({ valore, onChange }: { valore: Intervallo; onChange: (v: Intervallo) => void }) {
  const voci: Array<[Intervallo, string]> = [["7g", "7 giorni"], ["30g", "30 giorni"], ["tutto", "Tutto"]];
  return (
    <div className="flex items-center gap-1 rounded-lg p-1" style={RIQUADRO}>
      {voci.map(([v, testo]) => (
        <button key={v} onClick={() => onChange(v)} className="px-3 py-1 rounded-md text-sm font-medium transition-colors"
          style={valore === v ? { background: "oklch(0.65 0.2 265)", color: "white" } : { color: "oklch(0.7 0.02 260)" }}>
          {testo}
        </button>
      ))}
    </div>
  );
}

const TooltipCurva = ({ active, payload, label }: { active?: boolean; payload?: Array<{ value: number | null; name: string; color: string }>; label?: string }) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-xl p-3 text-sm" style={{ background: "oklch(0.16 0.02 260)", border: "1px solid oklch(0.25 0.02 260)", boxShadow: "var(--shadow-elevated)" }}>
      <div className="text-muted-foreground mb-2 text-xs">{ora(label)}</div>
      {payload.map((p) => (
        <div key={p.name} className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full" style={{ background: p.color }} />
          <span className="text-foreground font-medium">{p.name}: </span>
          <span style={{ color: p.color }}>{p.value == null ? "—" : usd(p.value)}</span>
        </div>
      ))}
    </div>
  );
};

/* ------------------------------------------------------------------ */
/* Panoramica: i due libri fianco a fianco                            */
/* ------------------------------------------------------------------ */

function CartaLibro({ s, attivo, onClick }: { s: any; attivo: boolean; onClick: () => void }) {
  const meta = LIBRI[s.libro as LibroId];
  return (
    <button onClick={onClick} className="text-left w-full rounded-2xl p-5 transition-all" style={{
      background: attivo ? "oklch(0.24 0.045 262)" : "oklch(0.2 0.03 262)",
      border: `2px solid ${attivo ? meta.colore : "oklch(0.32 0.04 262)"}`,
    }}>
      <div className="flex items-center justify-between mb-3">
        <div>
          <div className="text-lg font-bold text-foreground">{meta.nome}</div>
          <div className="text-sm text-muted-foreground">{meta.sotto}</div>
        </div>
        <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0" style={{ background: `${meta.colore}20` }}>
          <Bot className="w-4 h-4" style={{ color: meta.colore }} />
        </div>
      </div>
      {!s.ok ? (
        <div className="flex items-start gap-2 text-sm" style={{ color: ROSSO }}>
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
          <span>{s.motivo}</span>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-3 mb-3">
            <div>
              <div className="text-xs uppercase tracking-wider text-muted-foreground">Capitale</div>
              <div className="text-2xl font-bold tabular-nums">{usd(s.equity)}</div>
              <div className="text-sm font-medium" style={{ color: colorePnl(s.ritorno_pct) }}>{pct(s.ritorno_pct)} dal via</div>
            </div>
            <div>
              <div className="text-xs uppercase tracking-wider text-muted-foreground">BTC buy & hold</div>
              <div className="text-2xl font-bold tabular-nums">{pct(s.benchmark_btc_pct)}</div>
              <div className="text-sm text-muted-foreground">stesso capitale, mai toccato</div>
            </div>
            <div>
              <div className="text-xs uppercase tracking-wider text-muted-foreground">Vs non fare niente</div>
              <div className="text-2xl font-bold tabular-nums" style={{ color: colorePnl(s.differenza_pct) }}>{s.differenza_pct == null ? "—" : `${s.differenza_pct >= 0 ? "+" : ""}${s.differenza_pct.toFixed(2)} pt`}</div>
              <div className="text-sm text-muted-foreground">la domanda che conta</div>
            </div>
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
            <span>{s.operazioni} operazioni</span>
            <span>win rate {s.win_rate_pct == null ? "—" : `${s.win_rate_pct}%`}</span>
            <span>expectancy {s.expectancy_r == null ? "—" : `${s.expectancy_r} R`}</span>
            <span>max DD {n(s.max_drawdown_pct)}%</span>
            <span>{s.posizioni_aperte} aperte</span>
          </div>
          <div className="flex items-center justify-between mt-3 text-xs">
            <span className="px-2 py-0.5 rounded-full" style={{ background: "oklch(0.72 0.18 75 / 0.15)", color: "oklch(0.8 0.15 80)" }}>{s.campione.testo}</span>
            <span className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full" style={{ background: s.ciclo.acceso ? VERDE : s.ciclo.acceso === false ? ROSSO : MUTO }} />
              <span className="text-muted-foreground">{s.ciclo.testo}</span>
            </span>
          </div>
        </>
      )}
    </button>
  );
}

/* ------------------------------------------------------------------ */
/* Dettaglio di un libro                                              */
/* ------------------------------------------------------------------ */

function Dettaglio({ libro }: { libro: LibroId }) {
  const q = trpc.finance.libro.useQuery({ libro }, { refetchInterval: 60_000 });
  const [aperta, setAperta] = useState<number | null>(null);
  const [intervallo, setIntervallo] = useState<Intervallo>("7g");
  const meta = LIBRI[libro];

  if (q.isLoading) return <div className="space-y-3">{[1, 2, 3].map((i) => <div key={i} className="h-32 rounded-xl skeleton-shimmer" />)}</div>;
  if (!q.data) return null;
  if (!q.data.ok) {
    return (
      <div className="card-premium rounded-2xl p-8 text-center">
        <AlertTriangle className="w-8 h-8 mx-auto mb-3" style={{ color: ROSSO }} />
        <p className="text-sm text-foreground font-medium">Il VPS non ha risposto per questo libro</p>
        <p className="text-xs text-muted-foreground mt-1">{q.data.motivo}</p>
      </div>
    );
  }

  const { dati: d, curva: curvaTutta, campione, ciclo, differenza_pct, estremi } = q.data;
  const m = d.metriche;
  // Un solo selettore governa curva e colonne: stesso intervallo, stesso asse dei tempi.
  const daMs = intervallo === "tutto" ? 0 : Date.now() - (intervallo === "7g" ? 7 : 30) * 86_400_000;
  const curva = curvaTutta.filter((p) => Date.parse(p.t) >= daMs);
  const perTutti = new Map((d.performance_giornaliera ?? []).map((p) => [p.giorno, p.pct] as const));
  const perf: Array<{ giorno: string; pct: number | null }> = intervallo === "tutto"
    ? (d.performance_giornaliera ?? [])
    : giorniIntervallo(intervallo === "7g" ? 7 : 30).map((g) => ({ giorno: g, pct: perTutti.get(g) ?? null }));
  // L'asse delle colonne e' simmetrico e mai sotto il mezzo punto: una giornata da +0,01%
  // non deve sembrare un grattacielo solo perche' e' l'unica.
  const maxAbs = Math.max(0.5, ...perf.map((p) => Math.abs(p.pct ?? 0) * 1.25));
  const eqMin = curva.length ? Math.min(...curva.flatMap((p) => [p.portafoglio, p.btc ?? p.portafoglio])) : 0;
  const eqMax = curva.length ? Math.max(...curva.flatMap((p) => [p.portafoglio, p.btc ?? p.portafoglio])) : 0;
  const margine = (eqMax - eqMin) * 0.15 || d.capitale_iniziale * 0.01;

  return (
    <div className="space-y-6">
      {/* Intestazione del libro */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-lg font-semibold text-foreground" style={{ color: meta.colore }}>{meta.nome}</h3>
          <p className="text-xs text-muted-foreground">{d.venue} · modalita' {d.modalita} · istantanea delle {ora(d.generato_il)}</p>
        </div>
        <div className="flex items-center gap-2 text-xs">
          <span className="w-2 h-2 rounded-full" style={{ background: ciclo.acceso ? VERDE : ciclo.acceso === false ? ROSSO : MUTO }} />
          <span className="text-muted-foreground">ciclo: {ciclo.testo}{d.heartbeat?.fase ? ` (${d.heartbeat.fase})` : ""}</span>
        </div>
      </div>

      {d.circuit_breaker && (
        <div className="rounded-2xl p-4 flex items-start gap-3" style={{ background: `${ROSSO}12`, border: `1px solid ${ROSSO}40` }}>
          <Skull className="w-5 h-5 shrink-0" style={{ color: ROSSO }} />
          <div className="text-sm"><b>Circuit breaker attivo:</b> {d.circuit_breaker.motivo} — fino a {ora(d.circuit_breaker.fino_a)}</div>
        </div>
      )}

      {/* I quattro riquadri */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Riquadro label="Capitale iniziale" value={usd(d.capitale_iniziale)} sub="dichiarato, non il saldo del demo" color={MUTO} icon={Wallet} />
        <Riquadro label="Capitale attuale" value={usd(d.equity)} sub={`${pct(d.ritorno_pct)} dal via · giorno ${n(m.giorni_operativi, 0)}`} color={colorePnl(d.ritorno_pct)} icon={Activity} />
        <Riquadro label="BTC buy & hold" value={d.benchmark_btc?.valore == null ? "—" : usd(d.benchmark_btc.valore)} sub={d.benchmark_btc?.ritorno_pct == null ? "benchmark non disponibile" : `${pct(d.benchmark_btc.ritorno_pct)} senza fare niente`} color={BTC} icon={Target} />
        <Riquadro label="Vs non fare niente" value={differenza_pct == null ? "—" : `${differenza_pct >= 0 ? "+" : ""}${differenza_pct.toFixed(2)} pt`} sub={differenza_pct == null ? "serve il benchmark" : differenza_pct >= 0 ? "sopra il buy & hold" : "sotto il buy & hold: verde travestito"} color={colorePnl(differenza_pct)} icon={differenza_pct != null && differenza_pct >= 0 ? ArrowUp : ArrowDown} />
      </div>

      {/* Equity curve */}
      <div className="rounded-2xl p-5" style={SCHEDA}>
        <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
          <div className="text-lg font-bold">Equity curve</div>
          <div className="flex flex-wrap items-center gap-4 text-sm">
            <div className="flex items-center gap-1.5"><div className="w-6 h-0.5" style={{ background: meta.colore }} /><span className="text-muted-foreground">Portafoglio</span></div>
            <div className="flex items-center gap-1.5"><div className="w-6 h-0.5 border-t border-dashed" style={{ borderColor: BTC }} /><span className="text-muted-foreground">BTC buy & hold</span></div>
            <SelettoreIntervallo valore={intervallo} onChange={setIntervallo} />
          </div>
        </div>
        {curva.length > 1 ? (
          <ResponsiveContainer width="100%" height={280}>
            <LineChart data={curva} margin={{ top: 5, right: 5, bottom: 5, left: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="oklch(0.2 0.01 260)" />
              <XAxis dataKey="t" tick={{ fontSize: 10, fill: MUTO }} tickFormatter={(v) => ora(v)} minTickGap={60} />
              <YAxis domain={[Math.floor(eqMin - margine), Math.ceil(eqMax + margine)]} tick={{ fontSize: 10, fill: MUTO }} tickFormatter={(v) => `${Math.round(v)}`} width={56} />
              <Tooltip content={<TooltipCurva />} />
              <ReferenceLine y={d.capitale_iniziale} stroke="oklch(0.35 0.02 260)" strokeDasharray="4 4" />
              <Line type="monotone" dataKey="portafoglio" name="Portafoglio" stroke={meta.colore} strokeWidth={2} dot={false} isAnimationActive={false} />
              <Line type="monotone" dataKey="btc" name="BTC buy & hold" stroke={BTC} strokeWidth={1.5} strokeDasharray="5 4" dot={false} connectNulls isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        ) : (
          <div className="h-[280px] flex items-center justify-center text-sm text-muted-foreground">curva equity: nessun battito nell'intervallo scelto</div>
        )}
      </div>

      {/* Statistiche */}
      <div className="rounded-2xl p-5" style={SCHEDA}>
        <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
          <div className="text-lg font-bold">Statistiche</div>
          <span className="text-xs px-2 py-0.5 rounded-full flex items-center gap-1" style={{ background: "oklch(0.72 0.18 75 / 0.15)", color: "oklch(0.8 0.15 80)" }}>
            <Info className="w-3 h-3" /> {campione.testo}
          </span>
        </div>
        <div className="grid grid-cols-3 md:grid-cols-6 gap-3">
          <Stat label="Operazioni" value={String(m.operazioni)} />
          <Stat label="Vincenti" value={String(m.vincenti)} color={m.vincenti ? VERDE : undefined} />
          <Stat label="Perdenti" value={String(m.perdenti)} color={m.perdenti ? ROSSO : undefined} />
          <Stat label="Win rate" value={m.win_rate_pct == null ? "—" : `${m.win_rate_pct}%`} />
          <Stat label="Miglior trade" value={estremi.miglior_pct == null ? "—" : pct(estremi.miglior_pct)} color={estremi.miglior_pct == null ? undefined : VERDE} />
          <Stat label="Peggior trade" value={estremi.peggior_pct == null ? "—" : pct(estremi.peggior_pct)} color={estremi.peggior_pct == null ? undefined : ROSSO} />
        </div>
        <div className="grid grid-cols-3 md:grid-cols-6 gap-3 mt-3">
          <Stat label="Max drawdown" value={`${n(m.max_drawdown_pct)}%`} color={m.max_drawdown_pct > 0 ? ROSSO : undefined} />
          <Stat label="Expectancy" value={m.expectancy_r == null ? "—" : `${m.expectancy_r} R`} color={colorePnl(m.expectancy_r)} />
          <Stat label="Profit factor" value={m.profit_factor == null ? "—" : m.profit_factor === Infinity ? "∞" : String(m.profit_factor)} />
          <Stat label="Commissioni" value={usd(m.fee_totali)} />
          <Stat label="Durata media" value={d.statistiche?.durata_media_ore == null ? "—" : `${d.statistiche.durata_media_ore} h`} />
          <Stat label="Rifiuti risk mgr" value={String(d.statistiche?.rifiuti_risk_manager?.totale ?? "—")} />
        </div>
        <p className="text-[11px] text-muted-foreground mt-3">Miglior e peggior trade sono in percentuale sul capitale del libro, non sul nozionale a leva. Il win rate da solo non dice niente: contano expectancy e drawdown.</p>
      </div>

      {/* Performance giornaliera */}
      <div className="rounded-2xl p-5" style={SCHEDA}>
        <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
          <div className="text-lg font-bold">Performance giornaliera</div>
          <div className="text-sm text-muted-foreground">{intervallo === "tutto" ? "tutte le giornate" : intervallo === "7g" ? "ultimi 7 giorni" : "ultimi 30 giorni"} · i giorni senza dati restano vuoti</div>
        </div>
        {perf.length ? (
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={perf} margin={{ top: 10, right: 5, bottom: 5, left: 5 }} barCategoryGap="30%">
              <CartesianGrid strokeDasharray="3 3" stroke="oklch(0.3 0.02 260)" vertical={false} />
              <XAxis dataKey="giorno" tick={{ fontSize: 12, fill: "oklch(0.7 0.02 260)" }} tickFormatter={giornoBreve} interval={intervallo === "30g" ? 2 : 0} />
              <YAxis domain={[-maxAbs, maxAbs]} tick={{ fontSize: 12, fill: "oklch(0.7 0.02 260)" }} tickFormatter={(v) => `${v > 0 ? "+" : ""}${Number(v).toFixed(1)}%`} width={56} />
              <Tooltip formatter={(v: any) => [v == null ? "nessun dato" : pct(Number(v)), "giornata"]} labelFormatter={(l) => String(l)} contentStyle={{ background: "oklch(0.16 0.02 260)", border: "1px solid oklch(0.3 0.03 260)", borderRadius: 12, fontSize: 13 }} />
              <ReferenceLine y={0} stroke="oklch(0.5 0.02 260)" />
              <Bar dataKey="pct" isAnimationActive={false} radius={[4, 4, 4, 4]} maxBarSize={48}>
                {perf.map((p, i) => <Cell key={i} fill={p.pct == null ? "transparent" : p.pct >= 0 ? VERDE : ROSSO} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        ) : <div className="text-sm text-muted-foreground">nessuna giornata completa ancora</div>}
      </div>

      {/* Posizioni aperte */}
      <div className="rounded-2xl p-5" style={SCHEDA}>
        <div className="text-lg font-bold mb-3">Posizioni aperte</div>
        {d.posizioni.length ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="text-[11px] uppercase tracking-wider text-muted-foreground text-left">
                <th className="py-2 pr-3">Coin</th><th className="py-2 pr-3">Lato</th><th className="py-2 pr-3 text-right">Entrata</th><th className="py-2 pr-3 text-right">Stop</th><th className="py-2 pr-3 text-right">Target</th><th className="py-2 pr-3 text-right">Size</th><th className="py-2 pr-3 text-right">PnL aperto</th><th className="py-2 pr-3">Aperta</th><th className="py-2">Setup / tesi</th>
              </tr></thead>
              <tbody>
                {d.posizioni.map((p, i) => (
                  <tr key={i} className="border-t" style={{ borderColor: "oklch(0.25 0.02 260 / 0.5)" }}>
                    <td className="py-2 pr-3 font-semibold">{p.coin}</td>
                    <td className="py-2 pr-3"><span className="text-xs px-2 py-0.5 rounded-full font-medium" style={{ background: p.lato === 1 ? `${VERDE}20` : `${ROSSO}20`, color: p.lato === 1 ? VERDE : ROSSO }}>{p.lato === 1 ? "LONG" : "SHORT"}{p.leva ? ` ${p.leva}x` : ""}</span></td>
                    <td className="py-2 pr-3 text-right tabular-nums">{n(p.entrata, 4)}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{n(p.stop, 4)}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{n(p.target, 4)}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{n(p.size, 4)}</td>
                    <td className="py-2 pr-3 text-right tabular-nums font-medium" style={{ color: colorePnl(p.pnl_aperto) }}>{p.pnl_aperto == null ? "—" : usd(p.pnl_aperto)}</td>
                    <td className="py-2 pr-3 text-muted-foreground whitespace-nowrap">{ora(p.aperta_il)}</td>
                    <td className="py-2 text-xs text-muted-foreground max-w-[420px]"><b className="text-foreground">{p.setup ?? "—"}</b>{p.tesi ? ` — ${p.tesi}` : ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <div className="text-sm text-muted-foreground">nessuna: il cash e' una posizione</div>}
      </div>

      {/* Storico */}
      <div className="rounded-2xl p-5" style={SCHEDA}>
        <div className="text-lg font-bold mb-3">Storico operazioni chiuse</div>
        {d.chiuse.length ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="text-[11px] uppercase tracking-wider text-muted-foreground text-left">
                <th className="py-2 pr-3">#</th><th className="py-2 pr-3">Chiusa</th><th className="py-2 pr-3">Coin</th><th className="py-2 pr-3">Lato</th><th className="py-2 pr-3">Setup</th><th className="py-2 pr-3 text-right">Entrata</th><th className="py-2 pr-3 text-right">Uscita</th><th className="py-2 pr-3">Uscita per</th><th className="py-2 pr-3 text-right">R</th><th className="py-2 text-right">PnL</th>
              </tr></thead>
              <tbody>
                {d.chiuse.map((c, i) => {
                  const apertaRiga = aperta === i;
                  return (
                    <Fragment key={i}>
                      <tr className="border-t cursor-pointer" style={{ borderColor: "oklch(0.25 0.02 260 / 0.5)" }} onClick={() => setAperta(apertaRiga ? null : i)}>
                        <td className="py-2 pr-3 text-muted-foreground">{apertaRiga ? <ChevronDown className="w-3.5 h-3.5 inline" /> : <ChevronRight className="w-3.5 h-3.5 inline" />} {d.chiuse.length - i}</td>
                        <td className="py-2 pr-3 whitespace-nowrap">{ora(c.chiusa_il)}</td>
                        <td className="py-2 pr-3 font-semibold">{c.coin}</td>
                        <td className="py-2 pr-3"><span className="text-xs px-2 py-0.5 rounded-full font-medium" style={{ background: c.lato === 1 ? `${VERDE}20` : `${ROSSO}20`, color: c.lato === 1 ? VERDE : ROSSO }}>{c.lato === 1 ? "LONG" : "SHORT"}</span></td>
                        <td className="py-2 pr-3 text-xs">{c.setup ?? "—"}</td>
                        <td className="py-2 pr-3 text-right tabular-nums">{n(c.entrata, 4)}</td>
                        <td className="py-2 pr-3 text-right tabular-nums">{n(c.uscita, 4)}</td>
                        <td className="py-2 pr-3 text-xs">{c.motivo ?? "—"}</td>
                        <td className="py-2 pr-3 text-right tabular-nums" style={{ color: colorePnl(c.r_multiplo) }}>{c.r_multiplo == null ? "—" : n(c.r_multiplo)}</td>
                        <td className="py-2 text-right tabular-nums font-medium" style={{ color: colorePnl(c.pnl_netto) }}>{usd(c.pnl_netto)}</td>
                      </tr>
                      {apertaRiga && (
                        <tr>
                          <td colSpan={10} className="pb-3 px-3 text-xs text-muted-foreground">
                            <div className="rounded-xl p-3" style={{ background: "oklch(0.16 0.02 260 / 0.5)" }}>
                              <div><b className="text-foreground">Aperta:</b> {ora(c.aperta_il)}{c.size ? ` · size ${n(c.size, 4)}` : ""}{c.fee_pagate != null ? ` · commissioni ${usd(c.fee_pagate)}` : ""}</div>
                              <div className="mt-1"><b className="text-foreground">Tesi:</b> {c.tesi ?? "non registrata"}</div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : <div className="text-sm text-muted-foreground">ancora nessuna operazione chiusa</div>}
      </div>

      {/* Ultima decisione + copy dossier */}
      <div className="grid lg:grid-cols-2 gap-4">
        <div className="rounded-2xl p-5" style={SCHEDA}>
          <div className="text-lg font-bold mb-2 flex items-center gap-2"><Bot className="w-4 h-4" /> Ultima decisione del modello</div>
          {d.ultima_decisione ? (
            <div className="text-sm space-y-2">
              <div className="text-xs text-muted-foreground">{ora(d.ultima_decisione.ora)} · {d.ultima_decisione.modello ?? "—"}{d.ultima_decisione.regime ? ` · regime: ${d.ultima_decisione.regime}` : ""}</div>
              {d.ultima_decisione.nota && <p className="text-muted-foreground">{d.ultima_decisione.nota}</p>}
              {(d.ultima_decisione.decisioni ?? []).map((x, i) => (
                <div key={i} className="rounded-lg p-2 text-xs" style={{ background: "oklch(0.16 0.02 260 / 0.5)" }}>
                  <b className="text-foreground">{x.coin} · {x.azione}</b>{x.setup ? ` · ${x.setup}` : ""}{x.confidenza != null ? ` · conf. ${x.confidenza}` : ""}
                  {x.tesi && <div className="text-muted-foreground mt-0.5">{x.tesi}</div>}
                </div>
              ))}
            </div>
          ) : <div className="text-sm text-muted-foreground">nessuna decisione registrata ancora</div>}
        </div>
        <div className="rounded-2xl p-5" style={SCHEDA}>
          <div className="text-lg font-bold mb-2 flex items-center gap-2"><ShieldCheck className="w-4 h-4" /> Regole del libro</div>
          {d.rischio ? (
            <ul className="text-sm text-muted-foreground space-y-1">
              <li>Rischio per operazione: <b className="text-foreground">{d.rischio.per_operazione_pct}%</b> del capitale · leva max <b className="text-foreground">{d.rischio.leva_max}x</b> · posizioni max <b className="text-foreground">{d.rischio.posizioni_max}</b></li>
              <li>Stop giornaliero <b className="text-foreground">-{d.rischio.perdita_max_giorno_pct}%</b> · stop mensile <b className="text-foreground">-{d.rischio.perdita_max_mese_pct}%</b> (cancelli nel codice, non nel prompt)</li>
            </ul>
          ) : <div className="text-sm text-muted-foreground">regole non dichiarate</div>}
          {d.esperimento?.condizione_di_spegnimento && (
            <div className="mt-3 text-xs rounded-lg p-2" style={{ background: `${ROSSO}10`, border: `1px solid ${ROSSO}30` }}>
              <b>Condizione di spegnimento:</b> {d.esperimento.condizione_di_spegnimento}
            </div>
          )}
          {d.broker && typeof (d.broker as any).equity_demo_totale === "number" && (
            <div className="mt-3 text-[11px] text-muted-foreground">Saldo del demo Bybit: {usd((d.broker as any).equity_demo_totale)} — non e' il capitale del libro, che e' dichiarato a {usd(d.capitale_iniziale)}.</div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Pagina                                                              */
/* ------------------------------------------------------------------ */

export default function Finance() {
  const [location, navigate] = useLocation();
  const iniziale = (location.split("/")[2] as LibroId) || "principale";
  const [libro, setLibro] = useState<LibroId>(iniziale in LIBRI ? iniziale : "principale");
  const utils = trpc.useUtils();
  const pan = trpc.finance.panoramica.useQuery(undefined, { refetchInterval: 60_000 });
  const scegli = (l: LibroId) => { setLibro(l); navigate(`/finance/${l}`, { replace: true }); };
  const aggiorna = async () => {
    await utils.finance.panoramica.fetch({ forza: true });
    await utils.finance.libro.invalidate();
    await utils.finance.panoramica.invalidate();
  };
  const libri = useMemo(() => pan.data?.libri ?? [], [pan.data]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold text-foreground flex items-center gap-2"><CandlestickChart className="w-6 h-6" /> Trading Lab</h2>
          <p className="text-base text-muted-foreground">Due agenti, due conti, due metodi. La domanda e' una sola: quello che fanno batte il non fare niente?</p>
        </div>
        <Button variant="outline" size="sm" className="gap-2" onClick={aggiorna} disabled={pan.isFetching}>
          <RefreshCw className={`w-3.5 h-3.5 ${pan.isFetching ? "animate-spin" : ""}`} /> Rileggi dal VPS
        </Button>
      </div>

      {pan.isLoading ? (
        <div className="grid lg:grid-cols-2 gap-4">{[1, 2].map((i) => <div key={i} className="h-44 rounded-2xl skeleton-shimmer" />)}</div>
      ) : (
        <div className="grid lg:grid-cols-2 gap-4">
          {libri.map((s: any) => <CartaLibro key={s.libro} s={s} attivo={s.libro === libro} onClick={() => scegli(s.libro)} />)}
        </div>
      )}

      <div className="rounded-2xl p-4 text-xs text-muted-foreground flex items-start gap-2" style={{ background: "oklch(0.72 0.18 75 / 0.07)", border: "1px solid oklch(0.72 0.18 75 / 0.2)" }}>
        <Trophy className="w-4 h-4 mt-0.5 shrink-0" style={{ color: BTC }} />
        <span>Un numero verde da solo non vuol dire niente. La domanda non e' mai "quanto ho guadagnato", e' "quanto ho guadagnato in piu' del non fare niente" — e prima di dire "funziona" servono decine di operazioni chiuse e almeno un mese storto.</span>
      </div>

      <Dettaglio libro={libro} />
    </div>
  );
}
