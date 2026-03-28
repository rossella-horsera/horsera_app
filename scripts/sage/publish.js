/**
 * scripts/sage/publish.js
 *
 * Sage publishing orchestrator.
 *
 * Workflow:
 *   1. Draft content (passed in or generated)
 *   2. Create a Trello card on the Social board with the draft
 *   3. Move the card to "To Review"
 *   4. Ping #horsera-social in Slack with the draft + Trello link
 *   5. Wait for approval (poll Trello comments or Slack thread)
 *
 * Usage:
 *   node scripts/sage/publish.js                         # interactive
 *   node scripts/sage/publish.js --draft "Post text..."  # with inline draft
 *   node scripts/sage/publish.js --draft-file draft.md   # from file
 *
 * Can also be imported and called programmatically.
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
  createCardInList,
  moveCardToList,
  addComment,
  setDueDate,
  getCard,
  getComments,
  findList,
  getLists,
} from "./trello.js";
import {
  postMessage,
  postDraftForReview,
} from "./slack.js";
import { publishTextPost, publishLinkPost, checkToken } from "./linkedin.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── Config ──────────────────────────────────────────────────────────────────

// The social board may be a separate board or the main one.
// Override with TRELLO_SOCIAL_BOARD_ID in .env.local; falls back to default.
function loadEnv() {
  const envPath = path.resolve(__dirname, "../../.env.local");
  const lines = fs.readFileSync(envPath, "utf-8").split("\n");
  const env = {};
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;
    env[trimmed.slice(0, eqIdx).trim()] = trimmed.slice(eqIdx + 1).trim();
  }
  return env;
}

const ENV = loadEnv();
const SOCIAL_BOARD_ID = ENV.TRELLO_SOCIAL_BOARD_ID || ENV.TRELLO_BOARD_ID;

// ── Core workflow steps ─────────────────────────────────────────────────────

/**
 * Step 1: Create a Trello card with the draft.
 *
 * @param {string} title   — card title
 * @param {string} draft   — full draft text (goes into card description)
 * @param {object} options — { listName, due, boardId }
 * @returns {object} Trello card object
 */
export async function createDraftCard(title, draft, options = {}) {
  const {
    listName = "In Progress",
    due = new Date().toISOString(),
    boardId = SOCIAL_BOARD_ID,
  } = options;

  const card = await createCardInList(listName, {
    name: title,
    desc: draft,
    due,
    boardId,
  });

  console.log(`✅ Card created: ${card.shortUrl}`);
  return card;
}

/**
 * Step 2: Move the card to a review list.
 */
export async function moveToReview(cardId, listName = "To Review") {
  const card = await moveCardToList(cardId, listName, SOCIAL_BOARD_ID);
  console.log(`✅ Card moved to "${listName}"`);
  return card;
}

/**
 * Step 3: Post the draft to Slack for review.
 */
export async function notifySlack(draft, trelloUrl, platform = "LinkedIn") {
  await postDraftForReview(draft, trelloUrl, platform);
  console.log("✅ Slack notification sent to #horsera-social");
}

/**
 * Step 4: Poll Trello comments for approval.
 * Looks for a comment containing "approved" or "rejected".
 * Returns { approved: boolean, comment: string } or null if still waiting.
 */
export async function checkApproval(cardId) {
  const comments = await getComments(cardId);
  for (const action of comments) {
    const text = action.data?.text?.toLowerCase() || "";
    if (text.includes("approved") || text.includes("approve")) {
      return { approved: true, comment: action.data.text };
    }
    if (
      text.includes("rejected") ||
      text.includes("reject") ||
      text.includes("changes needed")
    ) {
      return { approved: false, comment: action.data.text };
    }
  }
  return null; // still waiting
}

/**
 * Poll for approval with a timeout.
 * @param {string} cardId
 * @param {number} intervalMs  — poll interval (default 30s)
 * @param {number} timeoutMs   — give up after (default 30min)
 */
