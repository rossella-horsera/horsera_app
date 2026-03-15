import { createContext, useContext, useState } from 'react';
import type { ReactNode } from 'react';
import CadenceDrawer from '../components/layout/CadenceDrawer';

interface CadenceContextValue {
  openCadence: () => void;
  isStreaming: boolean;
  setIsStreaming: (v: boolean) => void;
  speechState: 'idle' | 'listening' | 'done';
  setSpeechState: (v: 'idle' | 'listening' | 'done') => void;
}

const CadenceContext = createContext<CadenceContextValue>({
  openCadence: () => {},
  isStreaming: false,
  setIsStreaming: () => {},
  speechState: 'idle',
  setSpeechState: () => {},
});

export function useCadence() {
  return useContext(CadenceContext);
}

export function CadenceProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const [speechState, setSpeechState] = useState<'idle' | 'listening' | 'done'>('idle');

  return (
    <CadenceContext.Provider value={{
      openCadence: () => setOpen(true),
      isStreaming,
      setIsStreaming,
      speechState,
      setSpeechState,
    }}>
      {children}
      <CadenceDrawer
        open={open}
        onClose={() => setOpen(false)}
        onStreamingChange={setIsStreaming}
        onSpeechStateChange={setSpeechState}
      />
    </CadenceContext.Provider>
  );
}