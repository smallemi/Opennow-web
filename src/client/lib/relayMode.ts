import { useSyncExternalStore } from "react";

import { clampToRelayLimits, type RelayIceConfig, type RelayStatus } from "@shared/relay";
import { api } from "../api";

const STORAGE_KEY = "opennow.web.proxyMode";

export interface RelayModeState {
  status: RelayStatus | null;
  /** The visitor's own choice; ignored when the instance forces proxy mode. */
  enabled: boolean;
  /** Streams go through the relay right now. */
  active: boolean;
}

function readStoredChoice(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

let state: RelayModeState = { status: null, enabled: readStoredChoice(), active: false };
const listeners = new Set<() => void>();

function update(next: Partial<RelayModeState>): void {
  const merged = { ...state, ...next };
  merged.active = Boolean(merged.status?.available && (merged.status.forced || merged.enabled));
  state = merged;
  for (const listener of listeners) listener();
}

let loading: Promise<void> | null = null;
export function loadRelayStatus(): Promise<void> {
  loading ??= api<RelayStatus>("/api/relay/status")
    .then((status) => update({ status }))
    .catch(() => {
      loading = null;
    });
  return loading;
}

export function setProxyModeEnabled(enabled: boolean): void {
  try {
    localStorage.setItem(STORAGE_KEY, enabled ? "1" : "0");
  } catch {
    // ignore
  }
  update({ enabled });
}

export function getRelayModeState(): RelayModeState {
  return state;
}

export function useRelayMode(): RelayModeState {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      void loadRelayStatus();
      return () => listeners.delete(listener);
    },
    () => state,
  );
}

/** Applies the instance's proxy limits to stream settings while proxy mode is active. */
export function applyRelayLimits<T extends { resolution: string; fps: number; maxBitrateMbps: number }>(settings: T): T {
  const current = getRelayModeState();
  return current.active && current.status ? clampToRelayLimits(settings, current.status.limits) : settings;
}

export async function fetchRelayIceConfig(): Promise<RelayIceConfig> {
  return api<RelayIceConfig>("/api/relay/ice");
}
