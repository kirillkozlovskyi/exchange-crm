import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import api from '../api/axios';
import { setNumberFormatPrefs, getNumberFormatPrefs, NumberFormatPrefs } from '../lib/format';
import { useAuth } from './AuthContext';

interface NumberFormatContextType {
  prefs: NumberFormatPrefs;
  refresh: () => Promise<void>;
}

const NumberFormatContext = createContext<NumberFormatContextType>(null!);

// Обгортає весь застосунок (у App.tsx, всередині AuthProvider): тримає
// глобальний формат чисел (fmtNum/fmtMoney у lib/format.ts) у стані React,
// щоб зміна set-стану тут перемалювала все дерево з новим форматом одразу
// після логіну чи після збереження в адмінці (без перезавантаження сторінки).
export function NumberFormatProvider({ children }: { children: React.ReactNode }) {
  const { token } = useAuth();
  const [prefs, setPrefs] = useState<NumberFormatPrefs>(getNumberFormatPrefs());

  const refresh = useCallback(async () => {
    try {
      const { data } = await api.get('/settings/number-format');
      setNumberFormatPrefs(data);
      setPrefs(data);
    } catch {
      // не залогінені / мережева помилка — лишаємо поточний формат
    }
  }, []);

  useEffect(() => {
    if (token) refresh();
  }, [token, refresh]);

  return (
    <NumberFormatContext.Provider value={{ prefs, refresh }}>
      {children}
    </NumberFormatContext.Provider>
  );
}

export const useNumberFormat = () => useContext(NumberFormatContext);
