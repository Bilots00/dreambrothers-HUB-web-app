import { useState } from "react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import {
  Download, Heart, Loader2, MoreHorizontal, Pause, Pencil, Play, Repeat, Send, Trash2, TriangleAlert,
} from "lucide-react";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { DREAMMAP_RARITIES, DREAMMAP_USES, MUSIC_PURPOSES, SFX_TYPES } from "@shared/music";
import { fileUrl, toggle, usePlayer } from "./player";

export type Track = {
  id: number; kind: "track" | "sfx"; title: string; purpose: string; sfxType: string | null; mood: string | null;
  keyName: string | null; bpm: number | null; status: string; error: string | null; durationSec: number | null;
  loopStartSec: number | null; loopSec: number | null; bytes: number | null; source: string; batch: string | null;
  isNew: boolean; favourite: boolean; dmPublished: boolean; dmUses: string[]; dmRarity: string | null; metrics: any;
  createdAt: string | Date | null;
};

// un colore per scopo: la copertina dice subito "a cosa serve"
export const PURPOSE_HUE: Record<string, number> = { focus: 250, study: 200, work: 70, relax: 300, meditate: 150, sleep: 275, ad: 350, sfx: 35 };
export function Cover({ t, size = 48 }: { t: Pick<Track, "purpose" | "id">; size?: number }) {
  const h = PURPOSE_HUE[t.purpose] ?? 260, h2 = (h + 40 + (t.id % 5) * 12) % 360;
  return (
    <div className="shrink-0 rounded-xl" style={{
      width: size, height: size,
      background: `radial-gradient(circle at ${30 + (t.id % 4) * 12}% 30%, oklch(0.78 0.14 ${h2}), transparent 60%), linear-gradient(135deg, oklch(0.5 0.17 ${h}), oklch(0.25 0.08 ${h2}))`,
    }} />
  );
}

const fmt = (s: number | null) => {
  if (s == null) return "";
  const v = Math.round(s);
  return v < 60 ? `${v}s` : `${Math.floor(v / 60)}:${String(v % 60).padStart(2, "0")}`;
};
export const purposeLabel = (t: Pick<Track, "purpose" | "sfxType">) =>
  t.purpose === "sfx" ? SFX_TYPES.find((s) => s.id === t.sfxType)?.label ?? "SFX" : MUSIC_PURPOSES.find((p) => p.id === t.purpose)?.label ?? t.purpose;

