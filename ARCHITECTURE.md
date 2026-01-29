# Live 2-Way Data Sync System Architecture

## System Overview

A production-grade bidirectional synchronization system between Google Sheets and MySQL, designed to handle dynamic schemas, prevent infinite loops, and respect API rate limits.

---

## 1. Schema Strategy: Dynamic Column Mapping

### Problem Statement
Google Sheets has a fluid schema—users can add/remove/rename columns at any time. We cannot hardcode column mappings.

### Solution: Schema Registry Pattern

```
┌─────────────────────────────────────────────────────────────────┐
│                    SCHEMA REGISTRY TABLE                        │
├─────────────────────────────────────────────────────────────────┤
│  sync_schema_registry                                           │
│  ├── id (PK)                                                    │
│  ├── sheet_id (VARCHAR) - Google Sheet ID                       │
│  ├── sheet_name (VARCHAR) - Tab/Sheet name                      │
│  ├── column_index (INT) - 0-based column position in Sheet      │
│  ├── column_header (VARCHAR) - Header name from Sheet (Row 1)   │
│  ├── mysql_column_name (VARCHAR) - Sanitized SQL-safe name      │
│  ├── data_type (ENUM) - 'TEXT', 'NUMBER', 'DATE', 'BOOLEAN'     │
│  ├── created_at (TIMESTAMP)                                     │
│  └── updated_at (TIMESTAMP)                                     │
└─────────────────────────────────────────────────────────────────┘
```

### Column Name Sanitization Rules
1. Convert to lowercase
2. Replace spaces/special chars with underscores
3. Prefix numeric-starting names with `col_`
4. Truncate to 64 chars (MySQL limit)
5. Append `_1`, `_2` for duplicates

### Dynamic Table Structure

For each synced sheet, we create a corresponding MySQL table:

```
┌─────────────────────────────────────────────────────────────────┐
│  sheet_{sanitized_sheet_id}_{sheet_name}                        │
├─────────────────────────────────────────────────────────────────┤
│  _sync_row_id (PK, AUTO_INCREMENT) - Internal row identifier    │
│  _sheet_row_number (INT, UNIQUE) - Actual row number in Sheet   │
│  _row_hash (VARCHAR(64)) - SHA256 of row content for change det │
│  _last_modified_at (TIMESTAMP) - For conflict resolution        │
│  _last_modified_by (ENUM) - 'SHEET', 'DATABASE', 'SYSTEM'       │
│  _sync_status (ENUM) - 'SYNCED', 'PENDING', 'CONFLICT', 'ERROR' │
│  ...dynamic columns from schema registry...                     │
└─────────────────────────────────────────────────────────────────┘
```

### Schema Evolution Handling

When a new column is detected in the Sheet:
1. Add entry to `sync_schema_registry`
2. Execute `ALTER TABLE ADD COLUMN` with default NULL
3. Log schema change for audit

When a column is removed from the Sheet:
1. Mark column as `deprecated` in registry (soft delete)
2. **Do NOT drop MySQL column** (data preservation)
3. Stop syncing that column

---

## 2. Loop Prevention Strategy: The "Origin Stamp" Pattern

### The Infinite Loop Problem

```
DANGEROUS LOOP:
Sheet Edit → Webhook → MySQL Update → Polling Detects Change → 
Sheet Update → Webhook → MySQL Update → ... ∞
```

### Solution: Multi-Layer Loop Breaking

#### Layer 1: Origin Stamp (`_last_modified_by`)

Every write operation stamps the source:

| Operation Source | `_last_modified_by` Value |
|------------------|---------------------------|
| Google Sheet webhook | `'SHEET'` |
| MySQL direct edit | `'DATABASE'` |
| System reconciliation | `'SYSTEM'` |

**Rule:** The DB→Sheet sync worker **ignores** rows where `_last_modified_by = 'SHEET'` within a cooldown window.

