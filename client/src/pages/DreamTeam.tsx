import { useEffect, useMemo, useRef, useState } from "react";
import { Send, Users, Crown, Loader2, MessageCircle, AlertTriangle } from "lucide-react";
import { Streamdown } from "streamdown";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";

// Dream Team — la stanza del mastermind. E' lo SPECCHIO del gruppo Telegram:
// il motore (chi parla, chi passa, l'ordine) vive in dreamteam.py sul VPS.
// Qui si legge la riunione e si imbuca; se il ponte e' giu', Telegram continua
// a funzionare e questa pagina lo dice invece di fingere.

const BORDER = "1px solid oklch(0.2 0.015 260)";
const PANEL_BG = "oklch(0.12 0.015 260)";
const MAX_LEN = 3500;

// Colore stabile per agente: dallo stesso code esce sempre la stessa tinta,
// senza dipendere dall'ordine del roster.
function hueDaCodice(code: string): number {
  let h = 0;
  for (let i = 0; i < code.length; i++) h = (h * 31 + code.charCodeAt(i)) % 360;
  return h;
}
function coloreAgente(code: string | null | undefined) {
  const hue = hueDaCodice(code ?? "team");
  return {
    testo: `oklch(0.78 0.14 ${hue})`,
    sfondo: `oklch(0.65 0.16 ${hue} / 0.1)`,
    bordo: `oklch(0.65 0.16 ${hue} / 0.28)`,
  };
}

function StatusPill({ ok, labelOk, labelKo }: { ok: boolean; labelOk: string; labelKo: string }) {
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium"
      style={{
        color: ok ? "oklch(0.8 0.15 150)" : "oklch(0.75 0.16 25)",
        background: ok ? "oklch(0.7 0.15 150 / 0.1)" : "oklch(0.65 0.18 25 / 0.1)",
        border: `1px solid ${ok ? "oklch(0.7 0.15 150 / 0.3)" : "oklch(0.65 0.18 25 / 0.3)"}`,
      }}
    >
      <span
        className="h-1.5 w-1.5 rounded-full"
        style={{ background: ok ? "oklch(0.8 0.15 150)" : "oklch(0.75 0.16 25)" }}
      />
      {ok ? labelOk : labelKo}
    </span>
  );
}

