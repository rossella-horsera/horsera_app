import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import VideoWithSkeleton from '../components/VideoWithSkeleton';
import { createVideoReadUrl, POSE_API_BASE } from '../lib/poseApi';
import type { TimestampedFrame, VideoAnalysisResult } from '../hooks/useVideoAnalysis';

type Biometrics = VideoAnalysisResult['biometrics'];

interface PoseJobFrameData {
  frame_time?: number;
  detected?: boolean;
  sample_index?: number;
  source_frame_index?: number;
  keypoints?: [number, number, number][] | null;
}

interface PoseJobResult {
  biometrics?: Biometrics;
  sampleIntervalSec?: number;
  framesData?: PoseJobFrameData[];
}

interface PoseJobResponse {
  status?: string;
  stage?: string;
  error?: string | null;
  object_path?: string | null;
  completed_at?: number;
  result?: PoseJobResult | null;
}

const POLL_MS = 3000;

const EMPTY_BIOMETRICS: Biometrics = {
  lowerLegStability: 0,
  reinSteadiness: 0,
  reinSymmetry: 0,
  coreStability: 0,
  upperBodyAlignment: 0,
  pelvisStability: 0,
};

function mapFrames(result?: PoseJobResult | null): TimestampedFrame[] {
  const sampleIntervalSec = typeof result?.sampleIntervalSec === 'number' ? result.sampleIntervalSec : undefined;
  return (result?.framesData ?? []).map((frame) => ({
    time: frame.frame_time ?? 0,
    detected: frame.detected,
    sampleIndex: frame.sample_index,
    sourceFrameIndex: frame.source_frame_index,
    sampleIntervalSec,
    frame: Array.isArray(frame.keypoints)
      ? frame.keypoints.map(([x, y, score]) => ({ x, y, score }))
      : null,
  }));
}

function formatCompletedAt(epochSeconds?: number): string | null {
  if (typeof epochSeconds !== 'number' || !Number.isFinite(epochSeconds) || epochSeconds <= 0) {
    return null;
  }
  return new Date(epochSeconds * 1000).toLocaleString();
}

function statusHeadline(job?: PoseJobResponse | null): string {
  if (!job) return 'Loading job';
  if (job.status === 'complete') return 'Overlay ready';
  if (job.status === 'failed') return 'Analysis failed';
  if (job.status === 'processing') return 'Analysis still running';
  if (job.status === 'pending') return 'Queued for analysis';
  return 'Loading job';
}

