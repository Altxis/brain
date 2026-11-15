/**
 * Claude Code connector: sessions from ~/.claude/projects/<folder>/<session>.jsonl.
 *
 * Each JSONL line is an event. We only want the human's turns and the text of the replies:
 * service events (attachment, system, …), tool output and model reasoning are dropped.
 * Subagents live in a <session>/subagents/ subfolder — they are side branches, we skip them.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";

import type { BrainRecord } from "../records.ts";

export const SOURCE = "claude_code";
export const DEFAULT_ROOT = join(homedir(), ".claude", "projects");

/** Only the event fields we read. The JSON has more, we don't need it. */
interface ContentBlock {
  type?: string;
  text?: string;
}

interface SessionEvent {
  type?: string;
  uuid?: string;
  timestamp?: string;
  cwd?: string;
  isSidechain?: boolean;
  isMeta?: boolean;
  message?: { content?: string | ContentBlock[] };
}

/** Files exactly one level deep (<root>/<folder>/<id>.jsonl), so subagents/ never gets in. */
export function sessionFiles(root: string = DEFAULT_ROOT): string[] {
  const files: string[] = [];
  for (const dir of readdirSync(root, { withFileTypes: true })) {
    if (!dir.isDirectory()) continue;
    for (const f of readdirSync(join(root, dir.name), { withFileTypes: true })) {
      if (f.isFile() && f.name.endsWith(".jsonl")) files.push(join(root, dir.name, f.name));
    }
  }
  return files.sort();
}

/** Message text: either a string or a list of blocks, of which we keep only type=text. */
function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((b): b is ContentBlock => typeof b === "object" && b !== null && b.type === "text")
    .map((b) => b.text ?? "")
    .join("\n");
}

function readEvents(path: string): SessionEvent[] {
  const events: SessionEvent[] = [];
  for (const line of readFileSync(path, "utf-8").split("\n")) {
    try {
      events.push(JSON.parse(line));
    } catch {
      // the file may be written to right now — the last line can be truncated
    }
  }
  return events;
}

const sessionId = (path: string) => basename(path, ".jsonl"); // the file name is the session id

/** Compare strings by code units — like Python's sort(), locale-independent. */
const byString = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * One session can span several files: if the working directory changes mid-conversation,
 * Claude Code continues the same session (same id) in the new project's folder — and copies
 * the whole earlier history there. So we concatenate files from oldest to newest and drop
 * duplicate events by uuid: the first copy wins, with the original working directory.
 */
export function parse(paths: string[]): BrainRecord | null {
  const seen = new Set<string>();
  const events: SessionEvent[] = [];
  const oldestFirst = [...paths].sort((a, b) => statSync(a).mtimeMs - statSync(b).mtimeMs);
  for (const p of oldestFirst) {
    for (const e of readEvents(p)) {
      if (e.uuid) {
        if (seen.has(e.uuid)) continue;
        seen.add(e.uuid);
      }
      events.push(e);
    }
  }
  events.sort((a, b) => byString(a.timestamp ?? "", b.timestamp ?? "")); // sort() in JS is stable

  const turns: string[] = [];
  let firstUser = "";
  let project: string | null = null;
  let lastTs = "";
  for (const event of events) {
    const kind = event.type;
    if ((kind !== "user" && kind !== "assistant") || event.isSidechain || event.isMeta) continue;
    const text = textOf(event.message?.content).trim();
    if (!text) continue; // e.g. a user message that only carries a tool_result
    if (kind === "user" && !firstUser) firstUser = text;
    project ??= event.cwd ?? null;
    lastTs = event.timestamp ?? lastTs;
    turns.push(`${kind === "user" ? "User" : "Claude"}: ${text}`);
  }
  if (turns.length === 0) return null;

  const firstLine = firstUser.split(/\r?\n/)[0] ?? "";
  return {
    source: SOURCE,
    externalId: sessionId(paths[0]!),
    // Array.from splits by code points, not UTF-16 units — emoji won't be cut in half.
    title: Array.from(firstLine).slice(0, 100).join(""),
    body: turns.join("\n\n"),
    updatedAt: lastTs,
    project,
  };
}

export function* fetch(root: string = DEFAULT_ROOT): Generator<BrainRecord> {
  const sessions = new Map<string, string[]>();
  for (const path of sessionFiles(root)) {
    const id = sessionId(path);
    sessions.set(id, [...(sessions.get(id) ?? []), path]);
  }
  for (const paths of sessions.values()) {
    const record = parse(paths);
    if (record) yield record;
  }
}
