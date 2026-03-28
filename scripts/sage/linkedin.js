/**
 * scripts/sage/linkedin.js
 *
 * LinkedIn publishing for Sage.
 * Posts to LinkedIn as "Horsera AI" using the personal profile token.
 *
 * Reads from .env.local:
 *   LINKEDIN_ACCESS_TOKEN  — OAuth2 access token
 *   LINKEDIN_PERSON_URN    — urn:li:person:xxx
 *   LINKEDIN_ORG_URN       — urn:li:organization:xxx (optional, for company page posts)
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

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
const ACCESS_TOKEN = ENV.LINKEDIN_ACCESS_TOKEN;
const PERSON_URN = ENV.LINKEDIN_PERSON_URN;
const ORG_URN = ENV.LINKEDIN_ORG_URN || null;

if (!ACCESS_TOKEN || !PERSON_URN) {
  throw new Error(
    "Missing LINKEDIN_ACCESS_TOKEN or LINKEDIN_PERSON_URN in .env.local — run: node scripts/linkedin-auth.js"
  );
}

const API_BASE = "https://api.linkedin.com";

async function linkedinFetch(endpoint, options = {}) {
  const res = await fetch(`${API_BASE}${endpoint}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${ACCESS_TOKEN}`,
      "Content-Type": "application/json",
      "LinkedIn-Version": "202402",
      "X-Restli-Protocol-Version": "2.0.0",
      ...options.headers,
    },
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`LinkedIn API ${res.status}: ${body}`);
  }

  // Some endpoints return 201 with no body
  const text = await res.text();
  return text ? JSON.parse(text) : { ok: true, status: res.status };
}

/**
 * Publish a text-only post to LinkedIn.
 *
 * @param {string} text — the post content
 * @param {object} options
 * @param {boolean} options.asOrg — post as the org page (requires LINKEDIN_ORG_URN + Community Management API)
 * @returns {object} LinkedIn API response
 */
export async function publishTextPost(text, { asOrg = false } = {}) {
  const author = asOrg && ORG_URN ? ORG_URN : PERSON_URN;

  const body = {
    author,
    lifecycleState: "PUBLISHED",
    specificContent: {
      "com.linkedin.ugc.ShareContent": {
        shareCommentary: { text },
        shareMediaCategory: "NONE",
      },
    },
    visibility: {
      "com.linkedin.ugc.MemberNetworkVisibility": "PUBLIC",
    },
  };

  const result = await linkedinFetch("/v2/ugcPosts", {
    method: "POST",
    body: JSON.stringify(body),
  });

  console.log(`✅ Published to LinkedIn as ${asOrg && ORG_URN ? "Horsera (org)" : "Horsera AI (personal)"}`);
  return result;
}

/**
 * Publish a post with a link/article preview.
 *
 * @param {string} text — the post commentary
 * @param {string} url — the link to share
 * @param {object} options
 * @param {string} options.title — link title override
 * @param {string} options.description — link description override
 * @param {boolean} options.asOrg — post as org
 * @returns {object} LinkedIn API response
 */
export async function publishLinkPost(text, url, { title, description, asOrg = false } = {}) {
  const author = asOrg && ORG_URN ? ORG_URN : PERSON_URN;

  const media = {
    status: "READY",
    originalUrl: url,
  };
  if (title) media.title = { text: title };
  if (description) media.description = { text: description };

  const body = {
    author,
    lifecycleState: "PUBLISHED",
    specificContent: {
      "com.linkedin.ugc.ShareContent": {
        shareCommentary: { text },
        shareMediaCategory: "ARTICLE",
        media: [media],
      },
    },
    visibility: {
      "com.linkedin.ugc.MemberNetworkVisibility": "PUBLIC",
    },
  };

  const result = await linkedinFetch("/v2/ugcPosts", {
    method: "POST",
    body: JSON.stringify(body),
  });

  console.log(`✅ Published link post to LinkedIn`);
  return result;
}

/**
 * Upload an image to LinkedIn and return the asset URN.
 *
 * @param {Buffer} imageBuffer — raw image bytes
 * @returns {string} asset URN (e.g., urn:li:digitalmediaAsset:xxx)
 */
export async function uploadImage(imageBuffer) {
  const registerBody = {
    registerUploadRequest: {
      recipes: ["urn:li:digitalmediaRecipe:feedshare-image"],
      owner: PERSON_URN,
      serviceRelationships: [
        { relationshipType: "OWNER", identifier: "urn:li:userGeneratedContent" },
      ],
    },
  };

  const regResult = await linkedinFetch("/v2/assets?action=registerUpload", {
    method: "POST",
    body: JSON.stringify(registerBody),
  });

  const uploadUrl = regResult.value.uploadMechanism["com.linkedin.digitalmedia.uploading.MediaUploadHttpRequest"].uploadUrl;
  const asset = regResult.value.asset;

  const uploadRes = await fetch(uploadUrl, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${ACCESS_TOKEN}`,
      "Content-Type": "application/octet-stream",
    },
    body: imageBuffer,
  });

  if (!uploadRes.ok) {
    const errBody = await uploadRes.text();
    throw new Error(`LinkedIn image upload ${uploadRes.status}: ${errBody}`);
  }

  return asset;
}

/**
 * Publish a post with an image.
 *
 * @param {string} text — the post commentary
 * @param {Buffer} imageBuffer — raw image bytes
 * @param {object} options
 * @param {boolean} options.asOrg — post as org
 * @returns {object} LinkedIn API response
 */
export async function publishImagePost(text, imageBuffer, { asOrg = false } = {}) {
  const author = asOrg && ORG_URN ? ORG_URN : PERSON_URN;
  const asset = await uploadImage(imageBuffer);

  const body = {
    author,
    lifecycleState: "PUBLISHED",
    specificContent: {
      "com.linkedin.ugc.ShareContent": {
        shareCommentary: { text },
        shareMediaCategory: "IMAGE",
        media: [{ status: "READY", media: asset }],
      },
    },
    visibility: {
      "com.linkedin.ugc.MemberNetworkVisibility": "PUBLIC",
    },
  };

  const result = await linkedinFetch("/v2/ugcPosts", {
    method: "POST",
    body: JSON.stringify(body),
  });

  console.log(`✅ Published image post to LinkedIn`);
  return result;
}

/**
 * Get the current user's LinkedIn profile info.
 * Useful for verifying the token still works.
 */
export async function getProfile() {
  return linkedinFetch("/v2/userinfo");
}

/**
 * Check if the access token is still valid.
 * Returns { valid: true, name, sub } or { valid: false, error }.
 */
export async function checkToken() {
  try {
    const profile = await getProfile();
    return { valid: true, name: profile.name, sub: profile.sub };
  } catch (err) {
    return { valid: false, error: err.message };
  }
}
