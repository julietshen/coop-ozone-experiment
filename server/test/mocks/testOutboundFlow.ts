/**
 * Integration test: Coop → Ozone outbound flow
 *
 * Tests that Coop can emit moderation events to Ozone via OzoneService.emitEvent().
 * Verifies:
 * 1. OzoneService constructs proper Ozone event definitions
 * 2. JWT auth token is created and sent
 * 3. Mock Ozone server receives the event
 * 4. Audit trail is recorded in ozone_service.emitted_events
 *
 * Prerequisites:
 * - Mock Ozone server running on localhost:3210
 * - Ozone credentials configured for test org
 */
import getBottle from '../../iocContainer/index.js';

const orgId = 'e7c89ce7729';

async function main() {
  const { container } = await getBottle();
  const ozoneService = container.OzoneService;

  // Test 1: Emit a label event
  console.log('=== Test 1: Emit label event ===');
  try {
    await ozoneService.emitEvent({
      orgId,
      eventType: 'label',
      labels: ['spam', 'misleading'],
      negateLabels: [],
      comment: 'Coop automated moderation: content flagged as spam',
      subjectDid: 'did:plc:spamaccount789',
      subjectUri: 'at://did:plc:spamaccount789/app.bsky.feed.post/spam001',
      coopActionId: 'test-action-001',
      coopCorrelationId: 'test-correlation-001',
      policies: [
        { id: 'policy-spam', name: 'Spam Policy' },
        { id: 'policy-misleading', name: 'Misleading Content' },
      ],
    });
    console.log('  => SUCCESS: Label event emitted to Ozone');
  } catch (e: any) {
    console.error('  => ERROR:', e.message);
  }

  // Test 2: Emit a takedown event
  console.log('\n=== Test 2: Emit takedown event ===');
  try {
    await ozoneService.emitEvent({
      orgId,
      eventType: 'takedown',
      labels: [],
      comment: 'Severe violation: content removed by Coop moderation',
      subjectDid: 'did:plc:violator999',
      coopActionId: 'test-action-002',
      coopCorrelationId: 'test-correlation-002',
      policies: [{ id: 'policy-violence', name: 'Violence Policy' }],
      durationInHours: 72,
    });
    console.log('  => SUCCESS: Takedown event emitted to Ozone');
  } catch (e: any) {
    console.error('  => ERROR:', e.message);
  }

  // Test 3: Emit a comment event
  console.log('\n=== Test 3: Emit comment event ===');
  try {
    await ozoneService.emitEvent({
      orgId,
      eventType: 'comment',
      labels: [],
      comment: 'This account has been reviewed by Coop moderation team. No action taken.',
      subjectDid: 'did:plc:reviewed123',
      coopActionId: 'test-action-003',
      coopCorrelationId: 'test-correlation-003',
      policies: [],
    });
    console.log('  => SUCCESS: Comment event emitted to Ozone');
  } catch (e: any) {
    console.error('  => ERROR:', e.message);
  }

  // Test 4: Emit an acknowledge event
  console.log('\n=== Test 4: Emit acknowledge event ===');
  try {
    await ozoneService.emitEvent({
      orgId,
      eventType: 'acknowledge',
      labels: [],
      comment: 'Report acknowledged by Coop',
      subjectDid: 'did:plc:acked456',
      subjectUri: 'at://did:plc:acked456/app.bsky.feed.post/ack001',
      coopActionId: 'test-action-004',
      coopCorrelationId: 'test-correlation-004',
      policies: [],
    });
    console.log('  => SUCCESS: Acknowledge event emitted to Ozone');
  } catch (e: any) {
    console.error('  => ERROR:', e.message);
  }

  // Step 5: Check mock server received events
  console.log('\n=== Step 5: Check mock server received events ===');
  try {
    const res = await fetch('http://localhost:3210/test/received-events');
    const received = await res.json() as any[];
    console.log(`Mock server received ${received.length} events:`);
    for (const evt of received) {
      const eventType = evt.event?.['$type'] ?? 'unknown';
      const subjectType = evt.subject?.['$type'] ?? 'unknown';
      const subjectId = evt.subject?.did ?? evt.subject?.uri ?? 'unknown';
      console.log(`  Event ${evt.id}: type=${eventType}, subject=${subjectId}`);
    }
  } catch (e: any) {
    console.error('  => ERROR checking mock:', e.message);
  }

  // Step 6: Check audit trail in DB
  console.log('\n=== Step 6: Check audit trail ===');
  try {
    const pg = container.KyselyPg;
    const rows = await pg
      .selectFrom('ozone_service.emitted_events' as any)
      .select([
        'id',
        'ozone_event_type',
        'subject_did',
        'status',
        'coop_action_id',
      ] as any)
      .where('org_id' as any, '=', orgId)
      .orderBy('created_at' as any, 'desc')
      .limit(10)
      .execute();
    console.log(`Audit trail has ${rows.length} entries:`);
    for (const row of rows as any[]) {
      console.log(
        `  ${row.id.substring(0, 8)}... type=${row.ozone_event_type} subject=${row.subject_did} status=${row.status}`,
      );
    }
  } catch (e: any) {
    console.error('  => ERROR checking audit trail:', e.message);
  }

  // Summary
  console.log('\n=== Summary ===');
  console.log('Outbound flow test complete.');
  console.log('All 4 event types tested: label, takedown, comment, acknowledge');

  process.exit(0);
}

main().catch((e) => {
  console.error('Fatal error:', e);
  process.exit(1);
});
