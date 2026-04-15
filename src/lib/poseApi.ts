const DEFAULT_POSE_API = (
  typeof window !== 'undefined' && window.location.hostname === 'localhost'
    ? 'http://localhost:8000'
    : '/api/pose'
);

export const POSE_API_BASE = import.meta.env.VITE_POSE_API_URL ?? DEFAULT_POSE_API;

export interface SignedUploadResponse {
  upload_url: string;
  object_path: string;
  required_headers?: Record<string, string>;
}

export async function createVideoUploadUrl(filename: string, contentType: string, sizeBytes: number): Promise<SignedUploadResponse> {
  const response = await fetch(`${POSE_API_BASE}/uploads/video-url`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      filename,
      content_type: contentType || 'video/mp4',
      size_bytes: sizeBytes,
    }),
  });

  if (!response.ok) {
    throw new Error(`Failed to create upload URL: ${response.status} ${response.statusText}`);
  }

  const payload = await response.json() as SignedUploadResponse;
  if (!payload.upload_url || !payload.object_path) {
    throw new Error('Invalid upload URL response from Pose API');
  }
  return payload;
}

export async function uploadFileToSignedUrl(file: Blob, upload: SignedUploadResponse, onProgress?: (fraction: number) => void): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.timeout = 30 * 60 * 1000;
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && onProgress) {
        onProgress(event.loaded / event.total);
      }
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else reject(new Error(`Upload failed ${xhr.status}: ${xhr.responseText || xhr.statusText}`));
    };
    xhr.onerror = () => reject(new Error('Network error while uploading video'));
    xhr.ontimeout = () => reject(new Error('Upload timed out'));
    xhr.open('PUT', upload.upload_url);
    if (upload.required_headers) {
      Object.entries(upload.required_headers).forEach(([key, value]) => xhr.setRequestHeader(key, value));
    }
    xhr.send(file);
  });
}

export async function pinVideoObject(objectPath: string, filename: string, rideId?: string): Promise<string> {
  const response = await fetch(`${POSE_API_BASE}/videos/pin`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      object_path: objectPath,
      filename,
      ride_id: rideId,
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Failed to pin video: ${response.status} ${body || response.statusText}`);
  }

  const payload = await response.json() as { object_path?: string };
  if (!payload.object_path) {
    throw new Error('Pin response was missing object_path');
  }

  return payload.object_path;
}

export async function createVideoReadUrl(objectPath: string): Promise<{ readUrl: string; expiresAt: number }> {
  const response = await fetch(`${POSE_API_BASE}/videos/read-url`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ object_path: objectPath }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Failed to create read URL: ${response.status} ${body || response.statusText}`);
  }

  const payload = await response.json() as { read_url?: string; expires_in_seconds?: number };
  if (!payload.read_url) {
    throw new Error('Read URL response was missing read_url');
  }

  return {
    readUrl: payload.read_url,
    expiresAt: Date.now() + ((payload.expires_in_seconds ?? 900) * 1000),
  };
}