#### Layer 2: Content Hash Comparison (`_row_hash`)

Before triggering any sync:
1. Compute SHA256 hash of the incoming row data
2. Compare with stored `_row_hash`
3. **Skip if hashes match** (no actual change)

```typescript
function computeRowHash(rowData: Record<string, unknown>): string {
  const normalized = JSON.stringify(rowData, Object.keys(rowData).sort());
  return crypto.createHash('sha256').update(normalized).digest('hex');
}
```

#### Layer 3: Cooldown Window (Temporal Guard)

After a sync operation completes:
1. Set `_last_modified_at` to current timestamp
2. The opposite direction sync **ignores** changes within `SYNC_COOLDOWN_MS` (default: 5000ms)

```
Timeline:
|-------- Sync from Sheet @ T=0 --------|
|---- Cooldown Window (5s) ---|
                              |---- DB→Sheet polling ignores this row ---|
```

#### Layer 4: Sync Transaction ID

Each sync batch gets a unique `sync_transaction_id`. Store in Redis:

```
Key: sync:lock:{sheet_id}:{row_number}
Value: { transactionId, direction, timestamp }
TTL: 10 seconds
```

If a webhook arrives while a lock exists for the opposite direction, **queue it for retry** instead of processing immediately.

### Loop Prevention Decision Matrix

| Scenario | Action |
|----------|--------|
| Sheet change, `_last_modified_by` = 'SHEET', within cooldown | SKIP (echo of our own update) |
| Sheet change, hash unchanged | SKIP (no-op edit) |
| DB change, `_last_modified_by` = 'DATABASE', within cooldown | SKIP (echo of our own update) |
| DB change, lock exists for SHEET direction | QUEUE for retry |
| Any change, hash changed, outside cooldown | PROCESS |

---

## 3. Data Flow Diagrams

