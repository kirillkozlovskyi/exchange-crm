import ActiveShiftsAdmin from './ActiveShiftsAdmin';
import CompanyBalanceCard from './CompanyBalanceCard';
import NbuWidget from './NbuWidget';

/**
 * «Огляд» — стартова сторінка адмінки: хто зараз працює, загальний баланс
 * компанії та курси НБУ. Все найважливіше — на одному екрані.
 */
export default function AdminOverview() {
  return (
    <div className="grid grid-cols-1 xl:grid-cols-3 gap-4 items-start">
      <div className="xl:col-span-2">
        <ActiveShiftsAdmin />
      </div>
      <div className="space-y-4">
        <CompanyBalanceCard />
        <NbuWidget inline />
      </div>
    </div>
  );
}
