// ─── Learning Content Types ──────────────────────────────────────────────────

export type ContentType = "lesson" | "exercise-on-saddle" | "exercise-off-saddle" | "clinic" | "explanation";
export type SkillDomain = "position" | "balance" | "aids" | "flatwork" | "jumping" | "groundwork" | "fitness" | "mental";
export type Discipline = "dressage" | "jumping" | "eventing" | "general" | "western";
export type RecommendationSource = "trainer" | "ai" | "system";

export interface LearningItem {
  id: string;
  type: ContentType;
  title: string;
  description: string;
  duration: string;
  skillDomains: SkillDomain[];
  linkedGoals: string[]; // goal names from DevelopmentThread
  linkedSkills: string[]; // specific skill names
  difficulty: "beginner" | "intermediate" | "advanced";
  discipline: Discipline;
  source?: string; // e.g. "YouTube", "Trainer Emma", "Horsera"
  url?: string; // external link
  trainerRecommended?: boolean;
  trainerName?: string;
  steps?: string[]; // for exercises
  keyTakeaways?: string[];
  recommended?: boolean; // contextually recommended based on active thread
  recommendationReason?: string;
}

// ─── Browse Categories ───────────────────────────────────────────────────────

export interface BrowseCategory {
  id: string;
  label: string;
  icon: string;
  filter: (item: LearningItem) => boolean;
}

export const browseCategories: BrowseCategory[] = [
  { id: "canter", label: "Canter Control", icon: "🐴", filter: (i) => i.linkedSkills.some((s) => s.toLowerCase().includes("canter") || s.toLowerCase().includes("rhythm")) || i.linkedGoals.some((g) => g.toLowerCase().includes("canter")) },
  { id: "balance", label: "Balance & Position", icon: "⚖️", filter: (i) => i.skillDomains.includes("balance") || i.skillDomains.includes("position") },
  { id: "aids", label: "Aids & Communication", icon: "🤝", filter: (i) => i.skillDomains.includes("aids") },
  { id: "fitness", label: "Rider Fitness", icon: "💪", filter: (i) => i.skillDomains.includes("fitness") },
  { id: "flatwork", label: "Flatwork Fundamentals", icon: "🔄", filter: (i) => i.skillDomains.includes("flatwork") },
  { id: "mental", label: "Mental Game", icon: "🧠", filter: (i) => i.skillDomains.includes("mental") },
];

// ─── Trainer Recommendation ──────────────────────────────────────────────────

export interface TrainerRecommendation {
  id: string;
  itemId: string; // references LearningItem.id
  trainerName: string;
  date: string;
  note: string; // trainer's personal note on why this is recommended
  priority: "required" | "suggested";
  attachedTo: {
    type: "goal" | "milestone" | "ride";
    name: string;
  };
}

// Mock trainer recommendations
export const trainerRecommendations: TrainerRecommendation[] = [
  {
    id: "tr1",
    itemId: "l1",
    trainerName: "Emma",
    date: "Feb 8",
    note: "Sarah, your core is the bottleneck right now. Do this 3x this week before we meet on Thursday.",
    priority: "required",
    attachedTo: { type: "goal", name: "Balanced Canter Transitions" },
  },
  {
    id: "tr2",
    itemId: "l2",
    trainerName: "Emma",
    date: "Feb 8",
    note: "Re-read this before your next ride. Your timing is getting better but the concept needs to click deeper.",
    priority: "suggested",
    attachedTo: { type: "ride", name: "Arena session — Feb 7" },
  },
  {
    id: "tr3",
    itemId: "l3",
    trainerName: "Emma",
    date: "Feb 7",
    note: "Use this exact drill in your next 2 sessions. Stick to 2 reps max — don't push to 3 yet.",
    priority: "required",
    attachedTo: { type: "milestone", name: "Half-halt timing" },
  },
  {
    id: "tr4",
    itemId: "l5",
    trainerName: "Emma",
    date: "Feb 5",
    note: "Your hip flexors are restricting your seat. This will help — try it on rest days.",
    priority: "suggested",
    attachedTo: { type: "goal", name: "Balanced Canter Transitions" },
  },
];

