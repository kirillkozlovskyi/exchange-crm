import React, { createContext, useContext, useState, useEffect } from 'react';
import api from '../api/axios';

interface User {
  sub: number;
  login: string;
  name: string;
  role: 'CASHIER' | 'SENIOR_CASHIER' | 'ADMIN';
  exchangePointId: number | null;
}

interface AuthContextType {
  user: User | null;
  token: string | null;
  login: (login: string, password: string) => Promise<void>;
  logout: () => void;
  isLoading: boolean;
}

const AuthContext = createContext<AuthContextType>(null!);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const savedToken = localStorage.getItem('token');
    const savedUser = localStorage.getItem('user');
    if (savedToken && savedUser) {
      setToken(savedToken);
      setUser(JSON.parse(savedUser));
    }
    setIsLoading(false);
  }, []);

  const login = async (login: string, password: string) => {
    const { data } = await api.post('/auth/login', { login, password });
    localStorage.setItem('token', data.access_token);
    const { data: me } = await api.get('/auth/me', {
      headers: { Authorization: `Bearer ${data.access_token}` },
    });
    localStorage.setItem('user', JSON.stringify(me));
    setToken(data.access_token);
    setUser(me);
  };

  const logout = () => {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    setToken(null);
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, token, login, logout, isLoading }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
