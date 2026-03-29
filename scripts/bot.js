/**
 * scripts/bot.js
 *
 * Horsera Slack bot — conversational interface to the agent team.
 * Uses Socket Mode (@slack/bolt) and Anthropic API for agent responses.
 * Single file, ES module.
 *
 * Usage:  node scripts/bot.js
 * Requires: @slack/bolt, @anthropic-ai/sdk
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { App } from "@slack/bolt";
import Anthropic from "@anthropic-ai/sdk";
import { google } from "googleapis";

// ── Helpers ─────────────────────────────────────────────────────────────────

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

function log(...args) {
  const ts = new Date().toISOString();
  console.log(`[${ts}]`, ...args);
}

// ── Load .env.local ─────────────────────────────────────────────────────────

function loadEnv() {
  // Start with process.env (Railway, Docker, etc.)
  // Then overlay .env.local if it exists (local dev)
  // process.env values take precedence — so Railway vars always win
  const env = { ...process.env };
  const envPath = path.join(ROOT, ".env.local");
  if (fs.existsSync(envPath)) {
    const lines = fs.readFileSync(envPath, "utf-8").split("\n");
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eqIdx = trimmed.indexOf("=");
      if (eqIdx === -1) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      const value = trimmed.slice(eqIdx + 1).trim();
      // Only use .env.local value if not already set by process.env
      if (!env[key]) env[key] = value;
    }
  }
  return env;
}

const ENV = loadEnv();

const SLACK_BOT_TOKEN = ENV.SLACK_BOT_TOKEN;
const SLACK_APP_TOKEN = ENV.SLACK_APP_TOKEN;
const ANTHROPIC_API_KEY = ENV.ANTHROPIC_API_KEY;
const TRELLO_API_KEY = ENV.TRELLO_API_KEY;
const TRELLO_TOKEN = ENV.TRELLO_TOKEN;
const LINKEDIN_ACCESS_TOKEN = (ENV.LINKEDIN_ACCESS_TOKEN || "").replace(/\s+/g, "");
const LINKEDIN_PERSON_URN = (ENV.LINKEDIN_PERSON_URN || "").trim();

if (!SLACK_BOT_TOKEN) throw new Error("Missing SLACK_BOT_TOKEN in .env.local");
if (!SLACK_APP_TOKEN) throw new Error("Missing SLACK_APP_TOKEN in .env.local");
if (!ANTHROPIC_API_KEY) throw new Error("Missing ANTHROPIC_API_KEY in .env.local");
if (!TRELLO_API_KEY) throw new Error("Missing TRELLO_API_KEY in .env.local");
if (!TRELLO_TOKEN) throw new Error("Missing TRELLO_TOKEN in .env.local");

// ── Trello config ───────────────────────────────────────────────────────────

const TRELLO_BASE = "https://api.trello.com/1";
const TRELLO_BOARDS = {
  main: "Xe7yzxVo",
  social: "69c55c2df1405484a92bef28",
};

const SAGE_LISTS = {
  requestedTopics: "69c55c43ae2062d2026d8fc2",
  inProgress: "69c55c4c9358a30186118e16",
  toReview: "69c55c872b19434e48ce7b7d",
  approved: "69c55c902b19434e48ce9c73",
  published: "69c55c50dccc64d962916fa3",
};

// ── Trello helpers ──────────────────────────────────────────────────────────

function trelloUrl(endpoint) {
  const sep = endpoint.includes("?") ? "&" : "?";
  return `${TRELLO_BASE}${endpoint}${sep}key=${TRELLO_API_KEY}&token=${TRELLO_TOKEN}`;
}

async function trelloMoveCard(cardId, listId) {
  const res = await fetch(trelloUrl(`/cards/${cardId}?idList=${listId}`), {
    method: "PUT",
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Trello move_card failed (${res.status}): ${body}`);
  }
  return await res.json();
}

async function trelloAddComment(cardId, text) {
  const res = await fetch(trelloUrl(`/cards/${cardId}/actions/comments`), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Trello add_comment failed (${res.status}): ${body}`);
  }
  return await res.json();
}

async function trelloCreateCard(listId, name, desc = "") {
  const res = await fetch(trelloUrl("/cards"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ idList: listId, name, desc }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Trello create_card failed (${res.status}): ${body}`);
  }
  return await res.json();
}

// Map tool names to handler functions
const TRELLO_TOOL_HANDLERS = {
  move_card: async (input) => {
    const result = await trelloMoveCard(input.cardId, input.listId);
    return { success: true, card: { id: result.id, name: result.name, url: result.shortUrl } };
  },
  add_comment: async (input) => {
    const result = await trelloAddComment(input.cardId, input.text);
    return { success: true, commentId: result.id };
  },
  create_card: async (input) => {
    const result = await trelloCreateCard(input.listId, input.name, input.desc || "");
    return { success: true, card: { id: result.id, name: result.name, url: result.shortUrl } };
  },
};

// ── Google Docs config ──────────────────────────────────────────────────────

const CONTENT_DOC_ID = "1BulY-4nHxpn69ZUbOItOxYN1OArDktyBoc_bVDDI-xM";
const CONTENT_TAB_ID = "t.0";
const MEMORY_TAB_ID = "t.m8e6w0f9mcmv";

// Horsera brand colors
const COLORS = {
  cognac: { red: 0.549, green: 0.353, blue: 0.235 },     // #8C5A3C
  champagne: { red: 0.788, green: 0.663, blue: 0.431 },   // #C9A96E
  cadenceBlue: { red: 0.420, green: 0.498, blue: 0.639 }, // #6B7FA3
  progressGreen: { red: 0.490, green: 0.608, blue: 0.463 }, // #7D9B76
  ink: { red: 0.102, green: 0.078, blue: 0.055 },          // #1A140E
  stone: { red: 0.941, green: 0.922, blue: 0.894 },        // #F0EBE4
};

let docsClient = null;

function getDocsClient() {
  if (docsClient) return docsClient;
  const b64Key = ENV.GOOGLE_SERVICE_ACCOUNT_KEY;
  if (!b64Key) {
    log("Warning: GOOGLE_SERVICE_ACCOUNT_KEY not set — Google Docs tools disabled");
    return null;
  }
  let credentials;
  try {
    credentials = JSON.parse(Buffer.from(b64Key, "base64").toString("utf-8"));
    log("Google credentials loaded for:", credentials.client_email);
  } catch (err) {
    log("Failed to parse GOOGLE_SERVICE_ACCOUNT_KEY:", err.message);
    log("Key length:", b64Key.length, "chars, first 50:", b64Key.slice(0, 50));
    return null;
  }
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ["https://www.googleapis.com/auth/documents", "https://www.googleapis.com/auth/drive"],
  });
  docsClient = google.docs({ version: "v1", auth });
  return docsClient;
}

let driveClient = null;
function getDriveClient() {
  if (driveClient) return driveClient;
  const b64Key = ENV.GOOGLE_SERVICE_ACCOUNT_KEY;
  if (!b64Key) return null;
  const credentials = JSON.parse(Buffer.from(b64Key, "base64").toString("utf-8"));
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ["https://www.googleapis.com/auth/drive"],
  });
  driveClient = google.drive({ version: "v3", auth });
  return driveClient;
}

async function readGoogleDocTab(tabId = CONTENT_TAB_ID) {
  const docs = getDocsClient();
  if (!docs) throw new Error("Google Docs not configured");
  const doc = await docs.documents.get({
    documentId: CONTENT_DOC_ID,
    includeTabsContent: true,
  });
  // Find the right tab
  const tab = doc.data.tabs?.find((t) => t.tabProperties?.tabId === tabId);
  if (!tab) throw new Error(`Tab ${tabId} not found in document`);

  // Extract text with suggestions marked
  let text = "";
  for (const element of tab.documentTab?.body?.content || []) {
    if (element.paragraph) {
      for (const el of element.paragraph.elements || []) {
        if (el.textRun) {
          const content = el.textRun.content;
          if (el.textRun.suggestedInsertionIds?.length > 0) {
            text += `[SUGGESTION - ADD: ${content}]`;
          } else if (el.textRun.suggestedDeletionIds?.length > 0) {
            text += `[SUGGESTION - DELETE: ${content}]`;
          } else {
            text += content;
          }
        }
      }
    }
  }
  return { title: tab.tabProperties?.title || "Untitled", text: text.trim() };
}

async function readDocComments() {
  const drive = getDriveClient();
  if (!drive) return [];
  try {
    const res = await drive.comments.list({
      fileId: CONTENT_DOC_ID,
      fields: "comments(id,content,author,quotedFileContent,resolved,createdTime)",
    });
    return (res.data.comments || [])
      .filter((c) => !c.resolved)
      .map((c) => ({
        author: c.author?.displayName || "Unknown",
        comment: c.content,
        quotedText: c.quotedFileContent?.value || "",
        date: c.createdTime?.slice(0, 10) || "",
      }));
  } catch (err) {
    log("Failed to read comments:", err.message);
    return [];
  }
}

function getTabEndIndex(tab) {
  const content = tab.documentTab?.body?.content || [];
  return content.at(-1)?.endIndex || 1;
}

async function appendFormattedPost(postData) {
  const docs = getDocsClient();
  if (!docs) throw new Error("Google Docs not configured");

  const doc = await docs.documents.get({ documentId: CONTENT_DOC_ID, includeTabsContent: true });
  const tab = doc.data.tabs?.find((t) => t.tabProperties?.tabId === CONTENT_TAB_ID);
  if (!tab) throw new Error("Content tab not found");
  const endIndex = getTabEndIndex(tab);
  const startIdx = endIndex - 1;

  // Build the post text block
  const divider = "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n";
  const status = postData.status || "Draft";
  const date = new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
  const title = postData.title || "Untitled Post";
  const hook = postData.hook || "";
  const body = postData.body || "";
  const hashtags = postData.hashtags || "";
  const notes = postData.notes || "";

  const statusLine = `[${status}]  •  ${date}\n`;
  const titleLine = `${title}\n\n`;
  const hookLabel = "HOOK\n";
  const hookText = `${hook}\n\n`;
  const bodyLabel = "BODY\n";
  const bodyText = `${body}\n\n`;
  const hashtagsLabel = "HASHTAGS\n";
  const hashtagsText = `${hashtags}\n\n`;
  const notesSection = notes ? `ROSSELLA'S NOTES\n${notes}\n\n` : "ROSSELLA'S NOTES\n(Add your feedback here)\n\n";

  const fullText = divider + statusLine + titleLine + hookLabel + hookText + bodyLabel + bodyText + hashtagsLabel + hashtagsText + notesSection;

  // Step 1: Insert all text (specify tab)
  const requests = [
    { insertText: { location: { index: startIdx, tabId: CONTENT_TAB_ID }, text: fullText } },
  ];

  // Step 2: Apply formatting (indices relative to startIdx)
  let idx = startIdx;

  // Divider — cognac color
  requests.push({
    updateTextStyle: {
      range: { startIndex: idx, endIndex: idx + divider.length },
      textStyle: { foregroundColor: { color: { rgbColor: COLORS.cognac } } },
      fields: "foregroundColor",
    },
  });
  idx += divider.length;

  // Status line — champagne, small caps feel
  requests.push({
    updateTextStyle: {
      range: { startIndex: idx, endIndex: idx + statusLine.length },
      textStyle: {
        foregroundColor: { color: { rgbColor: COLORS.champagne } },
        bold: true,
        fontSize: { magnitude: 9, unit: "PT" },
      },
      fields: "foregroundColor,bold,fontSize",
    },
  });
  idx += statusLine.length;

  // Title — heading style, cognac
  requests.push({
    updateParagraphStyle: {
      range: { startIndex: idx, endIndex: idx + titleLine.length },
      paragraphStyle: { namedStyleType: "HEADING_2" },
      fields: "namedStyleType",
    },
  });
  requests.push({
    updateTextStyle: {
      range: { startIndex: idx, endIndex: idx + titleLine.length - 1 },
      textStyle: { foregroundColor: { color: { rgbColor: COLORS.cognac } } },
      fields: "foregroundColor",
    },
  });
  idx += titleLine.length;

  // Section labels — bold, cadence blue, small
  const sections = [
    { label: hookLabel, text: hookText },
    { label: bodyLabel, text: bodyText },
    { label: hashtagsLabel, text: hashtagsText },
  ];

  for (const section of sections) {
    requests.push({
      updateTextStyle: {
        range: { startIndex: idx, endIndex: idx + section.label.length },
        textStyle: {
          foregroundColor: { color: { rgbColor: COLORS.cadenceBlue } },
          bold: true,
          fontSize: { magnitude: 8, unit: "PT" },
        },
        fields: "foregroundColor,bold,fontSize",
      },
    });
    idx += section.label.length;

    // Body text — ink color, normal
    requests.push({
      updateTextStyle: {
        range: { startIndex: idx, endIndex: idx + section.text.length },
        textStyle: {
          foregroundColor: { color: { rgbColor: COLORS.ink } },
          fontSize: { magnitude: 11, unit: "PT" },
        },
        fields: "foregroundColor,fontSize",
      },
    });
    idx += section.text.length;
  }

  // Notes label — progress green
  const notesLabel = "ROSSELLA'S NOTES\n";
  requests.push({
    updateTextStyle: {
      range: { startIndex: idx, endIndex: idx + notesLabel.length },
      textStyle: {
        foregroundColor: { color: { rgbColor: COLORS.progressGreen } },
        bold: true,
        fontSize: { magnitude: 8, unit: "PT" },
      },
      fields: "foregroundColor,bold,fontSize",
    },
  });

  await docs.documents.batchUpdate({
    documentId: CONTENT_DOC_ID,
    requestBody: { requests },
  });

  return { success: true, docId: CONTENT_DOC_ID };
}

// ── Sage Memory (persistent across redeploys) ──────────────────────────────

async function readSageMemory() {
  try {
    const result = await readGoogleDocTab(MEMORY_TAB_ID);
    return result.text;
  } catch (err) {
    log("Failed to read Sage memory:", err.message);
    return "";
  }
}

async function appendSageMemory(content) {
  const docs = getDocsClient();
  if (!docs) throw new Error("Google Docs not configured");
  const doc = await docs.documents.get({ documentId: CONTENT_DOC_ID, includeTabsContent: true });
  const tab = doc.data.tabs?.find((t) => t.tabProperties?.tabId === MEMORY_TAB_ID);
  if (!tab) throw new Error("Sage-memory tab not found");
  const endIndex = getTabEndIndex(tab);
  const date = new Date().toISOString().slice(0, 10);
  const entry = `\n[${date}] ${content}\n`;
  await docs.documents.batchUpdate({
    documentId: CONTENT_DOC_ID,
    requestBody: {
      requests: [{ insertText: { location: { index: endIndex - 1, tabId: MEMORY_TAB_ID }, text: entry } }],
    },
  });
  return { success: true };
}

async function clearAndWriteContentTab(posts) {
  const docs = getDocsClient();
  if (!docs) throw new Error("Google Docs not configured");

  const doc = await docs.documents.get({ documentId: CONTENT_DOC_ID, includeTabsContent: true });
  const tab = doc.data.tabs?.find((t) => t.tabProperties?.tabId === CONTENT_TAB_ID);
  if (!tab) throw new Error("Content tab not found");
  const endIndex = getTabEndIndex(tab);

  // Step 1: Delete all existing content (leave index 1, the minimum)
  const requests = [];
  if (endIndex > 2) {
    requests.push({
      deleteContentRange: {
        range: { startIndex: 1, endIndex: endIndex - 1, tabId: CONTENT_TAB_ID },
      },
    });
  }

  // Execute delete first
  if (requests.length > 0) {
    await docs.documents.batchUpdate({
      documentId: CONTENT_DOC_ID,
      requestBody: { requests },
    });
  }

  // Step 2: Write each post with formatting
  for (const post of posts) {
    await appendFormattedPost(post);
  }

  return { success: true, postsWritten: posts.length };
}

// Google Docs tool handlers
const GDOCS_TOOL_HANDLERS = {
  read_content_doc: async () => {
    const result = await readGoogleDocTab(CONTENT_TAB_ID);
    const comments = await readDocComments();
    return {
      success: true,
      title: result.title,
      content: result.text,
      comments: comments.length > 0 ? comments : "No comments",
    };
  },
  append_to_content_doc: async (input) => {
    const result = await appendFormattedPost(input);
    return result;
  },
  replace_content_doc: async (input) => {
    const result = await clearAndWriteContentTab(input.posts);
    return result;
  },
  read_sage_memory: async () => {
    const text = await readSageMemory();
    return { success: true, content: text };
  },
  save_sage_memory: async (input) => {
    const result = await appendSageMemory(input.content);
    return result;
  },
};

// ── LinkedIn publishing ─────────────────────────────────────────────────────

function linkedinHeaders(contentType = "application/json") {
  return {
    Authorization: `Bearer ${LINKEDIN_ACCESS_TOKEN}`,
    "Content-Type": contentType,
    "LinkedIn-Version": "202402",
    "X-Restli-Protocol-Version": "2.0.0",
  };
}

/**
 * Upload an image to LinkedIn and return the asset URN.
 * Steps: 1) register upload, 2) upload binary, 3) return asset.
 */
