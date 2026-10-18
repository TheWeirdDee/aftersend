import { timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";
import { AppError } from "@/lib/http/errors";
import { json, route } from "@/lib/http/route";
import { cleanupStagingAudio } from "@/lib/notices/cleanup";

export const dynamic = "force-dynamic";

/** Scheduled cleanup of expired staging audio. Requires `Authorization: Bearer $CRON_SECRET`. */
export const GET = route(async (req: NextRequest) => {
  const secret = process.env.CRON_SECRET;
  const given = req.headers.get("authorization") ?? "";
  const expected = `Bearer ${secret}`;
  if (!secret || given.length !== expected.length || !timingSafeEqual(Buffer.from(given), Buffer.from(expected))) {
    throw new AppError("unauthenticated", "Not authorised.");
  }
  return json(await cleanupStagingAudio());
});
