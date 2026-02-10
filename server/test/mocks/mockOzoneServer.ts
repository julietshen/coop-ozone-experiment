/**
 * Mock Ozone XRPC server for integration testing.
 *
 * Implements the Ozone moderation API endpoints that Coop interacts with:
 * - GET  /xrpc/tools.ozone.moderation.queryEvents  — returns canned events
 * - POST /xrpc/tools.ozone.moderation.emitEvent     — accepts & logs events
 * - GET  /xrpc/tools.ozone.moderation.queryStatuses — returns subject statuses
 * - GET  /xrpc/_health                              — health check
 *
 * Usage:
 *   npx tsx server/test/mocks/mockOzoneServer.ts [port]
 */
import express from 'express';
import http from 'http';

// ---------------------------------------------------------------------------
// In-memory state
// ---------------------------------------------------------------------------

export type ReceivedEvent = {
  id: number;
  event: Record<string, unknown>;
  subject: Record<string, unknown>;
  createdBy: string;
  createdAt: string;
  receivedAt: string;
};

/** Events seeded for queryEvents responses (inbound polling test data). */
const seededEvents: Array<{
  id: number;
  event: Record<string, unknown>;
  subject: Record<string, unknown>;
  subjectBlobCids: string[];
  createdBy: string;
  createdAt: string;
}> = [];

/** Events received via emitEvent (outbound action test data). */
const receivedEvents: ReceivedEvent[] = [];

let nextEventId = 1;

// ---------------------------------------------------------------------------
// Seed helpers
// ---------------------------------------------------------------------------

function seedReportEvent(overrides: Partial<(typeof seededEvents)[number]> = {}) {
  const event = {
    id: nextEventId++,
    event: {
      $type: 'tools.ozone.moderation.defs#modEventReport',
      comment: 'This content violates community guidelines',
      reportType: 'com.atproto.moderation.defs#reasonSpam',
    },
    subject: {
      $type: 'com.atproto.repo.strongRef',
      uri: 'at://did:plc:testuser123/app.bsky.feed.post/abc123',
      cid: 'bafyreig6test',
    },
    subjectBlobCids: [],
    createdBy: 'did:plc:reporter001',
    createdAt: new Date().toISOString(),
    ...overrides,
  };
  seededEvents.push(event);
  return event;
}

function seedLabelEvent(overrides: Partial<(typeof seededEvents)[number]> = {}) {
  const event = {
    id: nextEventId++,
    event: {
      $type: 'tools.ozone.moderation.defs#modEventLabel',
      createLabelVals: ['spam', 'harassment'],
      negateLabelVals: [],
      comment: 'Labeled by automated system',
    },
    subject: {
      $type: 'com.atproto.admin.defs#repoRef',
      did: 'did:plc:spammer456',
    },
    subjectBlobCids: [],
    createdBy: 'did:plc:moderator001',
    createdAt: new Date().toISOString(),
    ...overrides,
  };
  seededEvents.push(event);
  return event;
}

function seedEscalateEvent(overrides: Partial<(typeof seededEvents)[number]> = {}) {
  const event = {
    id: nextEventId++,
    event: {
      $type: 'tools.ozone.moderation.defs#modEventEscalate',
      comment: 'Requires senior moderator review',
    },
    subject: {
      $type: 'com.atproto.repo.strongRef',
      uri: 'at://did:plc:escalateduser/app.bsky.feed.post/xyz789',
      cid: 'bafyreiesctest',
    },
    subjectBlobCids: [],
    createdBy: 'did:plc:juniormod',
    createdAt: new Date().toISOString(),
    ...overrides,
  };
  seededEvents.push(event);
  return event;
}

// Seed some default events
seedReportEvent();
seedLabelEvent();
seedEscalateEvent();

// ---------------------------------------------------------------------------
// Express app
// ---------------------------------------------------------------------------