export default function DreamTeam() {
  const [draft, setDraft] = useState("");
  const [mostraRoster, setMostraRoster] = useState(false);
  const fondo = useRef<HTMLDivElement>(null);
  const utils = trpc.useUtils();

  const stanza = trpc.dreamTeam.stanza.useQuery(undefined, { refetchInterval: 4000 });
  const agenti = trpc.dreamTeam.agenti.useQuery(undefined, { refetchInterval: 30000 });

  const invia = trpc.dreamTeam.invia.useMutation({
    onSuccess: (r) => {
      if (!r.success) {
        // Niente bolla ottimista su un salvataggio fallito: il difetto piu'
        // costoso e' una UI che mostra un messaggio che non esiste.
        toast.error("Messaggio NON salvato: il database non risponde.");
        return;
      }
      setDraft("");
      utils.dreamTeam.stanza.invalidate();
    },
    onError: (e) => toast.error(`Invio fallito: ${e.message}`),
  });

  const roster = agenti.data ?? [];
  const perCodice = useMemo(() => {
    const m = new Map<string, (typeof roster)[number]>();
    for (const a of roster) m.set(a.code, a);
    return m;
  }, [roster]);

  const messaggi = stanza.data?.messages ?? [];

  useEffect(() => {
    fondo.current?.scrollIntoView({ behavior: "smooth" });
  }, [messaggi.length, stanza.data?.attesa]);

  function tagga(a: (typeof roster)[number]) {
    const tag = a.telegramUsername ? `@${a.telegramUsername}` : a.nome;
    setDraft((d) => (d.trim() ? `${d.trimEnd()} ${tag} ` : `${tag} `));
  }

  function inviaOra() {
    const testo = draft.trim();
    if (!testo || invia.isPending) return;
    invia.mutate({ text: testo });
  }

  const ponteOnline = stanza.data?.ponteOnline ?? false;
  const gruppoAgganciato = Boolean(stanza.data?.groupId);
  const dbOk = stanza.data?.dbOk ?? true;

  return (
    <div className="flex h-[calc(100vh-4rem)] flex-col">
      {/* Testata: titolo + verita' operativa del ponte */}
      <div
        className="flex flex-wrap items-center gap-3 px-4 py-3"
        style={{ borderBottom: BORDER, background: PANEL_BG }}
      >
        <div className="flex items-center gap-2">
          <Users className="h-5 w-5" style={{ color: "oklch(0.72 0.15 40)" }} />
          <h1 className="text-lg font-semibold">Dream Team</h1>
          <span className="hidden text-xs opacity-60 sm:inline">
            il mastermind degli agenti — specchio del gruppo Telegram
          </span>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {!dbOk && <StatusPill ok={false} labelOk="" labelKo="database giù" />}
          <StatusPill
            ok={ponteOnline}
            labelOk={stanza.data?.occupato ? "ponte attivo · riunione in corso" : "ponte attivo"}
            labelKo="ponte offline (VPS)"
          />
          <StatusPill ok={gruppoAgganciato} labelOk="gruppo agganciato" labelKo="gruppo non agganciato" />
          <Button
            variant="outline"
            size="sm"
            className="lg:hidden"
            onClick={() => setMostraRoster((v) => !v)}
          >
            <Users className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div className="flex min-h-0 flex-1">
        {/* La riunione */}
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
            {stanza.isLoading && (
              <div className="flex items-center justify-center gap-2 py-10 text-sm opacity-60">
                <Loader2 className="h-4 w-4 animate-spin" /> Carico la stanza…
              </div>
            )}

            {!stanza.isLoading && messaggi.length === 0 && (
              <div className="mx-auto max-w-md py-14 text-center text-sm opacity-70">
                <MessageCircle className="mx-auto mb-3 h-8 w-8 opacity-50" />
                <p className="font-medium">La stanza è vuota.</p>
                <p className="mt-1">
                  Fai una domanda aperta al team, o tagga un agente dal roster per
                  parlare direttamente con lui. Tutto quello che scrivi qui arriva
                  nel gruppo Telegram, e viceversa.
                </p>
              </div>
            )}

            {messaggi.map((m) => {
              if (m.role === "system") {
                return (
                  <div key={m.id} className="py-1 text-center text-xs italic opacity-55">
                    {m.text}
                  </div>
                );
              }
              if (m.role === "user") {
                return (
                  <div key={m.id} className="flex justify-end">
                    <div className="max-w-[85%] sm:max-w-[70%]">
                      <div
                        className="rounded-2xl rounded-br-sm px-4 py-2.5 text-sm whitespace-pre-wrap"
                        style={{
                          background: "oklch(0.45 0.12 265 / 0.25)",
                          border: "1px solid oklch(0.55 0.14 265 / 0.35)",
                        }}
                      >
                        {m.text}
                      </div>
                      <div className="mt-1 flex items-center justify-end gap-2 text-[11px] opacity-55">
                        <span>{m.source === "web" ? "dal web" : "da Telegram"}</span>
                        {m.source === "web" && !m.deliveredAt && m.status === "new" && (
                          <span>· in consegna…</span>
                        )}
                        {m.senzaRisposta && (
                          <span className="inline-flex items-center gap-1" style={{ color: "oklch(0.75 0.14 60)" }}>
                            <AlertTriangle className="h-3 w-3" /> rimasta senza risposta
                          </span>
                        )}
                      </div>
                      {m.nota && (
                        <div className="mt-1 text-right text-[11px] italic" style={{ color: "oklch(0.75 0.14 60)" }}>
                          {m.nota}
                        </div>
                      )}
                    </div>
                  </div>
                );
              }
              // agente
              const info = perCodice.get(m.agentCode ?? "");
              const col = coloreAgente(m.agentCode);
              return (
                <div key={m.id} className="flex justify-start">
                  <div className="max-w-[90%] sm:max-w-[75%]">
                    <div className="mb-1 flex items-center gap-1.5 text-xs font-semibold" style={{ color: col.testo }}>
                      <span>{info?.emoji ?? "🤖"}</span>
                      <span>{info?.nome ?? m.agentCode}</span>
                      {info?.capofila && <Crown className="h-3 w-3 opacity-80" />}
                    </div>
                    <div
                      className="rounded-2xl rounded-tl-sm px-4 py-2.5 text-sm"
                      style={{ background: col.sfondo, border: `1px solid ${col.bordo}` }}
                    >
                      <Streamdown>{m.text}</Streamdown>
                    </div>
                  </div>
                </div>
              );
            })}

            {stanza.data?.attesa && (
              <div className="flex items-center gap-2 text-sm opacity-70">
                <Loader2 className="h-4 w-4 animate-spin" />
                Il team sta rispondendo…
              </div>
            )}
            <div ref={fondo} />
          </div>

          {/* Composer */}
          <div className="px-4 py-3" style={{ borderTop: BORDER, background: PANEL_BG }}>
            {!ponteOnline && (
              <p className="mb-2 text-xs" style={{ color: "oklch(0.75 0.14 60)" }}>
                Il ponte col VPS è offline: il messaggio resta in coda e parte
                appena il servizio torna su. La riunione su Telegram non si ferma.
              </p>
            )}
            <div className="flex items-end gap-2">
              <Textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value.slice(0, MAX_LEN))}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    inviaOra();
                  }
                }}
                placeholder="Domanda aperta al team, oppure tagga un agente (@…) per parlare con lui…"
                className="min-h-[44px] max-h-40 flex-1 resize-none"
              />
              <Button onClick={inviaOra} disabled={!draft.trim() || invia.isPending} size="icon" className="shrink-0">
                {invia.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              </Button>
            </div>
            <div className="mt-1 text-right text-[11px] opacity-45">
              {draft.length}/{MAX_LEN}
            </div>
          </div>
        </div>

        {/* Roster: chi c'e' in squadra, chi guida, chi manca */}
        <aside
          className={`${mostraRoster ? "block" : "hidden"} w-72 shrink-0 overflow-y-auto lg:block`}
          style={{ borderLeft: BORDER, background: PANEL_BG }}
        >
          <div className="px-4 pt-4 pb-2 text-xs font-semibold uppercase tracking-wide opacity-60">
            La squadra
          </div>
          {agenti.isLoading && (
            <div className="px-4 py-2 text-sm opacity-60">Carico il roster…</div>
          )}
          {!agenti.isLoading && roster.length === 0 && (
            <div className="px-4 py-2 text-xs opacity-60">
              Il roster arriva dal VPS al primo battito del ponte.
            </div>
          )}
          <div className="space-y-1 px-2 pb-4">
            {roster.map((a) => {
              const col = coloreAgente(a.code);
              return (
                <button
                  key={a.code}
                  onClick={() => a.attivo && tagga(a)}
                  disabled={!a.attivo}
                  title={a.attivo ? `Tagga ${a.nome} nel messaggio` : "Non ancora in squadra (manca il token del bot)"}
                  className="w-full rounded-lg px-2.5 py-2 text-left transition-colors disabled:opacity-40"
                  style={{ border: "1px solid transparent" }}
                  onMouseEnter={(e) => { if (a.attivo) e.currentTarget.style.background = col.sfondo; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
                >
                  <div className="flex items-center gap-2">
                    <span className="text-lg leading-none">{a.emoji}</span>
                    <span className="truncate text-sm font-medium" style={{ color: a.attivo ? col.testo : undefined }}>
                      {a.nome}
                    </span>
                    {a.capofila && <Crown className="h-3.5 w-3.5 shrink-0" style={{ color: "oklch(0.8 0.14 75)" }} />}
                    {!a.attivo && <span className="ml-auto shrink-0 text-[10px] opacity-60">fuori squadra</span>}
                  </div>
                  {a.campo && <div className="mt-0.5 line-clamp-2 pl-7 text-[11px] opacity-55">{a.campo}</div>}
                </button>
              );
            })}
          </div>
        </aside>
      </div>
    </div>
  );
}
