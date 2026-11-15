/** Common record format: everything the database knows arrives in this shape from any source. */
export interface BrainRecord {
  source: string; // where from: "claude_code", later "migaku", "github"…
  externalId: string; // id within the source; the (source, externalId) pair is unique
  title: string;
  body: string; // cleaned-up text, this is what search runs on
  updatedAt: string; // ISO time of the last change
  project: string | null;
}
