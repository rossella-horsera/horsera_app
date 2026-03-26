/**
 * scripts/sage/slack.js
 *
 * Slack integration for Sage — posts to #horsera-social via webhook.
 * Also supports reading messages via Slack Web API if a bot token is
 * available (SLACK_BOT_TOKEN in .env.local), but the webhook is sufficient
 * for posting.
 *
 * Reads SLACK_WEBHOOK_URL from .env.local.
 */

import fetch from "node-fetch";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

// ── Load credentials ────────────────────────────────────────────────────────

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");

function loadEnv() {
  const envPath = path.join(ROOT, ".env.local");
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
const WEBHOOK_URL = ENV.SLACK_WEBHOOK_URL;
const BOT_TOKEN = ENV.SLACK_BOT_TOKEN || null; // optional, for reading messages

if (!WEBHOOK_URL) {
  throw new Error("Missing SLACK_WEBHOOK_URL in .env.local");
}

// ── Webhook posting (no bot token required) ─────────────────────────────────

/**
 * Post a simple text message to the webhook channel (#horsera-social).
 */
export async function postMessage(text) {
  const res = await fetch(WEBHOOK_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Slack webhook ${res.status}: ${body}`);
  }
  return { ok: true };
}

/**
 * Post a rich message using Slack Block Kit.
 * `blocks` is an array of Block Kit block objects.
 * Optional `text` is the fallback for notifications.
 */
export async function postBlocks(blocks, text = "") {
  const res = await fetch(WEBHOOK_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text, blocks }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Slack webhook ${res.status}: ${body}`);
  }
  return { ok: true };
}

/**
 * Post a message with an image attachment.
 * Uses Block Kit image block.
 */
export async function postWithImage(text, imageUrl, altText = "image") {
  const blocks = [
    {
      type: "section",
      text: { type: "mrkdwn", text },
    },
    {
      type: "image",
      image_url: imageUrl,
      alt_text: altText,
    },
  ];
  return postBlocks(blocks, text);
}

/**
 * Post a formatted Sage draft for review.
 * Includes the draft text, a Trello card link, and action prompt.
 */
export async function postDraftForReview(draft, trelloUrl, platform = "LinkedIn") {
  const blocks = [
    {
      type: "header",
      text: {
        type: "plain_text",
        text: `📝 Sage — ${platform} Draft Ready for Review`,
      },
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: draft,
      },
    },
    { type: "divider" },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `📋 *Trello card:* <${trelloUrl}|View card>`,
      },
    },
    {
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text: "Reply in this thread to approve, request changes, or reject.",
        },
      ],
    },
  ];
  return postBlocks(blocks, `Sage ${platform} draft ready for review`);
}

// ── Slack Web API (requires SLACK_BOT_TOKEN) ────────────────────────────────

const SLACK_API = "https://slack.com/api";

function requireBotToken() {
  if (!BOT_TOKEN) {
    throw new Error(
      "SLACK_BOT_TOKEN is required in .env.local for reading messages and replying in threads"
    );
  }
}

async function slackApi(method, body = {}) {
  requireBotToken();
  const res = await fetch(`${SLACK_API}/${method}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${BOT_TOKEN}`,
    },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!data.ok) {
    throw new Error(`Slack API ${method}: ${data.error}`);
  }
  return data;
}

/**
 * Read recent messages from a channel.
 * `channel` is the channel ID (not the name).
 * Returns up to `limit` messages (default 20).
 */
export async function readMessages(channel, limit = 20) {
  return slackApi("conversations.history", { channel, limit });
}

/**
 * Reply in a thread.
 * `channel` is the channel ID, `threadTs` is the parent message timestamp.
 */
export async function replyInThread(channel, threadTs, text) {
  return slackApi("chat.postMessage", {
    channel,
    thread_ts: threadTs,
    text,
  });
}

/**
 * Reply in a thread with Block Kit blocks.
 */
export async function replyInThreadBlocks(channel, threadTs, blocks, text = "") {
  return slackApi("chat.postMessage", {
    channel,
    thread_ts: threadTs,
    text,
    blocks,
  });
}

/**
 * Upload an image to a channel or thread.
 * Note: file uploads use multipart form data.
 */
export async function uploadImage(channel, filePath, { threadTs, comment } = {}) {
  requireBotToken();
  const fileBuffer = fs.readFileSync(filePath);
  const fileName = path.basename(filePath);

  // Step 1: get upload URL
  const upload = await slackApi("files.getUploadURLExternal", {
    filename: fileName,
    length: fileBuffer.length,
  });

  // Step 2: upload file content
  await fetch(upload.upload_url, {
    method: "POST",
    body: fileBuffer,
  });

  // Step 3: complete upload
  const completeBody = {
    files: [{ id: upload.file_id, title: fileName }],
    channel_id: channel,
  };
  if (comment) completeBody.initial_comment = comment;
  if (threadTs) completeBody.thread_ts = threadTs;

  return slackApi("files.completeUploadExternal", completeBody);
}