export async function waitForApproval(cardId, intervalMs = 30_000, timeoutMs = 1_800_000) {
  const start = Date.now();
  console.log("⏳ Waiting for approval on Trello card...");

  while (Date.now() - start < timeoutMs) {
    const result = await checkApproval(cardId);
    if (result) return result;
    await new Promise((r) => setTimeout(r, intervalMs));
  }

  console.log("⏰ Timed out waiting for approval");
  return null;
}

// ── Full orchestration ──────────────────────────────────────────────────────

/**
 * Run the complete Sage publish workflow end to end.
 *
 * @param {object} options
 * @param {string} options.title     — card / post title
 * @param {string} options.draft     — the content draft
 * @param {string} options.platform  — "LinkedIn", "Instagram", etc.
 * @param {string} options.dueDate   — ISO date string (defaults to today)
 * @param {string} options.linkUrl   — optional URL to share as a link post
 * @param {boolean} options.waitForApproval — whether to poll for approval (default true)
 */
export async function runPublishWorkflow({
  title,
  draft,
  platform = "LinkedIn",
  dueDate,
  linkUrl,
  waitForApproval: shouldWait = true,
} = {}) {
  if (!title || !draft) {
    throw new Error("title and draft are required");
  }

  console.log(`\n🐴 Sage — Starting ${platform} publish workflow\n`);

  // 1. Create card in "In Progress"
  const card = await createDraftCard(title, draft, {
    listName: "In Progress",
    due: dueDate || new Date().toISOString(),
  });

  // 2. Move to "To Review"
  await moveToReview(card.id, "To Review");

  // 3. Notify Slack
  await notifySlack(draft, card.shortUrl, platform);

  // 4. Wait for approval if requested
  if (shouldWait) {
    const result = await waitForApproval(card.id);
    if (result?.approved) {
      console.log("🎉 Draft approved! Comment:", result.comment);
      await addComment(card.id, "✅ Approved — proceeding to publish.");

      // 5. Publish to LinkedIn
      try {
        const publishResult = linkUrl
          ? await publishLinkPost(draft, linkUrl, { asOrg: false })
          : await publishTextPost(draft, { asOrg: false });
        await addComment(card.id, "✅ Published to LinkedIn.");
        await moveToReview(card.id, "Done");
        return { card, approval: result, published: true };
      } catch (err) {
        console.error("❌ LinkedIn publish failed:", err.message);
        await addComment(card.id, `❌ LinkedIn publish failed: ${err.message}`);
        return { card, approval: result, published: false, error: err.message };
      }
    } else if (result && !result.approved) {
      console.log("❌ Draft rejected. Comment:", result.comment);
      await addComment(card.id, "🔄 Changes requested — see comment above.");
    } else {
      console.log("⏰ No response received within timeout.");
    }
    return { card, approval: result, published: false };
  }

  console.log("\n✅ Workflow complete — awaiting manual approval.\n");
  return { card, approval: null, published: false };
}

// ── CLI entrypoint ──────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);

  let draft = null;
  let title = "Sage LinkedIn Draft";

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--draft" && args[i + 1]) {
      draft = args[++i];
    } else if (args[i] === "--draft-file" && args[i + 1]) {
      draft = fs.readFileSync(args[++i], "utf-8").trim();
    } else if (args[i] === "--title" && args[i + 1]) {
      title = args[++i];
    }
  }

  if (!draft) {
    console.log("Usage:");
    console.log('  node publish.js --draft "Your draft text here"');
    console.log("  node publish.js --draft-file ./draft.md");
    console.log("  node publish.js --title \"Post Title\" --draft \"Text...\"");
    process.exit(1);
  }

  await runPublishWorkflow({ title, draft, waitForApproval: true });
}

// Run CLI if executed directly
const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isMain) {
  main().catch((err) => {
    console.error("❌ Publish failed:", err.message);
    process.exit(1);
  });
}
