import Database from "better-sqlite3"
import { randomUUID } from "node:crypto"
import { chmodSync, mkdirSync } from "node:fs"
import { dirname, isAbsolute } from "node:path"
import { getAgentDir } from "../paths.js"
import { MemoryConflictError, type Memory, type MemoryRepository, type MemoryRevision, type MemoryScope, type MemorySearch } from "./repository.js"

type ScopeColumns = [kind: string, projectPath: string, sessionId: string]
type Row = {
  id: string; scope_kind: string; project_path: string; session_id: string
  content: string; source: string; revision: number; created_at: number; updated_at: number
}
type RevisionRow = Row & { action: MemoryRevision["action"] }

const columns = "id, scope_kind, project_path, session_id, content, source, revision, created_at, updated_at"
const scopeWhere = "scope_kind = ? AND project_path = ? AND session_id = ?"

function scopeColumns(scope: MemoryScope): ScopeColumns {
  if (scope.kind === "app") return ["app", "", ""]
  if (!scope.projectPath || !isAbsolute(scope.projectPath)) throw new Error("memory projectPath must be absolute")
  if (scope.kind === "project") return ["project", scope.projectPath, ""]
  if (!scope.sessionId?.trim()) throw new Error("memory sessionId is required")
  return ["session", scope.projectPath, scope.sessionId]
}

function fromRow(row: Row): Memory {
  const scope: MemoryScope = row.scope_kind === "app" ? { kind: "app" }
    : row.scope_kind === "project" ? { kind: "project", projectPath: row.project_path }
      : { kind: "session", projectPath: row.project_path, sessionId: row.session_id }
  return { id: row.id, scope, content: row.content, source: row.source, revision: row.revision, createdAt: row.created_at, updatedAt: row.updated_at }
}

function cleanContent(content: string): string {
  const value = content.trim()
  if (!value || value.length > 20_000) throw new Error("memory content must be 1–20000 characters")
  return value
}

function pageSize(value: number | undefined): number { return Math.min(100, Math.max(1, Math.floor(value ?? 50))) }