// Helper: get trainer recommendation for an item
export function getTrainerRecForItem(itemId: string): TrainerRecommendation | undefined {
  return trainerRecommendations.find((r) => r.itemId === itemId);
}

// Helper: get all trainer-recommended items, sorted by priority
export function getTrainerRecommendedItems(): { item: LearningItem; rec: TrainerRecommendation }[] {
  return trainerRecommendations
    .sort((a, b) => (a.priority === "required" ? -1 : 1) - (b.priority === "required" ? -1 : 1))
    .map((rec) => {
      const item = learningCatalog.find((i) => i.id === rec.itemId);
      return item ? { item, rec } : null;
    })
    .filter(Boolean) as { item: LearningItem; rec: TrainerRecommendation }[];
}

// Helper: determine recommendation source for display
export function getRecommendationSource(item: LearningItem): RecommendationSource {
  if (trainerRecommendations.some((r) => r.itemId === item.id)) return "trainer";
  if (item.recommended) return "ai";
  return "system";
}

// ─── Practice Exercises (First-Class Objects) ────────────────────────────────

export interface PracticeExercise {
  id: string;
  title: string;
  intent: string; // "what this builds"
  howToPerform: string[];
  successCriteria: {
    quality: string;
    consistency: string;
    repetition: string;
  };
  trainerNotes?: string;
  linkedSkills: string[];
  linkedGoals: string[];
  skillDomains: SkillDomain[];
  difficulty: "beginner" | "intermediate" | "advanced";
  estimatedDuration: string;
  onSaddle: boolean;
}

export interface ExercisePracticeLog {
  exerciseId: string;
  date: string;
  howItWent: "struggled" | "okay" | "good" | "nailed-it";
  briefReflection: string;
}