function createMockOzoneApp() {
  const app = express();
  app.use(express.json());

  // Health check
  app.get('/xrpc/_health', (_req, res) => {
    res.json({ version: 'mock-ozone-0.1.0' });
  });

  // Query moderation events (inbound polling)
  app.get('/xrpc/tools.ozone.moderation.queryEvents', (req, res) => {
    const cursor = req.query.cursor ? Number(req.query.cursor) : 0;
    const limit = req.query.limit ? Number(req.query.limit) : 50;

    // Filter events after cursor
    const filtered = seededEvents.filter((e) => e.id > cursor);
    const page = filtered.slice(0, limit);

    const newCursor =
      page.length > 0 ? String(page[page.length - 1].id) : undefined;

    console.log(
      `[MockOzone] queryEvents cursor=${cursor} → returning ${page.length} events (newCursor=${newCursor})`,
    );

    res.json({
      cursor: newCursor,
      events: page,
    });
  });

  // Emit moderation event (outbound action)
  app.post('/xrpc/tools.ozone.moderation.emitEvent', (req, res) => {
    const body = req.body;
    const id = nextEventId++;

    const received: ReceivedEvent = {
      id,
      event: body.event,
      subject: body.subject,
      createdBy: body.createdBy,
      createdAt: new Date().toISOString(),
      receivedAt: new Date().toISOString(),
    };

    receivedEvents.push(received);

    console.log(
      `[MockOzone] emitEvent received: id=${id} type=${body.event?.$type} subject=${JSON.stringify(body.subject)}`,
    );

    res.json({
      id,
      event: body.event,
      subject: body.subject,
      createdBy: body.createdBy,
      createdAt: received.createdAt,
    });
  });

  // Query subject statuses
  app.get('/xrpc/tools.ozone.moderation.queryStatuses', (req, res) => {
    console.log(
      `[MockOzone] queryStatuses subject=${req.query.subject ?? '(all)'}`,
    );

    res.json({
      cursor: undefined,
      subjectStatuses: [],
    });
  });

  // ---------------------------------------------------------------------------
  // Debug / test inspection endpoints
  // ---------------------------------------------------------------------------

  // Get all received (outbound) events
  app.get('/test/received-events', (_req, res) => {
    res.json(receivedEvents);
  });

  // Get all seeded (inbound) events
  app.get('/test/seeded-events', (_req, res) => {
    res.json(seededEvents);
  });

  // Seed a new event for inbound testing
  app.post('/test/seed-event', (req, res) => {
    const body = req.body;
    const eventType = body.type ?? 'report';

    let event;
    switch (eventType) {
      case 'report':
        event = seedReportEvent(body.overrides ?? {});
        break;
      case 'label':
        event = seedLabelEvent(body.overrides ?? {});
        break;
      case 'escalate':
        event = seedEscalateEvent(body.overrides ?? {});
        break;
      default:
        res.status(400).json({ error: `Unknown event type: ${eventType}` });
        return;
    }

    console.log(`[MockOzone] Seeded ${eventType} event id=${event.id}`);
    res.json(event);
  });

  // Clear all state
  app.post('/test/reset', (_req, res) => {
    seededEvents.length = 0;
    receivedEvents.length = 0;
    nextEventId = 1;
    console.log('[MockOzone] State reset');
    res.json({ ok: true });
  });

  return app;
}

// ---------------------------------------------------------------------------
// Start server when run directly
// ---------------------------------------------------------------------------

const port = Number(process.argv[2]) || 3210;
const app = createMockOzoneApp();
const server = http.createServer(app);

server.listen(port, () => {
  console.log(`[MockOzone] Mock Ozone XRPC server listening on http://localhost:${port}`);
  console.log(`[MockOzone] Seeded ${seededEvents.length} events for inbound polling`);
  console.log(`[MockOzone] Available endpoints:`);
  console.log(`  GET  /xrpc/_health`);
  console.log(`  GET  /xrpc/tools.ozone.moderation.queryEvents`);
  console.log(`  POST /xrpc/tools.ozone.moderation.emitEvent`);
  console.log(`  GET  /xrpc/tools.ozone.moderation.queryStatuses`);
  console.log(`  GET  /test/received-events`);
  console.log(`  GET  /test/seeded-events`);
  console.log(`  POST /test/seed-event`);
  console.log(`  POST /test/reset`);
});

export { createMockOzoneApp };
