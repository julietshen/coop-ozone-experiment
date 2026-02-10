/**
 * Seeds realistic AT Protocol / Bluesky post data into Coop via the
 * Ozone inbound flow. Creates a "Bluesky Post" content type with appropriate
 * fields, then enqueues MRT jobs with realistic post data.
 *
 * Run: cd server && node --loader ts-node/esm --require dotenv/config test/mocks/seedRealisticEvents.ts
 */
import { v1 as uuidv1 } from 'uuid';

import getBottle from '../../iocContainer/index.js';
import { toCorrelationId } from '../../utils/correlationIds.js';

const orgId = 'e7c89ce7729';

// Realistic Bluesky posts that a labeler/moderation service might flag
const MOCK_POSTS = [
  {
    subject: {
      $type: 'com.atproto.repo.strongRef' as const,
      uri: 'at://did:plc:7iza6de2dwap2sbkpav7c6c6/app.bsky.feed.post/3lkj8mvbs2c2x',
      cid: 'bafyreihvzbqfu76ed4l5yp3gwdex7ry4js6mg3tjmewqbicy6a7g3wikpe',
    },
    author: {
      did: 'did:plc:7iza6de2dwap2sbkpav7c6c6',
      handle: 'suspicious-account.bsky.social',
      displayName: 'Free Gift Cards 🎁',
    },
    text: '🚨 URGENT: Click this link to claim your FREE $500 Amazon gift card!! Limited time only!! Don\'t miss out!!! 👉 bit.ly/t0ta11y-n0t-a-scam\n\n#free #giveaway #amazon #giftcard',
    createdAt: '2026-02-09T18:30:00.000Z',
    labels: ['spam'],
    reportReason: 'Spam',
    eventType: 'tools.ozone.moderation.defs#modEventReport',
    reportType: 'com.atproto.moderation.defs#reasonSpam',
  },
  {
    subject: {
      $type: 'com.atproto.repo.strongRef' as const,
      uri: 'at://did:plc:qb3awk4qkb3wuarb5p3yg2xm/app.bsky.feed.post/3lkja92cx7s2k',
      cid: 'bafyreidwqaokfbudm44gxo2me5jntp3cvtoiveafwrxi5nmlhz3bnqsrwi',
    },
    author: {
      did: 'did:plc:qb3awk4qkb3wuarb5p3yg2xm',
      handle: 'edgelord2026.bsky.social',
      displayName: 'Anonymous',
    },
    text: 'I swear the next person who cuts me off in traffic is going to regret it. I have zero patience left. People need to learn respect or face consequences. Not joking.',
    createdAt: '2026-02-09T19:15:00.000Z',
    labels: ['threat'],
    reportReason: 'Mean',
    eventType: 'tools.ozone.moderation.defs#modEventReport',
    reportType: 'com.atproto.moderation.defs#reasonViolation',
  },
  {
    subject: {
      $type: 'com.atproto.repo.strongRef' as const,
      uri: 'at://did:plc:xrr5j2okn7ew2zvcwsxus3gb/app.bsky.feed.post/3lkjc5pr89k2e',
      cid: 'bafyreigdo5qhcejck3e5opy4im76kkpbvhfq2o37mvdbat7at2o47v2ori',
    },
    author: {
      did: 'did:plc:xrr5j2okn7ew2zvcwsxus3gb',
      handle: 'wellness-guru.bsky.social',
      displayName: 'Dr. Natural Health 🌿',
    },
    text: 'EXPOSED: Big Pharma doesn\'t want you to know that ivermectin cures cancer AND reverses aging. My cousin\'s friend took it and her tumors disappeared in 3 days. Share before they delete this! The medical establishment is LYING to you. #truth #health #bigpharma',
    createdAt: '2026-02-09T20:00:00.000Z',
    labels: ['misinformation', 'misleading'],
    reportReason: 'Spam',
    eventType: 'tools.ozone.moderation.defs#modEventLabel',
  },
  {
    subject: {
      $type: 'com.atproto.admin.defs#repoRef' as const,
      did: 'did:plc:m5fth4dznkzrc3va7woofrsa',
    },
    author: {
      did: 'did:plc:m5fth4dznkzrc3va7woofrsa',
      handle: 'hate-speech-account.bsky.social',
      displayName: '🔥',
    },
    text: '[Account-level report: Multiple posts containing targeted harassment and slurs directed at ethnic minorities. Pattern of behavior spanning 47 posts over 2 weeks.]',
    createdAt: '2026-02-09T20:30:00.000Z',
    labels: ['harassment', 'hate'],
    reportReason: 'Mean',
    eventType: 'tools.ozone.moderation.defs#modEventEscalate',
  },
  {
    subject: {
      $type: 'com.atproto.repo.strongRef' as const,
      uri: 'at://did:plc:nk2vwxcfp3hf9gk5x8hjqr9p/app.bsky.feed.post/3lkje2mzp4s2n',
      cid: 'bafyreifkqvifyh5kzp7ldntk7oaq7e4ahkgt7cz3nxrhx2yq5ew3ikfpkq',
    },
    author: {
      did: 'did:plc:nk2vwxcfp3hf9gk5x8hjqr9p',
      handle: 'crypto-moonshot.bsky.social',
      displayName: '💰 Crypto Insider 💰',
    },
    text: 'Just got insider info: $MOONCOIN is about to 1000x 🚀🚀🚀 Buy NOW before the announcement tomorrow. I put my life savings in. This is NOT financial advice but you\'d be stupid not to. DM me for the private Telegram group 📈\n\nContract: 0x742d35Cc6634C0532925a3b844Bc9e7595f2bD18',
    createdAt: '2026-02-09T21:00:00.000Z',
    labels: ['spam', 'misleading'],
    reportReason: 'Spam',
    eventType: 'tools.ozone.moderation.defs#modEventReport',
    reportType: 'com.atproto.moderation.defs#reasonSpam',
  },
  {
    subject: {
      $type: 'com.atproto.repo.strongRef' as const,
      uri: 'at://did:plc:t4gk2yqj5wvn8zm3r7dpqfhc/app.bsky.feed.post/3lkjf7rqs5t2a',
      cid: 'bafyreig7teklsn3whdaxnrpxqw2sfpkfnx2y5dprqjc7uqhv3oqbz5kza',
    },
    author: {
      did: 'did:plc:t4gk2yqj5wvn8zm3r7dpqfhc',
      handle: 'quick-cash-now.bsky.social',
      displayName: '💸 Money Machine 💸',
    },
    text: '🔥 LIMITED TIME OFFER 🔥 Send 0.1 BTC to my wallet and I\'ll send back 1.0 BTC! Elon Musk is backing this project!! Send bitcoin to bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh and watch your money multiply! Only 24 hours left!',
    createdAt: '2026-02-09T21:30:00.000Z',
    labels: ['spam', 'misleading'],
    reportReason: 'Spam',
    eventType: 'tools.ozone.moderation.defs#modEventReport',
    reportType: 'com.atproto.moderation.defs#reasonSpam',
  },
  {
    subject: {
      $type: 'com.atproto.repo.strongRef' as const,
      uri: 'at://did:plc:v8m3wxbfq6pz4nh5k2cz9djr/app.bsky.feed.post/3lkjg9atm6u2b',
      cid: 'bafyreidpxwz3k4t5q8jroh2nxlc7v6x3ewnbkta9hr2qjx5qfz7smpvdi',
    },
    author: {
      did: 'did:plc:v8m3wxbfq6pz4nh5k2cz9djr',
      handle: 'gov-grants-help.bsky.social',
      displayName: 'US Gov Grant Program',
    },
    text: 'ATTENTION: You have been selected to receive free money from the US Government!! 💵💵 $25,000 grant available to all citizens. No repayment needed! DM me your SSN and bank details to claim. Act NOW — limited time offer before funds run out! #grants #freemoney',
    createdAt: '2026-02-09T22:00:00.000Z',
    labels: ['spam', 'misleading'],
    reportReason: 'Spam',
    eventType: 'tools.ozone.moderation.defs#modEventReport',
    reportType: 'com.atproto.moderation.defs#reasonSpam',
  },
  {
    subject: {
      $type: 'com.atproto.repo.strongRef' as const,
      uri: 'at://did:plc:j3kl8nmp9qr2stuvw4xy5z6a/app.bsky.feed.post/3lkjh2bvn7w2c',
      cid: 'bafyreiaxqwerty3k4t5q8jroh2nxlc7v6x3ewnbkta9hr2qjx5qfz7abc',
    },
    author: {
      did: 'did:plc:j3kl8nmp9qr2stuvw4xy5z6a',
      handle: 'real-journalist.bsky.social',
      displayName: 'Independent Reporter',
    },
    text: 'Thread 🧵: I\'ve been investigating corruption at City Hall for 6 months. The mayor\'s office funneled $2.3M in contracts to his brother-in-law\'s firm. Documents attached. Reporting is not a crime. #accountability #journalism',
    createdAt: '2026-02-09T22:30:00.000Z',
    labels: [],
    reportReason: 'Spam',
    eventType: 'tools.ozone.moderation.defs#modEventReport',
    reportType: 'com.atproto.moderation.defs#reasonSpam',
  },
  {
    subject: {
      $type: 'com.atproto.repo.strongRef' as const,
      uri: 'at://did:plc:b7cd9efg0hi1jk2lm3no4pq5/app.bsky.feed.post/3lkji4cwp8x2d',
      cid: 'bafyreiqwerty5678abcdefghijklmnopqrstuvwxyz1234567890aabbcc',
    },
    author: {
      did: 'did:plc:b7cd9efg0hi1jk2lm3no4pq5',
      handle: 'forex-signals-vip.bsky.social',
      displayName: '📈 Forex King 📈',
    },
    text: 'I turned $100 into $50,000 in ONE WEEK using my trading bot 🤖 Send bitcoin (0.05 BTC) for lifetime access to my VIP signals group. This is literally free money — the bot does everything for you! DM for wallet address. First 50 people only!! 🚀',
    createdAt: '2026-02-09T23:00:00.000Z',
    labels: ['spam', 'misleading'],
    reportReason: 'Spam',
    eventType: 'tools.ozone.moderation.defs#modEventReport',
    reportType: 'com.atproto.moderation.defs#reasonSpam',
  },
  {
    subject: {
      $type: 'com.atproto.repo.strongRef' as const,
      uri: 'at://did:plc:r6st7uvw8xy9za0bc1de2fg3/app.bsky.feed.post/3lkjj5dxq9y2e',
      cid: 'bafyreimnopqrs456789abcdefghijklmnopqrstuvwxyz0123456789ddeeff',
    },
    author: {
      did: 'did:plc:r6st7uvw8xy9za0bc1de2fg3',
      handle: 'angry-gamer42.bsky.social',
      displayName: 'xX_DarkLord_Xx',
    },
    text: 'You\'re actually the worst player I\'ve ever seen. Uninstall the game and do everyone a favor. Nobody wants you here. Go crawl back to whatever hole you came from, trash.',
    createdAt: '2026-02-09T23:30:00.000Z',
    labels: ['harassment'],
    reportReason: 'Mean',
    eventType: 'tools.ozone.moderation.defs#modEventReport',
    reportType: 'com.atproto.moderation.defs#reasonOther',
  },
  {
    subject: {
      $type: 'com.atproto.repo.strongRef' as const,
      uri: 'at://did:plc:h4ij5klm6no7pq8rs9tu0vw1/app.bsky.feed.post/3lkjk6eyr0z2f',
      cid: 'bafyreistuvwx234567890abcdefghijklmnopqrstuvwxyz12345678eeffgg',
    },
    author: {
      did: 'did:plc:h4ij5klm6no7pq8rs9tu0vw1',
      handle: 'proud-parent.bsky.social',
      displayName: 'Sarah M.',
    },
    text: 'My daughter just got accepted to her dream school! 🎉 So proud of all her hard work. She\'s been studying non-stop for months. Can\'t wait to celebrate this weekend! #proudmom #college',
    createdAt: '2026-02-10T00:00:00.000Z',
    labels: [],
    reportReason: 'Spam',
    eventType: 'tools.ozone.moderation.defs#modEventReport',
    reportType: 'com.atproto.moderation.defs#reasonSpam',
  },
];