// Mock practice exercises
export const practiceExercises: PracticeExercise[] = [
  {
    id: "pe1",
    title: "Walk-Halt Transitions with Core Focus",
    intent: "Builds core awareness and teaches your body to initiate downward transitions from your seat rather than your hands.",
    howToPerform: [
      "Walk on a 20m circle with soft contact",
      "Exhale deeply and engage your lower abdominals",
      "Think 'grow tall' — let the halt come from your seat stopping, not pulling",
      "Hold the halt for 5 seconds, then walk again with a light leg aid",
      "Repeat 8 times, alternating direction every 4 reps",
    ],
    successCriteria: {
      quality: "Horse halts within 2 strides of your seat aid with no head tossing",
      consistency: "6 out of 8 halts feel smooth and balanced",
      repetition: "Practice 3 sessions in a row before progressing",
    },
    trainerNotes: "Sarah — this is the precursor to a clean canter transition. If you can't halt from your seat, you can't half-halt from it either.",
    linkedSkills: ["Core engagement", "Half-halt timing"],
    linkedGoals: ["Balanced Canter Transitions"],
    skillDomains: ["aids", "position"],
    difficulty: "beginner",
    estimatedDuration: "10 min",
    onSaddle: true,
  },
  {
    id: "pe2",
    title: "Two-Point Hold at Trot",
    intent: "Develops independent balance and leg stability without relying on the reins for support.",
    howToPerform: [
      "Pick up a rising trot on a large circle",
      "Take two-point position (hover above saddle, hands on mane)",
      "Hold for 30 seconds without grabbing mane or gripping with knees",
      "Sit for 30 seconds, then repeat",
      "Build to 60 seconds in two-point over 2 weeks",
    ],
    successCriteria: {
      quality: "Your lower leg stays under your hip — no tipping forward",
      consistency: "Hold 30 seconds without losing balance 4 out of 5 attempts",
      repetition: "Include in every warm-up for 2 weeks",
    },
    linkedSkills: ["Core engagement", "Rhythm control"],
    linkedGoals: ["Balanced Canter Transitions", "Walk–Trot Transitions"],
    skillDomains: ["balance", "position", "fitness"],
    difficulty: "intermediate",
    estimatedDuration: "8 min",
    onSaddle: true,
  },
  {
    id: "pe3",
    title: "Rhythm Counting at Walk & Trot",
    intent: "Trains your internal metronome so you can feel when rhythm breaks — the earliest signal of a loss of balance.",
    howToPerform: [
      "At walk, count '1-2-3-4' aloud matching each footfall",
      "Maintain the count through corners and transitions",
      "At trot, count '1-2, 1-2' matching the diagonal pairs",
      "When you lose the count, that's when rhythm broke — note what caused it",
      "Aim for 2 full laps without losing count",
    ],
    successCriteria: {
      quality: "You can identify the exact moment rhythm changes before it becomes obvious",
      consistency: "Maintain count through 3 consecutive turns",
      repetition: "Every ride for 1 week, then check-in weekly",
    },
    trainerNotes: "This sounds simple but it's genuinely hard. Don't skip it. Rhythm awareness separates intermediate from advanced riders.",
    linkedSkills: ["Rhythm control"],
    linkedGoals: ["Balanced Canter Transitions"],
    skillDomains: ["flatwork"],
    difficulty: "beginner",
    estimatedDuration: "5 min",
    onSaddle: true,
  },
  {
    id: "pe4",
    title: "Pelvic Clock on Stability Ball",
    intent: "Develops the subtle pelvic mobility riders need to follow the horse's movement without bracing.",
    howToPerform: [
      "Sit on a stability ball with feet hip-width apart",
      "Imagine your pelvis is a clock face — 12 o'clock is forward, 6 is back",
      "Slowly tilt to 12, then 6, then 3 (right), then 9 (left)",
      "Make smooth circles: 10 clockwise, 10 counter-clockwise",
      "Add eyes-closed for the last 5 reps each direction",
    ],
    successCriteria: {
      quality: "Circles are smooth, not jerky. Upper body stays quiet.",
      consistency: "Can do eyes-closed without losing center",
      repetition: "3x per week for 2 weeks",
    },
    linkedSkills: ["Core engagement"],
    linkedGoals: ["Balanced Canter Transitions"],
    skillDomains: ["fitness", "balance"],
    difficulty: "beginner",
    estimatedDuration: "8 min",
    onSaddle: false,
  },
  {
    id: "pe5",
    title: "Transition Ladder: Walk-Trot-Canter Pyramid",
    intent: "Systematically improves transition quality by building complexity gradually within a single session.",
    howToPerform: [
      "Start with 4× walk-trot-walk transitions (each direction)",
      "Rate each transition: was the rhythm maintained? Did you use seat first?",
      "Only progress to trot-canter-trot if 3 of 4 walk-trots were 'good'",
      "Do 2× trot-canter-trot transitions per direction",
      "Finish with 1 walk-canter-walk per direction — only if everything else was clean",
    ],
    successCriteria: {
      quality: "Upward transitions feel forward, not rushed. Downward transitions come from seat.",
      consistency: "3 out of 4 transitions at each level rated 'good' before progressing",
      repetition: "Weekly for 4 weeks — track your pass rate each time",
    },
    trainerNotes: "This is THE exercise for your current goal. Don't rush to the canter work — the quality of your walk-trot transitions predicts your canter quality.",
    linkedSkills: ["Half-halt timing", "Rhythm control", "Core engagement"],
    linkedGoals: ["Balanced Canter Transitions"],
    skillDomains: ["flatwork", "aids", "balance"],
    difficulty: "intermediate",
    estimatedDuration: "25 min",
    onSaddle: true,
  },
];

// Helper: get exercises for a goal
export function getExercisesForGoal(goalName: string): PracticeExercise[] {
  return practiceExercises.filter((e) => e.linkedGoals.includes(goalName));
}

// Helper: get exercises for a skill
export function getExercisesForSkill(skillName: string): PracticeExercise[] {
  return practiceExercises.filter((e) => e.linkedSkills.includes(skillName));
}

// Helper: get exercises by on/off saddle
export function getExercisesByType(onSaddle: boolean): PracticeExercise[] {
  return practiceExercises.filter((e) => e.onSaddle === onSaddle);
}

// ─── Skill Domain Display Config ─────────────────────────────────────────────

