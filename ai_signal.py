"""
AI Signal Generator for MoneyIndex
===================================
Uses NVIDIA NEM + Kimi K2.5 for AI-powered trading suggestions.

Features:
- Aggregates market data (OI, PCR, Max Pain, IV, Strike Votes)
- Generates bullish/bearish signals with confidence scores
- Evaluates option buying environment quality
"""

import requests
import json
import logging
from typing import Dict, Optional
from dataclasses import dataclass

logger = logging.getLogger(__name__)


@dataclass
class AIConfig:
    """AI Signal Configuration"""
    NVIDIA_API_KEY: str = ""
    NVIDIA_API_URL: str = "https://integrate.api.nvidia.com/v1/chat/completions"
    MODEL_NAME: str = "moonshotai/kimi-k2.5"
    AI_ENABLED: bool = True
    
    # Groq fallback
    GROQ_API_KEY: str = "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"
    
    # RL Settings
    RL_ENABLED: bool = True
    RL_REWARD_LOOKBACK_MINUTES: int = 30
    
    # Request settings
    MAX_TOKENS: int = 512
    TEMPERATURE: float = 0.3
    TIMEOUT_SECONDS: int = 30


class AISignalGenerator:
    """NVIDIA NEM + Kimi K2.5 AI signal generation"""
    
    def __init__(self, api_key: str, config: AIConfig = None):
        self.config = config or AIConfig()
        self.api_key = api_key
        self.url = self.config.NVIDIA_API_URL
        self.model = self.config.MODEL_NAME
    
    def aggregate_market_data(self, index_data: dict) -> dict:
        """
        Aggregate all metrics for AI analysis from index data.
        
        Extracts: strike votes, OI, PCR, Max Pain, IV, weighted score
        """
        bar_data = index_data.get('bar_graph_data', [])
        atm = index_data.get('atm', 0)
        interval = index_data.get('strike_interval', 50)
        
        # Get strikes within ATM ± 5 for voting
        near_strikes = [
            s for s in bar_data 
            if abs(s['strike'] - atm) <= 5 * interval
        ]
        
        max_pain = index_data.get('max_pain', {})
        spot = index_data.get('spot', 0)
        
        # Calculate max pain distance
        max_pain_strike = max_pain.get('strike', spot)
        max_pain_distance = 0
        if spot and max_pain_strike:
            max_pain_distance = round((max_pain_strike - spot) / spot * 100, 2)
        
        # Get IV data
        iv_data = index_data.get('iv_data', {})
        current_iv = iv_data.get('current_iv', 0)
        iv_trend = iv_data.get('iv_trend', 'STABLE')
        
        # Get weighted score
        weighted_score = index_data.get('current_weighted_score', {})
        
        return {
            'index': index_data.get('index', 'UNKNOWN'),
            'bullish_votes': sum(1 for s in near_strikes if s.get('net_signal', 0) > 0),
            'bearish_votes': sum(1 for s in near_strikes if s.get('net_signal', 0) < 0),
            'neutral_votes': sum(1 for s in near_strikes if s.get('net_signal', 0) == 0),
            'spot': spot,
            'atm': atm,
            'pcr': round(index_data.get('pcr', 0), 2),
            'max_pain_strike': max_pain_strike,
            'max_pain_distance': max_pain_distance,
            'weighted_score': weighted_score.get('score', 0),
            'weighted_signal': weighted_score.get('signal', 'NEUTRAL'),
            'current_iv': current_iv,
            'iv_trend': iv_trend,
            'total_ce_oi': index_data.get('total_ce_oi', 0),
            'total_pe_oi': index_data.get('total_pe_oi', 0),
            'overall_trend': index_data.get('overall_trend', 'NEUTRAL'),
            # Strike crossover data (if available from confluence call)
            'crossover_score': index_data.get('crossover_score', 0),
            'crossover_direction': index_data.get('crossover_direction', 'NEUTRAL'),
            'call_dominant_strikes': index_data.get('call_dominant_strikes', 0),
            'put_dominant_strikes': index_data.get('put_dominant_strikes', 0),
            'crossovers_from_baseline': index_data.get('crossovers_from_baseline', 0)
        }
    
    def generate_suggestion(self, market_data: dict) -> dict:
        """
        Query AI for trading suggestion.
        Tries NVIDIA first, falls back to Groq if timeout.
        
        Returns:
            dict with signal, confidence, environment, reasoning
        """
        # Try NVIDIA first
        if self.api_key:
            result = self._try_nvidia(market_data)
            if 'error' not in result or 'timed out' not in result.get('error', '').lower():
                return result
            logger.info("NVIDIA timed out, trying Groq fallback...")
        
        # Fallback to Groq (free)
        result = self._try_groq(market_data)
        return result
    
    def _try_nvidia(self, market_data: dict) -> dict:
        """Try NVIDIA NEM API"""
        prompt = self._build_prompt(market_data)
        
        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json"
        }
        
        payload = {
            "model": self.model,
            "messages": [
                {
                    "role": "system", 
                    "content": "You are an expert Indian options trading analyst. Analyze the given market metrics and provide trading suggestions. Respond ONLY with valid JSON, no markdown or explanation."
                },
                {"role": "user", "content": prompt}
            ],
            "max_tokens": self.config.MAX_TOKENS,
            "temperature": self.config.TEMPERATURE,
            "stream": False
        }
        
        try:
            response = requests.post(
                self.url, 
                headers=headers, 
                json=payload, 
                timeout=self.config.TIMEOUT_SECONDS
            )
            response.raise_for_status()
            result = response.json()
            
            content = result['choices'][0]['message']['content']
            parsed = self._parse_response(content)
            
            # Add metadata
            parsed['index'] = market_data.get('index', 'UNKNOWN')
            parsed['model'] = self.model
            
            logger.info(f"AI Signal for {parsed['index']}: {parsed['signal']} (confidence: {parsed['confidence']})")
            return parsed
            
        except requests.exceptions.Timeout:
            logger.error("NVIDIA API request timed out")
            return self._fallback_response("Request timed out")
        except requests.exceptions.RequestException as e:
            logger.error(f"NVIDIA API request failed: {e}")
            return self._fallback_response(str(e))
        except (KeyError, IndexError, json.JSONDecodeError) as e:
            logger.error(f"NVIDIA response parse error: {e}")
            return self._fallback_response("Response parse error")
    
    def _try_groq(self, market_data: dict) -> dict:
        """Try Groq API (free fallback)"""
        try:
            from groq import Groq
        except ImportError:
            logger.warning("Groq not installed, using fallback response")
            return self._smart_fallback(market_data)
        
        # Get Groq API key from config or environment
        import os
        groq_key = self.config.GROQ_API_KEY if hasattr(self.config, 'GROQ_API_KEY') else os.environ.get('GROQ_API_KEY', '')
        
        if not groq_key:
            logger.warning("GROQ_API_KEY not set, using confluence-based analysis")
            return self._smart_fallback(market_data)
        
        try:
            client = Groq(api_key=groq_key)
            prompt = self._build_prompt(market_data)
            
            response = client.chat.completions.create(
                model="llama-3.3-70b-versatile",
                messages=[
                    {
                        "role": "system",
                        "content": "You are an expert Indian options trading analyst. Respond ONLY with valid JSON."
                    },
                    {"role": "user", "content": prompt}
                ],
                temperature=0.3,
                max_tokens=400
            )
            
            content = response.choices[0].message.content
            
            if not content:
                logger.warning("Groq returned empty response")
                return self._smart_fallback(market_data)
            
            parsed = self._parse_response(content)
            parsed['index'] = market_data.get('index', 'UNKNOWN')
            parsed['model'] = 'groq/llama-3.3-70b'
            
            logger.info(f"Groq AI Signal for {parsed['index']}: {parsed['signal']}")
            return parsed
            
        except Exception as e:
            logger.error(f"Groq API failed: {e}")
            return self._smart_fallback(market_data)
    
    def _smart_fallback(self, market_data: dict) -> dict:
        """Generate signal based on confluence when AI is unavailable"""
        confluence = calculate_confluence_score(market_data)
        
        signal = confluence['direction']
        score = confluence['score']
        confidence = min(10, score * 2 + 3)  # Convert 0-5 to roughly 3-10
        
        # Determine environment based on factors
        if score >= 4:
            environment = "Good"
        elif score >= 2:
            environment = "Moderate"
        else:
            environment = "Poor"
        
        reasoning = confluence['aligned_factors'] if confluence['aligned_factors'] else ["No strong signals detected"]
        
        return {
            'signal': signal,
            'confidence': confidence,
            'environment': environment,
            'reasoning': reasoning,
            'model': 'confluence-fallback'
        }
    
    def _build_prompt(self, data: dict) -> str:
        """Build the analysis prompt for Kimi K2.5"""
        # Crossover section if available
        crossover_section = ""
        if data.get('crossover_score', 0) != 0 or data.get('call_dominant_strikes', 0) > 0:
            crossover_section = f"""
ATM STRIKE CROSSOVER (ATM ± 3 strikes):
- Call Dominant Strikes: {data.get('call_dominant_strikes', 0)}
- Put Dominant Strikes: {data.get('put_dominant_strikes', 0)}  
- Crossover Score: {data.get('crossover_score', 0)} (range: -10 bearish to +10 bullish)
- Crossovers Since 9:15: {data.get('crossovers_from_baseline', 0)} strikes flipped
- Direction from Crossover: {data.get('crossover_direction', 'NEUTRAL')}
"""
        
        return f"""Analyze these Indian market options metrics for {data.get('index', 'INDEX')}:

STRIKE VOTING (ATM ± 5 strikes):
- Bullish Strikes: {data['bullish_votes']}
- Bearish Strikes: {data['bearish_votes']}
- Neutral Strikes: {data.get('neutral_votes', 0)}
{crossover_section}
PRICE LEVELS:
- Spot Price: {data['spot']}
- ATM Strike: {data['atm']}
- Max Pain: {data['max_pain_strike']} ({data['max_pain_distance']}% from spot)

OI ANALYSIS:
- Total CE OI: {data['total_ce_oi']:,}
- Total PE OI: {data['total_pe_oi']:,}
- PCR: {data['pcr']}
- Weighted Score: {data['weighted_score']} ({data['weighted_signal']})

VOLATILITY:
- Current IV: {data.get('current_iv', 'N/A')}%
- IV Trend: {data.get('iv_trend', 'N/A')}

CURRENT TREND: {data.get('overall_trend', 'NEUTRAL')}

Based on this data, determine:
1. Trading signal (BULLISH/BEARISH/NEUTRAL)
2. Confidence level (1-10)
3. Option buying environment quality (Best/Good/Moderate/Poor)
4. Key reasoning points (2-3 bullets)

Respond in this exact JSON format:
{{"signal":"BULLISH","confidence":7,"environment":"Good","reasoning":["Point 1","Point 2"]}}"""

    def _parse_response(self, content: str) -> dict:
        """Parse AI response, extracting JSON"""
        if not content:
            return self._fallback_response("Empty response")
        
        try:
            # Try to find JSON in the response
            content = content.strip()
            
            # Handle case where response might have markdown code blocks
            if '```json' in content:
                start = content.find('```json') + 7
                end = content.find('```', start)
                content = content[start:end].strip()
            elif '```' in content:
                start = content.find('```') + 3
                end = content.find('```', start)
                content = content[start:end].strip()
            
            # Find JSON object
            start = content.find('{')
            end = content.rfind('}') + 1
            
            if start >= 0 and end > start:
                json_str = content[start:end]
                result = json.loads(json_str)
                
                # Validate required fields
                return {
                    'signal': result.get('signal', 'NEUTRAL').upper(),
                    'confidence': min(10, max(1, int(result.get('confidence', 5)))),
                    'environment': result.get('environment', 'Moderate'),
                    'reasoning': result.get('reasoning', ['No reasoning provided'])
                }
            
            return self._fallback_response("No JSON found in response")
            
        except (json.JSONDecodeError, ValueError, TypeError) as e:
            logger.error(f"JSON parse error: {e}")
            return self._fallback_response("Parse error")
    
    def _fallback_response(self, error: str) -> dict:
        """Return a fallback response when AI fails"""
        return {
            'signal': 'NEUTRAL',
            'confidence': 5,
            'environment': 'Unknown',
            'reasoning': [f'AI unavailable: {error}'],
            'error': error
        }


