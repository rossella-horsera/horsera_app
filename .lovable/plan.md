

# Evidence Studio UX Redesign: Analysis-First with Visual Frames and Prominent Genie

## Summary

Restructure the Evidence Studio results view so the AI analysis is front and center, with frame thumbnails tied to each insight, a streamlined focus/trim tool offered as a secondary action, and Genie floating prominently over the video.

## What Changes

### 1. Results Layout: Analysis as the Protagonist

**Current problem:** The Trim/Focus tool and Analysis Mode toggle appear *above* the insights, making users think they need to choose something before seeing results.

**New layout order (top to bottom):**

1. Video player (with Genie icon overlay)
2. AI Coach Summary card (overall summary)
3. Insights section (each insight with a representative frame thumbnail)
4. "Want deeper analysis?" card -- offers Focus Segment re-analysis
5. Next Ride Actions
6. Saved Moments (if any)
7. Disclaimer

The "Save Moment" and "Trim/Focus" buttons move *below* the insights section, presented as a secondary action card rather than primary controls.

### 2. Genie Floating on Video

**Current:** Genie is a collapsible section at the very bottom of results.

**New:** A floating Genie icon (Sparkles) pinned to the bottom-right corner of the video player. Tapping it opens a search-bar-style overlay that slides up from the video, with the chat input + suggestion chips. The full chat expands inline below.

This makes Genie always visible and one tap away, without taking space from the analysis.

### 3. Frame Thumbnails on Insight Cards

Each InsightCard will show the most representative extracted frame (using the first `frameIndices` entry) as a small thumbnail. This gives visual proof of what the AI observed.

**Data flow:** The `extractedFrames` array (base64 JPEGs) is already available. Each insight has `frameIndices` mapping to these frames. The InsightCard will receive `relevantFrame: string | undefined` and render it as a small image.

### 4. Focus Segment Redesign

**Current:** "Trim/Focus" button + "Analysis Mode" toggle is confusing.

**New:** Remove the top-level mode toggle. Instead, after showing full-video results, offer a card:

> "Want to zoom in? Select a 30-90s segment for deeper frame-by-frame analysis."
> [Select Focus Segment] button

When tapped, it expands the timeline tool inline. The timeline shows frame thumbnails from the extracted frames so users can visually see what they're selecting. On re-analysis, the insights update and the frame thumbnails update to reflect the new segment.

The duration prompt (>3 min video) stays but is simplified -- just a subtle banner, not a blocking dialog.

### 5. Extracted Frames Strip Updates on Trim

When the user adjusts the focus segment handles, show a mini strip of frames from the selected region (re-sampled from the video). This requires calling `extractFramesFromVideo` with the new segment bounds when the user commits.

## Technical Details

### Files Modified

**`src/pages/EvidenceStudioPage.tsx`** (major restructure of `ResultsView`):

- Move Genie from bottom section to a floating overlay on the video player
  - Floating button: absolute positioned bottom-right of video container
  - On click: show a search bar overlay at bottom of video + suggestion chips
  - Chat messages expand below the video in a panel
- Reorder ResultsView sections: Summary -> Insights -> Focus Card -> Actions -> Moments
- Remove the "Analysis Mode" toggle and "Trim/Focus" button from top
- Add a "Deeper Analysis" card after insights with inline focus segment tool
- Pass `extractedFrames` and `frameIndices` to `InsightCard`
- Update `InsightCard` to accept and display a frame thumbnail
- Remove `showFocusTool` / `analysisMode` toggle UI; replace with single "focus segment" expandable card

**`InsightCard` component updates:**
- Add `relevantFrame?: string` prop
- Render a small (80px wide) rounded thumbnail on the right side of the card
- On expanded view, show the frame slightly larger with timestamp

**`EmbeddedGenieChat` component updates:**
- Restructure to work in two modes: "search bar" (compact, overlaid on video) and "expanded" (full chat below video)
- Search bar mode: single input line with suggestion chips, floating over video bottom
- Expanded mode: same as current chat panel but positioned right below the video

**State changes in `ResultsView`:**
- Remove `analysisMode` state management (always starts with "full")
- Add `showFocusCard: boolean` for the optional deeper analysis section
- Add `genieMode: "hidden" | "search" | "expanded"` for the Genie overlay states

### No backend changes needed
All changes are frontend only. The `video-analysis` and `genie-chat` edge functions remain unchanged.

### No new dependencies
Uses existing framer-motion for animations, existing icons from lucide-react.

## User Experience Flow (After)

1. Upload video -> frames extracted -> AI analyzes -> results appear
2. First thing user sees: video player with small Genie sparkle icon in corner
3. Below: AI Coach Summary with overall assessment
4. Below: Individual insights, each with a frame thumbnail showing the moment
5. Below insights: "Want deeper analysis?" card with focus segment tool
6. Below: Next Ride Actions
7. User taps Genie icon -> search bar appears over video -> types question -> answer streams in below video
8. User optionally selects focus segment -> re-analyzes -> insights + frames update

