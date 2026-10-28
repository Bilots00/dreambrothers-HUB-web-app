import { z } from "zod";
import {
  AD_LENGTHS, AMBIENT_LENGTHS, DREAMMAP_RARITIES, DREAMMAP_USES, MUSIC_KEYS, MUSIC_MOODS, MUSIC_PURPOSES, SFX_TYPES,
} from "@shared/music";
import { protectedProcedure, router } from "../_core/trpc";
import {
  deleteTrack, enqueue, listTracks, markAllSeen, newSeed, nightlyStatus, runNightlyBatch, setPublished, updateTrack,
} from "./service";

const ids = <T extends readonly { id: string }[]>(a: T) => a.map((x) => x.id) as [T[number]["id"], ...T[number]["id"][]];

export const musicRouter = router({
  list: protectedProcedure.query(({ ctx }) => listTracks(ctx.user.id)),

  generate: protectedProcedure
    .input(z.object({
      purpose: z.enum(ids(MUSIC_PURPOSES)),
      mood: z.enum(ids(MUSIC_MOODS)).optional(),
      key: z.enum(MUSIC_KEYS).optional(),
      bpm: z.number().int().min(44).max(110).optional(),
      lengthSec: z.number().int().optional(),
      sfxType: z.enum(ids(SFX_TYPES)).optional(),
      title: z.string().max(120).optional(),
      count: z.number().int().min(1).max(4).default(1),
    }))
    .mutation(async ({ ctx, input }) => {
      const isSfx = input.purpose === "sfx";
      const lengths: readonly number[] = input.purpose === "ad" ? AD_LENGTHS : AMBIENT_LENGTHS;
      const lengthSec = isSfx ? undefined : lengths.includes(input.lengthSec ?? -1) ? input.lengthSec : lengths[input.purpose === "ad" ? 1 : 1];
      const out: number[] = [];
      for (let i = 0; i < input.count; i++) {
        out.push(await enqueue(ctx.user.id, {
          kind: isSfx ? "sfx" : "track", purpose: input.purpose, mood: isSfx ? undefined : input.mood, key: isSfx ? undefined : input.key,
          bpm: isSfx ? undefined : input.bpm, lengthSec, sfxType: isSfx ? (input.sfxType ?? "reward") : undefined,
          seed: newSeed(), title: input.title && input.count > 1 ? `${input.title} ${i + 1}` : input.title,
        }, "manual", null));
      }
      return { ids: out };
    }),

  update: protectedProcedure
    .input(z.object({ id: z.number().int(), title: z.string().min(1).max(120).optional(), favourite: z.boolean().optional(), isNew: z.boolean().optional() }))
    .mutation(async ({ ctx, input }) => { await updateTrack(ctx.user.id, input.id, input); return { ok: true }; }),

  markAllSeen: protectedProcedure.mutation(async ({ ctx }) => { await markAllSeen(ctx.user.id); return { ok: true }; }),

  remove: protectedProcedure.input(z.object({ id: z.number().int() }))
    .mutation(async ({ ctx, input }) => { await deleteTrack(ctx.user.id, input.id); return { ok: true }; }),

  publish: protectedProcedure
    .input(z.object({
      id: z.number().int(), on: z.boolean(),
      uses: z.array(z.enum(ids(DREAMMAP_USES))).default([]),
      rarity: z.enum(DREAMMAP_RARITIES).nullable().default(null),
    }))
    .mutation(async ({ ctx, input }) => { await setPublished(ctx.user.id, input.id, input.on, input.uses, input.rarity); return { ok: true }; }),

  nightly: protectedProcedure.query(({ ctx }) => nightlyStatus(ctx.user.id)),
  runNightlyNow: protectedProcedure.mutation(() => runNightlyBatch({ force: true })),
});
