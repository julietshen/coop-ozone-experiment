# Ozone Integration

This document covers Coop's bidirectional integration with [Ozone](https://github.com/bluesky-social/ozone), Bluesky's open-source moderation service built on the AT Protocol.

## Overview

The Ozone integration enables two-way communication between Coop and a self-hosted Ozone moderation instance:

* **Inbound (Ozone → Coop):** Ozone moderation events (reports, labels, escalations) are polled and ingested into Coop's Manual Review Tool (MRT) queue.
* **Outbound (Coop → Ozone):** Coop rule actions and moderator decisions emit moderation events (labels, takedowns, comments, etc.) back to Ozone.

This allows teams to use Coop's rule engine and review workflows while staying synchronized with Ozone's moderation state.

## Configuration

### Environment Variables

| Variable | Default | Description |
| :--- | :--- | :--- |
| `OZONE_POLL_ENABLED` | `false` | Set to `true` to enable inbound event polling |
| `OZONE_POLL_INTERVAL_MS` | `30000` | Polling frequency in milliseconds |

### Credentials

Ozone credentials are configured per-organization via the `setIntegrationConfig` GraphQL mutation:

```graphql
mutation ConfigureOzone {
  setIntegrationConfig(input: {
    apiCredential: {
      ozone: {
        serviceUrl: "https://ozone.example.com"
        did: "did:plc:your_service_did"
        signingKey: "0xabc123..."
        handle: "coop-service"
      }
    }
  }) {
    ... on SetIntegrationConfigSuccessResponse {
      config {
        name
        apiCredential {
          ... on OzoneIntegrationApiCredential {
            serviceUrl
            did
            handle
          }
        }
      }
    }
  }
}
```

| Field | Required | Description |
| :--- | :--- | :--- |
| `serviceUrl` | Yes | Base URL of the Ozone instance |
| `did` | Yes | DID of the service account performing actions |
| `signingKey` | Yes | Hex-encoded secp256k1 private key (32 bytes) |
| `handle` | No | Human-readable handle for the account |

Credentials are stored in the `signal_auth_service.ozone_configs` table and managed through the `SignalAuthService`.

**Authentication:** The `OzoneApiClient` signs requests with JWT tokens using the ES256K algorithm. Tokens include the service DID as `iss`, the Ozone service DID as `aud`, and a 60-second expiry.

## Inbound Flow: Ozone → Coop

The `OzoneEventPollingJob` runs as a background job that continuously polls Ozone for new moderation events.

### How It Works

1. The polling job fetches all orgs with sync enabled (`ozone_service.event_sync_state`)
2. For each org, it calls `ozoneService.pollEvents(orgId)` using the stored cursor for pagination
3. Each event is classified and routed:

| Ozone Event Type | Action in Coop |
| :--- | :--- |
| **Report** | Enqueued to MRT with extracted labels and reason |
| **Label** | Labels mapped to Coop policies, enqueued to MRT |
| **Escalate** | Enqueued to MRT with priority |
| **Takedown** | Logged (informational) |
| **Comment** | Logged (informational) |

4. The sync cursor is updated after each successful poll
5. The job sleeps for `OZONE_POLL_INTERVAL_MS` before the next iteration

### Sync State

Per-org polling state is tracked in `ozone_service.event_sync_state`:

| Column | Description |
| :--- | :--- |
| `org_id` | Organization identifier |
| `last_synced_cursor` | Pagination cursor from last poll |
| `last_synced_at` | Timestamp of last successful sync |
| `sync_enabled` | Enable/disable polling for this org |

### Enabling Sync for an Org

```sql
INSERT INTO ozone_service.event_sync_state (org_id, sync_enabled)
VALUES ('your-org-id', true);
```

## Outbound Flow: Coop → Ozone

When a Coop rule fires or a moderator takes a decision, the `EMIT_OZONE_EVENT` action type sends a moderation event to Ozone.

### Action Configuration

The `EMIT_OZONE_EVENT` action supports these event types:

| Event Type | Ozone XRPC Type | Description |
| :--- | :--- | :--- |
| `label` | `modEventLabel` | Apply or negate labels on a subject |
| `takedown` | `modEventTakedown` | Take down content |
| `reverseTakedown` | `modEventReverseTakedown` | Reverse a takedown |
| `comment` | `modEventComment` | Add a moderator comment |
| `acknowledge` | `modEventAcknowledge` | Acknowledge a report |
| `escalate` | `modEventEscalate` | Escalate for further review |

### How It Works

