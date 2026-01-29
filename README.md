# Sheets-MySQL Sync

A production-grade bidirectional synchronization system between Google Sheets and MySQL.

## Features

- **Bidirectional Sync**: Changes in Google Sheets automatically sync to MySQL and vice versa
- **Dynamic Schema**: Handles any table structure - columns are dynamically mapped
- **Loop Prevention**: Multi-layer defense against infinite sync loops
- **Rate Limiting**: Respects Google Sheets API quotas (60 writes/min)
- **Conflict Resolution**: Last-Write-Wins with conflict logging for manual review
- **Job Queues**: BullMQ-powered queues for reliable, scalable processing
- **Type Coercion**: Graceful handling of type mismatches

## Architecture

See [ARCHITECTURE.md](./ARCHITECTURE.md) for detailed system design.

## Tech Stack

- **Backend**: Node.js + TypeScript + Express
- **Database**: MySQL 8.0
- **Queue**: Redis + BullMQ
- **Frontend**: Next.js (Dashboard)
- **APIs**: Google Sheets API v4

## Quick Start

### Prerequisites

- Node.js 18+
- Docker & Docker Compose
- Google Cloud Project with Sheets API enabled

### 1. Clone and Install

```bash
cd sheets-mysql-sync
cd backend && npm install
```

### 2. Start Infrastructure

```bash
# From project root
docker-compose up -d

# Verify containers are running
docker-compose ps
```

This starts:
- MySQL 8.0 on port 3306
- Redis 7 on port 6379
- Redis Commander (UI) on port 8081

### 3. Configure Environment

```bash
# Copy example env file
cp .env.example .env

# Edit .env with your Google API credentials
```

### 4. Run the Backend

```bash
cd backend
npm run dev
```

### 5. Verify Installation

```bash
# Health check
curl http://localhost:3000/health

# Deep health check (MySQL + Redis)
curl http://localhost:3000/health/deep
```

## Project Structure

```
sheets-mysql-sync/
├── backend/
│   ├── src/
│   │   ├── index.ts              # Express app entry
│   │   ├── config/
│   │   │   ├── database.ts       # MySQL connection pool
│   │   │   └── redis.ts          # Redis/BullMQ connection
│   │   ├── api/                  # REST API routes
│   │   ├── services/             # Business logic
│   │   ├── queues/               # BullMQ queues & workers
│   │   ├── utils/                # Utilities
│   │   └── types/                # TypeScript definitions
│   ├── sql/init/                 # Database init scripts
│   └── package.json
├── frontend/                     # Next.js dashboard
├── shared/                       # Shared types
├── docker-compose.yml
├── ARCHITECTURE.md
└── README.md
```

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/health` | GET | Basic health check |
| `/health/deep` | GET | Deep health check (all services) |
| `/api/webhook` | POST | Receive Sheet change events |
| `/api/sync/status` | GET | Get sync status |
| `/api/sheets` | GET | List synced sheets |

## Configuration

Key environment variables:

| Variable | Description | Default |
|----------|-------------|---------|
| `MYSQL_HOST` | MySQL hostname | localhost |
| `REDIS_HOST` | Redis hostname | localhost |
| `SYNC_COOLDOWN_MS` | Loop prevention cooldown | 5000 |
| `SHEETS_RATE_LIMIT_PER_MIN` | Max Sheet API calls/min | 55 |

## Development

```bash
# Run with hot reload
npm run dev

# Type check
npm run typecheck

# Build for production
npm run build
npm start
```

## Docker Services

```bash
# Start all services
docker-compose up -d

# View logs
docker-compose logs -f mysql
docker-compose logs -f redis

# Stop all services
docker-compose down

# Reset data (careful!)
docker-compose down -v
```

## License

ISC
