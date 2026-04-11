export interface Post {
  id: string;
  timestamp: string;
  sentiment: 'bullish' | 'bearish';
  content: string;
  confidence: number;
  industry: string;
  tickers: string[];
}
