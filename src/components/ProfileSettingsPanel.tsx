import { useState, useEffect, useRef, useCallback } from 'react';
import { getUserProfile, saveUserProfile } from '../lib/userProfile';
import type { UserProfile } from '../lib/userProfile';
import { safeStorage } from '../lib/safeStorage';

const COLORS = {
  parchment: '#FAF7F3',
  cognac: '#8C5A3C',
  champagne: '#C9A96E',
  charcoal: '#1A140E',
  muted: '#B5A898',
  border: '#EDE7DF',
  cardBg: '#FFFFFF',
  softBg: '#F0EBE4',
};

const FONTS = {
  heading: "'Playfair Display', serif",
  body: "'DM Sans', sans-serif",
  mono: "'DM Mono', monospace",
};

const DISCIPLINES = [
  { value: 'usdf-dressage', label: 'USDF Dressage' },
  { value: 'pony-club', label: 'Pony Club' },
  { value: 'hunter-jumper', label: 'Hunter / Jumper' },
  { value: 'a-bit-of-everything', label: 'A Bit of Everything' },
] as const;

const PHOTO_KEY = 'horsera_profile_photo';

// ── Crop modal ──────────────────────────────────────────────────────────────

interface CropModalProps {
  imageSrc: string;
  onConfirm: (croppedDataUrl: string) => void;
  onCancel: () => void;
}

function CropModal({ imageSrc, onConfirm, onCancel }: CropModalProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const dragStart = useRef({ x: 0, y: 0, ox: 0, oy: 0 });

  const CROP_SIZE = 320; // px displayed crop circle (320 = sharp on 2× retina at 88px CSS)
  const [minScale, setMinScale] = useState(0.1);

  // Draw the preview whenever scale/offset changes
  useEffect(() => {
    const img = imgRef.current;
    const canvas = canvasRef.current;
    if (!img || !canvas || !img.complete) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const sz = CROP_SIZE;
    canvas.width = sz;
    canvas.height = sz;

    // Clear
    ctx.clearRect(0, 0, sz, sz);

    // Clip to circle
    ctx.save();
    ctx.beginPath();
    ctx.arc(sz / 2, sz / 2, sz / 2, 0, Math.PI * 2);
    ctx.clip();

    // Draw scaled + offset image — preserve natural aspect ratio
    const naturalW = img.naturalWidth;
    const naturalH = img.naturalHeight;
    const displayW = naturalW * scale;
    const displayH = naturalH * scale;
    const x = sz / 2 - displayW / 2 + offset.x;
    const y = sz / 2 - displayH / 2 + offset.y;
    ctx.drawImage(img, x, y, displayW, displayH);
    ctx.restore();
  }, [scale, offset, imageSrc]);

  const handlePointerDown = (e: React.PointerEvent) => {
    setDragging(true);
    dragStart.current = { x: e.clientX, y: e.clientY, ox: offset.x, oy: offset.y };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };
  const handlePointerMove = (e: React.PointerEvent) => {
    if (!dragging) return;
    setOffset({
      x: dragStart.current.ox + (e.clientX - dragStart.current.x),
      y: dragStart.current.oy + (e.clientY - dragStart.current.y),
    });
  };
  const handlePointerUp = () => setDragging(false);

  const confirm = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    onConfirm(canvas.toDataURL('image/jpeg', 0.85));
  };

  return (
    <>
      <div
        onClick={onCancel}
        style={{ position: 'fixed', inset: 0, background: 'rgba(26,20,14,0.6)', zIndex: 100 }}
      />
      <div style={{
        position: 'fixed',
        top: '50%', left: '50%',
        transform: 'translate(-50%, -50%)',
        width: 300, background: COLORS.parchment,
        borderRadius: 24, zIndex: 101,
        padding: '24px 20px 20px',
        boxShadow: '0 8px 40px rgba(0,0,0,0.25)',
        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16,
      }}>
        {/* Hidden img for drawing */}
        <img
          ref={imgRef}
          src={imageSrc}
          style={{ display: 'none' }}
          onLoad={() => {
            const img = imgRef.current;
            if (img) {
              // Minimum scale: both dims must fill the crop circle
              // With natural aspect ratio preserved: scale >= CROP_SIZE / naturalW AND scale >= CROP_SIZE / naturalH
              // So minScale = CROP_SIZE / min(naturalW, naturalH)
              const minDim = Math.min(img.naturalWidth, img.naturalHeight);
              const computedMin = minDim > 0 ? CROP_SIZE / minDim : 0.1;
              setMinScale(computedMin);
              setScale(computedMin); // start just covering the circle
            } else {
              // Trigger initial draw fallback
              setScale(s => s + 0.0001);
              setTimeout(() => setScale(s => s - 0.0001), 10);
            }
          }}
        />

        <div style={{ fontFamily: FONTS.heading, fontSize: 17, color: COLORS.charcoal }}>
          Adjust Photo
        </div>
        <div style={{ fontSize: 11, color: COLORS.muted, fontFamily: FONTS.body, textAlign: 'center', lineHeight: 1.5 }}>
          Drag to position · Pinch or use slider to zoom
        </div>

        {/* Crop preview */}
        <div style={{ position: 'relative', width: CROP_SIZE, height: CROP_SIZE }}>
          <canvas
            ref={canvasRef}
            width={CROP_SIZE}
            height={CROP_SIZE}
            style={{ borderRadius: '50%', border: `2.5px solid ${COLORS.cognac}`, cursor: dragging ? 'grabbing' : 'grab', boxShadow: '0 4px 20px rgba(140,90,60,0.25)' }}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerLeave={handlePointerUp}
          />
        </div>

        {/* Zoom slider */}
        <div style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 10, color: COLORS.muted, fontFamily: FONTS.mono }}>–</span>
          <input
            type="range" min={minScale} max={Math.max(minScale * 4, 2)} step={minScale / 20}
            value={scale}
            onChange={e => setScale(Number(e.target.value))}
            style={{ flex: 1, accentColor: COLORS.cognac }}
          />
          <span style={{ fontSize: 10, color: COLORS.muted, fontFamily: FONTS.mono }}>+</span>
        </div>

        <div style={{ display: 'flex', gap: 10, width: '100%' }}>
          <button
            onClick={onCancel}
            style={{ flex: 1, padding: '11px', borderRadius: 12, border: `1.5px solid ${COLORS.border}`, background: 'none', cursor: 'pointer', fontSize: 13, color: COLORS.charcoal, fontFamily: FONTS.body }}
          >
            Cancel
          </button>
          <button
            onClick={confirm}
            style={{ flex: 1, padding: '11px', borderRadius: 12, border: 'none', background: COLORS.cognac, color: COLORS.parchment, cursor: 'pointer', fontSize: 13, fontWeight: 600, fontFamily: FONTS.body }}
          >
            Use Photo
          </button>
        </div>
      </div>
    </>
  );
}

