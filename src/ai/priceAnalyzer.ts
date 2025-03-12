import axios from 'axios';
import OpenAI from 'openai';
import dotenv from 'dotenv';

dotenv.config();

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

interface PriceData {
  date: string;
  price: number;
}

interface AnalysisResult {
  movingAverage7Day: number;
  movingAverage30Day: number;
  priceChangePercentage: number;
  priceFactor: number;
}

export async function fetchHistoricalPrices(tokenId: string, days: number = 30): Promise<PriceData[]> {
  try {
    const response = await axios.get(`https://api.coingecko.com/api/v3/coins/${tokenId}/market_chart`, {
      params: {
        vs_currency: 'usd',
        days: days,
      },
    });

    const data = response.data as { prices: [number, number][] };
    return data.prices.map((item: [number, number]) => ({
      date: new Date(item[0]).toISOString(),
      price: item[1],
    }));
  } catch (error) {
    console.error('Error fetching historical prices:', error);
    throw new Error('Failed to fetch historical prices');
  }
}

export function calculateMovingAverage(prices: PriceData[], period: number): number {
  if (prices.length < period) {
    throw new Error('Not enough price data to calculate moving average');
  }

  const recentPrices = prices.slice(-period);
  const sum = recentPrices.reduce((acc, data) => acc + data.price, 0);
  return sum / period;
}

export function calculatePriceChangePercentage(prices: PriceData[]): number {
  if (prices.length < 2) {
    throw new Error('Not enough price data to calculate price change');
  }

  const dateMap = new Map<string, PriceData[]>();
  
  prices.forEach(priceData => {
    const date = new Date(priceData.date);
    const dayKey = `${date.getUTCFullYear()}-${(date.getUTCMonth() + 1).toString().padStart(2, '0')}-${date.getUTCDate().toString().padStart(2, '0')}`;
    
    if (!dateMap.has(dayKey)) {
      dateMap.set(dayKey, []);
    }
    dateMap.get(dayKey)!.push(priceData);
  });
  
  const groupedByDay = Array.from(dateMap.entries())
    .sort((a, b) => a[0].localeCompare(b[0]));
  
  // console.log(`Found ${groupedByDay.length} days of price data`);
  groupedByDay.forEach(([day, prices]) => {
    // console.log(`Day ${day}: ${prices.length} price points, last price: ${prices[prices.length-1].price}`);
  });
  
  if (groupedByDay.length < 2) {
    throw new Error('Not enough days of price data to calculate day-over-day change');
  }
  
  const previousDayData = groupedByDay[groupedByDay.length - 2][1];
  const oldPrice = previousDayData[previousDayData.length - 1].price; 
  const oldPriceDate = previousDayData[previousDayData.length - 1].date;
  
  const currentDayData = groupedByDay[groupedByDay.length - 1][1];
  const currentPrice = currentDayData[currentDayData.length - 1].price; 
  const currentPriceDate = currentDayData[currentDayData.length - 1].date;
  const percentageChange = ((currentPrice - oldPrice) / oldPrice) * 100;
  
  return percentageChange;
}

export async function analyzeTokenPrice(tokenId: string): Promise<AnalysisResult> {
  try {
    const priceData = await fetchHistoricalPrices(tokenId);
    
    const movingAverage7Day = calculateMovingAverage(priceData, 7);
    
    const movingAverage30Day = calculateMovingAverage(priceData, 30);
    
    const priceChangePercentage = calculatePriceChangePercentage(priceData);
    
    const completion = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        {
          role: "system",
          content: `You are a cryptocurrency price analyzer. Analyze the provided data and return a single number:
          
          - If price is dropping (negative price change %), return a number between 0 and 1:
            * For minimal price drops (0 to -3%), return a number close to 1 (0.7-1.0)
            * For moderate price drops (-3% to -10%), return a mid-range number (0.3-0.7)
            * For significant price drops (< -10%), return a number close to 0 (0.0-0.3)
          
          - If price is rising (positive price change %), return a number between 1 and 2:
            * For minimal price increases (0-3%), return a number close to 1 (1.0-1.3)
            * For moderate price increases (3-10%), return a mid-range number (1.3-1.7)
            * For significant price increases (>10%), return a number close to 2 (1.7-1.9)
          
          Only return the number as a JSON object with a single field called "priceFactor". Nothing else.`
        },
        {
          role: "user",
          content: `
          Please analyze this token data and provide a price factor:
          
          Token: ${tokenId}
          7-Day Moving Average: $${movingAverage7Day.toFixed(4)}
          30-Day Moving Average: $${movingAverage30Day.toFixed(4)}
          1-Day Price Change: ${priceChangePercentage.toFixed(2)}%
          `
        }
      ],
      response_format: { type: "json_object" }
    });
    
    if (!completion.choices[0].message.content) {
      throw new Error('OpenAI response content is null');
    }
    
    const analysis = JSON.parse(completion.choices[0].message.content);
    const priceFactor = analysis.priceFactor;
    console.log('OpenAI analysis result:', analysis);
    
    return {
      movingAverage7Day,
      movingAverage30Day,
      priceChangePercentage,
      priceFactor
    };
  } catch (error) {
    console.error('Error analyzing token price:', error);
    const defaultPriceChange = 0;
    return {
      movingAverage7Day: 0,
      movingAverage30Day: 0,
      priceChangePercentage: defaultPriceChange,
      priceFactor: defaultPriceChange > 0 ? 1.5 : 0.5 
    };
  }
}

// replace this with the token ID you want to analyze :


// const tokenId: string = 'sonic-3';

// async function runAnalysis() {
//   const analysis = await analyzeTokenPrice(tokenId);
//   console.log('Analysis result:', analysis);
// }
// runAnalysis();