### Direction A: Google Sheet → MySQL

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                         SHEET → DATABASE FLOW                                │
└──────────────────────────────────────────────────────────────────────────────┘

  ┌─────────────┐     ┌─────────────────┐     ┌─────────────────────────────┐
  │   Google    │     │  Google Apps    │     │      Node.js Backend        │
  │   Sheets    │────▶│    Script       │────▶│   POST /api/webhook         │
  │  (User Edit)│     │  (onEdit trigger│     │                             │
  └─────────────┘     └─────────────────┘     └──────────────┬──────────────┘
                                                             │
                      Payload: { sheetId, sheetName,         │
                                 row, col, value,            ▼
                                 timestamp, userEmail }   ┌──────────────────┐
                                                          │  Validation &    │
                                                          │  Deduplication   │
                                                          │  (Hash Check)    │
                                                          └────────┬─────────┘
                                                                   │
                                              ┌────────────────────┴─────┐
                                              │                          │
                                              ▼                          ▼
                                    ┌─────────────────┐        ┌─────────────────┐
                                    │  SKIP           │        │  Enqueue to     │
                                    │  (Duplicate)    │        │  BullMQ         │
                                    └─────────────────┘        │  "sheet-to-db"  │
                                                               └────────┬────────┘
                                                                        │
                                                                        ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                              REDIS + BullMQ                                 │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │  Queue: sheet-to-db                                                  │   │
│  │  ├── Job: { sheetId, row, col, value, timestamp, retries: 0 }       │   │
│  │  ├── Job: { ... }                                                    │   │
│  │  └── Rate Limiter: max 50 jobs/minute (buffer for other operations) │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────────┘
                                         │
                                         ▼
                              ┌─────────────────────┐
                              │   BullMQ Worker     │
                              │   "SheetToDbWorker" │
                              └──────────┬──────────┘
                                         │
           ┌─────────────────────────────┼─────────────────────────────┐
           │                             │                             │
           ▼                             ▼                             ▼
  ┌─────────────────┐         ┌─────────────────────┐       ┌─────────────────┐
  │ Schema Check:   │         │ Type Casting:       │       │ Conflict Check: │
  │ Column exists?  │         │ Validate & coerce   │       │ Compare         │
  │ Need ALTER?     │         │ to MySQL type       │       │ timestamps      │
  └────────┬────────┘         └──────────┬──────────┘       └────────┬────────┘
           │                             │                           │
           └─────────────────────────────┼───────────────────────────┘
                                         │
                                         ▼
                              ┌─────────────────────┐
                              │   MySQL UPDATE      │
                              │   SET column=value, │
                              │   _last_modified_by │
                              │     = 'SHEET',      │
                              │   _row_hash = new   │
                              └──────────┬──────────┘
                                         │
                                         ▼
                              ┌─────────────────────┐
                              │   Emit Event:       │
                              │   "sync:complete"   │
                              │   (for dashboard)   │
                              └─────────────────────┘
```

### Direction B: MySQL → Google Sheet

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                         DATABASE → SHEET FLOW                                │
└──────────────────────────────────────────────────────────────────────────────┘

  ┌─────────────────────────────────────────────────────────────────────────┐
  │                           MySQL Database                                │
  │  ┌─────────────────────────────────────────────────────────────────┐   │
  │  │  sheet_abc123_sales                                              │   │
  │  │  Row modified: UPDATE ... SET price=99.99 (by external app/user) │   │
  │  │  Trigger fires → INSERT INTO sync_change_log                     │   │
  │  └─────────────────────────────────────────────────────────────────┘   │
  │                                                                         │
  │  ┌─────────────────────────────────────────────────────────────────┐   │
  │  │  sync_change_log (CDC Table)                                     │   │
  │  │  ├── id (PK, AUTO_INCREMENT)                                     │   │
  │  │  ├── table_name                                                  │   │
  │  │  ├── row_id                                                      │   │
  │  │  ├── operation (INSERT/UPDATE/DELETE)                            │   │
  │  │  ├── changed_columns (JSON)                                      │   │
  │  │  ├── old_values (JSON)                                           │   │
  │  │  ├── new_values (JSON)                                           │   │
  │  │  ├── changed_at (TIMESTAMP)                                      │   │
  │  │  └── processed (BOOLEAN, default FALSE)                          │   │
  │  └─────────────────────────────────────────────────────────────────┘   │
  └─────────────────────────────────────────────────────────────────────────┘
                                         │
                                         │ Polling every 5 seconds
                                         ▼
                              ┌─────────────────────┐
                              │   Polling Service   │
                              │   "DbChangeWatcher" │
                              └──────────┬──────────┘
                                         │
                                         │ SELECT * FROM sync_change_log
                                         │ WHERE processed = FALSE
                                         │ AND _last_modified_by != 'SHEET'
                                         │ ORDER BY changed_at ASC
                                         │ LIMIT 100
                                         ▼
                              ┌─────────────────────┐
                              │   Loop Prevention   │
                              │   Check:            │
                              │   - Origin stamp    │
                              │   - Cooldown window │
                              │   - Hash comparison │
                              └──────────┬──────────┘
                                         │
                            ┌────────────┴────────────┐
                            │                         │
                            ▼                         ▼
                   ┌─────────────────┐      ┌─────────────────┐
                   │  SKIP           │      │  Batch Group    │
                   │  (Loop detected)│      │  by Sheet ID    │
                   └─────────────────┘      └────────┬────────┘
                                                     │
                                                     ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                              REDIS + BullMQ                                 │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │  Queue: db-to-sheet                                                  │   │
│  │  ├── Job: { sheetId, updates: [{row, col, value}, ...], batchId }   │   │
│  │  └── Rate Limiter: max 55 jobs/minute (leave headroom)              │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │  Batch Accumulator (5 second window OR 50 updates threshold)        │   │
│  │  Purpose: Combine multiple cell updates into single API call        │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────────┘
                                         │
                                         ▼
                              ┌─────────────────────┐
                              │   BullMQ Worker     │
                              │   "DbToSheetWorker" │
                              └──────────┬──────────┘
                                         │
                                         ▼
                              ┌─────────────────────┐
                              │  Google Sheets API  │
                              │  spreadsheets.      │
                              │  values.batchUpdate │
                              │                     │
                              │  Rate: 60 req/min   │
                              │  Quota: 300 req/min │
                              │  per user           │
                              └──────────┬──────────┘
                                         │
           ┌─────────────────────────────┼─────────────────────────────┐
           │                             │                             │
           ▼                             ▼                             ▼
  ┌─────────────────┐         ┌─────────────────────┐       ┌─────────────────┐
  │ Success:        │         │ Rate Limited (429): │       │ Error:          │
  │ Mark processed  │         │ Re-queue with       │       │ Log, retry with │
  │ = TRUE          │         │ exponential backoff │       │ backoff, alert  │
  └─────────────────┘         └─────────────────────┘       └─────────────────┘
```

### Complete System Overview

```
┌────────────────────────────────────────────────────────────────────────────────────┐
│                              SYSTEM ARCHITECTURE                                   │
├────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                    │
│   ┌──────────────┐                                      ┌──────────────────────┐  │
│   │              │◀─────── User Edits ────────────────▶│                      │  │
│   │   Google     │                                      │       MySQL          │  │
│   │   Sheets     │                                      │      Database        │  │
│   │              │                                      │                      │  │
│   └──────┬───────┘                                      └──────────┬───────────┘  │
│          │                                                         │              │
│          │ Apps Script                                             │ Triggers/    │
│          │ onEdit()                                                │ Polling      │
│          │                                                         │              │
│          ▼                                                         ▼              │
│   ┌──────────────────────────────────────────────────────────────────────────┐   │
│   │                          Node.js Backend (Express + TypeScript)          │   │
│   │  ┌────────────────────────────────────────────────────────────────────┐  │   │
│   │  │                         API Layer                                  │  │   │
│   │  │  POST /api/webhook           GET /api/sync/status                  │  │   │
│   │  │  POST /api/sheets/register   GET /api/health                       │  │   │
│   │  └────────────────────────────────────────────────────────────────────┘  │   │
│   │                                    │                                      │   │
│   │  ┌─────────────────────────────────┴─────────────────────────────────┐   │   │
│   │  │                         Service Layer                              │   │   │
│   │  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌───────────┐  │   │   │
│   │  │  │   Schema    │  │    Sync     │  │   Conflict  │  │   Queue   │  │   │   │
│   │  │  │   Manager   │  │   Engine    │  │   Resolver  │  │  Manager  │  │   │   │
│   │  │  └─────────────┘  └─────────────┘  └─────────────┘  └───────────┘  │   │   │
│   │  └───────────────────────────────────────────────────────────────────────┘   │
│   │                                    │                                      │   │
│   │  ┌─────────────────────────────────┴─────────────────────────────────┐   │   │
│   │  │                          Data Layer                                │   │   │
│   │  │  ┌──────────────────┐     ┌──────────────────┐                    │   │   │
│   │  │  │   MySQL Pool     │     │   Redis Client   │                    │   │   │
│   │  │  │   (mysql2)       │     │   (ioredis)      │                    │   │   │
│   │  │  └──────────────────┘     └──────────────────┘                    │   │   │
│   │  └───────────────────────────────────────────────────────────────────────┘   │
│   └──────────────────────────────────────────────────────────────────────────┘   │
│                                    │                                              │
│   ┌────────────────────────────────┴─────────────────────────────────────────┐   │
│   │                          Redis + BullMQ                                   │   │
│   │  ┌────────────────────────┐        ┌────────────────────────┐            │   │
│   │  │  Queue: sheet-to-db    │        │  Queue: db-to-sheet    │            │   │
│   │  │  ├── Rate: 50/min      │        │  ├── Rate: 55/min      │            │   │
│   │  │  ├── Retries: 3        │        │  ├── Retries: 3        │            │   │
│   │  │  └── Backoff: exp      │        │  └── Backoff: exp      │            │   │
│   │  └────────────────────────┘        └────────────────────────┘            │   │
│   │                                                                           │   │
│   │  ┌────────────────────────────────────────────────────────────────────┐  │   │
│   │  │  Sync Locks: sync:lock:{sheetId}:{rowNumber} TTL=10s               │  │   │
│   │  │  Rate Limit Counters: ratelimit:sheets:{minute}                    │  │   │
│   │  └────────────────────────────────────────────────────────────────────┘  │   │
│   └──────────────────────────────────────────────────────────────────────────┘   │
│                                                                                    │
│   ┌──────────────────────────────────────────────────────────────────────────┐   │
│   │                        Next.js Dashboard                                  │   │
│   │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────────┐  │   │
│   │  │  Sync       │  │  Queue      │  │  Error      │  │  Schema         │  │   │
│   │  │  Status     │  │  Monitor    │  │  Logs       │  │  Viewer         │  │   │
│   │  └─────────────┘  └─────────────┘  └─────────────┘  └─────────────────┘  │   │
│   └──────────────────────────────────────────────────────────────────────────┘   │
│                                                                                    │
└────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 4. Conflict Resolution: Last Write Wins (LWW)

### Timestamp-Based Resolution

```typescript
interface SyncRecord {
  _sheet_row_number: number;
  _last_modified_at: Date;
  _last_modified_by: 'SHEET' | 'DATABASE' | 'SYSTEM';
}

function resolveConflict(incoming: SyncPayload, existing: SyncRecord): 'APPLY' | 'SKIP' | 'CONFLICT' {
  const incomingTs = new Date(incoming.timestamp).getTime();
  const existingTs = existing._last_modified_at.getTime();
  
  // Same origin within cooldown = echo, skip
  if (incoming.source === existing._last_modified_by && 
      Math.abs(incomingTs - existingTs) < SYNC_COOLDOWN_MS) {
    return 'SKIP';
  }
  
  // Incoming is newer = apply
  if (incomingTs > existingTs) {
    return 'APPLY';
  }
  
  // Existing is newer but different origin = potential conflict
  if (incomingTs < existingTs && incoming.source !== existing._last_modified_by) {
    return 'CONFLICT'; // Log for manual review
  }
  
  return 'SKIP';
}
```

### Conflict Logging Table

```sql
CREATE TABLE sync_conflicts (
  id INT AUTO_INCREMENT PRIMARY KEY,
  sheet_id VARCHAR(255) NOT NULL,
  row_number INT NOT NULL,
  column_name VARCHAR(64),
  sheet_value TEXT,
  db_value TEXT,
  sheet_timestamp TIMESTAMP,
  db_timestamp TIMESTAMP,
  resolution ENUM('SHEET_WINS', 'DB_WINS', 'MANUAL', 'PENDING') DEFAULT 'PENDING',
  resolved_at TIMESTAMP NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

---

## 5. Rate Limiting Strategy

### Google Sheets API Quotas

| Quota Type | Limit | Our Budget |
|------------|-------|------------|
| Read requests | 300/min per user | 250/min max |
| Write requests | 60/min per user | 55/min max |
| Per-project | 500/100sec | Stay well under |

### BullMQ Rate Limiter Configuration

```typescript
const dbToSheetQueue = new Queue('db-to-sheet', {
  connection: redisConnection,
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 5000, // 5s, 10s, 20s
    },
    removeOnComplete: 100,
    removeOnFail: 500,
  },
});

const worker = new Worker('db-to-sheet', processor, {
  connection: redisConnection,
  limiter: {
    max: 55,        // 55 jobs
    duration: 60000, // per minute
  },
  concurrency: 1,   // Serial processing to maintain order
});
```

### Batch Optimization

Instead of 50 individual cell updates (50 API calls), we batch:

```typescript
// Before: 50 API calls
updates.forEach(u => sheets.values.update(...));

// After: 1 API call with batchUpdate
sheets.spreadsheets.values.batchUpdate({
  spreadsheetId: sheetId,
  resource: {
    valueInputOption: 'USER_ENTERED',
    data: updates.map(u => ({
      range: `${sheetName}!${columnToLetter(u.col)}${u.row}`,
      values: [[u.value]],
    })),
  },
});
```

---

## 6. Type Casting & Validation

### Mapping Rules

| Sheet Value | Detected Type | MySQL Type | Coercion Logic |
|-------------|---------------|------------|----------------|
| "123" | NUMBER | DECIMAL(20,6) | parseFloat, default 0 |
| "2024-01-15" | DATE | DATETIME | new Date(), default NULL |
| "TRUE"/"FALSE" | BOOLEAN | TINYINT(1) | 1/0, default 0 |
| "hello" | TEXT | TEXT | trim, default '' |
| "" (empty) | NULL | NULL | NULL |
| "=SUM(A:A)" | FORMULA | TEXT | Store formula as text |

### Safe Coercion Implementation

```typescript
function coerceValue(value: unknown, targetType: ColumnType): unknown {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  try {
    switch (targetType) {
      case 'NUMBER':
        const num = parseFloat(String(value).replace(/[^0-9.-]/g, ''));
        return isNaN(num) ? 0 : num;
      
      case 'DATE':
        const date = new Date(value as string);
        return isNaN(date.getTime()) ? null : date;
      
      case 'BOOLEAN':
        const lower = String(value).toLowerCase();
        return ['true', '1', 'yes'].includes(lower) ? 1 : 0;
      
      case 'TEXT':
      default:
        return String(value).trim();
    }
  } catch (error) {
    logger.warn(`Type coercion failed for value: ${value}, type: ${targetType}`);
    return null;
  }
}
```

---

## 7. Error Handling & Recovery

### Retry Strategy with Exponential Backoff

```
Attempt 1: Immediate
Attempt 2: Wait 5 seconds
Attempt 3: Wait 10 seconds
Attempt 4: Wait 20 seconds
Final: Move to Dead Letter Queue (DLQ)
```

### Dead Letter Queue Processing

Failed jobs after max retries are moved to DLQ for:
1. Manual inspection
2. Alerting (webhook to Slack/email)
3. Bulk retry after issue resolution

### Health Monitoring

```typescript
interface HealthStatus {
  mysql: 'healthy' | 'degraded' | 'down';
  redis: 'healthy' | 'degraded' | 'down';
  sheetsApi: 'healthy' | 'rate_limited' | 'down';
  queues: {
    sheetToDb: { waiting: number; active: number; failed: number };
    dbToSheet: { waiting: number; active: number; failed: number };
  };
  lastSyncAt: Date | null;
}
```

---

## 8. Security Considerations

### API Authentication
- Webhook endpoint protected by HMAC signature verification
- Google OAuth2 for Sheets API access
- Service account for server-to-server communication

### Data Validation
- All incoming data sanitized before SQL execution
- Parameterized queries only (no string interpolation)
- Column names validated against whitelist

### Secrets Management
```
.env (never committed)
├── MYSQL_HOST
├── MYSQL_USER
├── MYSQL_PASSWORD
├── MYSQL_DATABASE
├── REDIS_URL
├── GOOGLE_CLIENT_ID
├── GOOGLE_CLIENT_SECRET
├── GOOGLE_REFRESH_TOKEN
├── WEBHOOK_SECRET (for HMAC verification)
└── NODE_ENV
```

---

## 9. Project Structure

```
sheets-mysql-sync/
├── backend/
│   ├── src/
│   │   ├── index.ts                 # Express app entry
│   │   ├── config/
│   │   │   ├── database.ts          # MySQL pool config
│   │   │   ├── redis.ts             # Redis/BullMQ config
│   │   │   └── google.ts            # Google API config
│   │   ├── api/
│   │   │   ├── routes/
│   │   │   │   ├── webhook.ts       # POST /api/webhook
│   │   │   │   ├── sync.ts          # Sync status endpoints
│   │   │   │   └── health.ts        # Health check
│   │   │   └── middleware/
│   │   │       ├── auth.ts          # HMAC verification
│   │   │       └── errorHandler.ts  # Global error handler
│   │   ├── services/
│   │   │   ├── SchemaManager.ts     # Dynamic schema handling
│   │   │   ├── SyncEngine.ts        # Core sync logic
│   │   │   ├── ConflictResolver.ts  # LWW implementation
│   │   │   └── GoogleSheetsService.ts
│   │   ├── queues/
│   │   │   ├── sheetToDbQueue.ts    # Sheet→DB queue
│   │   │   ├── dbToSheetQueue.ts    # DB→Sheet queue
│   │   │   └── workers/
│   │   │       ├── sheetToDbWorker.ts
│   │   │       └── dbToSheetWorker.ts
│   │   ├── polling/
│   │   │   └── DbChangeWatcher.ts   # MySQL polling service
│   │   ├── utils/
│   │   │   ├── hash.ts              # SHA256 utilities
│   │   │   ├── typeCoercion.ts      # Type casting
│   │   │   └── columnUtils.ts       # Column name sanitization
│   │   └── types/
│   │       └── index.ts             # TypeScript interfaces
│   ├── package.json
│   └── tsconfig.json
├── frontend/
│   ├── src/
│   │   ├── app/
│   │   │   ├── page.tsx             # Dashboard home
│   │   │   ├── layout.tsx
│   │   │   └── api/                  # Next.js API routes (proxy)
│   │   └── components/
│   │       ├── SyncStatus.tsx
│   │       ├── QueueMonitor.tsx
│   │       └── ErrorLog.tsx
│   ├── package.json
│   └── next.config.js
├── shared/
│   └── types.ts                     # Shared TypeScript types
├── ARCHITECTURE.md                  # This file
├── docker-compose.yml               # MySQL + Redis for dev
├── .env.example
└── README.md
```

---

## 10. MVP Milestones

| Phase | Deliverable | Success Criteria |
|-------|-------------|------------------|
| 1 | Architecture Doc | Approved by stakeholder |
| 2 | Backend skeleton | Express + MySQL + Redis connected |
| 3 | Sheet→DB sync | Webhook receives data, writes to MySQL |
| 4 | DB→Sheet sync | Polling detects changes, updates Sheets |
| 5 | Loop prevention | No infinite loops in 10-minute stress test |
| 6 | Dashboard | View sync status in browser |
| 7 | Edge cases | Type casting, rate limiting verified |

---

## Appendix: MySQL Trigger for Change Detection

```sql
-- Alternative to polling: MySQL triggers for CDC
DELIMITER //

CREATE TRIGGER after_sheet_data_update
AFTER UPDATE ON sheet_abc123_sales
FOR EACH ROW
BEGIN
  -- Only log if NOT a sync-originated change
  IF NEW._last_modified_by != 'SHEET' THEN
    INSERT INTO sync_change_log (
      table_name,
      row_id,
      operation,
      changed_columns,
      old_values,
      new_values,
      changed_at
    ) VALUES (
      'sheet_abc123_sales',
      NEW._sync_row_id,
      'UPDATE',
      JSON_OBJECT(), -- Populated by application logic
      JSON_OBJECT(), -- OLD values
      JSON_OBJECT(), -- NEW values
      NOW()
    );
  END IF;
END//

DELIMITER ;
```

---

**Document Version:** 1.0  
**Last Updated:** 2026-01-29  
**Status:** DRAFT - Pending Approval