// ── Main panel ──────────────────────────────────────────────────────────────

interface ProfileSettingsPanelProps {
  open: boolean;
  onClose: () => void;
}

export default function ProfileSettingsPanel({ open, onClose }: ProfileSettingsPanelProps) {
  const [profile, setProfile] = useState<UserProfile>(getUserProfile);
  const [saved, setSaved] = useState(false);
  const [photoDataUrl, setPhotoDataUrl] = useState<string | null>(null);
  const [cropSrc, setCropSrc] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setProfile(getUserProfile());
      setSaved(false);
      setPhotoDataUrl(safeStorage.getItem(PHOTO_KEY));
    }
  }, [open]);

  const handleSave = () => {
    saveUserProfile(profile);
    setSaved(true);
    setTimeout(() => {
      setSaved(false);
      onClose();
    }, 900);
  };

  const handlePhotoSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';
    if (!file.type.startsWith('image/')) return;
    const reader = new FileReader();
    reader.onload = () => setCropSrc(reader.result as string);
    reader.readAsDataURL(file);
  }, []);

  const handleCropConfirm = useCallback((croppedDataUrl: string) => {
    safeStorage.setItem(PHOTO_KEY, croppedDataUrl);
    setPhotoDataUrl(croppedDataUrl);
    setCropSrc(null);
    // Dispatch a custom event so AppShell can re-render avatar
    window.dispatchEvent(new CustomEvent('horsera:photo-updated'));
  }, []);

  const handleRemovePhoto = () => {
    safeStorage.removeItem(PHOTO_KEY);
    setPhotoDataUrl(null);
    window.dispatchEvent(new CustomEvent('horsera:photo-updated'));
  };

  if (!open) return null;

  return (
    <>
      {cropSrc && (
        <CropModal
          imageSrc={cropSrc}
          onConfirm={handleCropConfirm}
          onCancel={() => setCropSrc(null)}
        />
      )}

      {/* Backdrop */}
      <div
        onClick={onClose}
        style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          background: 'rgba(26,20,14,0.3)', zIndex: 60,
        }}
      />

      {/* Panel */}
      <div style={{
        position: 'fixed', top: 0, right: 0, bottom: 0,
        width: '100%', maxWidth: '360px',
        background: COLORS.parchment, zIndex: 61,
        boxShadow: '-8px 0 30px rgba(26,20,14,0.12)',
        animation: 'slideInFromRight 0.25s ease-out',
        overflowY: 'auto',
        display: 'flex', flexDirection: 'column',
        paddingTop: 'env(safe-area-inset-top, 0px)',
      }}>
        <style>{`
          @keyframes slideInFromRight {
            from { transform: translateX(100%); }
            to { transform: translateX(0); }
          }
        `}</style>

        {/* Header */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '20px', borderBottom: `1px solid ${COLORS.border}`,
        }}>
          <div style={{ fontFamily: FONTS.heading, fontSize: '18px', color: COLORS.charcoal }}>
            Profile
          </div>
          <button
            onClick={onClose}
            style={{
              background: 'none', border: 'none', cursor: 'pointer', padding: 4,
              display: 'flex', alignItems: 'center',
            }}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
              <path d="M18 6L6 18M6 6l12 12" stroke={COLORS.charcoal} strokeWidth="1.8" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        <div style={{ padding: '20px', flex: 1 }}>

          {/* ── Profile Photo ───────────────────────────────── */}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            style={{ display: 'none' }}
            onChange={handlePhotoSelect}
          />

          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', marginBottom: 28 }}>
            {/* Avatar circle */}
            <div
              style={{
                position: 'relative',
                width: 88, height: 88,
                borderRadius: '50%',
                border: `2.5px solid ${COLORS.cognac}`,
                boxShadow: '0 4px 20px rgba(140,90,60,0.20)',
                cursor: 'pointer',
                overflow: 'hidden',
                background: COLORS.softBg,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                marginBottom: 12,
              }}
              onClick={() => fileInputRef.current?.click()}
            >
              {photoDataUrl ? (
                <img
                  src={photoDataUrl}
                  alt="Profile"
                  style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                />
              ) : (
                <span style={{
                  fontFamily: FONTS.heading, fontSize: 32, color: COLORS.cognac,
                  lineHeight: 1, fontWeight: 400,
                }}>
                  {profile.firstName ? profile.firstName[0].toUpperCase() : '?'}
                </span>
              )}

              {/* Upload overlay */}
              <div style={{
                position: 'absolute', inset: 0,
                background: 'rgba(140,90,60,0.55)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                opacity: 0,
                transition: 'opacity 0.15s',
                borderRadius: '50%',
              }}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.opacity = '1'; }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.opacity = '0'; }}
              >
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
                  <path d="M12 4v12M6 10l6-6 6 6" stroke="#FAF7F3" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                  <path d="M4 18h16" stroke="#FAF7F3" strokeWidth="2" strokeLinecap="round" />
                </svg>
              </div>
            </div>

            <button
              onClick={() => fileInputRef.current?.click()}
              style={{
                background: COLORS.softBg, border: 'none', cursor: 'pointer',
                borderRadius: 10, padding: '7px 16px',
                fontSize: 12, fontFamily: FONTS.body, color: COLORS.cognac,
                fontWeight: 600,
              }}
            >
              {photoDataUrl ? 'Change Photo' : 'Upload Photo'}
            </button>
            {photoDataUrl && (
              <button
                onClick={handleRemovePhoto}
                style={{
                  background: 'none', border: 'none', cursor: 'pointer',
                  fontSize: 11, fontFamily: FONTS.body, color: COLORS.muted,
                  marginTop: 4, padding: '4px 8px',
                }}
              >
                Remove
              </button>
            )}
          </div>

          {/* ── Profile fields ──────────────────────────────── */}
          <SectionLabel>Rider Info</SectionLabel>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', marginBottom: '28px' }}>
            <FieldGroup label="Your First Name">
              <input
                type="text"
                value={profile.firstName}
                onChange={e => setProfile(p => ({ ...p, firstName: e.target.value }))}
                style={inputStyle}
                placeholder="e.g. Rossella"
              />
            </FieldGroup>

            <FieldGroup label="Horse's Name">
              <input
                type="text"
                value={profile.horseName}
                onChange={e => setProfile(p => ({ ...p, horseName: e.target.value }))}
                style={inputStyle}
                placeholder="e.g. Caviar"
              />
            </FieldGroup>

            <FieldGroup label="Discipline">
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                {DISCIPLINES.map(d => (
                  <button
                    key={d.value}
                    onClick={() => setProfile(p => ({ ...p, discipline: d.value as UserProfile['discipline'] }))}
                    style={{
                      padding: '10px 8px', borderRadius: '10px', fontSize: '12px',
                      fontFamily: FONTS.body, fontWeight: 500, cursor: 'pointer',
                      border: profile.discipline === d.value
                        ? `2px solid ${COLORS.cognac}`
                        : `1px solid ${COLORS.border}`,
                      background: profile.discipline === d.value ? `${COLORS.cognac}10` : COLORS.cardBg,
                      color: profile.discipline === d.value ? COLORS.cognac : COLORS.charcoal,
                      transition: 'all 0.15s ease',
                    }}
                  >
                    {d.label}
                  </button>
                ))}
              </div>
            </FieldGroup>

            <button
              onClick={handleSave}
              style={{
                width: '100%', padding: '13px', borderRadius: '12px',
                background: saved ? '#7D9B76' : COLORS.cognac,
                color: COLORS.parchment, border: 'none', cursor: 'pointer',
                fontSize: '14px', fontWeight: 600, fontFamily: FONTS.body,
                transition: 'background 0.2s ease',
              }}
            >
              {saved ? 'Saved' : 'Save Changes'}
            </button>
          </div>

          {/* ── About ──────────────────────────────────────── */}
          <SectionLabel>About</SectionLabel>
          <div style={{
            background: COLORS.cardBg, borderRadius: '12px', padding: '16px',
            border: `1px solid ${COLORS.border}`,
          }}>
            <div style={{ fontFamily: FONTS.mono, fontSize: '11px', color: COLORS.muted, marginBottom: '6px' }}>
              Horsera MVP 0.1
            </div>
            <div style={{ fontFamily: FONTS.body, fontSize: '13px', color: '#6B5E50', marginBottom: '8px' }}>
              Made with 💖 from riders, for riders.
            </div>
            <a
              href="mailto:contact@horsera.ai"
              style={{
                fontFamily: FONTS.body, fontSize: '12px',
                color: COLORS.cognac, textDecoration: 'none',
                display: 'inline-flex', alignItems: 'center', gap: '5px',
              }}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <rect x="3" y="5" width="18" height="14" rx="2" stroke="currentColor" strokeWidth="1.6"/>
                <path d="M3 7l9 6 9-6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
              contact@horsera.ai
            </a>
          </div>
        </div>
      </div>
    </>
  );
}

// ── Helper components ───────────────────────────────────────────────────────

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      fontSize: '10px', fontWeight: 600, letterSpacing: '0.14em',
      textTransform: 'uppercase' as const, color: '#B5A898',
      fontFamily: "'DM Sans', sans-serif", marginBottom: '12px',
    }}>
      {children}
    </div>
  );
}

function FieldGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div style={{
        fontSize: '10px', fontWeight: 600, letterSpacing: '0.12em',
        textTransform: 'uppercase' as const, color: '#B5A898',
        fontFamily: "'DM Sans', sans-serif", marginBottom: '6px',
      }}>
        {label}
      </div>
      {children}
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '12px 14px', borderRadius: '10px',
  border: '1px solid #EDE7DF', background: '#FFFFFF',
  fontSize: '14px', fontFamily: "'DM Sans', sans-serif",
  color: '#1A140E', outline: 'none',
};
