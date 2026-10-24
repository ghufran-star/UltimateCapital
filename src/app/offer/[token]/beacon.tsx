"use client";

import { useEffect } from "react";

/** Counts a real open (link-preview bots fetch the page but don't run scripts). */
export function ViewBeacon({ token }: { token: string }) {
  useEffect(() => {
    fetch(`/api/offer/${token}/view`, { method: "POST", keepalive: true }).catch(() => null);
  }, [token]);
  return null;
}