async function linkedinUploadImage(imageBuffer) {
  // Step 1: Register the upload
  const registerBody = {
    registerUploadRequest: {
      recipes: ["urn:li:digitalmediaRecipe:feedshare-image"],
      owner: LINKEDIN_PERSON_URN,
      serviceRelationships: [
        { relationshipType: "OWNER", identifier: "urn:li:userGeneratedContent" },
      ],
    },
  };

  const regRes = await fetch("https://api.linkedin.com/v2/assets?action=registerUpload", {
    method: "POST",
    headers: linkedinHeaders(),
    body: JSON.stringify(registerBody),
  });

  if (!regRes.ok) {
    const errBody = await regRes.text();
    throw new Error(`LinkedIn register upload ${regRes.status}: ${errBody}`);
  }

  const regData = await regRes.json();
  const uploadUrl = regData.value.uploadMechanism["com.linkedin.digitalmedia.uploading.MediaUploadHttpRequest"].uploadUrl;
  const asset = regData.value.asset;

  // Step 2: Upload the image binary
  const uploadRes = await fetch(uploadUrl, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${LINKEDIN_ACCESS_TOKEN}`,
      "Content-Type": "application/octet-stream",
    },
    body: imageBuffer,
  });

  if (!uploadRes.ok) {
    const errBody = await uploadRes.text();
    throw new Error(`LinkedIn image upload ${uploadRes.status}: ${errBody}`);
  }

  log(`LinkedIn image uploaded: ${asset}`);
  return asset;
}

/**
 * Download an image from a URL (Slack file, external URL, etc.)
 * For Slack files, uses the bot token for auth.
 */
async function downloadImage(imageUrl) {
  log(`Downloading image from: ${imageUrl.slice(0, 100)}...`);
  const headers = {};
  // Slack file URLs need bot token auth
  if (imageUrl.includes("files.slack.com") || imageUrl.includes("slack.com/files")) {
    headers.Authorization = `Bearer ${SLACK_BOT_TOKEN}`;
  }
  try {
    const res = await fetch(imageUrl, { headers });
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text().catch(() => "no body")}`);
    const buffer = Buffer.from(await res.arrayBuffer());
    log(`Image downloaded: ${buffer.length} bytes`);
    return buffer;
  } catch (err) {
    log(`Image download failed: ${err.message}`);
    throw new Error(`Failed to download image: ${err.message} (URL: ${imageUrl.slice(0, 100)})`);
  }
}