def calculate_confluence_score(market_data: dict) -> dict:
    """
    Calculate confluence score based on alignment of multiple factors.
    
    Factors checked:
    1. Strike votes alignment
    2. PCR trend
    3. Max pain position
    4. IV trend
    5. Weighted score signal
    6. ATM Strike Crossover (CE vs PE dominance)
    
    Returns:
        dict with score (0-6), direction, aligned_factors list
    """
    aligned_factors = []
    bullish_count = 0
    bearish_count = 0
    
    # 1. Strike votes
    bullish_votes = market_data.get('bullish_votes', 0)
    bearish_votes = market_data.get('bearish_votes', 0)
    
    if bullish_votes > bearish_votes * 1.5:
        aligned_factors.append('Strike Votes (Bullish)')
        bullish_count += 1
    elif bearish_votes > bullish_votes * 1.5:
        aligned_factors.append('Strike Votes (Bearish)')
        bearish_count += 1
    
    # 2. PCR
    pcr = market_data.get('pcr', 1.0)
    if pcr > 1.2:
        aligned_factors.append('PCR > 1.2 (Bullish)')
        bullish_count += 1
    elif pcr < 0.8:
        aligned_factors.append('PCR < 0.8 (Bearish)')
        bearish_count += 1
    
    # 3. Max Pain distance
    max_pain_distance = market_data.get('max_pain_distance', 0)
    if max_pain_distance > 0.5:  # Spot below max pain
        aligned_factors.append('Below Max Pain (Bullish)')
        bullish_count += 1
    elif max_pain_distance < -0.5:  # Spot above max pain
        aligned_factors.append('Above Max Pain (Bearish)')
        bearish_count += 1
    
    # 4. IV Trend
    iv_trend = market_data.get('iv_trend', 'STABLE')
    if iv_trend == 'FALLING':
        aligned_factors.append('IV Falling (Bullish)')
        bullish_count += 1
    elif iv_trend == 'RISING':
        aligned_factors.append('IV Rising (Bearish/Volatility)')
        bearish_count += 1
    
    # 5. Weighted score
    weighted_signal = market_data.get('weighted_signal', 'NEUTRAL')
    if weighted_signal == 'BULLISH':
        aligned_factors.append('Weighted Score (Bullish)')
        bullish_count += 1
    elif weighted_signal == 'BEARISH':
        aligned_factors.append('Weighted Score (Bearish)')
        bearish_count += 1
    
    # 6. ATM Strike Crossover (CE vs PE dominance at ATM ± 3 strikes)
    crossover_direction = market_data.get('crossover_direction', 'NEUTRAL')
    crossover_score = market_data.get('crossover_score', 0)
    put_dominant = market_data.get('put_dominant_strikes', 0)
    call_dominant = market_data.get('call_dominant_strikes', 0)
    
    # PE dominant = Bullish (puts being written), CE dominant = Bearish (calls being written)
    if crossover_direction == 'BULLISH' or (put_dominant > call_dominant and crossover_score >= 2):
        aligned_factors.append(f'ATM Crossover (Bullish, {put_dominant} PE dominant)')
        bullish_count += 1
    elif crossover_direction == 'BEARISH' or (call_dominant > put_dominant and crossover_score <= -2):
        aligned_factors.append(f'ATM Crossover (Bearish, {call_dominant} CE dominant)')
        bearish_count += 1
    
    # Calculate direction and score
    if bullish_count > bearish_count:
        direction = 'BULLISH'
        score = bullish_count
    elif bearish_count > bullish_count:
        direction = 'BEARISH'
        score = bearish_count
    else:
        direction = 'NEUTRAL'
        score = 0
    
    return {
        'score': score,
        'max_score': 6,
        'direction': direction,
        'aligned_factors': aligned_factors,
        'bullish_factors': bullish_count,
        'bearish_factors': bearish_count
    }
