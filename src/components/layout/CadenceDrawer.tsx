import { useState, useRef, useEffect, useCallback } from 'react';
import React from 'react';
import { getUserProfile } from '../../lib/userProfile';
import { mockGoal, mockRides } from '../../data/mock';
import { getRides } from '../../lib/storage';
import { safeStorage } from '../../lib/safeStorage';
import { CadenceIcon } from './CadenceFAB';

const CADENCE_HISTORY_KEY = 'horsera_cadence_history';

interface Message {
  role: 'cadence' | 'rider';
  text: string;
  timestamp: string;
  imageUrl?: string; // in-memory only, not persisted to localStorage
}


const suggestedPrompts = [
  'What should I focus on in my next ride?',
  'Why do I keep losing my right stirrup?',
  'Am I ready for the Spring Classic?',
  'Explain my lower leg stability score',
];

const OPENAI_API_KEY = import.meta.env.VITE_OPENAI_API_KEY as string | undefined;

function buildSystemPrompt(): string {
  const profile = getUserProfile();
  const name = profile.firstName || 'the rider';
  const horse = profile.horseName || 'their horse';
  const discipline = profile.discipline === 'usdf' ? 'USDF Dressage'
    : profile.discipline === 'pony-club' ? 'Pony Club'
    : profile.discipline === 'hunter-jumper' ? 'Hunter/Jumper'
    : 'general equestrian';

  const activeMilestone = mockGoal.milestones.find(m => m.state === 'working');
  const milestoneName = activeMilestone?.name || 'their current milestone';
  const currentLevel = mockGoal.currentDisciplineLevel || 'training';
  const storedRides = getRides();
  const ridesSummary = storedRides.length > 0
    ? storedRides.slice(0, 3).map(r => {
        const avg = r.biometrics
          ? Math.round(Object.values(r.biometrics).reduce((a, b) => a + b, 0) / Object.values(r.biometrics).length * 100)
          : null;
        const signal = r.overallScore > 0.75 ? 'improving' : r.overallScore > 0.55 ? 'consistent' : 'needs-work';
        return `${r.date}: ${r.type} ride on ${r.horse || horse}, signal: ${signal}${avg ? `, avg score: ${avg}%` : ''}`;
      }).join('\n')
    : mockRides.slice(0, 3).map(r =>
        `${r.date}: ${r.type} ride on ${r.horse}, focus: ${r.focusMilestone}, signal: ${r.signal}${r.biometrics ? `, avg score: ${Math.round(Object.values(r.biometrics).reduce((a, b) => a + b, 0) / Object.values(r.biometrics).length * 100)}%` : ''}`
      ).join('\n');

  return `You are Cadence, an intelligent riding advisor built into the Horsera app. You are deeply knowledgeable about equestrian riding, biomechanics, and development.

Your rider is ${name}, who rides a horse named ${horse} and trains in ${discipline}. They are currently working toward ${currentLevel} level, with their active milestone being "${milestoneName}".

Recent rides:
${ridesSummary}

Your personality:
- Warm, precise, and deeply equestrian — you speak like an experienced trainer, not a chatbot
- You give specific, actionable guidance rooted in the rider's actual data
- You are ambient and calm — you suggest, you don't announce
- You know this rider well and refer to their specific progress and patterns
- Keep responses concise and focused (2-4 sentences unless asked for more)
- Never be generic — always connect advice to ${name}'s specific situation with ${horse}
- You can also answer general equestrian questions (gaits, biomechanics, disciplines, breeds, training concepts) with the same warm, expert tone — always grounding your answer in the rider's context when relevant`;
}

function renderMarkdown(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\n/g, '<br/>');
}

// ─── Web Speech API — ambient type declarations ───────────────────────
type SpeechState = 'idle' | 'listening' | 'done';

declare global {
  interface Window {
    SpeechRecognition: typeof SpeechRecognition;
    webkitSpeechRecognition: typeof SpeechRecognition;
  }
}

function getSpeechRecognitionClass(): (new () => SpeechRecognition) | null {
  if (typeof window === 'undefined') return null;
  // Works on Chrome (SpeechRecognition) and iOS Safari (webkitSpeechRecognition)
  return (window.SpeechRecognition || window.webkitSpeechRecognition) ?? null;
}

