// Horsera MVP — Complete Mock Data
// All data is sample/placeholder for MVP. Replace with real data layer post-MVP.

// ─────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────

export type MilestoneState = 'untouched' | 'working' | 'mastered';
export type RideType = 'training' | 'lesson' | 'mock-test' | 'hack';
export type DisciplineTrack = 'usdf' | 'pony-club' | 'hunter-jumper';
export type DisciplineLevel = 'intro' | 'training' | 'first' | 'second' | 'third';
export type GoalType = 'competition' | 'experience' | 'skill';

export interface DisciplineLevelDef {
  id: DisciplineLevel;
  label: string;
  fullName: string;
  description: string;
  performanceTasks: string[]; // what rider must demonstrate at this level
}

export const USDF_LEVELS: DisciplineLevelDef[] = [
  {
    id: 'intro',
    label: 'Intro',
    fullName: 'Intro Level',
    description: 'Walk & trot basics, relaxation, straightness',
    performanceTasks: ['20m walk circle', 'Rising trot across diagonal', 'Free walk on loose rein', 'Halt and salute on centerline'],
  },
  {
    id: 'training',
    label: 'Training',
    fullName: 'Training Level',
    description: 'Steady contact, balanced canter',
    performanceTasks: ['20m trot circle (both reins)', 'Free walk on long rein', 'Working canter, 20m circle', 'Walk–trot transitions at markers', 'Halt & salute'],
  },
  {
    id: 'first',
    label: 'First',
    fullName: 'First Level',
    description: 'Bend, balance, lateral work',
    performanceTasks: ['Leg yield from centerline to track', '15m trot circles', 'Lengthened trot diagonal', 'Canter serpentine', 'Medium walk to collected walk'],
  },
  {
    id: 'second',
    label: 'Second',
    fullName: 'Second Level',
    description: 'Collection begins, shoulder-in',
    performanceTasks: ['Shoulder-in at trot', 'Travers (haunches-in)', 'Counter canter 20m circle', 'Rein back (3–4 steps)', 'Collected and medium trot'],
  },
  {
    id: 'third',
    label: 'Third',
    fullName: 'Third Level',
    description: 'Flying changes, half-pass',
    performanceTasks: ['Simple flying change of lead', 'Half-pass at trot and canter', 'Collected walk pirouette', 'Extended trot across diagonal', 'Shoulder-in to renvers'],
  },
];

export interface BiometricsSnapshot {
  lowerLegStability:   number;
  reinSteadiness:      number;
  reinSymmetry:        number;
  coreStability:       number;
  upperBodyAlignment:  number;
  pelvisStability:     number;
}

export interface Milestone {
  id: string;
  name: string;
  state: MilestoneState;
  ridesConsistent: number;
  ridesRequired: number;
  disciplineLevel?: DisciplineLevel; // only for level-based (USDF/Pony Club) goals
  biomechanicsFocus: string[];
  ridingQuality: string;
  performanceTasks: string[];
  exercises: Exercise[];
  description: string;
  cadenceNote?: string; // context-sensitive Cadence insight when this skill is selected
}

export interface Exercise {
  id: string;
  name: string;
  type: 'on-saddle' | 'off-saddle';
  duration: string;
  description: string;
}

export interface Goal {
  id: string;
  name: string;
  type: GoalType;
  description?: string;
  track?: DisciplineTrack;
  level?: string;
  currentDisciplineLevel?: DisciplineLevel;
  test?: string;
  targetDate?: string;
  milestones: Milestone[];
}

export interface Ride {
  id: string;
  date: string;
  horse: string;
  type: RideType;
  duration: number;
  focusMilestone: string;
  reflection: string;
  trainerFeedback?: string;
  cadenceInsight?: string;
  signal: 'improving' | 'consistent' | 'needs-work';
  biometrics?: BiometricsSnapshot;
  videoUploaded: boolean;
  milestoneId: string;
}

export interface Rider {
  id: string;
  name: string;
  firstName: string;
  horse: string;
  trainer: string;
  track: DisciplineTrack;
  currentGoalId: string;
  upcomingCompetition?: {
    name: string;
    date: string;
    level: string;
    tests: string[];
    daysAway: number;
  };
}

export interface WeeklyPattern {
  day: string;
  ridden: boolean;
  duration?: number;
  isToday: boolean;
}

import { getHorseName } from '../lib/userProfile';

// ─────────────────────────────────────────────────────────
// RIDER
// ─────────────────────────────────────────────────────────