async function linkedinPublish(text, { linkUrl, imageUrl } = {}) {
  // Strip markdown formatting — LinkedIn uses plain text only
  text = text.replace(/\*\*(.+?)\*\*/g, "$1").replace(/__(.+?)__/g, "$1").replace(/\*(.+?)\*/g, "$1").replace(/_(.+?)_/g, "$1");
  log(`LinkedIn publish — token length: ${LINKEDIN_ACCESS_TOKEN.length}, URN: ${LINKEDIN_PERSON_URN}, imageUrl: ${imageUrl ? "yes" : "no"}, linkUrl: ${linkUrl ? "yes" : "no"}`);
  if (!LINKEDIN_ACCESS_TOKEN || !LINKEDIN_PERSON_URN) {
    throw new Error("LinkedIn not configured — missing LINKEDIN_ACCESS_TOKEN or LINKEDIN_PERSON_URN");
  }

  let shareMediaCategory = "NONE";
  let media = [];

  if (imageUrl) {
    // Image posts are currently suppressed by LinkedIn on this account.
    // Skip image upload and publish as text-only until Community Management API is approved.
    log("Skipping image upload — LinkedIn suppresses image posts on this account. Publishing text-only.");
  }
  if (linkUrl) {
    shareMediaCategory = "ARTICLE";
    media = [{ status: "READY", originalUrl: linkUrl }];
  }

  const body = {
    author: LINKEDIN_PERSON_URN,
    lifecycleState: "PUBLISHED",
    specificContent: {
      "com.linkedin.ugc.ShareContent": {
        shareCommentary: { text },
        shareMediaCategory,
        ...(media.length > 0 ? { media } : {}),
      },
    },
    visibility: {
      "com.linkedin.ugc.MemberNetworkVisibility": "PUBLIC",
    },
  };

  const res = await fetch("https://api.linkedin.com/v2/ugcPosts", {
    method: "POST",
    headers: linkedinHeaders(),
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(`LinkedIn API ${res.status}: ${errBody}`);
  }

  const resText = await res.text();
  return resText ? JSON.parse(resText) : { ok: true };
}

const LINKEDIN_TOOL_HANDLERS = {
  publish_to_linkedin: async (input) => {
    const result = await linkedinPublish(input.text, {
      linkUrl: input.linkUrl,
      imageUrl: input.imageUrl,
    });
    log("LinkedIn post published successfully");
    return { success: true, message: "Published to LinkedIn as Horsera AI", result };
  },
};

// ── Slack history tool handler ────────────────────────────────────────────

const SLACK_TOOL_HANDLERS = {
  read_slack_history: async (input) => {
    const chName = input.channel || "horsera-social";
    const chId = await getChannelId(chName);
    if (!chId) return { success: false, error: `Channel #${chName} not found` };
    const history = await getTodaysChannelHistory(chId, input.limit || 100);
    return { success: true, channel: chName, messages: history || "No messages today" };
  },
};

// Merge all handlers
Object.assign(TRELLO_TOOL_HANDLERS, GDOCS_TOOL_HANDLERS, LINKEDIN_TOOL_HANDLERS, SLACK_TOOL_HANDLERS);

// Tool definitions for Claude
const TRELLO_TOOLS = [
  {
    name: "move_card",
    description:
      "Move a Trello card to a different list. Use this when Rossella approves, rejects, or wants to change the status of a card.",
    input_schema: {
      type: "object",
      properties: {
        cardId: { type: "string", description: "The Trello card ID" },
        listId: { type: "string", description: "The target list ID to move the card to" },
      },
      required: ["cardId", "listId"],
    },
  },
  {
    name: "add_comment",
    description: "Add a comment to a Trello card.",
    input_schema: {
      type: "object",
      properties: {
        cardId: { type: "string", description: "The Trello card ID" },
        text: { type: "string", description: "The comment text" },
      },
      required: ["cardId", "text"],
    },
  },
  {
    name: "create_card",
    description: "Create a new Trello card in a specified list.",
    input_schema: {
      type: "object",
      properties: {
        listId: { type: "string", description: "The list ID to create the card in" },
        name: { type: "string", description: "The card title" },
        desc: { type: "string", description: "The card description (optional)" },
      },
      required: ["listId", "name"],
    },
  },
  {
    name: "read_content_doc",
    description: "Read the current contents of the Horsera Content Pipeline Google Doc. Use this to see what drafts exist, what's been approved, and what Rossella has commented on.",
    input_schema: {
      type: "object",
      properties: {},
      required: [],
    },
  },
  {
    name: "append_to_content_doc",
    description: "Add a beautifully formatted LinkedIn post draft to the Horsera Content Pipeline Google Doc. The doc is styled with Horsera brand colors automatically. Provide structured post data.",
    input_schema: {
      type: "object",
      properties: {
        title: { type: "string", description: "Post title (e.g., 'Swimming With Horses — Personal Story')" },
        status: { type: "string", description: "Status: Draft, In Review, Approved, Published" },
        hook: { type: "string", description: "The opening hook line (bold, attention-grabbing)" },
        body: { type: "string", description: "The main post body (2-4 paragraphs)" },
        hashtags: { type: "string", description: "Hashtags (e.g., '#equestrian #horsescience')" },
        notes: { type: "string", description: "Optional notes or questions for Rossella" },
      },
      required: ["title", "hook", "body", "hashtags"],
    },
  },
  {
    name: "replace_content_doc",
    description: "REPLACE the entire content of the Google Doc with updated posts. Use this when Rossella asks you to revise, update, or clean up the doc — do NOT append duplicates. Provide ALL posts that should be in the doc (the old content is deleted first).",
    input_schema: {
      type: "object",
      properties: {
        posts: {
          type: "array",
          description: "Array of all posts to write to the doc (replaces everything)",
          items: {
            type: "object",
            properties: {
              title: { type: "string" },
              status: { type: "string" },
              hook: { type: "string" },
              body: { type: "string" },
              hashtags: { type: "string" },
              notes: { type: "string" },
            },
            required: ["title", "hook", "body", "hashtags"],
          },
        },
      },
      required: ["posts"],
    },
  },
  {
    name: "read_sage_memory",
    description: "Read Sage's persistent memory — conversation history, preferences, and context from past sessions. Always read this at the start of a new conversation to maintain continuity.",
    input_schema: {
      type: "object",
      properties: {},
      required: [],
    },
  },
  {
    name: "save_sage_memory",
    description: "Save an important fact, decision, preference, or conversation summary to Sage's persistent memory. Use this to remember things across sessions — e.g., content decisions, Rossella's feedback patterns, approved topics, ongoing projects. Be concise but specific.",
    input_schema: {
      type: "object",
      properties: {
        content: { type: "string", description: "The memory to save (concise, specific, useful for future sessions)" },
      },
      required: ["content"],
    },
  },
  {
    name: "publish_to_linkedin",
    description: "Publish a post to LinkedIn as Horsera AI. ONLY use this after Rossella explicitly approves the post. The post goes live immediately and is public. Supports text-only, link preview, or image posts. For images: if Rossella attached an image in Slack, use that file's URL as imageUrl.",
    input_schema: {
      type: "object",
      properties: {
        text: { type: "string", description: "The full post text to publish on LinkedIn" },
        linkUrl: { type: "string", description: "Optional URL to attach as a link preview (cannot combine with imageUrl)" },
        imageUrl: { type: "string", description: "Optional image URL to upload and attach to the post (Slack file URL or external URL)" },
      },
      required: ["text"],
    },
  },
  {
    name: "read_slack_history",
    description: "Read today's messages from a Slack channel. Use this to catch up on conversations you may have missed, especially if context seems incomplete or if Rossella references something discussed earlier. Always read history when you're unsure about context.",
    input_schema: {
      type: "object",
      properties: {
        channel: { type: "string", description: "Channel name without # (default: horsera-social). Options: horsera-social, horsera-agents" },
        limit: { type: "number", description: "Max messages to fetch (default: 100)" },
      },
      required: [],
    },
  },
];

// ── Agent system prompts ────────────────────────────────────────────────────

const AGENT_BASE_PROMPT = (name) => `You are ${name}, a member of the Horsera agent team. You are chatting with Rossella (the founder) in Slack.
Reply concisely and in character. Use markdown formatting sparingly — Slack uses mrkdwn, not full markdown.
When Rossella approves a post or card, confirm and take the Trello action.
When she gives feedback, acknowledge it specifically and offer a revision.`;

const SAGE_EXTRA_PROMPT = `
You have access to Trello. The social board lists are:
- Requested Topics: 69c55c43ae2062d2026d8fc2
- In Progress: 69c55c4c9358a30186118e16
- To Review: 69c55c872b19434e48ce7b7d
- Approved: 69c55c902b19434e48ce9c73
- Published: 69c55c50dccc64d962916fa3

When Rossella approves a post, move the card to Approved and confirm.
When she requests changes, update the card description with the new draft and move it back to In Progress.

You also have access to the Horsera Content Pipeline Google Doc.
- Use read_content_doc to see current drafts, approved posts, and Rossella's inline comments
- Use append_to_content_doc ONLY when adding a single new post to an existing doc
- Use replace_content_doc when updating, revising, or rewriting posts — this REPLACES the entire doc with the updated version (no duplicates!)
- For SMALL changes (1-2 posts, minor edits): use append_to_content_doc or replace_content_doc directly. Act first, explain after.
- For BIG changes (rewriting multiple posts, applying many comments, restructuring the doc): DO NOT attempt this yourself — you will run out of tool calls. Instead, tell Rossella:
  "This is a big doc rewrite — I'll prepare a handoff for Claude Code. Here's what to paste:"
  Then write a clear, copy-pasteable prompt that includes: (1) what comments/changes to apply, (2) the current state, (3) the desired outcome. Rossella will paste this into Claude Code where the rewrite can happen reliably.
- NEVER say "Done!" or "I've updated the doc!" unless you actually called a tool. If you didn't call replace_content_doc or append_to_content_doc, you didn't change the doc.
- The Google Doc is the primary workspace for drafting and reviewing content
- Trello tracks status; the Google Doc holds the actual content
- When you draft a new post, add it to the Google Doc AND create/update the Trello card

IMPORTANT — Equestrian Accuracy:
- Before finalizing ANY post that references biomechanics, training concepts, horse science, or competition, tell Rossella you'll have Monty (the equestrian expert) review it
- If Rossella asks you to consult Monty, acknowledge it and note that Monty should review the content
- You cannot fact-check equestrian content yourself — Monty is the authority

IMPORTANT — LinkedIn Publishing:
- You can publish directly to LinkedIn using the publish_to_linkedin tool
- Posts go live as "Horsera AI" (personal profile) — they are PUBLIC and IMMEDIATE
- NEVER publish without Rossella's explicit approval ("approved", "publish it", "go ahead", "ship it", etc.)
- After publishing, move the Trello card to Published (list ID: 69c55c50dccc64d962916fa3)
- If the post includes a link, pass it as linkUrl for a rich preview
- If Rossella attaches an image in Slack, use that file's URL as imageUrl to publish an image post
- You can handle text-only posts, link posts, and image posts

IMPORTANT — Context and Conversation Awareness:
- Today's Slack conversations are injected into your system prompt automatically — USE THEM for context
- If Rossella references something discussed earlier today, you should already know about it from the injected history
- If context seems incomplete, use the read_slack_history tool to check what was discussed
- When Monty reviews something in the same channel, you see his messages too — don't ask Rossella to repeat what Monty said
- When Rossella sends you a file/image attachment, the URL is in the message — use it directly
- NEVER act confused about context that's clearly in today's conversation history. If Rossella says "we aligned on X" — check the history, don't ask her to repeat it

IMPORTANT — Conversation Continuity:
- You share conversation context with other agents (Monty, Ross, etc.) in the same channel
- If Monty reviewed a post earlier in the conversation, you know about it — don't re-ask for review
- If Rossella gave feedback to Monty about accuracy, apply that feedback when you draft

IMPORTANT — Google Doc Safety:
- NEVER use replace_content_doc unless Rossella explicitly asks you to rewrite or restructure the doc
- If Rossella asks you to publish a LinkedIn post, that does NOT mean "rewrite the entire Google Doc"
- Only touch the doc when the task is specifically about the doc content
- When in doubt, ASK before modifying the doc

IMPORTANT — Persistent Memory:
- You have a persistent memory via read_sage_memory and save_sage_memory
- Memory is loaded automatically into your system prompt — you don't need to call read_sage_memory manually
- After meaningful conversations (content decisions, feedback, new topics, preferences), save key takeaways to memory
- This memory survives restarts and redeploys — it is your long-term knowledge base
- Save things like: approved topics, Rossella's content preferences, ongoing projects, key decisions, feedback patterns
- A daily summary is saved automatically at end of each day`;

function loadAgentFile(filename) {
  const filePath = path.join(ROOT, "_agents", filename);
  if (fs.existsSync(filePath)) {
    return fs.readFileSync(filePath, "utf-8");
  }
  return null;
}

function buildSystemPrompt(agentName, mdFile, extra = "") {
  const base = AGENT_BASE_PROMPT(agentName);
  const fileContent = loadAgentFile(mdFile);
  const personality = fileContent
    ? `\n\n--- Agent Reference ---\n${fileContent}`
    : "";
  return `${base}${extra}${personality}`;
}

const DEFAULT_PERSONALITIES = {
  ross: "You are Ross, the product manager. You are bold, visionary, and relentlessly practical. You guard the product vision, define scope and priorities, and have deep equestrian expertise. You think in systems and loops.",
  lauren:
    "You are Lauren, the designer. You start with empathy and think about what the rider is feeling. You own how Horsera feels — the visual DNA, the emotional journey, and the premium equestrian aesthetic.",
  beau: "You are Beau, the developer. You are pragmatic, clean, and quietly proud of good code. You implement features, maintain the architecture, and prefer simple solutions. You flag technical debt honestly.",
  quinn:
    "You are Quinn, the QA reviewer. You are skeptical, thorough, and rider-perspective-first. You are the last line of defense before anything ships. You think about what breaks, not just what works.",
};

// Build all agent system prompts at startup
const AGENTS = {
  sage: buildSystemPrompt("Sage", "sage.md", SAGE_EXTRA_PROMPT),
  ross: loadAgentFile("ross.md")
    ? buildSystemPrompt("Ross", "ross.md")
    : `${AGENT_BASE_PROMPT("Ross")}\n\n${DEFAULT_PERSONALITIES.ross}`,
  lauren: loadAgentFile("lauren.md")
    ? buildSystemPrompt("Lauren", "lauren.md")
    : `${AGENT_BASE_PROMPT("Lauren")}\n\n${DEFAULT_PERSONALITIES.lauren}`,
  beau: loadAgentFile("beau.md")
    ? buildSystemPrompt("Beau", "beau.md")
    : `${AGENT_BASE_PROMPT("Beau")}\n\n${DEFAULT_PERSONALITIES.beau}`,
  quinn: loadAgentFile("quinn.md")
    ? buildSystemPrompt("Quinn", "quinn.md")
    : `${AGENT_BASE_PROMPT("Quinn")}\n\n${DEFAULT_PERSONALITIES.quinn}`,
  monty: buildSystemPrompt("Monty", "monty.md"),
};

log("Agent system prompts loaded:");
for (const [name, prompt] of Object.entries(AGENTS)) {
  log(`  ${name}: ${prompt.length} chars`);
}

// ── Agent routing ───────────────────────────────────────────────────────────

// Channel-based defaults (channel name -> agent)
const CHANNEL_DEFAULTS = {
  "horsera-social": "sage",
  "horsera-agents": "ross",
};

// Keyword patterns for agent detection (checked in order)
const AGENT_KEYWORDS = [
  { pattern: /\bsage\b/i, agent: "sage" },
  { pattern: /\bross\b/i, agent: "ross" },
  { pattern: /\bbeau\b/i, agent: "beau" },
  { pattern: /\blauren\b/i, agent: "lauren" },
  { pattern: /\bquinn\b/i, agent: "quinn" },
  { pattern: /\bmonty\b/i, agent: "monty" },
  { pattern: /\bexpert\b/i, agent: "monty" },
];

function detectAgent(text, channelName) {
  // Check keyword mentions first
  for (const { pattern, agent } of AGENT_KEYWORDS) {
    if (pattern.test(text)) return agent;
  }
  // Fall back to channel default
  if (channelName && CHANNEL_DEFAULTS[channelName]) {
    return CHANNEL_DEFAULTS[channelName];
  }
  // Ultimate default
  return "ross";
}

// ── Slack channel history ───────────────────────────────────────────────────
// Read recent messages from a Slack channel to give agents same-day context.

// Known channel IDs — avoids needing channels:read scope
const KNOWN_CHANNELS = {
  "horsera-social": "C0APGA93ESV",
  "horsera-agents": "C0AL668US2Z",
};

function getChannelId(channelName) {
  return KNOWN_CHANNELS[channelName] || null;
}

/**
 * Fetch today's messages from a Slack channel.
 * Returns a formatted string of the conversation, including all agents and Rossella.
 */
async function getTodaysChannelHistory(channelId, limit = 100) {
  try {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const oldest = (todayStart.getTime() / 1000).toString();

    const result = await app.client.conversations.history({
      channel: channelId,
      oldest,
      limit,
      inclusive: true,
    });

    if (!result.messages || result.messages.length === 0) return "";

    // Also fetch thread replies for any threaded messages
    const allMessages = [];
    for (const msg of result.messages.reverse()) { // reverse to chronological order
      allMessages.push(msg);
      if (msg.reply_count > 0) {
        try {
          const threadResult = await app.client.conversations.replies({
            channel: channelId,
            ts: msg.ts,
            oldest,
            limit: 50,
          });
          // Skip the parent (already added), add replies
          for (const reply of (threadResult.messages || []).slice(1)) {
            allMessages.push(reply);
          }
        } catch {
          // skip thread fetch failures
        }
      }
    }

    // Format messages into readable context
    const lines = [];
    for (const msg of allMessages) {
      const time = new Date(parseFloat(msg.ts) * 1000).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
      const isBot = !!msg.bot_id;
      const text = msg.text || "";
      if (!text.trim()) continue;

      // Extract file attachments info
      const files = (msg.files || []).map(f => `[attached: ${f.name || f.title || "file"} — ${f.url_private || ""}]`).join(" ");

      if (isBot) {
        lines.push(`[${time}] Bot: ${text}${files ? " " + files : ""}`);
      } else {
        lines.push(`[${time}] Rossella: ${text}${files ? " " + files : ""}`);
      }
    }

    return lines.join("\n");
  } catch (err) {
    log("Failed to fetch channel history:", err.message);
    return "";
  }
}

/**
 * Get today's conversation context across all Horsera channels.
 * Gives Sage (or any agent) full awareness of what happened today.
 */
async function getTodaysContext() {
  const channels = ["horsera-social", "horsera-agents"];
  const sections = [];

  for (const chName of channels) {
    const chId = await getChannelId(chName);
    if (!chId) continue;
    const history = await getTodaysChannelHistory(chId);
    if (history) {
      sections.push(`--- #${chName} today ---\n${history}`);
    }
  }

  return sections.join("\n\n");
}

// ── Daily summary ──────────────────────────────────────────────────────────
// Save a summary of the day's conversations to Sage's memory at end of day.

let lastSummaryDate = null;

async function maybeSaveDailySummary() {
  const today = new Date().toISOString().slice(0, 10);
  if (lastSummaryDate === today) return; // already saved today

  const now = new Date();
  const hour = now.getHours();
  // Save summary after 11 PM
  if (hour < 23) return;

  lastSummaryDate = today;

  try {
    const context = await getTodaysContext();
    if (!context || context.length < 100) return; // not enough to summarize

    // Use Claude to summarize the day
    const summaryResponse = await callAnthropicWithRetry({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1024,
      system: "You are summarizing today's Slack conversations for the Horsera content team. Write a concise summary (3-8 bullet points) capturing: key decisions made, content approved/rejected, feedback given, action items, and any preferences expressed by Rossella. Be specific — include post titles, dates, and exact feedback. This summary will be saved to persistent memory for future sessions.",
      messages: [{ role: "user", content: `Summarize today's conversations:\n\n${context}` }],
    });

    const summary = summaryResponse.content.filter(b => b.type === "text").map(b => b.text).join("\n");
    if (summary) {
      await appendSageMemory(`Daily summary (${today}):\n${summary}`);
      log(`Saved daily summary for ${today}`);
    }
  } catch (err) {
    log("Failed to save daily summary:", err.message);
  }
}

// ── Conversation memory ──────────────────────────────────────────────────────
// Thread messages use threadTs as key. Channel-level messages use channelId as key.
// Agents share context within a channel — switching from Sage to Monty preserves history.

const conversationHistory = new Map(); // key -> { agent, messages[], lastActivity, agents[] }
const MAX_MESSAGES = 40;
const CHANNEL_CONTEXT_TIMEOUT = 60 * 60 * 1000; // 60 min — extended from 30 to retain more context

function getConversationKey(channelId, threadTs, isInThread) {
  return isInThread ? `thread:${threadTs}` : `channel:${channelId}`;
}

function getConversationContext(key) {
  const ctx = conversationHistory.get(key);
  if (!ctx) return null;
  // For channel-level convos, expire after timeout
  if (key.startsWith("channel:") && Date.now() - ctx.lastActivity > CHANNEL_CONTEXT_TIMEOUT) {
    conversationHistory.delete(key);
    return null;
  }
  return ctx;
}

function addToConversation(key, agent, role, content) {
  let ctx = conversationHistory.get(key);
  if (!ctx) {
    ctx = { agent, messages: [], lastActivity: Date.now(), agents: [] };
    conversationHistory.set(key, ctx);
  }
  ctx.messages.push({ role, content });
  ctx.lastActivity = Date.now();
  // Trim to last MAX_MESSAGES
  if (ctx.messages.length > MAX_MESSAGES) {
    ctx.messages = ctx.messages.slice(-MAX_MESSAGES);
  }
  // Track which agents participated
  if (!ctx.agents.includes(agent)) ctx.agents.push(agent);
  // Update current agent
  ctx.agent = agent;
}

/**
 * Get the full conversation context for a channel, including cross-agent history.
 * When Sage is called after Monty answered, Sage sees Monty's messages too.
 */
function getSharedChannelContext(channelId) {
  // Collect messages from both channel and thread contexts for this channel
  const allMessages = [];
  for (const [key, ctx] of conversationHistory) {
    if (key === `channel:${channelId}` || key.startsWith("thread:")) {
      // Check if this thread belongs to this channel (we store channelId in context)
      if (ctx.channelId === channelId || key === `channel:${channelId}`) {
        for (const msg of ctx.messages) {
          allMessages.push({ ...msg, agent: ctx.agent });
        }
      }
    }
  }
  return allMessages;
}

// ── Anthropic client ────────────────────────────────────────────────────────

const anthropic = new Anthropic({ apiKey: ANTHROPIC_API_KEY });

async function callAnthropicWithRetry(params, maxRetries = 3) {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await anthropic.messages.create(params);
    } catch (err) {
      if (err.status === 529 && attempt < maxRetries) {
        const delay = (attempt + 1) * 2000; // 2s, 4s, 6s
        log(`Anthropic 529 overloaded — retrying in ${delay}ms (attempt ${attempt + 1}/${maxRetries})`);
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }
      throw err;
    }
  }
}

