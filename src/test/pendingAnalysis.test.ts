import { beforeEach, describe, expect, it } from 'vitest';
import {
  clearCompletedPendingAnalysisSessions,
  getPendingAnalysisSessions,
  markPendingAnalysisComplete,
  resetPendingAnalysisSessionsForTest,
  updatePendingAnalysisSession,
  upsertPendingAnalysisSession,
} from '../lib/pendingAnalysis';

describe('pending analysis sessions', () => {
  beforeEach(() => {
    resetPendingAnalysisSessionsForTest();
  });

  it('creates and updates a preview-ready pending job', () => {
    upsertPendingAnalysisSession({
      id: 'job-1',
      status: 'processing',
      videoFileName: 'training.mp4',
      videoObjectPath: 'uploads/job-1/training.mp4',
      poseJobId: 'job-1',
      createdAt: 1000,
    });

    updatePendingAnalysisSession('job-1', {
      status: 'preview-ready',
      previewUpdatedAt: 2000,
    });

    expect(getPendingAnalysisSessions()).toEqual([
      {
        id: 'job-1',
        status: 'preview-ready',
        videoFileName: 'training.mp4',
        videoObjectPath: 'uploads/job-1/training.mp4',
        poseJobId: 'job-1',
        createdAt: 1000,
        previewUpdatedAt: 2000,
        finalRideId: undefined,
      },
    ]);
  });

  it('marks a pending job complete and clears completed sessions', () => {
    upsertPendingAnalysisSession({
      id: 'job-2',
      status: 'processing',
      videoFileName: 'lesson.mov',
      videoObjectPath: 'uploads/job-2/lesson.mov',
      poseJobId: 'job-2',
      createdAt: 1000,
    });

    markPendingAnalysisComplete('job-2', 'ride-2');

    expect(getPendingAnalysisSessions()[0]).toMatchObject({
      id: 'job-2',
      status: 'complete',
      finalRideId: 'ride-2',
    });

    clearCompletedPendingAnalysisSessions();

    expect(getPendingAnalysisSessions()).toEqual([]);
  });
});