export const mockRider: Rider = {
  id: 'rider-001',
  name: 'Rossella Vitali',
  firstName: 'Rossella',
  horse: getHorseName('Allegra'),
  trainer: 'Sarah Mitchell',
  track: 'usdf',
  currentGoalId: 'goal-001',
  upcomingCompetition: {
    name: 'USDF Spring Classic',
    date: '2026-03-31',
    level: 'Training Level',
    tests: ['Test 1', 'Test 2'],
    daysAway: 21,
  },
};

// ─────────────────────────────────────────────────────────
// EXERCISES
// ─────────────────────────────────────────────────────────

export const exercises: Record<string, Exercise[]> = {
  'lower-leg-stability': [
    {
      id: 'ex-001',
      name: 'Stirrup-less trot circles',
      type: 'on-saddle',
      duration: '5 min',
      description: 'Remove stirrups and trot on a 20m circle. Focus on letting your leg hang heavy and your ankle absorb the movement. Do not grip with the knee.',
    },
    {
      id: 'ex-002',
      name: 'Two-point position transitions',
      type: 'on-saddle',
      duration: '3 min',
      description: 'Alternate between two-point and full-seat in trot. Helps you feel the difference between a gripping leg and a weighted, following leg.',
    },
    {
      id: 'ex-003',
      name: 'Ankle circles (off-saddle)',
      type: 'off-saddle',
      duration: '2 min',
      description: 'Standing on one foot, rotate your ankle through its full range. Builds flexibility and awareness in the ankle joint.',
    },
  ],
  'rein-steadiness': [
    {
      id: 'ex-004',
      name: 'Tunnel rein exercise',
      type: 'on-saddle',
      duration: '5 min',
      description: 'Imagine your reins are inside a tunnel — they can only move forward and back, never up or sideways. Walk and trot while maintaining this constraint.',
    },
    {
      id: 'ex-005',
      name: 'Shoulder blade pinch',
      type: 'off-saddle',
      duration: '2 min',
      description: 'Stand tall and gently draw shoulder blades together and down. Hold for 5 seconds. Releases tension that causes hand movement.',
    },
  ],
  'core-stability': [
    {
      id: 'ex-006',
      name: 'Posting trot without stirrups',
      type: 'on-saddle',
      duration: '4 min',
      description: 'Post the trot without stirrups. The rise must come purely from core engagement, not the knee. Builds deep seat muscle activation.',
    },
    {
      id: 'ex-007',
      name: 'Plank hold',
      type: 'off-saddle',
      duration: '3 × 30 sec',
      description: 'Hold a forearm plank. Engage your pelvic floor gently. This activates the same deep core muscles you use to stabilize your seat.',
    },
  ],
};

// ─────────────────────────────────────────────────────────
// GOAL 1 — USDF Training Level (competition)
// ─────────────────────────────────────────────────────────