export const skillDomainConfig: Record<SkillDomain, { label: string; color: string }> = {
  position: { label: "Position", color: "bg-blue-500" },
  balance: { label: "Balance", color: "bg-primary" },
  aids: { label: "Aids", color: "bg-violet-500" },
  flatwork: { label: "Flatwork", color: "bg-sage" },
  jumping: { label: "Jumping", color: "bg-warmth" },
  groundwork: { label: "Groundwork", color: "bg-amber-600" },
  fitness: { label: "Fitness", color: "bg-rose-500" },
  mental: { label: "Mental", color: "bg-indigo-500" },
};

export const contentTypeConfig: Record<ContentType, { label: string; icon: string }> = {
  lesson: { label: "Lesson", icon: "📖" },
  "exercise-on-saddle": { label: "On-Saddle Exercise", icon: "🐴" },
  "exercise-off-saddle": { label: "Off-Saddle Exercise", icon: "💪" },
  clinic: { label: "Clinic", icon: "🎓" },
  explanation: { label: "Explanation", icon: "💡" },
};

// ─── Mock Learning Catalog ───────────────────────────────────────────────────

export const learningCatalog: LearningItem[] = [
  {
    id: "l1",
    type: "exercise-off-saddle",
    title: "Core Stability for Riders",
    description: "A 10-minute off-saddle routine targeting the deep core muscles riders rely on during transitions. Focuses on anti-rotation and pelvic stability — the exact muscles that fatigue during canter work.",
    duration: "10 min",
    skillDomains: ["fitness", "balance"],
    linkedGoals: ["Balanced Canter Transitions"],
    linkedSkills: ["Core engagement"],
    difficulty: "beginner",
    discipline: "general",
    source: "Horsera",
    trainerRecommended: true,
    steps: [
      "Dead bug — 3 sets of 8 reps per side",
      "Bird-dog hold — 3 × 20 seconds per side",
      "Plank with hip dip — 3 × 10 reps",
      "Seated pelvic tilts on stability ball — 2 × 15",
    ],
    keyTakeaways: ["Core fatigue causes upper-body collapse during transitions", "These exercises target riding-specific stability"],
    recommended: true,
    recommendationReason: "Your core engagement has plateaued at 3/5 — this addresses the exact muscles involved.",
  },
  {
    id: "l2",
    type: "lesson",
    title: "The Half-Halt Explained",
    description: "What a half-halt actually is, why timing matters, and how to practice it systematically. Covers the coordination of seat, hand, and leg aids in a single 'breath' of communication.",
    duration: "8 min read",
    skillDomains: ["aids", "flatwork"],
    linkedGoals: ["Balanced Canter Transitions"],
    linkedSkills: ["Half-halt timing"],
    difficulty: "intermediate",
    discipline: "dressage",
    source: "Horsera",
    trainerRecommended: true,
    keyTakeaways: [
      "The half-halt is a rebalancing signal, not a stopping aid",
      "Timing: apply 2 strides before the transition, not during",
      "Think 'close-hold-release' in one stride",
    ],
    recommended: true,
    recommendationReason: "Your half-halt timing improved from 2 to 3/5 — this deepens the concept.",
  },
  {
    id: "l3",
    type: "exercise-on-saddle",
    title: "Transition Ladder Drill",
    description: "A structured on-saddle exercise for improving transition quality. Walk-trot-walk, then walk-canter-walk, with specific focus points at each gait change.",
    duration: "20 min",
    skillDomains: ["flatwork", "balance", "aids"],
    linkedGoals: ["Balanced Canter Transitions", "Walk–Trot Transitions"],
    linkedSkills: ["Rhythm control", "Half-halt timing", "Core engagement"],
    difficulty: "intermediate",
    discipline: "dressage",
    source: "Trainer Emma",
    trainerRecommended: true,
    steps: [
      "Warm up: 5 min walk on long rein",
      "Walk-trot transitions × 6 — focus on maintaining rhythm through the transition",
      "Trot-walk transitions × 6 — half-halt 2 strides before, feel the walk arrive",
      "Walk-canter transitions × 4 — limit to 2 reps, rest between",
      "Cool down: stretchy trot, free walk",
    ],
    recommended: true,
    recommendationReason: "Directly practices your canter transitions with built-in rep limits matching your current plan.",
  },
  {
    id: "l4",
    type: "lesson",
    title: "Seat & Balance: Independent Seat Foundations",
    description: "Understanding what an 'independent seat' means and why it's the foundation for all advanced riding. Covers how to assess your own seat independence and common compensations.",
    duration: "12 min read",
    skillDomains: ["position", "balance"],
    linkedGoals: ["Balanced Canter Transitions"],
    linkedSkills: ["Core engagement"],
    difficulty: "intermediate",
    discipline: "general",
    source: "Trainer Emma",
    trainerName: "Emma",
    keyTakeaways: [
      "An independent seat means your hands and legs can act without affecting your balance",
      "Test: can you ride without stirrups at trot for 2 minutes without gripping?",
      "Common compensation: gripping with knees = losing core stability",
    ],
  },
  {
    id: "l5",
    type: "exercise-off-saddle",
    title: "Rider Yoga: Hip Flexor Release",
    description: "Tight hip flexors restrict a rider's ability to follow the horse's motion. This 15-minute yoga sequence opens the hip flexors and improves pelvic mobility for better seat connection.",
    duration: "15 min",
    skillDomains: ["fitness", "position"],
    linkedGoals: ["Balanced Canter Transitions", "Walk–Trot Transitions"],
    linkedSkills: ["Core engagement", "Rhythm control"],
    difficulty: "beginner",
    discipline: "general",
    source: "YouTube",
    url: "https://youtube.com/example",
    trainerRecommended: true,
    steps: [
      "Low lunge hold — 60 sec per side",
      "Pigeon pose — 60 sec per side",
      "Supine figure-4 stretch — 45 sec per side",
      "Cat-cow with pelvic focus — 10 reps",
      "Butterfly stretch — 60 seconds",
    ],
  },
  {
    id: "l6",
    type: "explanation",
    title: "Why Rhythm Matters More Than Speed",
    description: "A conceptual explanation of why maintaining rhythm through transitions is more important than achieving the 'right' speed. Connects to the biomechanics of how horses balance.",
    duration: "5 min read",
    skillDomains: ["flatwork"],
    linkedGoals: ["Balanced Canter Transitions"],
    linkedSkills: ["Rhythm control"],
    difficulty: "beginner",
    discipline: "dressage",
    source: "Horsera",
    keyTakeaways: [
      "Rhythm = the horse's internal metronome. Speed = tempo adjustments on top of rhythm.",
      "When rhythm breaks, the horse loses balance before the rider feels it",
      "Count strides aloud to train your internal rhythm awareness",
    ],
  },
  {
    id: "l7",
    type: "clinic",
    title: "Canter Workshop with Emma",
    description: "A recorded clinic covering canter transition quality, common rider errors, and progressive exercises. Includes video breakdowns of before-and-after transitions.",
    duration: "45 min",
    skillDomains: ["flatwork", "balance", "aids"],
    linkedGoals: ["Balanced Canter Transitions"],
    linkedSkills: ["Half-halt timing", "Core engagement", "Rhythm control"],
    difficulty: "intermediate",
    discipline: "dressage",
    source: "Trainer Emma",
    trainerName: "Emma",
    trainerRecommended: true,
  },
  {
    id: "l8",
    type: "exercise-on-saddle",
    title: "No-Stirrup Trot Work",
    description: "Build seat security and core strength by working without stirrups at trot. Start with posting trot, progress to sitting trot. Key for independent seat development.",
    duration: "15 min",
    skillDomains: ["balance", "position", "fitness"],
    linkedGoals: ["Walk–Trot Transitions", "Balanced Canter Transitions"],
    linkedSkills: ["Core engagement"],
    difficulty: "intermediate",
    discipline: "general",
    source: "Horsera",
    steps: [
      "Cross stirrups. Walk 3 min to settle.",
      "Rising trot on 20m circle — 2 min each direction",
      "Sitting trot with arms out — 1 min each direction",
      "Transitions walk-trot without stirrups — 6 reps",
      "Pick up stirrups, stretchy trot to finish",
    ],
  },
  {
    id: "l9",
    type: "lesson",
    title: "Understanding Leg Aids",
    description: "A breakdown of how different leg positions and pressures communicate with your horse. Covers driving, bending, and lateral aids with common mistakes to avoid.",
    duration: "10 min read",
    skillDomains: ["aids"],
    linkedGoals: ["Walk–Trot Transitions"],
    linkedSkills: ["Leg aids"],
    difficulty: "beginner",
    discipline: "general",
    source: "Horsera",
    keyTakeaways: [
      "Driving leg: at the girth, creates forward energy",
      "Bending leg: behind the girth, controls the hindquarters",
      "Less is more — constant leg pressure teaches the horse to ignore you",
    ],
  },
  {
    id: "l10",
    type: "exercise-off-saddle",
    title: "Balance Board Training",
    description: "Use a wobble board or BOSU ball to train the automatic balance reactions riders need. 10 minutes, 3x per week, builds the same reflexes used in the saddle.",
    duration: "10 min",
    skillDomains: ["balance", "fitness"],
    linkedGoals: ["Balanced Canter Transitions"],
    linkedSkills: ["Core engagement", "Rhythm control"],
    difficulty: "beginner",
    discipline: "general",
    source: "YouTube",
    url: "https://youtube.com/example-balance",
    steps: [
      "Stand on balance board — eyes open, 60 sec",
      "Stand on balance board — eyes closed, 30 sec",
      "Single leg balance — 30 sec per side",
      "Squats on BOSU ball — 3 × 10",
      "Ball toss while balancing — 20 catches",
    ],
  },
];