export default function JobOverlayViewerPage() {
  const { jobId = '' } = useParams();
  const [job, setJob] = useState<PoseJobResponse | null>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle');

  const keyframes = useMemo(() => mapFrames(job?.result), [job]);
  const biometrics = job?.result?.biometrics ?? EMPTY_BIOMETRICS;
  const completedAtLabel = formatCompletedAt(job?.completed_at);
  const viewerUrl = typeof window === 'undefined'
    ? `#/jobs/${jobId}/view`
    : `${window.location.origin}${window.location.pathname}#/jobs/${jobId}/view`;

  useEffect(() => {
    if (!jobId) {
      setError('Missing job id');
      setIsLoading(false);
      return;
    }

    let cancelled = false;
    let pollTimer: number | null = null;

    const clearPoll = () => {
      if (pollTimer !== null) {
        window.clearTimeout(pollTimer);
        pollTimer = null;
      }
    };

    const loadJob = async () => {
      try {
        const response = await fetch(`${POSE_API_BASE}/jobs/${jobId}`);
        if (!response.ok) {
          throw new Error(`Failed to load pose job ${jobId}: ${response.status} ${response.statusText}`);
        }

        const nextJob = await response.json() as PoseJobResponse;
        if (cancelled) return;

        setJob(nextJob);
        setError(null);

        if (nextJob.status === 'complete') {
          if (!nextJob.object_path) {
            throw new Error('Completed job is missing object_path, so the video cannot be reopened.');
          }
          const { readUrl } = await createVideoReadUrl(nextJob.object_path);
          if (cancelled) return;
          setVideoUrl(readUrl);
          return;
        }

        setVideoUrl(null);

        if (nextJob.status === 'failed') {
          setError(nextJob.error || 'Analysis failed before a viewable result was produced.');
          return;
        }

        if (nextJob.status === 'pending' || nextJob.status === 'processing') {
          pollTimer = window.setTimeout(() => {
            void loadJob();
          }, POLL_MS);
        }
      } catch (loadError) {
        if (cancelled) return;
        setError(loadError instanceof Error ? loadError.message : 'Failed to load pose job.');
        setVideoUrl(null);
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    };

    void loadJob();

    return () => {
      cancelled = true;
      clearPoll();
    };
  }, [jobId]);

  return (
    <div style={{
      minHeight: '100dvh',
      background: 'linear-gradient(180deg, #f7f3ee 0%, #efe6d8 100%)',
      padding: '32px 20px 48px',
    }}>
      <div style={{
        maxWidth: 1080,
        margin: '0 auto',
        display: 'grid',
        gap: 20,
      }}>
        <div style={{
          background: 'rgba(255,255,255,0.82)',
          border: '1px solid rgba(61,43,33,0.08)',
          borderRadius: 24,
          padding: '24px 24px 20px',
          boxShadow: '0 18px 40px rgba(34, 22, 14, 0.08)',
          backdropFilter: 'blur(16px)',
        }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'grid', gap: 8 }}>
              <span style={{
                fontSize: 12,
                letterSpacing: '0.28em',
                textTransform: 'uppercase',
                color: '#b67843',
                fontWeight: 700,
              }}>
                Pose Job Viewer
              </span>
              <h1 style={{
                margin: 0,
                fontSize: 32,
                lineHeight: 1.05,
                color: '#2f241b',
                fontWeight: 600,
              }}>
                {statusHeadline(job)}
              </h1>
              <div style={{ color: '#6f6054', fontSize: 14 }}>
                Job <code style={{ fontSize: '0.95em' }}>{jobId}</code>
                {completedAtLabel ? ` · completed ${completedAtLabel}` : ''}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <Link
                to="/"
                style={{
                  textDecoration: 'none',
                  padding: '11px 16px',
                  borderRadius: 999,
                  background: '#fff',
                  color: '#3d2b21',
                  border: '1px solid rgba(61,43,33,0.12)',
                  fontWeight: 600,
                }}
              >
                Back to rides
              </Link>
              <button
                type="button"
                onClick={() => {
                  if (!navigator.clipboard) {
                    setCopyState('failed');
                    return;
                  }
                  void navigator.clipboard.writeText(viewerUrl)
                    .then(() => setCopyState('copied'))
                    .catch(() => setCopyState('failed'));
                }}
                style={{
                  padding: '11px 16px',
                  borderRadius: 999,
                  background: '#d59a61',
                  color: '#fff',
                  fontWeight: 600,
                  border: 'none',
                  cursor: 'pointer',
                }}
              >
                {copyState === 'copied' ? 'Copied direct link' : copyState === 'failed' ? 'Copy failed' : 'Copy direct link'}
              </button>
            </div>
          </div>

          <div style={{
            marginTop: 16,
            display: 'flex',
            flexWrap: 'wrap',
            gap: 10,
          }}>
            <div style={{
              padding: '8px 12px',
              borderRadius: 999,
              background: 'rgba(213,154,97,0.14)',
              color: '#8c5a33',
              fontSize: 13,
              fontWeight: 600,
            }}>
              Status: {job?.status ?? 'loading'}
            </div>
            <div style={{
              padding: '8px 12px',
              borderRadius: 999,
              background: 'rgba(61,43,33,0.06)',
              color: '#5d4b3d',
              fontSize: 13,
            }}>
              Pose samples: {keyframes.length}
            </div>
            <div style={{
              padding: '8px 12px',
              borderRadius: 999,
              background: 'rgba(61,43,33,0.06)',
              color: '#5d4b3d',
              fontSize: 13,
              maxWidth: '100%',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}>
              Viewer URL: {viewerUrl}
            </div>
            {job?.object_path ? (
              <div style={{
                padding: '8px 12px',
                borderRadius: 999,
                background: 'rgba(61,43,33,0.06)',
                color: '#5d4b3d',
                fontSize: 13,
                maxWidth: '100%',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}>
                Video source: {job.object_path}
              </div>
            ) : null}
          </div>
        </div>

        <div style={{
          background: '#1a120c',
          borderRadius: 28,
          padding: 18,
          boxShadow: '0 24px 50px rgba(26,18,12,0.16)',
        }}>
          {videoUrl ? (
            <VideoWithSkeleton videoUrl={videoUrl} keyframes={keyframes} biometrics={biometrics} />
          ) : (
            <div style={{
              minHeight: 360,
              borderRadius: 20,
              display: 'grid',
              placeItems: 'center',
              padding: 24,
              textAlign: 'center',
              color: '#f4ede5',
              background: 'linear-gradient(145deg, rgba(70,48,35,0.85), rgba(25,18,13,0.95))',
            }}>
              <div style={{ maxWidth: 540 }}>
                <div style={{ fontSize: 24, fontWeight: 600, marginBottom: 10 }}>
                  {statusHeadline(job)}
                </div>
                <div style={{ color: 'rgba(244,237,229,0.76)', lineHeight: 1.6 }}>
                  {error
                    ? error
                    : isLoading
                      ? 'Fetching the job, result payload, and original video.'
                      : 'This page will keep polling until the backend job finishes, then swap in the overlay player automatically.'}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