// Performance-task-centric milestones. Each milestone is named by what the rider
// demonstrates (the observable task), not by the underlying biomechanics lever.
// Biomechanics and riding quality are shown as supporting context in the detail view.
const usdtMilestones: Milestone[] = [
  {
    id: 'ms-001',
    name: '20m Trot Circle',
    state: 'working',
    ridesConsistent: 3,
    ridesRequired: 5,
    disciplineLevel: 'training',
    biomechanicsFocus: ['Lower Leg Stability', 'Rein Steadiness'],
    ridingQuality: 'Rhythm',
    performanceTasks: ['Maintain rhythm and bend on 20m circle at trot, both reins'],
    exercises: exercises['lower-leg-stability'],
    description: `The 20m circle is the core Training Level movement. It tests rhythm, bend, and consistent contact. Lower leg stability keeps you anchored through the arc; steady reins keep ${getHorseName('your horse')} soft and forward.`,
    cadenceNote: '3 of 5 rides showing consistent circle geometry. The right rein is your weaker side — your lower leg tends to drift forward, breaking the bend. Try weighting the right stirrup through the arc.',
  },
  {
    id: 'ms-002',
    name: 'Free Walk on Long Rein',
    state: 'working',
    ridesConsistent: 4,
    ridesRequired: 5,
    disciplineLevel: 'training',
    biomechanicsFocus: ['Rein Steadiness', 'Rein Symmetry', 'Pelvis Vertical Stability'],
    ridingQuality: 'Contact & Relaxation',
    performanceTasks: ['Allow horse to stretch forward-down while maintaining direction and rhythm'],
    exercises: exercises['rein-steadiness'],
    description: `Free walk is one of the highest-weighted movements in Training Level tests. It requires you to gradually yield the rein while ${getHorseName('your horse')} stretches forward and down — a true test of rein elasticity and trust.`,
    cadenceNote: `Almost mastered — 4 of 5. The tunnel rein exercise has clearly worked. One more ride where the yield is gradual and ${getHorseName('your horse')} tracks up, and this is done.`,
  },
  {
    id: 'ms-003',
    name: 'Working Canter Transition',
    state: 'mastered',
    ridesConsistent: 5,
    ridesRequired: 5,
    disciplineLevel: 'training',
    biomechanicsFocus: ['Core Stability', 'Pelvis Vertical Stability', 'Lower Leg Stability'],
    ridingQuality: 'Rhythm & Balance',
    performanceTasks: ['Balanced trot-to-canter departure, maintain 20m circle at canter'],
    exercises: exercises['core-stability'],
    description: 'A clean canter transition requires core stability to absorb the gait change without bracing, and a quiet lower leg to give the aid without disturbing the hind leg. Your core work unlocked this.',
    cadenceNote: 'Mastered. Canter transitions have been clean and balanced for 5 consecutive rides. Your core stability is carrying you through — this is now a genuine strength.',
  },
  {
    id: 'ms-004',
    name: 'Halt & Salute',
    state: 'untouched',
    ridesConsistent: 0,
    ridesRequired: 5,
    disciplineLevel: 'training',
    biomechanicsFocus: ['Upper Body Vertical Alignment', 'Core Stability', 'Rein Symmetry'],
    ridingQuality: 'Straightness',
    performanceTasks: ['Square halt on centerline, hold 3+ seconds, drop reins for salute'],
    exercises: [],
    description: 'The halt and salute opens and closes every dressage test. A square halt requires straightness from poll to tail — which means the rider must be straight first. Upper body alignment is your key lever here.',
  },
  {
    id: 'ms-005',
    name: 'Walk–Trot Transitions',
    state: 'untouched',
    ridesConsistent: 0,
    ridesRequired: 5,
    disciplineLevel: 'training',
    biomechanicsFocus: ['Core Stability', 'Lower Leg Stability', 'Rein Steadiness'],
    ridingQuality: 'Rhythm & Impulsion',
    performanceTasks: ['Prompt, balanced transitions at markers — no loss of rhythm or contact'],
    exercises: [],
    description: 'Transitions are judged throughout Training Level tests. A balanced transition happens when the horse is prepared through the body, not pulled through the reins. Your core and lower leg stability feed directly into this.',
  },
  // ── Reaching ahead: First Level task already being explored ──
  {
    id: 'ms-006',
    name: 'Leg Yield',
    state: 'working',
    ridesConsistent: 1,
    ridesRequired: 5,
    disciplineLevel: 'first',
    biomechanicsFocus: ['Weight Distribution', 'Timing of Aids', 'Rein Symmetry'],
    ridingQuality: 'Straightness & Impulsion',
    performanceTasks: ['Leg yield from centerline to track at trot, maintaining rhythm'],
    exercises: [],
    description: 'Leg yield is the first lateral movement required at First Level. The horse moves forward and sideways, maintaining rhythm. Your lower leg stability and symmetry work is the direct foundation for this.',
    cadenceNote: 'You\'re already exploring First Level work while consolidating Training Level — that\'s how riders develop. Early days (1/5) but the instinct is right. Your symmetry work feeds directly into this.',
  },
];

// ─────────────────────────────────────────────────────────
// GOAL 2 — Feel Confident on Trail Rides (experience)
// ─────────────────────────────────────────────────────────

