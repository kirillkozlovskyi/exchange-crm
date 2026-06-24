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
}

const ShiftHeaderContext = createContext<ShiftHeaderContextType>({
  info: null,
  setInfo: () => {},
});

export function ShiftHeaderProvider({ children }: { children: ReactNode }) {
  const [info, setInfo] = useState<ShiftHeaderInfo | null>(null);
  return (
    <ShiftHeaderContext.Provider value={{ info, setInfo }}>
      {children}
    </ShiftHeaderContext.Provider>
  );
}

export function useShiftHeader() {
  return useContext(ShiftHeaderContext);
}
