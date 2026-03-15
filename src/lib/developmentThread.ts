// ─── Types ───────────────────────────────────────────────────────────────────

export type EntryType = "learn" | "ride" | "assess" | "adjust" | "achieve" | "evidence";

export interface ThreadEntry {
  id: string;
  type: EntryType;
  date: string;
  title: string;
  description?: string;
  // Ride-specific
  reflection?: string;
  duration?: string;
  location?: string;
  skillRatings?: Record<string, number>; // 1-5 scale
  // Assess-specific
  source?: "AI" | "trainer";
  insight?: string;
  // Adjust-specific
  recommendation?: string;
  // Trainer feedback
  trainerName?: string;
  trainerNote?: string;
  validated?: boolean;
  // ─── Journey Connections ───
  informedBy?: string[];       // IDs of learn/adjust entries that informed this ride
  practicedExercises?: string[]; // exercise IDs practiced during this ride
  ledToProgress?: {            // skill progress this entry contributed to
    skill: string;
    from: number;
    to: number;
  }[];
}

export interface SkillTrajectory {
  name: string;
  dataPoints: { date: string; score: number }[]; // 1-5
  trend: "improving" | "plateau" | "declining";
  latestNote?: string;
}

export interface DevelopmentThread {
  id: string;
  goal: string;
  status: "active" | "completed";
  skills: string[];
  startDate: string;
  completedDate?: string;
  entries: ThreadEntry[];
  skillTrajectories: SkillTrajectory[];
  nextAction: {
    type: "ride" | "learn" | "review";
    title: string;
    rationale: string;
  };
  validationSource?: string;
}

// ─── Journey Chain Helper ────────────────────────────────────────────────────

export interface JourneyChain {
  learned: ThreadEntry;
  practiced: ThreadEntry;
  improved: { skill: string; from: number; to: number };
}

export function getJourneyChains(thread: DevelopmentThread): JourneyChain[] {
  const chains: JourneyChain[] = [];
  const entryMap = new Map(thread.entries.map((e) => [e.id, e]));

  for (const entry of thread.entries) {
    if (entry.type === "ride" && entry.informedBy && entry.ledToProgress) {
      for (const learnId of entry.informedBy) {
        const learnEntry = entryMap.get(learnId);
        if (!learnEntry) continue;
        for (const progress of entry.ledToProgress) {
          chains.push({
            learned: learnEntry,
            practiced: entry,
            improved: progress,
          });
        }
      }
    }
  }
  return chains;
}

// ─── Mock Data ───────────────────────────────────────────────────────────────

export const activeThread: DevelopmentThread = {
  id: "thread-1",
  goal: "Balanced Canter Transitions",
  status: "active",
  skills: ["Half-halt timing", "Core engagement", "Rhythm control"],
  startDate: "Jan 28",
  entries: [
    {
      id: "e1",
      type: "learn",
      date: "Jan 28",
      title: "Seat & Balance lesson",
      description: "Independent seat foundations for canter work",
    },
    {
      id: "e2",
      type: "ride",
      date: "Jan 30",
      title: "Arena session",
      duration: "35 min",
      location: "Indoor arena",
      reflection: "First attempt at walk-canter. Lost rhythm after 2nd transition.",
      skillRatings: { "Half-halt timing": 2, "Core engagement": 2, "Rhythm control": 3 },
      informedBy: ["e1"],
      practicedExercises: ["pe1"],
      ledToProgress: [
        { skill: "Rhythm control", from: 0, to: 3 },
      ],
    },
    {
      id: "e3",
      type: "assess",
      date: "Jan 31",
      source: "AI",
      title: "AI analysis",
      insight: "Rhythm breaks correlate with loss of core engagement mid-transition. Half-halt timing is late by ~1 stride.",
    },
    {
      id: "e4",
      type: "adjust",
      date: "Jan 31",
      title: "Training adjustment",
      recommendation: "Focus on half-halt 2 strides earlier. Add 5-min core prep before mounting.",
    },
    {
      id: "e5",
      type: "ride",
      date: "Feb 3",
      title: "Arena session",
      duration: "40 min",
      location: "Indoor arena",
      reflection: "Earlier half-halts helped. Core prep made a noticeable difference. Still losing balance in 3rd transition.",
      skillRatings: { "Half-halt timing": 3, "Core engagement": 3, "Rhythm control": 3 },
      informedBy: ["e1", "e4"],
      practicedExercises: ["pe1", "pe3"],
      ledToProgress: [
        { skill: "Half-halt timing", from: 2, to: 3 },
        { skill: "Core engagement", from: 2, to: 3 },
      ],
    },
    {
      id: "e5b",
      type: "learn",
      date: "Feb 5",
      title: "The Half-Halt Explained",
      description: "Deepened understanding of half-halt timing and coordination",
    },
    {
      id: "e6",
      type: "ride",
      date: "Feb 7",
      title: "Arena session",
      duration: "42 min",
      location: "Indoor arena",
      reflection: "Better rhythm, lost balance in 3rd transition. Shorter sets felt more controlled.",
      skillRatings: { "Half-halt timing": 3, "Core engagement": 3, "Rhythm control": 4 },
      trainerName: "Emma",
      trainerNote: "Good progress. Try adding a 3rd rep next session.",
      informedBy: ["e5b", "e4"],
      practicedExercises: ["pe5", "pe3"],
      ledToProgress: [
        { skill: "Rhythm control", from: 3, to: 4 },
      ],
    },
    {
      id: "e7",
      type: "assess",
      date: "Feb 8",
      source: "AI",
      title: "Progress review",
      insight: "Rhythm improving steadily over 3 rides. Core engagement plateauing — consider targeted exercises.",
    },
    {
      id: "e8",
      type: "adjust",
      date: "Feb 8",
      title: "Updated plan",
      recommendation: "Shorten canter sets to 2 reps, add core prep exercises. Try 3rd rep only when first 2 feel stable.",
    },
  ],
  skillTrajectories: [
    {
      name: "Half-halt timing",
      dataPoints: [
        { date: "Jan 30", score: 2 },
        { date: "Feb 3", score: 3 },
        { date: "Feb 7", score: 3 },
      ],
      trend: "improving",
      latestNote: "Timing earlier by ~1 stride since adjustment",
    },
    {
      name: "Core engagement",
      dataPoints: [
        { date: "Jan 30", score: 2 },
        { date: "Feb 3", score: 3 },
        { date: "Feb 7", score: 3 },
      ],
      trend: "plateau",
      latestNote: "Plateau after initial gain — targeted exercises recommended",
    },
    {
      name: "Rhythm control",
      dataPoints: [
        { date: "Jan 30", score: 3 },
        { date: "Feb 3", score: 3 },
        { date: "Feb 7", score: 4 },
      ],
      trend: "improving",
      latestNote: "Consistent improvement, strongest skill in this goal",
    },
  ],
  nextAction: {
    type: "ride",
    title: "Practice shorter canter sets — 2 reps with core prep",
    rationale: "Your last ride showed core fatigue after rep 2. Shorter sets with prep should build endurance gradually.",
  },
};