1. The `ActionPublisher` handles `EMIT_OZONE_EVENT` actions
2. It extracts the subject DID and URI from the target item
3. Calls `ozoneService.emitEvent()` with the event type, labels, and comment
4. The service records the outbound event in `ozone_service.emitted_events` (status: `PENDING`)
5. Sends a JWT-signed request to Ozone's `tools.ozone.moderation.emitEvent` XRPC endpoint
6. Updates the audit record to `SUCCESS` or `RETRYABLE_ERROR`

### Audit Trail

All outbound events are recorded in `ozone_service.emitted_events`:

| Column | Description |
| :--- | :--- |
| `id` | UUID |
| `org_id` | Organization |
| `ozone_event_type` | Event type sent |
| `subject_did` | Target DID |
| `subject_uri` | Target content URI |
| `coop_action_id` | Triggering Coop action |
| `coop_correlation_id` | Correlation ID for tracing |
| `ozone_response` | JSON response from Ozone |
| `status` | `PENDING`, `SUCCESS`, or `RETRYABLE_ERROR` |
| `error` | Error message if failed |
| `retry_count` | Number of retry attempts |

## Label Mapping

Labels are mapped bidirectionally between Coop policy types and Ozone label values. Orgs can override the defaults.

### Default Mappings

| Coop Policy Type | Ozone Label | Direction |
| :--- | :--- | :--- |
| `HATE` | `hate` | Both |
| `VIOLENCE` | `violence` | Both |
| `VIOLENCE` | `gore` | Both |
| `SEXUAL_CONTENT` | `sexual` | Both |
| `SEXUAL_CONTENT` | `porn` | Both |
| `SEXUAL_CONTENT` | `nudity` | Both |
| `SPAM` | `spam` | Both |
| `HARASSMENT` | `harassment` | Both |
| `SELF_HARM_AND_SUICIDE` | `self-harm` | Both |
| `TERRORISM` | `terrorism` | Both |
| `SEXUAL_EXPLOITATION` | `csam` | Both |
| `SEXUAL_EXPLOITATION` | `!hide` | Outbound only |

Directions control when a mapping applies:
* **BOTH** — Used for both inbound (Ozone labels → Coop policies) and outbound (Coop policies → Ozone labels)
* **INBOUND** — Only used when converting Ozone labels to Coop policies
* **OUTBOUND** — Only used when converting Coop policies to Ozone labels

### Custom Mappings

Per-org label mappings are stored in `ozone_service.label_mappings` and can be managed via the `OzoneService` API:

```typescript
// Add a custom mapping
await ozoneService.setLabelMapping(orgId, {
  coopPolicyType: 'CUSTOM_POLICY',
  ozoneLabelValue: 'custom-label',
  direction: 'BOTH',
});

// Delete a mapping
await ozoneService.deleteLabelMapping(orgId, 'CUSTOM_POLICY', 'custom-label');

// Get all mappings for an org (falls back to defaults)
const mappings = await ozoneService.getLabelMappings(orgId);
```

## Setup Checklist

1. **Set environment variables** in your deployment:
   ```
   OZONE_POLL_ENABLED=true
   OZONE_POLL_INTERVAL_MS=30000
   ```

2. **Run the database migration** (`2026.02.09T00.00.00.ozone-service.sql`) to create the required tables

3. **Configure credentials** via the `setIntegrationConfig` GraphQL mutation (see [Credentials](#credentials) above)

4. **Enable sync** for the org in `ozone_service.event_sync_state`

5. **Configure label mappings** (optional — defaults are applied if none are set)

6. **Create `EMIT_OZONE_EVENT` actions** in your moderation rules to emit events outbound

7. **Test** using the mock Ozone server:
   ```bash
   npx tsx server/test/mocks/mockOzoneServer.ts 3210
   ```

## Key Files

| Path | Purpose |
| :--- | :--- |
| `server/services/ozoneService/ozoneService.ts` | Core service: emit events, poll, label mapping |
| `server/services/ozoneService/ozoneApiClient.ts` | XRPC HTTP client with JWT auth |
| `server/services/ozoneService/types.ts` | Type definitions for Ozone API |
| `server/services/ozoneService/labelMapping.ts` | Policy-to-label mapping logic and defaults |
| `server/workers_jobs/OzoneEventPollingJob.ts` | Inbound polling job |
| `server/rule_engine/ActionPublisher.ts` | `EMIT_OZONE_EVENT` action handling |
| `server/services/signalAuthService/signalAuthService.ts` | Credential CRUD |
| `server/graphql/modules/integration.ts` | GraphQL schema for Ozone credentials |
| `server/test/mocks/mockOzoneServer.ts` | Mock Ozone server for testing |
| `.devops/migrator/src/scripts/api-server-pg/2026.02.09T00.00.00.ozone-service.sql` | DB migration and seed data |
