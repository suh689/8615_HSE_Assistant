export type ChartType = 'gauge' | 'bar' | 'pie';

export interface TriggerData {
  chart_type: ChartType;
  value: number;
  label: string;
  id: string;
}

export interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  triggerData?: TriggerData;
}
