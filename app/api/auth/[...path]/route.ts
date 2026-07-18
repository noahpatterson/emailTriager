import { getNeonAuth } from "@/src/server/auth/neon";

const handler = getNeonAuth().handler();

export const GET = handler.GET;
export const POST = handler.POST;
export const PUT = handler.PUT;
export const PATCH = handler.PATCH;
export const DELETE = handler.DELETE;
