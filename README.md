# brain

Personal memory for Claude: collect → store → find → hand to the agent.
A learning rebuild of a "second brain" from scratch, stage by stage. Takeaways are in [LEARNING.md](LEARNING.md).

## Usage

Requires Node.js 26 (pinned in `.nvmrc`: run `nvm use` in the project root to switch to it).

```bash
npm install
npm run brain sync              # pull Claude Code sessions into the database (data/brain.db in the project, or $BRAIN_DB)
npm run brain -- search migaku  # search (`--` stops npm from eating flags like -n)
npm run brain -- show 1         # full record
npm test                        # tests (node:test)
npm run typecheck               # type check
```

Connect to Claude Code (use an absolute path to `tsx`: `npm run` prints a banner to stdout and breaks the protocol):

```bash
claude mcp add -s user brain -- /path/to/brain/node_modules/.bin/tsx /path/to/brain/src/cli.ts mcp
```

## Layout

```
src/
  records.ts                common record format (BrainRecord)
  connectors/claudeCode.ts  Claude Code sessions → records
  db.ts                     SQLite (built-in node:sqlite) + FTS5: upsert, search, get
  mcpServer.ts              search and get_record tools for Claude
  cli.ts                    CLI: sync | search | show | mcp
tests/thread.test.ts        end-to-end test: JSONL → record → database → search
```