export const completedThread: DevelopmentThread = {
  id: "thread-0",
  goal: "Walk–Trot Transitions",
  status: "completed",
  skills: ["Rhythm consistency", "Leg aids", "Rein contact"],
  startDate: "Dec 10",
  completedDate: "Jan 25",
  entries: [
    { id: "c1", type: "learn", date: "Dec 10", title: "Basics of transitions", description: "Foundation concepts for clean gait changes" },
    {
      id: "c2", type: "ride", date: "Dec 14", title: "First practice", duration: "30 min", location: "Arena",
      reflection: "Rough transitions, improving by end.",
      informedBy: ["c1"],
      ledToProgress: [
        { skill: "Rhythm consistency", from: 0, to: 3 },
        { skill: "Leg aids", from: 0, to: 2 },
      ],
    },
    { id: "c3", type: "assess", date: "Dec 16", source: "trainer", title: "Trainer review", trainerName: "Emma", insight: "Needs softer hands during upward transition." },
    {
      id: "c4", type: "ride", date: "Dec 20", title: "Follow-up session", duration: "35 min", location: "Arena",
      reflection: "Much smoother with softer contact.",
      informedBy: ["c1", "c3"],
      ledToProgress: [
        { skill: "Rein contact", from: 2, to: 3 },
        { skill: "Leg aids", from: 2, to: 4 },
      ],
    },
    { id: "c5", type: "achieve", date: "Jan 25", title: "Goal validated", description: "Trainer-confirmed mastery", validated: true, trainerName: "Emma" },
  ],
  skillTrajectories: [
    { name: "Rhythm consistency", dataPoints: [{ date: "Dec 14", score: 3 }, { date: "Dec 20", score: 4 }, { date: "Jan 25", score: 5 }], trend: "improving" },
    { name: "Leg aids", dataPoints: [{ date: "Dec 14", score: 2 }, { date: "Dec 20", score: 4 }, { date: "Jan 25", score: 5 }], trend: "improving" },
    { name: "Rein contact", dataPoints: [{ date: "Dec 14", score: 2 }, { date: "Dec 20", score: 3 }, { date: "Jan 25", score: 5 }], trend: "improving" },
  ],
  nextAction: { type: "review", title: "Completed", rationale: "" },
  validationSource: "Trainer Emma — video review Jan 25",
};

// Helper to get the latest trainer feedback from any thread
export function getLatestTrainerFeedback(thread: DevelopmentThread): ThreadEntry | undefined {
  return [...thread.entries].reverse().find((e) => e.trainerNote);
}

// Helper to get ride entries
export function getRideEntries(thread: DevelopmentThread): ThreadEntry[] {
  return thread.entries.filter((e) => e.type === "ride");
}

// Entry type display config
export const entryTypeConfig: Record<EntryType, { label: string; color: string; icon: string }> = {
  learn: { label: "Learn", color: "bg-blue-500", icon: "📖" },
  ride: { label: "Ride", color: "bg-primary", icon: "🐴" },
  assess: { label: "Assess", color: "bg-warmth", icon: "🔍" },
  adjust: { label: "Adjust", color: "bg-accent", icon: "🔧" },
  achieve: { label: "Achieve", color: "bg-yellow-500", icon: "🏆" },
  evidence: { label: "Evidence", color: "bg-violet-500", icon: "🎥" },
};