// Friendly tool names for progress display
const TOOL_DISPLAY_NAMES = {
  move_card: "Moving Trello card",
  add_comment: "Adding Trello comment",
  create_card: "Creating Trello card",
  read_content_doc: "Reading the Google Doc",
  append_to_content_doc: "Writing to the Google Doc",
  read_sage_memory: "Loading memory",
  save_sage_memory: "Saving to memory",
  publish_to_linkedin: "Publishing to LinkedIn",
  read_slack_history: "Reading Slack history",
};

const MAX_TOOL_LOOPS = 30; // High safety limit — auto-continue handles the flow

async function callClaude(systemPrompt, messages, onProgress = null) {
  // Build an accumulating message history so tool calls chain properly
  let allMessages = [...messages];

  let response = await callAnthropicWithRetry({
    model: "claude-sonnet-4-20250514",
    max_tokens: 4096,
    system: systemPrompt,
    messages: allMessages,
    tools: TRELLO_TOOLS,
  });

  let loopCount = 0;
  while (response.stop_reason === "tool_use") {
    loopCount++;
    if (loopCount > MAX_TOOL_LOOPS) {
      log("Tool loop hard limit reached — forcing completion");
      // Ask Claude to wrap up without tools
      allMessages.push({ role: "assistant", content: response.content });
      allMessages.push({ role: "user", content: [{ type: "text", text: "You've used many tool calls. Please provide your final response now without any more tool calls." }] });
      response = await callAnthropicWithRetry({
        model: "claude-sonnet-4-20250514",
        max_tokens: 4096,
        system: systemPrompt,
        messages: allMessages,
      });
      break;
    }

    const assistantContent = response.content;
    const toolUseBlocks = assistantContent.filter((b) => b.type === "tool_use");

    // Execute each tool call
    const toolResults = [];
    for (const toolUse of toolUseBlocks) {
      const displayName = TOOL_DISPLAY_NAMES[toolUse.name] || toolUse.name;
      if (onProgress) await onProgress(displayName);

      const handler = TRELLO_TOOL_HANDLERS[toolUse.name];
      let result;
      if (handler) {
        try {
          result = await handler(toolUse.input);
          log(`Tool [${loopCount}] ${toolUse.name} succeeded:`, JSON.stringify(result).slice(0, 200));
        } catch (err) {
          log(`Tool [${loopCount}] ${toolUse.name} failed:`, err.message);
          result = { success: false, error: err.message };
        }
      } else {
        result = { success: false, error: `Unknown tool: ${toolUse.name}` };
      }
      toolResults.push({
        type: "tool_result",
        tool_use_id: toolUse.id,
        content: JSON.stringify(result),
      });
    }

    // Accumulate messages so Claude has full history
    allMessages.push({ role: "assistant", content: assistantContent });
    allMessages.push({ role: "user", content: toolResults });

    if (onProgress) await onProgress("Thinking");

    response = await callAnthropicWithRetry({
      model: "claude-sonnet-4-20250514",
      max_tokens: 4096,
      system: systemPrompt,
      messages: allMessages,
      tools: TRELLO_TOOLS,
    });
  }

  // Extract final text
  const textBlocks = response.content.filter((b) => b.type === "text");
  return textBlocks.map((b) => b.text).join("\n");
}