const trailMilestones: Milestone[] = [
  {
    id: 'ms-t001',
    name: 'Relaxed Walk on Varied Terrain',
    state: 'working',
    ridesConsistent: 4,
    ridesRequired: 5,
    biomechanicsFocus: ['Lower Leg Stability', 'Core Stability', 'Upper Body Relaxation'],
    ridingQuality: 'Relaxation & Balance',
    performanceTasks: ['Walk on loose rein over new ground', 'Maintain rhythm on uneven footing'],
    exercises: [],
    description: `The foundation of trail confidence. A relaxed walk on varied terrain requires you to absorb ground movement through a soft leg and quiet seat — letting ${getHorseName('your horse')} focus on where they're going.`,
    cadenceNote: 'Almost there — 4 of 5 rides showing relaxed, consistent walk. One more strong session and this becomes your first trail milestone mastered. Your lower leg stability work from the arena is clearly transferring.',
  },
  {
    id: 'ms-t002',
    name: 'Calm in New Environments',
    state: 'working',
    ridesConsistent: 2,
    ridesRequired: 5,
    biomechanicsFocus: ['Core Stability', 'Rein Steadiness', 'Seat Independence'],
    ridingQuality: 'Relaxation & Contact',
    performanceTasks: ['Maintain rhythm when horse spooks', 'Ride past new objects without tension'],
    exercises: [],
    description: `Your body language communicates directly to ${getHorseName('your horse')}. When you tighten, they tighten. This milestone builds the body awareness to stay physically soft when the environment is novel.`,
    cadenceNote: 'A longer journey — 2 of 5. The key question: when do you first feel yourself brace? The spooky rides are actually your most useful data. Rein steadiness from your dressage work is your biggest asset here.',
  },
  {
    id: 'ms-t003',
    name: 'Confident Solo Riding',
    state: 'untouched',
    ridesConsistent: 0,
    ridesRequired: 5,
    biomechanicsFocus: ['Core Stability', 'Lower Leg Stability', 'Weight Distribution'],
    ridingQuality: 'Balance & Relaxation',
    performanceTasks: ['Complete solo trail loop', 'Handle unexpected situations independently'],
    exercises: [],
    description: `Riding independently develops your own decision-making and deepens the trust between you and ${getHorseName('your horse')}. This milestone unlocks once your environment-calm foundation is solid.`,
  },
  {
    id: 'ms-t004',
    name: 'Terrain Adaptability',
    state: 'untouched',
    ridesConsistent: 0,
    ridesRequired: 5,
    biomechanicsFocus: ['Weight Distribution', 'Seat Independence', 'Lower Leg Stability'],
    ridingQuality: 'Balance & Adjustability',
    performanceTasks: ['Ride uphill without tipping forward', 'Navigate downhill without bracing'],
    exercises: [],
    description: `Hills and uneven terrain require constant weight redistribution. This milestone builds the physical adaptability to ride any terrain without disrupting ${getHorseName('your horse')}'s balance.`,
  },
];

// ─────────────────────────────────────────────────────────
// GOALS
// ─────────────────────────────────────────────────────────

export const mockGoals: Goal[] = [
  {
    id: 'goal-001',
    name: 'USDF Training Level',
    type: 'competition',
    description: 'Compete at Training Level Test 1 & 2',
    track: 'usdf',
    level: 'Training Level',
    currentDisciplineLevel: 'training',
    test: 'Test 1',
    targetDate: '2026-03-31',
    milestones: usdtMilestones,
  },
  {
    id: 'goal-002',
    name: 'Feel Confident on Trail Rides',
    type: 'experience',
    description: 'Build confidence riding independently outside the arena',
    milestones: trailMilestones,
  },
];

// Backward-compatible alias — other screens (Rides, Insights, Home) still reference this
export const mockGoal: Goal = mockGoals[0];

// ─────────────────────────────────────────────────────────
// RIDES
// ─────────────────────────────────────────────────────────