interface CadenceDrawerProps {
  open: boolean;
  onClose: () => void;
  onStreamingChange?: (v: boolean) => void;
  onSpeechStateChange?: (v: SpeechState) => void;
}

function loadHistory(): Message[] {
  try {
    const raw = safeStorage.getItem(CADENCE_HISTORY_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    }
  } catch {
    // Ignore malformed persisted chat history and start fresh.
  }
  const p = getUserProfile();
  const name = p.firstName || 'Rider';
  return [{
    role: 'cadence',
    text: `Hi ${name}. I've been watching your recent rides. Your rein steadiness has improved noticeably — and your lower leg is your current focus. What's on your mind today?`,
    timestamp: 'Now',
  }];
}

export default function CadenceDrawer({ open, onClose, onStreamingChange, onSpeechStateChange }: CadenceDrawerProps) {
  const profile = getUserProfile();
  const riderName = profile.firstName || 'Rider';
  const [messages, setMessages] = useState<Message[]>(loadHistory);
  const [input, setInput] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [rateLimitMsg, setRateLimitMsg] = useState<string | null>(null);
  const [speechState, setSpeechState] = useState<SpeechState>('idle');
  const [interimTranscript, setInterimTranscript] = useState('');
  const [comingSoonMsg, setComingSoonMsg] = useState<string | null>(null);
  const comingSoonTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [pendingImage, setPendingImage] = useState<{ dataUrl: string; name: string } | null>(null);
  const recognitionRef = useRef<SpeechRecognition | null>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    if (messages.length > 1) {
      safeStorage.setItem(CADENCE_HISTORY_KEY, JSON.stringify(messages.slice(-30)));
    }
  }, [messages]);


  // Abort any active recognition when drawer closes
  useEffect(() => {
    if (!open && recognitionRef.current) {
      try { recognitionRef.current.abort(); } catch {
        // Ignore browsers that throw while tearing down recognition.
      }
      recognitionRef.current = null;
      setSpeechState('idle'); onSpeechStateChange?.('idle');
    }
  }, [open, onSpeechStateChange]);

  const showComingSoon = useCallback((msg: string) => {
    if (comingSoonTimerRef.current) clearTimeout(comingSoonTimerRef.current);
    setComingSoonMsg(msg);
    comingSoonTimerRef.current = setTimeout(() => setComingSoonMsg(null), 2500);
  }, []);

  const sendMessage = useCallback(async (text: string, imageDataUrl?: string) => {
    if (!text.trim() || isStreaming) return;
    const now = new Date().toLocaleTimeString('en', { hour: '2-digit', minute: '2-digit' });
    const riderMsg: Message = {
      role: 'rider',
      text,
      timestamp: now,
      ...(imageDataUrl ? { imageUrl: imageDataUrl } : {}),
    };
    // Build the text for the API (includes image context hint for fallback path)
    const riderText = imageDataUrl ? `[Image attached]\n\n${text}` : text;
    setMessages(prev => [...prev, riderMsg]);
    setInput('');
    setPendingImage(null);
    setIsStreaming(true); onStreamingChange?.(true);
    setRateLimitMsg(null);

    const allMessages = [...messages, riderMsg];

    if (!OPENAI_API_KEY) {
      // No API key — use fallback
      const fallback = getFallbackResponse(text);
      setTimeout(() => {
        setMessages(prev => [...prev, { role: 'cadence', text: fallback, timestamp: now }]);
        setIsStreaming(false); onStreamingChange?.(false);
      }, 800);
      return;
    }

    // Build OpenAI messages: system prompt + full conversation history
    const openAiMessages: { role: string; content: string | { type: string; text?: string; image_url?: { url: string } }[] }[] = [
      { role: 'system', content: buildSystemPrompt() },
      ...allMessages.map(m => {
        if (m === riderMsg && imageDataUrl) {
          return {
            role: 'user',
            content: [
              { type: 'text', text },
              { type: 'image_url', image_url: { url: imageDataUrl } },
            ],
          };
        }
        return {
          role: m.role === 'rider' ? 'user' : 'assistant',
          content: m.text,
        };
      }),
    ];

    try {
      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${OPENAI_API_KEY}`,
        },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          messages: openAiMessages,
          stream: true,
          max_tokens: 400,
          temperature: 0.7,
        }),
      });

      if (response.status === 429) {
        setRateLimitMsg('Cadence is resting — try again in a moment.');
        setIsStreaming(false); onStreamingChange?.(false);
        return;
      }
      if (!response.ok) throw new Error(`OpenAI API error: ${response.status}`);

      const cadenceMsg: Message = { role: 'cadence', text: '', timestamp: now };
      setMessages(prev => [...prev, cadenceMsg]);

      const reader = response.body?.getReader();
      const decoder = new TextDecoder();
      if (!reader) throw new Error('No response body');

      let buffer = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const data = line.slice(6).trim();
          if (data === '[DONE]') continue;
          try {
            const parsed = JSON.parse(data);
            const delta = parsed.choices?.[0]?.delta?.content;
            if (delta) {
              setMessages(prev => {
                const updated = [...prev];
                const last = updated[updated.length - 1];
                if (last.role === 'cadence') updated[updated.length - 1] = { ...last, text: last.text + delta };
                return updated;
              });
            }
          } catch {
            // Ignore malformed streaming chunks and keep reading.
          }
        }
      }
    } catch {
      const fallback = getFallbackResponse(text);
      setMessages(prev => {
        const last = prev[prev.length - 1];
        if (last.role === 'cadence' && last.text === '') {
          const updated = [...prev];
          updated[updated.length - 1] = { ...last, text: fallback };
          return updated;
        }
        return [...prev, { role: 'cadence', text: fallback, timestamp: now }];
      });
    } finally {
      setIsStreaming(false); onStreamingChange?.(false);
    }
  }, [messages, isStreaming, onStreamingChange]);

  const handlePickImage = useCallback(() => {
    if (isStreaming) return;
    fileInputRef.current?.click();
  }, [isStreaming]);

  const handleFileChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';
    if (!file.type.startsWith('image/')) { showComingSoon('Please choose an image file'); return; }
    if (file.size > 5 * 1024 * 1024) { showComingSoon('Image too large (max 5MB for now)'); return; }
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => reject(new Error('File read failed'));
      reader.readAsDataURL(file);
    });
    setPendingImage({ dataUrl, name: file.name });
  }, [showComingSoon]);

  // ─── Voice input — Web Speech API (Chrome + iOS Safari webkit prefix) ─────
  const toggleRecording = useCallback(async () => {
    const SpeechRecognitionClass = getSpeechRecognitionClass();

    // Graceful fallback: if no Speech API, show the toast
    if (!SpeechRecognitionClass) {
      showComingSoon('Voice input coming soon');
      return;
    }

    // If already listening, stop the current session
    if (speechState === 'listening') {
      try { recognitionRef.current?.stop(); } catch {
        // Ignore stop errors from browsers that already ended recognition.
      }
      setInterimTranscript('');
      return;
    }

    // Start a new recognition session
    try {
      const recognition = new SpeechRecognitionClass();
      recognitionRef.current = recognition;

      recognition.continuous = false;   // single utterance
      recognition.interimResults = false;
      recognition.lang = 'en-US';
      recognition.maxAlternatives = 1;

      setSpeechState('listening'); onSpeechStateChange?.('listening');

      recognition.onresult = (event: SpeechRecognitionEvent) => {
        const transcript = event.results[0]?.[0]?.transcript?.trim() ?? '';
        if (transcript) {
          // Fill the input so the rider can review/edit before sending
          setInput(prev => prev ? `${prev} ${transcript}` : transcript);
        }
        setSpeechState('done'); onSpeechStateChange?.('done');
        // Brief "done" glow, then back to idle
        setTimeout(() => setSpeechState('idle'), 700);
      };

      recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
        if (event.error === 'no-speech') {
          showComingSoon('No speech detected — try again');
        } else if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
          showComingSoon('Microphone access denied');
        } else if (event.error !== 'aborted') {
          showComingSoon('Voice input unavailable');
        }
        setSpeechState('idle'); onSpeechStateChange?.('idle');
        recognitionRef.current = null;
      };

      recognition.onend = () => {
        setInterimTranscript('');
        setSpeechState(prev => { const next = prev === 'listening' ? 'idle' : prev; onSpeechStateChange?.(next); return next; });
        recognitionRef.current = null;
      };

      recognition.start();
    } catch {
      showComingSoon('Voice input unavailable');
      setSpeechState('idle'); onSpeechStateChange?.('idle');
    }
  }, [speechState, showComingSoon, onSpeechStateChange]);

  const isRecording = speechState === 'listening';

  if (!open) return null;

  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(26,20,14,0.4)', zIndex: 70, transition: 'opacity 0.2s ease' }} />
      <div style={{ position: 'fixed', bottom: 0, left: '50%', transform: 'translateX(-50%)', width: 'min(100vw, 430px)', height: '78%', background: '#FAF7F3', borderRadius: '28px 28px 0 0', zIndex: 80, display: 'flex', flexDirection: 'column', overflow: 'hidden', boxShadow: '0 -8px 40px rgba(0,0,0,0.18)' }}>
        <div style={{ display: 'flex', justifyContent: 'center', paddingTop: '12px', paddingBottom: '4px' }}>
          <div style={{ width: '36px', height: '4px', background: '#EDE7DF', borderRadius: '2px' }} />
        </div>

        {/* ── Drawer header: new Cadence icon ── */}
        <div style={{ padding: '12px 20px 14px', borderBottom: '1px solid #EDE7DF', display: 'flex', alignItems: 'center', gap: '10px' }}>
          <div style={{
            width: '36px', height: '36px', borderRadius: '50%',
            background: '#1C1510',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            flexShrink: 0,
          }}>
            <CadenceIcon size={20} />
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: '15px', fontWeight: 600, color: '#1A140E' }}>Cadence</div>
            <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: '11px', color: '#B5A898' }}>Your intelligent riding advisor</div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#B5A898', fontSize: '20px', lineHeight: 1, padding: '4px' }}>×</button>
        </div>

        {rateLimitMsg && (
          <div style={{ padding: '10px 20px', background: 'rgba(196,113,74,0.08)', borderBottom: '1px solid rgba(196,113,74,0.15)', fontSize: '12px', color: '#C4714A', fontFamily: "'DM Sans', sans-serif", textAlign: 'center' }}>{rateLimitMsg}</div>
        )}

        {/* ── Messages ── */}
        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {messages.map((msg, i) => (
            <div key={i} style={{ display: 'flex', justifyContent: msg.role === 'rider' ? 'flex-end' : 'flex-start' }}>
              {msg.role === 'cadence' && (
                <div style={{ width: 24, height: 24, borderRadius: '50%', background: '#1C1510', flexShrink: 0, marginRight: 8, marginTop: 2, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <CadenceIcon size={14} />
                </div>
              )}
              <div style={{ maxWidth: '78%', padding: '10px 14px', borderRadius: msg.role === 'rider' ? '16px 16px 4px 16px' : '4px 16px 16px 16px', background: msg.role === 'rider' ? '#8C5A3C' : '#F1F4FA', color: msg.role === 'rider' ? '#FAF7F3' : '#1A140E', fontSize: '13.5px', lineHeight: 1.55, fontFamily: "'DM Sans', sans-serif" }}>
                {msg.imageUrl && (
                  <img src={msg.imageUrl} alt="Attached" style={{ display: 'block', width: 120, height: 80, objectFit: 'cover', borderRadius: 8, marginBottom: msg.text ? 8 : 0, border: '1px solid rgba(255,255,255,0.2)' }} />
                )}
                {msg.text && <span dangerouslySetInnerHTML={{ __html: renderMarkdown(msg.text) }} />}
                {isStreaming && i === messages.length - 1 && msg.role === 'cadence' && <span style={{ opacity: 0.5, animation: 'blink 1s infinite' }}>▊</span>}
              </div>
            </div>
          ))}
          {isStreaming && messages[messages.length - 1]?.role === 'rider' && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{ width: 24, height: 24, borderRadius: '50%', background: '#1C1510', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <CadenceIcon size={14} />
              </div>
              <div style={{ padding: '10px 14px', borderRadius: '4px 16px 16px 16px', background: '#F1F4FA', display: 'flex', gap: 4 }}>
                {[0, 1, 2].map(i => <div key={i} style={{ width: 6, height: 6, borderRadius: '50%', background: '#6B7FA3', animation: `bounce 1.2s ${i * 0.2}s infinite` }} />)}
              </div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* ── Suggested prompts ── */}
        {messages.length < 3 && (
          <div style={{ padding: '0 16px 8px', display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {suggestedPrompts.map((p, i) => (
              <button key={i} onClick={() => sendMessage(p)} style={{ background: '#F0EBE4', border: 'none', borderRadius: '20px', padding: '6px 12px', fontSize: '11.5px', color: '#7A6B5D', cursor: 'pointer', fontFamily: "'DM Sans', sans-serif", fontWeight: 500 }}>{p}</button>
            ))}
          </div>
        )}

        {/* ── Toast ── */}
        {comingSoonMsg && (
          <div style={{ position: 'fixed', bottom: '120px', left: '50%', transform: 'translateX(-50%)', background: '#1C1510', color: '#FAF7F3', padding: '8px 16px', borderRadius: '20px', fontSize: '12px', fontFamily: "'DM Sans', sans-serif", fontWeight: 500, boxShadow: '0 4px 16px rgba(0,0,0,0.2)', zIndex: 90, animation: 'fadeInUp 0.2s ease', whiteSpace: 'nowrap' }}>{comingSoonMsg}</div>
        )}

        {/* ── Input bar ── */}
        <div style={{ padding: '12px 16px 24px', borderTop: '1px solid #EDE7DF', display: 'flex', flexDirection: 'column', gap: 10, background: '#FAF7F3' }}>
          {pendingImage && (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: '8px 10px', background: '#FFFFFF', border: '1.5px solid #EDE7DF', borderRadius: '14px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                <img src={pendingImage.dataUrl} alt="Selected" style={{ width: 36, height: 36, objectFit: 'cover', borderRadius: 10, border: '1px solid #EDE7DF' }} />
                <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: 12, color: '#7A6B5D', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{pendingImage.name}</div>
              </div>
              <button onClick={() => setPendingImage(null)} style={{ width: 28, height: 28, borderRadius: '50%', border: 'none', background: '#F0EBE4', cursor: 'pointer', color: '#7A6B5D', fontSize: 16, lineHeight: 1 }} aria-label="Remove image">×</button>
            </div>
          )}
          {/* Live transcript display when recording */}
          {isRecording && (
            <div style={{
              background: 'rgba(140,90,60,0.06)',
              border: '1px solid rgba(140,90,60,0.18)',
              borderRadius: '12px',
              padding: '8px 12px',
              fontSize: '12.5px',
              color: interimTranscript ? '#1A140E' : '#B5A898',
              fontFamily: "'DM Sans', sans-serif",
              fontStyle: interimTranscript ? 'normal' : 'italic',
              lineHeight: 1.5,
              display: 'flex', alignItems: 'center', gap: 8,
              minHeight: 40,
            }}>
              <span style={{
                width: 8, height: 8, borderRadius: '50%',
                background: '#8C5A3C',
                flexShrink: 0,
                animation: 'mic-pulse 1.4s ease-out infinite',
              }} />
              {interimTranscript || 'Listening…'}
            </div>
          )}

          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
            {/* Mic / Done button */}
            <button
              onClick={toggleRecording}
              aria-label={isRecording ? 'Done — stop voice input' : 'Start voice input'}
              style={{
                minWidth: isRecording ? 64 : 40, height: 40,
                borderRadius: isRecording ? '20px' : '50%',
                background: isRecording ? '#8C5A3C' : '#F0EBE4',
                border: 'none', cursor: 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                gap: isRecording ? 5 : 0,
                flexShrink: 0,
                transition: 'all 0.2s ease',
                animation: isRecording ? 'mic-pulse 1.4s ease-out infinite' : 'none',
                padding: isRecording ? '0 14px' : '0',
              }}
            >
              {isRecording ? (
                <>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
                    <rect x="4" y="4" width="16" height="16" rx="3" fill="#FAF7F3" />
                  </svg>
                  <span style={{ fontSize: '11px', fontWeight: 600, color: '#FAF7F3', fontFamily: "'DM Sans', sans-serif", whiteSpace: 'nowrap' }}>Done</span>
                </>
              ) : (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                <rect x="8" y="2" width="8" height="12" rx="4" fill={'#7A6B5D'} />
                <path d="M5 11C5 14.87 8.13 18 12 18C15.87 18 19 14.87 19 11" stroke={'#7A6B5D'} strokeWidth="1.5" strokeLinecap="round" />
                <line x1="12" y1="18" x2="12" y2="22" stroke={'#7A6B5D'} strokeWidth="1.5" strokeLinecap="round" />
              </svg>
              )}
            </button>
            <input
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && !e.shiftKey && sendMessage(input, pendingImage?.dataUrl)}
              placeholder={isRecording ? 'Listening…' : 'Ask Cadence anything...'}
              disabled={isStreaming}
              style={{
                flex: 1, padding: '10px 14px', borderRadius: '12px',
                border: `1.5px solid ${isRecording ? 'rgba(140,90,60,0.5)' : '#EDE7DF'}`,
                background: '#FFFFFF', fontSize: '14px', color: '#1A140E',
                fontFamily: "'DM Sans', sans-serif", outline: 'none',
                opacity: isStreaming ? 0.6 : 1,
                transition: 'border-color 0.2s ease',
              }}
            />
            <input ref={fileInputRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handleFileChange} />
            <button onClick={handlePickImage} style={{ width: 40, height: 40, borderRadius: '50%', background: '#F0EBE4', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                <path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48" stroke="#7A6B5D" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            </button>
            <button onClick={() => sendMessage(input, pendingImage?.dataUrl)} disabled={isStreaming || !input.trim()} style={{ width: 40, height: 40, borderRadius: '50%', background: input.trim() && !isStreaming ? '#8C5A3C' : '#F0EBE4', border: 'none', cursor: input.trim() && !isStreaming ? 'pointer' : 'default', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'background 0.15s ease', flexShrink: 0 }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                <path d="M5 12H19M19 12L13 6M19 12L13 18" stroke={input.trim() && !isStreaming ? '#FAF7F3' : '#B5A898'} strokeWidth="2" strokeLinecap="round" />
              </svg>
            </button>
          </div>
        </div>

        <style>{`
          @keyframes bounce { 0%, 60%, 100% { transform: translateY(0); } 30% { transform: translateY(-4px); } }
          @keyframes blink { 0%, 100% { opacity: 0.5; } 50% { opacity: 0; } }
          @keyframes fadeInUp { from { opacity: 0; transform: translateX(-50%) translateY(8px); } to { opacity: 1; transform: translateX(-50%) translateY(0); } }
          @keyframes mic-pulse {
            0%   { box-shadow: 0 0 0 0   rgba(140,90,60,0.55); }
            60%  { box-shadow: 0 0 0 10px rgba(140,90,60,0); }
            100% { box-shadow: 0 0 0 0   rgba(140,90,60,0); }
          }
        `}</style>
      </div>
    </>
  );
}

function getFallbackResponse(question: string): string {
  const q = question.toLowerCase();

  // Ride-specific questions (use mock data context)
  if (q.includes('focus') || q.includes('next ride')) return "Based on your last 3 rides, I'd focus on your lower leg stability — specifically the right-rein drift we've been seeing.";
  if (q.includes('stirrup') || q.includes('right')) return "The right stirrup pattern is interesting — it shows up consistently across 4 of your last 5 rides.";
  if (q.includes('ready') || q.includes('spring classic') || q.includes('show')) return "You have 21 days until the Spring Classic — your core stability is mastered, rein steadiness is consolidating well.";
  if (q.includes('lower leg') || q.includes('stability score')) return "Your lower leg stability score is 72% — improving from 55% six weeks ago.";

  // General gait questions
  if (q.includes('trot') && (q.includes('sitting') || q.includes('sit'))) return "Sitting trot becomes easier when you follow the horse's movement rather than resist it. Think of your pelvis as a pendulum — let it swing fore and aft with each beat. Absorb through your hip flexors, not your lower back.";
  if (q.includes('canter') || q.includes('canter transition')) return "A clean canter transition comes from preparation, not force. Half-halt to balance the horse, position your outside leg slightly back, then ask with a light squeeze. The horse needs to be on the hindquarters before you ask.";
  if (q.includes('trot')) return "Trot has two beats — diagonal pairs of legs move together. In rising trot, you post on one diagonal; in dressage, you'll want to vary diagonals to develop the horse evenly. The rhythm should feel like a steady two-beat metronome.";
  if (q.includes('walk')) return "Walk is the foundation of everything. It's a four-beat gait with no moment of suspension — each hoof falls individually. Quality walk has clear, ground-covering strides with the hindfoot overtracking the frontfoot print.";
  if (q.includes('halt') || q.includes('square halt')) return "A square halt comes from riding forward into stillness, not pulling back. Use half-halts to prepare, close your leg to push the horse onto a giving hand, then close both legs and hands together. Think 'park the energy', not 'stop'.";
  if (q.includes('lateral') || q.includes('leg yield') || q.includes('shoulder-in') || q.includes('travers') || q.includes('renvers')) return "Lateral work teaches the horse to step under and across with the hindleg — this builds collection and suppleness. Leg yield is the gateway: the horse moves forward and sideways, with a slight flexion away from the direction of travel.";

  // Biomechanics / position
  if (q.includes('seat') || q.includes('deep seat')) return "A deep seat isn't about pushing down — it's about allowing your seat bones to follow the horse's back. Soften your hip flexors, breathe deeply, and think of your weight melting down through a relaxed leg. Tension is the enemy of depth.";
  if (q.includes('hand') || q.includes('rein contact') || q.includes('soft hand')) return "Soft hands aren't passive hands — they're elastic. Think of holding a small bird: firm enough that it can't fly away, gentle enough that it isn't hurt. The contact should travel from your elbow, through a supple wrist, to a steady finger.";
  if (q.includes('core') || q.includes('balance')) return "Core stability in the saddle isn't about bracing — it's about dynamic stability. Engage your deep abdominals gently, as if you're wearing a soft corset. This stabilises your pelvis so your leg and hand can operate independently.";
  if (q.includes('leg position') || q.includes('heel down')) return "The heel-down position is a consequence of a long, relaxed leg — not something you force. Let your weight sink into your heel naturally. If you have to push the heel down, the leg is probably too tense. Think about stretching down through the calf, not pointing the toe up.";

  // Disciplines
  if (q.includes('dressage')) return "Dressage is the art of riding the horse through progressive scales — rhythm, relaxation, contact, impulsion, straightness, collection. Each level builds on the last. The goal isn't perfection in movements; it's harmony between horse and rider.";
  if (q.includes('hunter') || q.includes('jumper') || q.includes('jumping')) return "In Hunter/Jumper, your eye to the fence is everything. Establish your rhythm in canter, find the distance early, and trust it. A balanced two-point and a following hand over the fence let the horse bascule freely through the back.";
  if (q.includes('pony club')) return "Pony Club develops well-rounded horsepeople: position, stable management, first aid, and eventually flatwork and jumping. The progressive rating system (D through A) gives you clear milestones. Each level tests both knowledge and practical skill.";

  // Breeds / horses
  if (q.includes('warmblood') || q.includes('thoroughbred') || q.includes('quarter horse') || q.includes('breed')) return "Different breeds have different movement characteristics. Warmbloods tend to have naturally elevated, elastic gaits. Thoroughbreds are often more sensitive and forward. Quarter Horses are compact and quick. Work with the horse you have — understand their natural balance before asking for more.";

  // Default — keep it personal to the rider's data
  return "Based on your recent rides and your current focus on Training Level Test 1, your strongest area right now is core stability — build everything else from a solid seat outward.";
}