async function main() {
  const { container } = await getBottle();
  const ozoneService = container.OzoneService;
  const moderationConfigService = container.ModerationConfigService;
  const manualReviewToolService = container.ManualReviewToolService;

  // Step 1: Use the "Post" content type which has text, images, owner_id fields
  const itemTypes = await moderationConfigService.getItemTypes({
    orgId,
    directives: { maxAge: 10 },
  });
  const postType = itemTypes.find((it: any) => it.name === 'Post');
  if (!postType) {
    console.error('No "Post" content type found');
    process.exit(1);
  }
  console.log(`Using content type: ${postType.name} (${postType.id})`);

  // Step 2: Clear old MRT jobs for clean slate
  console.log('\nClearing old Ozone MRT jobs...');
  const pg = container.KyselyPg;
  await pg
    .deleteFrom('manual_review_tool.job_creations' as any)
    .where('org_id' as any, '=', orgId)
    .where('item_id' as any, 'like', 'did:plc:%')
    .execute();
  console.log('Cleared.');

  // Step 3: Enqueue realistic posts
  console.log('\n=== Seeding realistic AT Protocol posts ===\n');

  for (const post of MOCK_POSTS) {
    const subjectDid = post.author.did;
    const subjectUri = post.subject.$type === 'com.atproto.repo.strongRef'
      ? (post.subject as any).uri
      : undefined;

    const requestId = toCorrelationId({
      type: 'post-content' as const,
      id: uuidv1(),
    });

    // Build item data matching the Post content type fields
    const itemData = {
      // Post content type fields
      text: post.text,
      images: [],
      owner_id: post.author.did,
      handle: post.author.handle,
      display_name: post.author.displayName,
      num_likes: Math.floor(Math.random() * 200),
      num_comments: Math.floor(Math.random() * 50),
      num_user_reports: Math.floor(Math.random() * 10) + 1,
    };

    try {
      await manualReviewToolService.enqueue({
        orgId,
        payload: {
          kind: 'DEFAULT' as const,
          reportHistory: [
            {
              reason: post.reportReason,
              reporterId: undefined,
              reportId: `ozone-${uuidv1()}`,
              reportedAt: new Date(post.createdAt),
              policyId: undefined,
            },
          ],
          item: {
            itemId: subjectUri ?? subjectDid,
            itemTypeIdentifier: {
              id: postType.id,
              version: postType.version,
              schemaVariant: postType.schemaVariant,
            },
            data: itemData as any,
            submissionTime: new Date(post.createdAt),
            submissionId: `ozone-${uuidv1()}`,
            creator: post.author.did,
          } as any,
          reportedForReason: post.reportReason,
          reportedForReasons: [
            { reason: post.reportReason, reporterId: undefined },
          ],
        },
        createdAt: new Date(post.createdAt),
        enqueueSource: 'REPORT' as const,
        enqueueSourceInfo: { kind: 'REPORT' as const },
        correlationId: requestId,
        policyIds: [],
      });

      const eventName = post.eventType.split('#')[1];
      console.log(
        `  @${post.author.handle} [${eventName}] — ${post.labels.join(', ')}`,
      );
      console.log(
        `    "${post.text.substring(0, 80)}${post.text.length > 80 ? '...' : ''}"`,
      );
      console.log(`    Reason: ${post.reportReason}`);
      console.log();
    } catch (e: any) {
      console.error(`  ERROR: ${e.message}`);
    }
  }

  console.log('=== Done! ===');
  console.log(`Seeded ${MOCK_POSTS.length} realistic Bluesky posts into MRT queue.`);
  console.log('Refresh the Coop MRT to see them.');

  process.exit(0);
}

main().catch((e) => {
  console.error('Fatal error:', e);
  process.exit(1);
});