export function TrackRow({ t }: { t: Track }) {
  const utils = trpc.useUtils();
  const player = usePlayer();
  const playing = player.id === t.id;
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(t.title);
  const [pubOpen, setPubOpen] = useState(false);
  const refresh = () => utils.music.list.invalidate();
  const update = trpc.music.update.useMutation({ onSuccess: refresh });
  const remove = trpc.music.remove.useMutation({ onSuccess: () => { refresh(); toast.success("Eliminata"); } });

  const play = () => {
    if (t.isNew) update.mutate({ id: t.id, isNew: false });
    toggle(t).catch(() => toast.error("Non riesco a suonarla"));
  };
  const loop = t.loopSec != null;
  const busy = t.status === "queued" || t.status === "rendering";

  return (
    <div className="group flex items-center gap-3 px-3 py-2.5 rounded-xl transition-colors hover:bg-accent" style={playing ? { background: "oklch(0.65 0.2 265 / 0.1)" } : undefined}>
      <button onClick={play} disabled={t.status !== "ready"} className="relative shrink-0" aria-label={playing ? "Ferma" : "Ascolta"}>
        <Cover t={t} />
        <span className={`absolute inset-0 flex items-center justify-center rounded-xl transition-opacity ${playing || busy ? "opacity-100" : "opacity-0 group-hover:opacity-100"}`} style={{ background: "oklch(0 0 0 / 0.35)" }}>
          {busy || (playing && player.loading) ? <Loader2 className="w-5 h-5 text-white animate-spin" />
            : t.status === "failed" ? <TriangleAlert className="w-5 h-5 text-white" />
            : playing ? <Pause className="w-5 h-5 text-white" /> : <Play className="w-5 h-5 text-white" />}
        </span>
      </button>

      <div className="flex-1 min-w-0">
        {editing ? (
          <form onSubmit={(e) => { e.preventDefault(); if (title.trim()) update.mutate({ id: t.id, title: title.trim() }); setEditing(false); }}>
            <input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} onBlur={() => setEditing(false)}
              className="w-full bg-transparent text-sm font-semibold outline-none border-b border-primary" maxLength={120} />
          </form>
        ) : (
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-sm font-semibold truncate">{t.title}</span>
            {t.isNew && <span className="shrink-0 text-[10px] font-bold uppercase px-1.5 py-0.5 rounded-md" style={{ background: "oklch(0.75 0.17 145)", color: "oklch(0.2 0.05 145)" }}>New</span>}
          </div>
        )}
        <div className="text-xs text-muted-foreground truncate mt-0.5">
          {busy ? (t.status === "queued" ? "In coda…" : "Sto suonando la traccia…")
            : t.status === "failed" ? <span style={{ color: "oklch(0.7 0.18 30)" }}>{t.error ?? "Non riuscita"}</span>
            : <>
                {purposeLabel(t)}
                {t.mood ? ` · ${t.mood}` : ""}
                {t.keyName ? ` · ${t.keyName}` : ""}
                {t.bpm ? ` · ${t.bpm} bpm` : ""}
              </>}
        </div>
      </div>

      <div className="hidden sm:flex items-center gap-3 text-xs text-muted-foreground shrink-0">
        {t.dmPublished && <span title="Pubblicata su Dream Map" className="flex items-center gap-1" style={{ color: "oklch(0.75 0.15 265)" }}><Send className="w-3.5 h-3.5" />Dream Map</span>}
        {loop && <span title="Loop senza cuciture"><Repeat className="w-3.5 h-3.5" /></span>}
        <span className="w-10 text-right tabular-nums">{fmt(t.loopSec ?? t.durationSec)}</span>
      </div>

      <button onClick={() => update.mutate({ id: t.id, favourite: !t.favourite })} className="p-1.5 rounded-lg hover:bg-background shrink-0" aria-label="Preferita">
        <Heart className="w-4 h-4" style={t.favourite ? { fill: "oklch(0.65 0.22 15)", color: "oklch(0.65 0.22 15)" } : { color: "oklch(0.5 0.02 260)" }} />
      </button>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button className="p-1.5 rounded-lg hover:bg-background shrink-0" aria-label="Altro"><MoreHorizontal className="w-4 h-4" /></button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={() => { setTitle(t.title); setEditing(true); }}><Pencil className="w-4 h-4 mr-2" />Rinomina</DropdownMenuItem>
          <DropdownMenuItem disabled={t.status !== "ready"} onClick={() => { window.location.href = fileUrl(t.id, true); }}><Download className="w-4 h-4 mr-2" />Scarica mp3</DropdownMenuItem>
          <DropdownMenuItem disabled={t.status !== "ready"} onClick={() => setPubOpen(true)}><Send className="w-4 h-4 mr-2" />{t.dmPublished ? "Dream Map…" : "Pubblica su Dream Map"}</DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem className="text-destructive" onClick={() => { if (confirm(`Eliminare "${t.title}"?`)) remove.mutate({ id: t.id }); }}><Trash2 className="w-4 h-4 mr-2" />Elimina</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {pubOpen && <PublishDialog t={t} onClose={() => setPubOpen(false)} />}
    </div>
  );
}

function PublishDialog({ t, onClose }: { t: Track; onClose: () => void }) {
  const utils = trpc.useUtils();
  const [uses, setUses] = useState<string[]>(t.dmUses.length ? t.dmUses : t.kind === "sfx" ? ["game_sfx"] : ["focus", "mystery_box"]);
  const [rarity, setRarity] = useState<string>(t.dmRarity ?? "argento");
  const publish = trpc.music.publish.useMutation({
    onSuccess: (_, v) => { utils.music.list.invalidate(); toast.success(v.on ? "Pubblicata su Dream Map" : "Tolta da Dream Map"); onClose(); },
  });
  const flip = (id: string) => setUses((u) => (u.includes(id) ? u.filter((x) => x !== id) : [...u, id]));
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle>{t.title} su Dream Map</DialogTitle></DialogHeader>
        <div className="space-y-5 pt-1">
          <div className="space-y-3">
            <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Dove compare</div>
            {DREAMMAP_USES.map((u) => (
              <label key={u.id} className="flex items-center gap-3 text-sm cursor-pointer">
                <Checkbox checked={uses.includes(u.id)} onCheckedChange={() => flip(u.id)} />{u.label}
              </label>
            ))}
          </div>
          {uses.includes("mystery_box") && (
            <div className="space-y-2">
              <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Scrigno</div>
              <div className="flex gap-1.5">
                {DREAMMAP_RARITIES.map((r) => (
                  <button key={r} onClick={() => setRarity(r)} className="flex-1 text-xs py-1.5 rounded-lg capitalize border transition-colors"
                    style={rarity === r ? { background: "oklch(0.65 0.2 265 / 0.18)", borderColor: "oklch(0.65 0.2 265 / 0.6)" } : { borderColor: "oklch(0.3 0.02 260)" }}>{r}</button>
                ))}
              </div>
            </div>
          )}
        </div>
        <DialogFooter className="pt-4 gap-2">
          {t.dmPublished && <Button variant="ghost" onClick={() => publish.mutate({ id: t.id, on: false })}>Togli da Dream Map</Button>}
          <Button disabled={!uses.length || publish.isPending} onClick={() => publish.mutate({ id: t.id, on: true, uses: uses as any, rarity: uses.includes("mystery_box") ? (rarity as any) : null })}>
            {t.dmPublished ? "Aggiorna" : "Pubblica"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