// ── Slack app ───────────────────────────────────────────────────────────────

const app = new App({
  token: SLACK_BOT_TOKEN,
  appToken: SLACK_APP_TOKEN,
  socketMode: true,
  clientOptions: {
    slackApiUrl: "https://slack.com/api/",
  },
  socketModePingInterval: 30000,
  socketModePingTimeout: 15000,
});

// Cache for channel name lookups
const channelNameCache = new Map();

async function getChannelName(channelId) {
  if (channelNameCache.has(channelId)) return channelNameCache.get(channelId);
  try {
    const info = await app.client.conversations.info({ channel: channelId });
    const name = info.channel?.name || null;
    channelNameCache.set(channelId, name);
    return name;
  } catch {
    return null;
  }
}

// Listen for all messages (including in threads)
app.event("message", async ({ event, context }) => {
  let thinkingMsg = null;
  try {
    // Ignore bot messages, message_changed, etc. (but allow file_share — user uploading images)
    if (event.subtype && event.subtype !== "file_share") return;
    // Ignore messages from the bot itself
    if (event.bot_id || event.user === context.botUserId) return;

    // Build text content — include file attachment info
    let text = event.text || "";
    const files = (event.files || []).map(f => ({
      name: f.name || f.title || "file",
      url: f.url_private || f.url_private_download || "",
      mimetype: f.mimetype || "",
    }));
    if (files.length > 0) {
      const fileInfo = files.map(f => `[attached file: ${f.name} (${f.mimetype}) — ${f.url}]`).join("\n");
      text = text ? `${text}\n${fileInfo}` : fileInfo;
    }
    if (!text.trim()) return;

    const channelId = event.channel;
    const isInThread = !!event.thread_ts; // true only if the user's message is already in a thread
    const threadTs = event.thread_ts || event.ts;
    const channelName = await getChannelName(channelId);

    // Determine conversation key and existing context
    const convKey = getConversationKey(channelId, threadTs, isInThread);
    const existingCtx = getConversationContext(convKey);
    let agentKey;

    // Check if user explicitly names an agent
    const explicitAgent = AGENT_KEYWORDS.some(({ pattern }) => pattern.test(text));

    if (explicitAgent) {
      // User named an agent — route to them but KEEP the conversation context
      agentKey = detectAgent(text, channelName);
      // Don't wipe history — the new agent inherits it
    } else if (existingCtx) {
      const channelDefault = CHANNEL_DEFAULTS[channelName] || "ross";
      const timeSinceLastActivity = Date.now() - existingCtx.lastActivity;
      const isRecentConvo = timeSinceLastActivity < 10 * 60 * 1000; // 10 minutes (up from 5)

      if (existingCtx.agent !== channelDefault && !isRecentConvo) {
        // Non-default agent context expired — fall back to channel default
        agentKey = channelDefault;
      } else {
        // Continue with existing agent
        agentKey = existingCtx.agent;
      }
    } else {
      agentKey = detectAgent(text, channelName);
    }

    const agentName = agentKey.charAt(0).toUpperCase() + agentKey.slice(1);
    log(`#${channelName || channelId} | ${agentName} | "${text.slice(0, 80)}${text.length > 80 ? "..." : ""}"`);

    // Add user message to conversation history
    addToConversation(convKey, agentKey, "user", text);

    // Store channelId in thread contexts for cross-agent lookups
    const ctxRef = conversationHistory.get(convKey);
    if (ctxRef) ctxRef.channelId = channelId;

    // Build messages array from conversation history
    const ctx = getConversationContext(convKey);

    // For Sage (and Monty), inject memory + today's Slack history into system prompt
    let systemPrompt = AGENTS[agentKey];
    const isSageOrMonty = agentKey === "sage" || agentKey === "monty";
    if (isSageOrMonty) {
      try {
        // Load persistent memory
        const memory = await readSageMemory();
        if (memory) {
          systemPrompt += `\n\n--- Sage's Memory (from prior sessions) ---\n${memory}`;
        }

        // Load today's Slack conversation history for full context
        // Only on first message or if context was reset (avoids repeated API calls)
        if (ctx.messages.length <= 2) {
          const todaysContext = await getTodaysContext();
          if (todaysContext) {
            systemPrompt += `\n\n--- Today's Slack conversations (for context — do NOT repeat or re-process these, just use them to understand what's been discussed) ---\n${todaysContext}`;
            log(`Loaded today's Slack context (${todaysContext.length} chars) into ${agentKey} system prompt`);
          }
        }

        if (ctx.messages.length === 1) log(`Loaded memory into ${agentKey} system prompt`);
      } catch (err) {
        log(`Failed to load context for ${agentKey}:`, err.message);
      }

      // Try saving daily summary (no-op if not end of day)
      maybeSaveDailySummary().catch(err => log("Daily summary error:", err.message));
    }

    // Post a "thinking" message, then replace it with the real response
    const thinkingOpts = {
      channel: channelId,
      text: `_${agentName} is thinking..._`,
    };
    if (isInThread) {
      thinkingOpts.thread_ts = threadTs;
    }
    thinkingMsg = await app.client.chat.postMessage(thinkingOpts);

    // Progress callback — updates the thinking message with what Sage is doing
    const onProgress = async (status) => {
      try {
        await app.client.chat.update({
          channel: channelId,
          ts: thinkingMsg.ts,
          text: `_${agentName}: ${status}..._`,
        });
      } catch {
        // ignore update failures
      }
    };

    // Call Claude
    const reply = await callClaude(systemPrompt, ctx.messages, onProgress);

    // Add assistant reply to conversation history
    addToConversation(convKey, agentKey, "assistant", reply);

    // Replace the thinking message with the real response, prefixed with agent name
    const finalReply = reply?.trim() ? `*${agentName}:*  ${reply}` : `*${agentName}:*  Done! Let me know if you need anything else.`;
    await app.client.chat.update({
      channel: channelId,
      ts: thinkingMsg.ts,
      text: finalReply,
    });

    log(`${agentName} replied (${reply.length} chars)`);
  } catch (err) {
    log("Error handling message:", err.message);
    console.error(err);

    // Update the thinking message with the error (or post a new one if thinking wasn't sent)
    try {
      if (thinkingMsg?.ts) {
        await app.client.chat.update({
          channel: event.channel,
          ts: thinkingMsg.ts,
          text: `Sorry, I hit a temporary error. Please try again in a moment.`,
        });
      } else {
        await app.client.chat.postMessage({
          channel: event.channel,
          text: `Sorry, I hit a temporary error. Please try again in a moment.`,
        });
      }
    } catch {
      log("Failed to send error message to Slack");
    }
  }
});

