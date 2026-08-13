// ============================================================
// WA MCP — Chat / history sync helpers (Baileys)
// Pure utilities for chat upsert + bounded history message select.
// ============================================================

export type CoercibleTimestamp =
  | number
  | string
  | { low: number; high?: number }
  | null
  | undefined;

export type PersistableChat = {
  id?: string | null;
  name?: string | null;
  unreadCount?: number;
  conversationTimestamp?: CoercibleTimestamp;
  pinned?: unknown;
  muteEndTime?: number | null | CoercibleTimestamp;
  archived?: boolean | null;
  messages?: unknown[];
};

/**
 * Coerce Baileys Long / number timestamps to unix seconds.
 * Values that look like milliseconds (> 1e12) are converted to seconds
 * so they match messageTimestamp storage in baileys.adapter.ts.
 */
export function coerceUnixTimestamp(value: CoercibleTimestamp): number | null {
  if (value == null || value === "") return null;
  let n: number;
  if (typeof value === "number") {
    n = value;
  } else if (typeof value === "string") {
    n = Number(value);
  } else if (typeof value === "object" && "low" in value) {
    // protobuf Long-like; low is enough for unix-second timestamps
    n = Number(value.low);
  } else {
    n = Number(value);
  }
  if (!Number.isFinite(n) || n <= 0) return null;
  if (n > 1e12) n = Math.floor(n / 1000);
  return Math.floor(n);
}

/** Skip status / broadcast / newsletter JIDs — not useful chat digests. */
export function isSkippableChatJid(jid: string): boolean {
  if (!jid) return true;
  return (
    jid === "status@broadcast" ||
    jid.endsWith("@broadcast") ||
    jid.endsWith("@newsletter")
  );
}

export function parseHistoryLimits(env: NodeJS.ProcessEnv = process.env): {
  maxPerChat: number;
  maxAgeDays: number;
} {
  const maxPerChat = Math.max(
    0,
    Number.parseInt(env.WA_HISTORY_MAX_MESSAGES_PER_CHAT ?? "50", 10) || 50,
  );
  const maxAgeDays = Math.max(
    0,
    Number.parseInt(env.WA_HISTORY_MAX_AGE_DAYS ?? "30", 10) || 30,
  );
  return { maxPerChat, maxAgeDays };
}

/**
 * Bound history messages: drop older than maxAgeDays, then keep the newest
 * maxPerChat messages per chat. Prefer skipping a full forever dump.
 */
export function selectBoundedHistoryMessages<T>(
  messages: T[],
  getChatId: (m: T) => string | null | undefined,
  getTimestamp: (m: T) => CoercibleTimestamp,
  limits: { maxPerChat: number; maxAgeDays: number } = parseHistoryLimits(),
  nowSec: number = Math.floor(Date.now() / 1000),
): T[] {
  const { maxPerChat, maxAgeDays } = limits;
  if (maxPerChat === 0) return [];

  const minTs = maxAgeDays > 0 ? nowSec - maxAgeDays * 24 * 60 * 60 : 0;
  const byChat = new Map<string, T[]>();

  for (const msg of messages) {
    const chatId = getChatId(msg);
    if (!chatId || isSkippableChatJid(chatId)) continue;
    const ts = coerceUnixTimestamp(getTimestamp(msg));
    if (ts == null) continue;
    if (minTs > 0 && ts < minTs) continue;
    const list = byChat.get(chatId) ?? [];
    list.push(msg);
    byChat.set(chatId, list);
  }

  const selected: T[] = [];
  for (const list of byChat.values()) {
    list.sort((a, b) => {
      const ta = coerceUnixTimestamp(getTimestamp(a)) ?? 0;
      const tb = coerceUnixTimestamp(getTimestamp(b)) ?? 0;
      return tb - ta;
    });
    selected.push(...list.slice(0, maxPerChat));
  }
  return selected;
}

/** Extract last message id from a Baileys chat stub's messages array if present. */
export function extractChatLastMessageId(messages: unknown[] | undefined): string | null {
  if (!Array.isArray(messages) || messages.length === 0) return null;
  // Baileys chat stubs usually put the newest message at index 0
  for (const entry of messages) {
    if (!entry || typeof entry !== "object") continue;
    const key = (entry as { key?: { id?: string }; message?: { key?: { id?: string } } }).key
      ?? (entry as { message?: { key?: { id?: string } } }).message?.key;
    if (key?.id) return key.id;
  }
  return null;
}

export function pinnedToFlag(pinned: unknown): number {
  if (pinned == null || pinned === false || pinned === 0) return 0;
  return 1;
}
