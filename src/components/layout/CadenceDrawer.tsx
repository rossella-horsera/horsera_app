import { useState, useRef, useEffect, useCallback } from 'react';
import React from 'react';
import { getUserProfile } from '../../lib/userProfile';
import { CadenceIcon } from './CadenceFAB';

interface Message {
  role: 'cadence' | 'rider';
  text: string;
  timestamp: string;
}

interface UsageStats {
  daily_used: number;
  daily_limit: number;
  monthly_used: number;
  monthly_limit: number;
}

const suggestedPrompts = [
  'What should I focus on in my next ride?',
  'Why do I keep losing my right stirrup?',
  'Am I ready for the Spring Classic?',
  'Explain my lower leg stability score',
];

const API_BASE = import.meta.env.DEV ? 'http://localhost:5000' : '__PORT_5000__'.startsWith('__') ? '' : '__PORT_5000__';

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

export default function CadenceDrawer({ open, onClose, onStreamingChange, onSpeechStateChange }: CadenceDrawerProps) {
  const profile = getUserProfile();
  const riderName = profile.firstName || 'Rider';
  const [messages, setMessages] = useState<Message[]>([
    {
      role: 'cadence',
      text: `Hi ${riderName}. I've been watching your recent rides. Your rein steadiness has improved noticeably — and your lower leg is your current focus. What's on your mind today?`,
      timestamp: 'Now',
    },
  ]);
  const [input, setInput] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [usage, setUsage] = useState<UsageStats | null>(null);
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
    if (open) {
      fetch(`${API_BASE}/api/cadence/usage`)
        .then(r => r.json())
        .then(setUsage)
        .catch(() => {});
    }
  }, [open]);

  // Abort any active recognition when drawer closes
  useEffect(() => {
    if (!open && recognitionRef.current) {
      try { recognitionRef.current.abort(); } catch {}
      recognitionRef.current = null;
      setSpeechState('idle'); onSpeechStateChange?.('idle');
    }
  }, [open]);

  const showComingSoon = useCallback((msg: string) => {
    if (comingSoonTimerRef.current) clearTimeout(comingSoonTimerRef.current);
    setComingSoonMsg(msg);
    comingSoonTimerRef.current = setTimeout(() => setComingSoonMsg(null), 2500);
  }, []);

  const sendMessage = useCallback(async (text: string, imageDataUrl?: string) => {
    if (!text.trim() || isStreaming) return;
    const now = new Date().toLocaleTimeString('en', { hour: '2-digit', minute: '2-digit' });
    const riderText = imageDataUrl ? `[Image attached]\n\n${text}` : text;
    const riderMsg: Message = { role: 'rider', text: riderText, timestamp: now };
    setMessages(prev => [...prev, riderMsg]);
    setInput('');
    setPendingImage(null);
    setIsStreaming(true); onStreamingChange?.(true);
    setRateLimitMsg(null);
    const allMessages = [...messages, riderMsg];
    const apiMessages = allMessages.map(m => ({
      role: m.role === 'rider' ? 'user' : 'assistant',
      content: m.text,
    }));
    try {
      const response = await fetch(`${API_BASE}/api/cadence/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: apiMessages,
          riderName: getUserProfile().firstName || undefined,
          image: imageDataUrl || undefined,
        }),
      });
      if (response.status === 429) {
        const err = await response.json();
        setRateLimitMsg(err.detail?.message || 'You have reached your message limit. Please try again later.');
        setIsStreaming(false); onStreamingChange?.(false);
        return;
      }
      if (!response.ok) throw new Error(`API error: ${response.status}`);
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
          const data = line.slice(6);
          if (data === '[DONE]') continue;
          try {
            const parsed = JSON.parse(data);
            if (parsed.type === 'text') {
              setMessages(prev => {
                const updated = [...prev];
                const last = updated[updated.length - 1];
                if (last.role === 'cadence') updated[updated.length - 1] = { ...last, text: last.text + parsed.text };
                return updated;
              });
            } else if (parsed.type === 'usage') {
              setUsage({ daily_used: parsed.daily_used, daily_limit: parsed.daily_limit, monthly_used: parsed.monthly_used, monthly_limit: parsed.monthly_limit });
            } else if (parsed.type === 'error') {
              setMessages(prev => {
                const updated = [...prev];
                const last = updated[updated.length - 1];
                if (last.role === 'cadence') updated[updated.length - 1] = { ...last, text: "I'm having trouble connecting right now. Please try again in a moment." };
                return updated;
              });
            }
          } catch {}
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
  }, [messages, isStreaming]);

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
      try { recognitionRef.current?.stop(); } catch {}
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
  }, [speechState, showComingSoon]);

  const isRecording = speechState === 'listening';

  if (!open) return null;

  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(26,20,14,0.4)', zIndex: 70, transition: 'opacity 0.2s ease' }} />
      <div style={{ position: 'fixed', bottom: 0, left: '50%', transform: 'translateX(-50%)', width: '100%', maxWidth: '430px', height: '78%', background: '#FAF7F3', borderRadius: '28px 28px 0 0', zIndex: 80, display: 'flex', flexDirection: 'column', overflow: 'hidden', boxShadow: '0 -8px 40px rgba(0,0,0,0.18)' }}>
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
          {usage && (
            <div style={{ fontSize: '9px', fontFamily: "'DM Mono', monospace", color: usage.daily_used > usage.daily_limit * 0.8 ? '#C4714A' : '#B5A898', textAlign: 'right', marginRight: 8 }}>
              {usage.daily_used}/{usage.daily_limit} today
            </div>
          )}
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#B5A898', fontSize: '20px', lineHeight: 1, padding: '4px' }}>×</button>
        </div>

        {rateLimitMsg && (
          <div style={{ padding: '10px 20px', background: 'rgba(196,113,74,0.08)', borderBottom: '1px solid rgba(196,113,74,0.15)', fontSize: '12px', color: '#C4714A', fontFamily: "'DM Sans', sans-serif", textAlign: 'center' }}>{rateLimitMsg}</div>
        )}

        {/* ── Messages ── */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {messages.map((msg, i) => (
            <div key={i} style={{ display: 'flex', justifyContent: msg.role === 'rider' ? 'flex-end' : 'flex-start' }}>
              {msg.role === 'cadence' && (
                <div style={{ width: 24, height: 24, borderRadius: '50%', background: '#1C1510', flexShrink: 0, marginRight: 8, marginTop: 2, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <CadenceIcon size={14} />
                </div>
              )}
              <div style={{ maxWidth: '78%', padding: '10px 14px', borderRadius: msg.role === 'rider' ? '16px 16px 4px 16px' : '4px 16px 16px 16px', background: msg.role === 'rider' ? '#8C5A3C' : '#F1F4FA', color: msg.role === 'rider' ? '#FAF7F3' : '#1A140E', fontSize: '13.5px', lineHeight: 1.55, fontFamily: "'DM Sans', sans-serif" }}>
                <span dangerouslySetInnerHTML={{ __html: renderMarkdown(msg.text) }} />
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
  if (q.includes('focus') || q.includes('next ride')) return "Based on your last 3 rides, I'd focus on your lower leg stability — specifically the right-rein drift we've been seeing.";
  if (q.includes('stirrup') || q.includes('right')) return "The right stirrup pattern is interesting — it shows up consistently across 4 of your last 5 rides.";
  if (q.includes('ready') || q.includes('spring classic') || q.includes('show')) return "You have 21 days until the Spring Classic — your core stability is mastered, rein steadiness is consolidating well.";
  if (q.includes('lower leg') || q.includes('stability score')) return "Your lower leg stability score is 72% — improving from 55% six weeks ago.";
  return "Based on your recent rides and your current focus on Training Level Test 1, your strongest area right now is core stability — build everything else from a solid seat outward.";
}
