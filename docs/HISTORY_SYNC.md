# History sync (Baileys)

WhatsApp Web (Baileys) can emit `messaging-history.set` with chats, contacts, and messages during login/sync. This server stores a **bounded** subset so digests and `getChats` work without dumping the entire phone history onto the volume.

## Env

| Variable | Default | Meaning |
|---|---|---|
| `WA_SYNC_FULL_HISTORY` | `false` | Passed to Baileys `syncFullHistory`. Leave off unless you intentionally want a larger sync. Chat *list* metadata is still persisted when false. |
| `WA_HISTORY_MAX_MESSAGES_PER_CHAT` | `50` | Max history messages persisted per chat from `messaging-history.set`. |
| `WA_HISTORY_MAX_AGE_DAYS` | `30` | Drop history messages older than this many days. |

Live `messages.upsert` traffic is still persisted normally (not limited by the history caps). Persist bounds still apply as a safety cap when `WA_SYNC_FULL_HISTORY=true`.

## Behavior

1. `chats.upsert` / `chats.update` / history chat stubs → upsert `chats` rows (skip broadcast/status/newsletter JIDs).
2. Bounded history messages → `messages` rows + touch `chats.last_message_*`.
3. Live `messages.upsert` also touches the corresponding `chats` row (`lastMessageId` / `lastMessageAt`, pushName via COALESCE).
4. `getChats()` prefers `chats` (enriched with contact names), falling back to distinct `messages.chat_id` when the chats table is empty.

## Part-file assemble note

Part files were regenerated from `baileys.adapter.ts` (concat of part1+part2+part3 matches the main file). Dockerfile does **not** assemble parts; it builds `src/` directly. Parts are kept in sync for alternate assemble deploys.

| Area | File |
|------|------|
| Imports (`chatsTable`, `chat-history` helpers, `sql`) | `baileys.adapter.part1.ts.txt` |
| `getChats()` reads `chats` table + contacts enrich + messages fallback | `baileys.adapter.part2.ts.txt` |
| `persistMessage` / `persistChats` / `updateChats` / `touchChatFromMessage` / `persistHistoryMessages`; event handlers | `baileys.adapter.part3.ts.txt` |
| New helper module | `src/channels/baileys/chat-history.ts` (not split; copy alongside parts) |

## Smoke check

See `scripts/smoke-chats.md`. After pairing / reconnect with history events:

1. Call the chats MCP resource `whatsapp://instances/{id}/chats` / `getChats` — expect non-empty JIDs with names when contacts are known.
2. Pick a chat and fetch messages — expect up to `WA_HISTORY_MAX_MESSAGES_PER_CHAT` recent rows within the age window.
