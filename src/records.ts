/** Общий формат записи: всё, что знает база, приходит в таком виде из любого источника. */
export interface BrainRecord {
  source: string; // откуда: "claude_code", позже "migaku", "github"…
  externalId: string; // идентификатор внутри источника; пара (source, externalId) уникальна
  title: string;
  body: string; // очищенный текст, по нему идёт поиск
  updatedAt: string; // ISO-время последнего изменения
  project: string | null;
}
