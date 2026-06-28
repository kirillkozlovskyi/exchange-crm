import { createContext, useContext, useState, ReactNode } from 'react';

interface ShiftHeaderInfo {
  pointName: string;
  deskName: string;
  shiftNumber: string;
  openedAt: string;
}

interface ShiftHeaderContextType {
  info: ShiftHeaderInfo | null;
  setInfo: (info: ShiftHeaderInfo | null) => void;
  actions: ReactNode | null;
  setActions: (actions: ReactNode | null) => void;
}

const ShiftHeaderContext = createContext<ShiftHeaderContextType>({
  info: null,
  setInfo: () => {},
  actions: null,
  setActions: () => {},
});

export function ShiftHeaderProvider({ children }: { children: ReactNode }) {
  const [info, setInfo] = useState<ShiftHeaderInfo | null>(null);
  const [actions, setActions] = useState<ReactNode | null>(null);
  return (
    <ShiftHeaderContext.Provider value={{ info, setInfo, actions, setActions }}>
      {children}
    </ShiftHeaderContext.Provider>
  );
}

export function useShiftHeader() {
  return useContext(ShiftHeaderContext);
}
