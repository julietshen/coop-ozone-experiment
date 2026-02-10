/**
 * Integration test: Ozone → Coop inbound flow
 *
 * Tests that events polled from Ozone are properly:
 * 1. Fetched via OzoneService.pollEvents()
 * 2. Classified into categories (REPORT, LABEL, ESCALATE, etc.)
 * 3. Enqueued to the Manual Review Tool
 *
 * Prerequisites:
 * - Mock Ozone server running on localhost:3210
 * - Ozone credentials configured for test org
 * - Sync state enabled for test org
 */
import { v1 as uuidv1 } from 'uuid';

import getBottle from '../../iocContainer/index.js';
import { toCorrelationId } from '../../utils/correlationIds.js';

const orgId = 'e7c89ce7729';

async function main() {
  const { container } = await getBottle();
  const ozoneService = container.OzoneService;
  const moderationConfigService = container.ModerationConfigService;
  const manualReviewToolService = container.ManualReviewToolService;

  // Step 1: Poll events from mock Ozone
  console.log('=== Step 1: Poll events ===');
  const { events, newCursor } = await ozoneService.pollEvents(orgId);
  console.log(`Polled ${events.length} events, cursor: ${newCursor}`);

  if (events.length === 0) {
    console.log('No events to process. Seed events and reset cursor first.');
    process.exit(0);
  }

  // Step 2: Classify each event
  console.log('\n=== Step 2: Classify events ===');
  for (const event of events) {
    const classified = ozoneService.classifyEvent(event);
    console.log(`Event ${event.id}:`, {
      type: event.event['$type'],
      category: classified.category,
      labels: classified.labels,
      subjectDid: classified.subjectDid,
      subjectUri: classified.subjectUri,
    });
  }

  // Step 3: Get content type for MRT enqueue
  console.log('\n=== Step 3: Get content types ===');
  const itemTypes = await moderationConfigService.getItemTypes({
    orgId,
    directives: { maxAge: 10 },
  });
  const contentType = itemTypes.find(
    (it: any) =>
      it.name === 'atproto_content' || it.name === 'bluesky_post',
  ) ?? itemTypes.find((it: any) => it.kind === 'CONTENT');

  if (!contentType) {
    console.error('No content type found for org');
    process.exit(1);
  }
  console.log(`Using content type: ${contentType.name} (${contentType.id})`);

  // Step 4: Process events — enqueue to MRT
  console.log('\n=== Step 4: Enqueue events to MRT ===');
  let successCount = 0;
  let errorCount = 0;

  for (const event of events) {
    const classified = ozoneService.classifyEvent(event);
    if (!classified.category || !classified.subjectDid) {
      console.log(`Skipping event ${event.id} (no category or subject)`);
      continue;
    }

    // Only process REPORT, LABEL, ESCALATE events
    if (!['REPORT', 'LABEL', 'ESCALATE'].includes(classified.category)) {
      console.log(`Skipping event ${event.id} (${classified.category} — informational only)`);
      continue;
    }

    console.log(`Processing event ${event.id} (${classified.category})...`);

    try {
      const requestId = toCorrelationId({
        type: 'post-content' as const,
        id: uuidv1(),
      });

      await manualReviewToolService.enqueue({
        orgId,
        payload: {
          kind: 'DEFAULT' as const,
          reportHistory: [
            {
              reason:
                classified.comment ??
                `Ozone ${classified.category.toLowerCase()}: ${classified.labels.join(', ')}`,
              reporterId: undefined,
              reportId: `ozone-${event.id}`,
              reportedAt: new Date(event.createdAt),
              policyId: undefined,
            },
          ],
          item: {
            itemId: classified.subjectDid,
            itemTypeIdentifier: {
              id: contentType.id,
              version: contentType.version,
              schemaVariant: contentType.schemaVariant,
            },
            data: {
              did: classified.subjectDid,
              ...(classified.subjectUri ? { uri: classified.subjectUri } : {}),
              ozoneEventType: event.event['$type'],
              ozoneLabels: classified.labels,
              ozoneComment: classified.comment ?? null,
            } as any,
            submissionTime: new Date(),
            submissionId: `ozone-${uuidv1()}`,
            creator: undefined,
          } as any,
          reportedForReason: classified.comment ?? null,
          reportedForReasons: classified.comment
            ? [{ reason: classified.comment, reporterId: undefined }]
            : [],
        },
        createdAt: new Date(event.createdAt),
        enqueueSource: 'REPORT' as const,
        enqueueSourceInfo: { kind: 'REPORT' as const },
        correlationId: requestId,
        policyIds: [],
      });

      console.log(`  => SUCCESS: Event ${event.id} enqueued to MRT`);
      successCount++;
    } catch (e: any) {
      console.error(`  => ERROR: Event ${event.id}: ${e.message}`);
      errorCount++;
    }
  }

  // Step 5: Verify sync state updated
  console.log('\n=== Step 5: Verify sync state ===');
  const syncState = await ozoneService.getSyncState(orgId);
  console.log('Sync state:', syncState);

  // Summary
  console.log('\n=== Summary ===');
  console.log(`Events polled: ${events.length}`);
  console.log(`Successfully enqueued: ${successCount}`);
  console.log(`Errors: ${errorCount}`);
  console.log(`Cursor updated to: ${syncState?.lastSyncedCursor}`);

  process.exit(0);
}

main().catch((e) => {
  console.error('Fatal error:', e);
  process.exit(1);
});
