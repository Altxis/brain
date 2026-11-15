/**
 * Коннектор Claude Code: сессии из ~/.claude/projects/<папка>/<session>.jsonl.
 *
 * Каждая строка JSONL — событие. Нам нужны только реплики человека и текст ответов:
 * служебные события (attachment, system, …), вывод инструментов и рассуждения модели отбрасываем.
 * Подагенты лежат в подпапке <session>/subagents/ — это побочные ветки, их не берём.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";

import type { BrainRecord } from "../records.ts";

export const SOURCE = "claude_code";
export const DEFAULT_ROOT = join(homedir(), ".claude", "projects");

/** Только те поля события, которые мы читаем. Остальное в JSON есть, но нам не нужно. */
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

/** Файлы ровно на один уровень вложенности (<root>/<папка>/<id>.jsonl), поэтому subagents/ сюда не попадают. */
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

/** Текст сообщения: строка или список блоков, из которых берём только блоки type=text. */
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
      // файл могут дописывать прямо сейчас — последняя строка бывает обрезана
    }
  }
  return events;
}

const sessionId = (path: string) => basename(path, ".jsonl"); // имя файла — это id сессии

/** Сравнение строк по кодам символов — как sort() в Python, без учёта локали. */
const byString = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Одна сессия может лежать в нескольких файлах: если в разговоре сменилась рабочая папка,
 * Claude Code продолжает ту же сессию (тот же id) в папке нового проекта — и копирует туда
 * всю прежнюю историю. Поэтому склеиваем файлы от старого к новому и выкидываем повторы по uuid
 * события: остаётся первая копия, с исходной рабочей папкой.
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
  events.sort((a, b) => byString(a.timestamp ?? "", b.timestamp ?? "")); // sort() в JS стабильный

  const turns: string[] = [];
  let firstUser = "";
  let project: string | null = null;
  let lastTs = "";
  for (const event of events) {
    const kind = event.type;
    if ((kind !== "user" && kind !== "assistant") || event.isSidechain || event.isMeta) continue;
    const text = textOf(event.message?.content).trim();
    if (!text) continue; // например, сообщение user, в котором только tool_result
    if (kind === "user" && !firstUser) firstUser = text;
    project ??= event.cwd ?? null;
    lastTs = event.timestamp ?? lastTs;
    turns.push(`${kind === "user" ? "Я" : "Claude"}: ${text}`);
  }
  if (turns.length === 0) return null;

  const firstLine = firstUser.split(/\r?\n/)[0] ?? "";
  return {
    source: SOURCE,
    externalId: sessionId(paths[0]!),
    // Array.from режет по символам, а не по UTF-16 — эмодзи не разломаются пополам.
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
