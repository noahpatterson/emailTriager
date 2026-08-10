import { NextResponse } from "next/server";
import { isInsecureLocalDevRequested } from "@/src/server/auth/local-dev-flags";
import { getNeonAuth } from "@/src/server/auth/neon";
import { isDemoProfile } from "@/src/server/demo/ai-gate";

const insecure = isInsecureLocalDevRequested();

function unavailable() {
  return NextResponse.json(
    { error: "Neon Auth is disabled for this deployment" },
    { status: 404 },
  );
}

const authDisabled = isInsecureLocalDevRequested() || isDemoProfile();
const neon = authDisabled ? null : getNeonAuth().handler();

export const GET = neon?.GET ?? unavailable;
export const POST = neon?.POST ?? unavailable;
export const PUT = neon?.PUT ?? unavailable;
export const PATCH = neon?.PATCH ?? unavailable;
export const DELETE = neon?.DELETE ?? unavailable;