export const mockRides: Ride[] = [
  {
    id: 'ride-001',
    date: '2026-03-09',
    horse: getHorseName('Allegra'),
    type: 'training',
    duration: 45,
    focusMilestone: 'Lower Leg Stability',
    reflection: 'Felt much more stable on the left rein today. Right rein still feels like my leg wants to creep forward. The stirrup-less work at the end really helped.',
    trainerFeedback: 'Good progress on the lower leg. Watch the right heel — it\'s coming up in the trot-canter transitions. Try the two-point exercise before each canter departure.',
    cadenceInsight: 'Your lower leg stability score improved by 12% compared to your last 3 rides. The drift is now mainly on the right rein — a consistent pattern across 4 sessions.',
    signal: 'improving',
    videoUploaded: true,
    milestoneId: 'ms-001',
    biometrics: {
      lowerLegStability:  0.72,
      reinSteadiness:     0.81,
      reinSymmetry:       0.76,
      coreStability:      0.88,
      upperBodyAlignment: 0.79,
      pelvisStability:    0.84,
    },
  },
  {
    id: 'ride-002',
    date: '2026-03-07',
    horse: getHorseName('Allegra'),
    type: 'lesson',
    duration: 60,
    focusMilestone: 'Rein Steadiness',
    reflection: 'Hard lesson. My hands kept moving during the trot circles. Sarah had me do the tunnel exercise which helped a lot by the end.',
    trainerFeedback: 'Really good second half once you found the tunnel feeling. Keep that image in your mind for every transition. Homework: shoulder blade pinches daily.',
    cadenceInsight: 'Rein steadiness was notably better in the second 20 minutes of this ride — consistent with your pattern of warming into the work.',
    signal: 'improving',
    videoUploaded: true,
    milestoneId: 'ms-002',
    biometrics: {
      lowerLegStability:  0.68,
      reinSteadiness:     0.74,
      reinSymmetry:       0.71,
      coreStability:      0.86,
      upperBodyAlignment: 0.77,
      pelvisStability:    0.82,
    },
  },
  {
    id: 'ride-003',
    date: '2026-03-05',
    horse: getHorseName('Allegra'),
    type: 'training',
    duration: 40,
    focusMilestone: 'Lower Leg Stability',
    reflection: `Shorter ride today — ${getHorseName('my horse')} was a bit spooky. Still managed 20 minutes of focused work. Leg felt OK.`,
    signal: 'consistent',
    videoUploaded: false,
    milestoneId: 'ms-001',
    biometrics: {
      lowerLegStability:  0.65,
      reinSteadiness:     0.78,
      reinSymmetry:       0.73,
      coreStability:      0.85,
      upperBodyAlignment: 0.76,
      pelvisStability:    0.80,
    },
  },
  {
    id: 'ride-004',
    date: '2026-03-04',
    horse: getHorseName('Allegra'),
    type: 'training',
    duration: 50,
    focusMilestone: 'Rein Steadiness',
    reflection: 'Good ride. Really tried to keep my elbows soft. Free walk felt connected.',
    signal: 'improving',
    videoUploaded: false,
    milestoneId: 'ms-002',
  },
  {
    id: 'ride-005',
    date: '2026-03-03',
    horse: getHorseName('Allegra'),
    type: 'training',
    duration: 45,
    focusMilestone: 'Core Stability',
    reflection: 'Practiced sitting trot without stirrups for the first time in a while. Harder than I remembered but feels right.',
    signal: 'consistent',
    videoUploaded: false,
    milestoneId: 'ms-003',
  },
];

// ─────────────────────────────────────────────────────────
// WEEKLY PATTERN
// ─────────────────────────────────────────────────────────

export const mockWeek: WeeklyPattern[] = [
  { day: 'M', ridden: true,  duration: 45, isToday: false },
  { day: 'T', ridden: true,  duration: 60, isToday: false },
  { day: 'W', ridden: false,              isToday: false },
  { day: 'T', ridden: true,  duration: 50, isToday: false },
  { day: 'F', ridden: true,  duration: 40, isToday: false },
  { day: 'S', ridden: false,              isToday: false },
  { day: 'S', ridden: false,              isToday: true  },
];

// ─────────────────────────────────────────────────────────
// BIOMETRICS TRENDS (for Insights screen)
// ─────────────────────────────────────────────────────────

export const biometricsTrend = [
  { date: 'Feb 10', lowerLeg: 0.55, reins: 0.60, core: 0.75, upperBody: 0.68, pelvis: 0.72 },
  { date: 'Feb 17', lowerLeg: 0.58, reins: 0.65, core: 0.78, upperBody: 0.70, pelvis: 0.75 },
  { date: 'Feb 24', lowerLeg: 0.63, reins: 0.70, core: 0.82, upperBody: 0.74, pelvis: 0.79 },
  { date: 'Mar 03', lowerLeg: 0.65, reins: 0.74, core: 0.85, upperBody: 0.76, pelvis: 0.80 },
  { date: 'Mar 07', lowerLeg: 0.68, reins: 0.74, core: 0.86, upperBody: 0.77, pelvis: 0.82 },
  { date: 'Mar 09', lowerLeg: 0.72, reins: 0.81, core: 0.88, upperBody: 0.79, pelvis: 0.84 },
];

// Cadence pattern insights
export const cadenceInsights = {
  home: 'Your rein steadiness improved across the last 3 rides. Lower leg is now your main unlock for Training Level Test 1.',
  journey: 'Two Training Level skills remain. At your current pace, Lower Leg Stability consolidates by late March — just before the Spring Classic. Your leg yield work is already beginning to show.',
  insights: 'Core Stability is your strongest area — mastered. The pattern across your last 8 rides shows rein steadiness improving consistently. Lower leg stability is improving but shows right-rein drift that may need targeted focus.',
  rideDetail: 'This ride showed a 12% improvement in lower leg stability. The right-rein drift pattern appeared again — 4 consecutive rides with the same pattern. This is likely worth discussing with Sarah at your next lesson.',
};