// ── Morning content check ──────────────────────────────────────────────────
// Every morning, Sage reads the Google Doc, finds posts scheduled for today,
// and sends a summary to #horsera-social.

const MORNING_CHECK_HOUR = 8; // 8 AM ET
let lastMorningCheck = null;

async function morningContentCheck() {
  const now = new Date();
  const today = now.toISOString().slice(0, 10); // YYYY-MM-DD

  // Only run once per day
  if (lastMorningCheck === today) return;

  // Check if it's the right hour (ET = UTC-4 or UTC-5 depending on DST)
  const etHour = new Date(now.toLocaleString("en-US", { timeZone: "America/New_York" })).getHours();
  if (etHour < MORNING_CHECK_HOUR) return;

  lastMorningCheck = today;
  log("Running morning content check...");

  try {
    // Read the Google Doc
    const docContent = await readGoogleDocTab();

    // Parse today's date in various formats for matching
    const dateObj = new Date(today + "T12:00:00");
    const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
    const monthShort = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const month = dateObj.getMonth();
    const day = dateObj.getDate();
    const year = dateObj.getFullYear();

    // Match patterns like "March 29, 2026", "Mar 29", "Apr 1", "April 1, 2026"
    const datePatterns = [
      `${monthNames[month]} ${day}, ${year}`,
      `${monthNames[month]} ${day}`,
      `${monthShort[month]} ${day}`,
      `📅 ${monthNames[month]} ${day}`,
      `📅 ${monthShort[month]} ${day}`,
    ];

    const docText = docContent.text;
    const todayHasPost = datePatterns.some(p => docText.includes(p));

    if (!todayHasPost) {
      log("No posts scheduled for today");
      return;
    }

    // Use Claude to analyze the doc and create a morning summary
    const summaryPrompt = `You are Sage, the Horsera content manager. Read the content pipeline document below and find any posts scheduled for today (${monthNames[month]} ${day}, ${year}).

For each post scheduled today, check:
- Is it marked as "Approved" or "☑" or similar? → It's ready to publish. Send an FYI reminder.
- Is it marked as "Draft" or "☐" or has no approval? → It needs Rossella's input before publishing.

Write a concise Slack message for #horsera-social. Format:

If approved:
"☀️ *Good morning, Rossella!*

📋 *Today's content:*
• [Post title] — ✅ Approved and ready to publish. I'll publish this when you give the word.

Let me know when you'd like me to publish!"

If needs approval:
"☀️ *Good morning, Rossella!*

📋 *Today's content:*
• [Post title] — 📝 Draft, needs your review before publishing.

Here's the draft for your review:
[include the post text]

Want me to make any changes, or shall I publish as-is?"

Here's the document:

${docText}`;

    const response = await callAnthropicWithRetry({
      model: "claude-sonnet-4-20250514",
      max_tokens: 2048,
      system: "You are Sage, the Horsera social media manager. Be warm, concise, and professional. Use Slack mrkdwn formatting.",
      messages: [{ role: "user", content: summaryPrompt }],
    });

    const message = response.content.filter(b => b.type === "text").map(b => b.text).join("\n");

    if (!message) {
      log("Morning check produced no message");
      return;
    }

    // Known channel IDs (avoids needing conversations.list scope)
    const socialChannelId = ENV.SAGE_SLACK_CHANNEL_ID || "C0APGA93ESV"; // #horsera-social

    // Post the morning summary
    await app.client.chat.postMessage({
      channel: socialChannelId,
      text: `*Sage:*  ${message}`,
    });

    log(`Morning content check posted to #horsera-social`);
  } catch (err) {
    log("Morning content check failed:", err.message);
    console.error(err);
  }
}

// Run morning check every 5 minutes
setInterval(() => {
  morningContentCheck().catch(err => log("Morning check interval error:", err.message));
}, 5 * 60 * 1000);

// ── Start ───────────────────────────────────────────────────────────────────

(async () => {
  await app.start();
  log("Horsera bot is running (Socket Mode)");
  log("Agents available: " + Object.keys(AGENTS).join(", "));
  log("Channel defaults: " + JSON.stringify(CHANNEL_DEFAULTS));
  log("Listening for messages...");

  // Run morning check on startup (in case bot restarts after the check hour)
  // Reset lastMorningCheck so a fresh deploy always tries
  lastMorningCheck = null;
  setTimeout(() => {
    morningContentCheck().catch(err => log("Startup morning check error:", err.message));
  }, 10_000); // Wait 10s for connections to stabilize
})();