/** The only SQLite-specific module; callers and contract tests depend on MemoryRepository. */
export function openSqliteMemoryRepository(path = `${getAgentDir()}/pi-ui/memory.sqlite`): MemoryRepository {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
  const db = new Database(path)
  chmodSync(path, 0o600)
  db.pragma("journal_mode = WAL")
  db.pragma("busy_timeout = 5000")
  db.pragma("foreign_keys = ON")
  const version = db.pragma("user_version", { simple: true }) as number
  if (version > 1) { db.close(); throw new Error(`unsupported memory schema version: ${version}`) }
  if (version === 0) db.transaction(() => {
    db.exec(`
      CREATE TABLE memory_entries (
        id TEXT PRIMARY KEY,
        scope_kind TEXT NOT NULL CHECK (scope_kind IN ('app', 'project', 'session')),
        project_path TEXT NOT NULL,
        session_id TEXT NOT NULL,
        content TEXT NOT NULL,
        source TEXT NOT NULL,
        revision INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        deleted_at INTEGER
      );
      CREATE INDEX memory_scope_list ON memory_entries(scope_kind, project_path, session_id, deleted_at, updated_at DESC);
      CREATE TABLE memory_revisions (
        id INTEGER PRIMARY KEY,
        memory_id TEXT NOT NULL REFERENCES memory_entries(id),
        action TEXT NOT NULL CHECK (action IN ('create', 'update', 'delete')),
        revision INTEGER NOT NULL,
        scope_kind TEXT NOT NULL,
        project_path TEXT NOT NULL,
        session_id TEXT NOT NULL,
        content TEXT NOT NULL,
        source TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX memory_revision_history ON memory_revisions(memory_id, revision);
      CREATE VIRTUAL TABLE memory_fts USING fts5(content, tokenize='trigram');
      CREATE TRIGGER memory_fts_insert AFTER INSERT ON memory_entries WHEN NEW.deleted_at IS NULL BEGIN
        INSERT INTO memory_fts(rowid, content) VALUES (NEW.rowid, NEW.content);
      END;
      CREATE TRIGGER memory_fts_update AFTER UPDATE ON memory_entries BEGIN
        DELETE FROM memory_fts WHERE rowid = OLD.rowid;
        INSERT INTO memory_fts(rowid, content) SELECT NEW.rowid, NEW.content WHERE NEW.deleted_at IS NULL;
      END;
      CREATE TRIGGER memory_fts_delete AFTER DELETE ON memory_entries BEGIN
        DELETE FROM memory_fts WHERE rowid = OLD.rowid;
      END;
      PRAGMA user_version = 1;
    `)
  })()

  const insert = db.prepare(`INSERT INTO memory_entries (${columns}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
  const select = db.prepare(`SELECT ${columns} FROM memory_entries WHERE id = ? AND ${scopeWhere} AND deleted_at IS NULL`)
  const list = db.prepare(`SELECT ${columns} FROM memory_entries WHERE ${scopeWhere} AND deleted_at IS NULL ORDER BY updated_at DESC, id DESC LIMIT ? OFFSET ?`)
  const revise = db.prepare(`INSERT INTO memory_revisions (memory_id, action, revision, scope_kind, project_path, session_id, content, source, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
  const history = db.prepare(`SELECT m.id, r.scope_kind, r.project_path, r.session_id, r.content, r.source, r.revision, r.created_at, r.updated_at, r.action FROM memory_revisions r JOIN memory_entries m ON m.id = r.memory_id WHERE r.memory_id = ? AND m.${scopeWhere.replaceAll(" AND ", " AND m.")} ORDER BY r.revision`)

  const recordRevision = (row: Row, action: MemoryRevision["action"]) =>
    revise.run(row.id, action, row.revision, row.scope_kind, row.project_path, row.session_id, row.content, row.source, row.created_at, row.updated_at)
  const selected = (scope: MemoryScope, id: string): Row | undefined => select.get(id, ...scopeColumns(scope)) as Row | undefined

  return {
    async create(input) {
      const scope = scopeColumns(input.scope)
      const now = Date.now()
      const row: Row = { id: randomUUID(), scope_kind: scope[0], project_path: scope[1], session_id: scope[2], content: cleanContent(input.content), source: input.source?.trim() || "manual", revision: 1, created_at: now, updated_at: now }
      db.transaction(() => {
        insert.run(row.id, row.scope_kind, row.project_path, row.session_id, row.content, row.source, row.revision, row.created_at, row.updated_at)
        recordRevision(row, "create")
      })()
      return fromRow(row)
    },
    async get(scope, id) { const row = selected(scope, id); return row ? fromRow(row) : null },
    async list(scope, options) {
      return (list.all(...scopeColumns(scope), pageSize(options?.limit), Math.max(0, Math.floor(options?.offset ?? 0))) as Row[]).map(fromRow)
    },
    async search(input: MemorySearch) {
      if (!input.scopes.length || !input.text.trim()) return []
      const text = input.text.trim()
      const scopes = input.scopes.map(scopeColumns)
      const where = scopes.map(() => `(${scopeWhere})`).join(" OR ")
      const params = scopes.flat()
      if ([...text].length < 3) {
        return (db.prepare(`SELECT ${columns} FROM memory_entries WHERE deleted_at IS NULL AND (${where}) AND instr(lower(content), lower(?)) > 0 ORDER BY updated_at DESC, id DESC LIMIT ?`)
          .all(...params, text, pageSize(input.limit)) as Row[]).map(fromRow)
      }
      const phrase = `"${text.replaceAll('"', '""')}"`
      return (db.prepare(`SELECT ${columns.split(", ").map(c => `e.${c}`).join(", ")} FROM memory_fts JOIN memory_entries e ON e.rowid = memory_fts.rowid WHERE memory_fts MATCH ? AND e.deleted_at IS NULL AND (${where.replaceAll("scope_kind", "e.scope_kind").replaceAll("project_path", "e.project_path").replaceAll("session_id", "e.session_id")}) ORDER BY bm25(memory_fts), e.updated_at DESC LIMIT ?`)
        .all(phrase, ...params, pageSize(input.limit)) as Row[]).map(fromRow)
    },
    async update(scope, id, expectedRevision, content) {
      return db.transaction(() => {
        const prior = selected(scope, id)
        if (!prior) return null
        if (prior.revision !== expectedRevision) throw new MemoryConflictError()
        const row = { ...prior, content: cleanContent(content), revision: prior.revision + 1, updated_at: Date.now() }
        db.prepare("UPDATE memory_entries SET content = ?, revision = ?, updated_at = ? WHERE id = ?").run(row.content, row.revision, row.updated_at, id)
        recordRevision(row, "update")
        return fromRow(row)
      })()
    },
    async delete(scope, id, expectedRevision) {
      return db.transaction(() => {
        const prior = selected(scope, id)
        if (!prior) return false
        if (prior.revision !== expectedRevision) throw new MemoryConflictError()
        const row = { ...prior, revision: prior.revision + 1, updated_at: Date.now() }
        db.prepare("UPDATE memory_entries SET revision = ?, updated_at = ?, deleted_at = ? WHERE id = ?").run(row.revision, row.updated_at, row.updated_at, id)
        recordRevision(row, "delete")
        return true
      })()
    },
    async history(scope, id) {
      return (history.all(id, ...scopeColumns(scope)) as RevisionRow[]).map(row => ({ ...fromRow(row), action: row.action }))
    },
    async close() { if (db.open) db.close() },
  }
}
