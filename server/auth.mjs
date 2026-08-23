import { timingSafeEqual } from "node:crypto";

export function adminTokenMatches(configured, supplied) {
  if (!configured || !supplied || configured.length !== supplied.length) return false;
  return timingSafeEqual(Buffer.from(configured), Buffer.from(supplied));
}
