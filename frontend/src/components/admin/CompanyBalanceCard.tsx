import { useEffect, useState } from 'react';
import api from '../../api/axios';
import { fmtNum, fmtMoney, fmtInt } from '../../lib/format';

type Company = {
  bank: Record<string, number>;
  desks: Record<string, number>;
  total: Record<string, number>;
  usdt: { global: number; points: number; total: number };
  // «Компанія в доларах»: каси за їх собівартістю, банк — за ринковою базою.
  usdTotal?: { desks: number; bank: number; usdt: number; total: number; usdSellRate: number };
};

/**
 * Загальний баланс компанії = Банк + Σ поточної готівки кас (+ USDT).
 * Використовується на «Огляді» та сторінці «Карта».
 */
export default function CompanyBalanceCard({ refreshKey = 0 }: { refreshKey?: number }) {
  const [company, setCompany] = useState<Company | null>(null);

  useEffect(() => {
    api.get('/cash-bank/company').then(({ data }) => setCompany(data)).catch(() => {});
  }, [refreshKey]);

  if (!company) {
    return (
      <div className="bg-white rounded-xl shadow p-5 text-center text-gray-400 text-sm">
        Завантаження балансу…
      </div>
    );
  }

  const currencies = Object.keys(company.total)
    .filter((c) => Math.abs(company.total[c]) >= 0.005)
    .sort();

  return (
    <div className="bg-gradient-to-br from-blue-50 to-white rounded-xl shadow p-5 border border-blue-100">
      <h3 className="font-semibold text-lg mb-3">🧮 Загальний баланс компанії</h3>
      <div className="overflow-x-auto">
        <table className="w-full text-sm border-collapse min-w-[380px]">
          <thead>
            <tr className="text-[11px] text-gray-500 uppercase tracking-wide border-b">
              <th className="py-1.5 px-3 text-left font-medium">Валюта</th>
              <th className="py-1.5 px-3 text-right font-medium">Карта</th>
              <th className="py-1.5 px-3 text-right font-medium">Каси</th>
              <th className="py-1.5 px-3 text-right font-medium">Разом</th>
            </tr>
          </thead>
          <tbody>
            {currencies.map((c) => (
              <tr key={c} className="border-b last:border-0">
                <td className="py-1.5 px-3 font-semibold text-gray-700">{c}</td>
                <td className="py-1.5 px-3 text-right tabular-nums text-gray-500">{fmtMoney(company.bank[c] ?? 0)}</td>
                <td className="py-1.5 px-3 text-right tabular-nums text-gray-500">{fmtMoney(company.desks[c] ?? 0)}</td>
                <td className="py-1.5 px-3 text-right tabular-nums font-bold text-blue-800">{fmtMoney(company.total[c] ?? 0)}</td>
              </tr>
            ))}
            <tr className="border-t-2">
              <td className="py-1.5 px-3 font-semibold text-teal-700">USDT</td>
              <td className="py-1.5 px-3 text-right tabular-nums text-gray-500">{company.usdt.global.toFixed(4)}</td>
              <td className="py-1.5 px-3 text-right tabular-nums text-gray-500">{company.usdt.points.toFixed(4)}</td>
              <td className="py-1.5 px-3 text-right tabular-nums font-bold text-teal-700">{company.usdt.total.toFixed(4)}</td>
            </tr>
            {company.usdTotal && (
              <tr className="border-t-2 bg-blue-50/50">
                <td className="py-2 px-3 font-bold text-blue-900">Разом у $</td>
                <td className="py-2 px-3 text-right tabular-nums text-gray-600">{fmtMoney(company.usdTotal.bank)}</td>
                <td className="py-2 px-3 text-right tabular-nums text-gray-600">{fmtMoney(company.usdTotal.desks)}</td>
                <td className="py-2 px-3 text-right tabular-nums font-bold text-blue-900 text-base">
                  {fmtMoney(company.usdTotal.total)} $
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-gray-400 mt-2">
        Каси = поточна готівка відкритих змін + останній залишок закритих. USDT — глобальний гаманець + гаманці точок.
        {company.usdTotal ? ' «Разом у $»: каси за їх собівартістю (сер. курс/кроси), карта — за поточними курсами, USDT 1:1.' : ''}
      </p>
    </div>
  );
}
