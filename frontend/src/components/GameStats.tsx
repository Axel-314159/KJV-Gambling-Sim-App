
import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '../lib/api';
import type { PlayerDataResponse } from '../types/api';
import { CartesianGrid, Legend, Line, LineChart, LabelList, Tooltip, XAxis, YAxis } from 'recharts';
// import { RechartsDevTools } from '@recharts/devtools';
import { GERAHS_PER_SHEKEL } from '../lib/currency';
// import { RechartsDevtools } from '@recharts/devtools';


export function IndexLineChart() {

  const { data: stats } = useQuery<PlayerDataResponse>({
    queryKey: ['playerLedgerStats'],
    queryFn: () => apiFetch<PlayerDataResponse>('/stats/ledger'),
  });
  
  if (!stats) return <div className="text-slate-400">Loading Player Statistics...</div>;

  const ledgerData = stats.ledgerData.map((datum) => ({
    date: datum.date,
    walletBalance: datum.walletBalance / GERAHS_PER_SHEKEL
  }));

  return (
    <LineChart style={{ width: '100%', aspectRatio: 2.5, maxWidth: 1000, margin: 'auto' }} responsive data={ledgerData}>
      <CartesianGrid strokeDasharray="4 4" />
      <XAxis dataKey="date" label="Date"/>
      <YAxis 
        width="auto" 
        label={{
          value: "Balance (Shekels)",
          angle: -90,
          position: 'insideLeft',
          style: { textAnchor: 'middle' }
        }} />
      <Tooltip />
      <Line type="monotone" dataKey="walletBalance" stroke='#fcba03' strokeWidth={2}>
        <LabelList 
            dataKey="walletBalance" 
            position="top" // Options: "top", "bottom", "left", "right", "insideTop", etc.
            offset={10}    // Distance in pixels from the data point
            fill="#aaa"
            fontSize={14}
          />
      </Line>
      <Legend position="insideTopRight" offset={20} />
    </LineChart>
  );
}