// Helper: get items recommended for active thread (trainer first, then AI)
export function getRecommendedItems(): LearningItem[] {
  const trainerItemIds = new Set(trainerRecommendations.map((r) => r.itemId));
  const trainerItems = learningCatalog.filter((item) => trainerItemIds.has(item.id));
  const aiItems = learningCatalog.filter((item) => item.recommended && !trainerItemIds.has(item.id));
  return [...trainerItems, ...aiItems];
}

// Helper: get items by goal
export function getItemsByGoal(goalName: string): LearningItem[] {
  return learningCatalog.filter((item) => item.linkedGoals.includes(goalName));
}

// Helper: get items by skill domain
export function getItemsByDomain(domain: SkillDomain): LearningItem[] {
  return learningCatalog.filter((item) => item.skillDomains.includes(domain));
}

// Helper: get items by specific skill name
export function getItemsBySkill(skillName: string): LearningItem[] {
  return learningCatalog.filter((item) => item.linkedSkills.includes(skillName));
}

// Helper: get contextual recommendations for a goal+skill combo with relevance reasons
export function getContextualRecommendations(
  goalName: string,
  skillName?: string,
  trend?: "improving" | "plateau" | "declining",
  trainerNote?: string
): { item: LearningItem; reason: string }[] {
  let items = learningCatalog.filter((item) => item.linkedGoals.includes(goalName));
  if (skillName) {
    // Prioritize items linked to this specific skill
    const skillItems = items.filter((item) => item.linkedSkills.includes(skillName));
    const otherItems = items.filter((item) => !item.linkedSkills.includes(skillName));
    items = [...skillItems, ...otherItems];
  }

  return items.slice(0, 3).map((item) => {
    let reason = `Supports your "${goalName}" goal`;
    if (skillName && item.linkedSkills.includes(skillName)) {
      if (trend === "plateau") {
        reason = `Your ${skillName} has plateaued — this targets that specific area`;
      } else if (trend === "declining") {
        reason = `Your ${skillName} needs attention — this can help rebuild`;
      } else if (trend === "improving") {
        reason = `Build on your ${skillName} momentum with deeper practice`;
      } else {
        reason = `Directly develops your ${skillName}`;
      }
    }
    if (trainerNote) {
      reason += ` (aligns with trainer feedback)`;
    }
    return { item, reason };
  });
}
