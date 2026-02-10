"""
INDEX OI SCANNER - Configuration
=================================
Centralized configuration for all indices (NIFTY, BANKNIFTY, SENSEX, FINNIFTY)

For cloud deployment:
- Set UPSTOX_ACCESS_TOKENS environment variable with your daily token
"""

import os
from dataclasses import dataclass
from typing import Dict, List


@dataclass
class IndexConfig:
    """Configuration for a single index"""
    name: str
    display_name: str
    spot_key: str           # NSE_INDEX|Nifty 50
    option_symbol: str      # NIFTY, BANKNIFTY, etc.
    strike_interval: int    # 50, 100, etc.
    strikes_range: int      # ATM ± N strikes
    lot_size: int
    exchange: str           # NSE or BSE


@dataclass
class IVConfig:
    """
    IV Momentum Sustainability Configuration
    
    Controls how IV patterns are detected and momentum is tracked
    after IV rise signals.
    """
    # Pattern Detection Thresholds
    IV_RISE_THRESHOLD: float = 0.5        # Min % IV rise per candle to count as rise
    IV_DROP_THRESHOLD: float = -0.5       # Min % IV drop to detect crush
    MIN_CONSECUTIVE_RISES: int = 3        # Consecutive candles needed for pattern
    
    # Momentum Analysis Windows (minutes after signal)
    MOMENTUM_WINDOWS: tuple = (1, 2, 3, 5, 10, 15, 20, 30, 45, 60)
    
    # Momentum Thresholds
    MOMENTUM_THRESHOLD: float = 0.1       # Min % momentum to be considered significant
    STRONG_MOMENTUM: float = 0.3          # Strong momentum threshold
    
    # IV Strength Classification
    WEAK_IV_RISE: float = 0.5             # Avg rise < 0.5% = WEAK
    MODERATE_IV_RISE: float = 1.0         # 0.5% - 1.0% = MODERATE, > 1.0% = STRONG
    
    # ATM Range for Aggregate IV
    ATM_IV_RANGE: int = 3                 # Use ATM ± 3 strikes for aggregate IV
    
    # Data Retention
    IV_CANDLE_RETENTION: int = 400        # Keep ~6 hours of minute candles
    PATTERN_HISTORY_COUNT: int = 50       # Keep last N patterns per index


# Index Configurations
INDICES: Dict[str, IndexConfig] = {
    'NIFTY': IndexConfig(
        name='NIFTY',
        display_name='NIFTY 50',
        spot_key='NSE_INDEX|Nifty 50',
        option_symbol='NIFTY',
        strike_interval=50,
        strikes_range=15,      # ATM ± 15 = 31 strikes
        lot_size=25,
        exchange='NSE'
    ),
    'BANKNIFTY': IndexConfig(
        name='BANKNIFTY',
        display_name='BANK NIFTY',
        spot_key='NSE_INDEX|Nifty Bank',
        option_symbol='BANKNIFTY',
        strike_interval=100,
        strikes_range=15,
        lot_size=15,
        exchange='NSE'
    ),
    'FINNIFTY': IndexConfig(
        name='FINNIFTY',
        display_name='FIN NIFTY',
        spot_key='NSE_INDEX|Nifty Fin Service',
        option_symbol='FINNIFTY',
        strike_interval=50,
        strikes_range=12,
        lot_size=25,
        exchange='NSE'
    ),
    'SENSEX': IndexConfig(
        name='SENSEX',
        display_name='SENSEX',
        spot_key='BSE_INDEX|SENSEX',
        option_symbol='SENSEX',
        strike_interval=100,
        strikes_range=12,
        lot_size=10,
        exchange='BSE'
    ),
    'MIDCPNIFTY': IndexConfig(
        name='MIDCPNIFTY',
        display_name='MIDCAP NIFTY',
        spot_key='NSE_INDEX|NIFTY MID SELECT',
        option_symbol='MIDCPNIFTY',
        strike_interval=25,
        strikes_range=12,
        lot_size=50,
        exchange='NSE'
    ),
    # MCX Commodities
    'CRUDEOIL': IndexConfig(
        name='CRUDEOIL',
        display_name='CRUDE OIL',
        spot_key='MCX_FO|CRUDEOIL',  # Will use futures as spot proxy
        option_symbol='CRUDEOIL',
        strike_interval=50,           # ₹50 strike interval
        strikes_range=15,
        lot_size=100,                 # 100 barrels per lot
        exchange='MCX'
    ),
    'NATURALGAS': IndexConfig(
        name='NATURALGAS',
        display_name='NATURAL GAS',
        spot_key='MCX_FO|NATURALGAS',  # Will use futures as spot proxy
        option_symbol='NATURALGAS',
        strike_interval=5,             # ₹5 strike interval
        strikes_range=15,
        lot_size=1250,                 # 1250 MMBtu per lot
        exchange='MCX'
    )
}

# Default active indices (can be changed in settings)
ACTIVE_INDICES = ['NIFTY', 'BANKNIFTY', 'FINNIFTY', 'SENSEX', 'CRUDEOIL', 'NATURALGAS']


class Config:
    """System-wide configuration"""
    
    # Database
    DB_PATH = "index_scanner.db"
    
    # API Settings
    API_BASE_URL = "https://api.upstox.com"
    API_BATCH_SIZE = 500
    API_BATCH_DELAY = 0.5           # Delay between batches
    MAX_API_CALLS_PER_MINUTE = 80   # Conservative limit
    
    # Polling Settings
    POLLING_INTERVAL = 20           # 20 seconds for indices (faster than stocks)
    SNAPSHOT_INTERVAL_MINUTES = 3   # Save timeseries every 3 minutes
    
    # Strike Thresholds
    STRIKE_MIN_OI_THRESHOLD = 500   # Minimum OI to consider
    MAX_STRIKES_PER_INDEX = 50      # Max strikes to load per index
    
    # OI Dominance Range (for Price Action chart)
    OI_DOMINANCE_STRIKES_RANGE = 5  # Use ATM ± 5 strikes for OI dominance in price chart
    
    # Strike Crossover Analysis Settings (for AI Analysis page)
    CROSSOVER_STRIKES_RANGE = 3         # Use ATM ± 3 strikes for crossover analysis
    CROSSOVER_DOMINANCE_THRESHOLD = 10  # 10% difference required for dominance
    
    # Signal Thresholds
    BULLISH_NET_THRESHOLD = 0.5     # Net score > 0.5 = Bullish
    BEARISH_NET_THRESHOLD = -0.5    # Net score < -0.5 = Bearish
    
    # Market Hours (IST)
    MARKET_OPEN = "09:15"
    MARKET_CLOSE = "15:30"
    PRE_MARKET_START = "09:00"
    
    # Upstox Access Tokens
    # Priority: Environment variable > Fallback token below
    # For cloud: Set UPSTOX_ACCESS_TOKENS in Render.com dashboard
    # For local: Either set env var OR paste your token in LOCAL_FALLBACK_TOKEN
    LOCAL_FALLBACK_TOKEN = "eyJ0eXAiOiJKV1QiLCJrZXlfaWQiOiJza192MS4wIiwiYWxnIjoiSFMyNTYifQ.eyJzdWIiOiIzV0NGUFUiLCJqdGkiOiI2OThhOWZmYzQ4YTk1NzAxNWQ3YWZlYjIiLCJpc011bHRpQ2xpZW50IjpmYWxzZSwiaXNQbHVzUGxhbiI6dHJ1ZSwiaWF0IjoxNzcwNjkyNjA0LCJpc3MiOiJ1ZGFwaS1nYXRld2F5LXNlcnZpY2UiLCJleHAiOjE3NzA3NjA4MDB9._oYbYrLLy-iMKCgwpIDiTOGQpA_4vlGQkpCWmCTpzwo"
    ACCESS_TOKENS_ENV = os.environ.get('UPSTOX_ACCESS_TOKENS', '') or LOCAL_FALLBACK_TOKEN
    
    # IV Momentum Settings
    IV_POLLING_ENABLED = True           # Enable/disable IV tracking
    IV_FETCH_INTERVAL = 60              # Fetch IV every 60 seconds (API efficient)
    
    # Server Settings
    HOST = "0.0.0.0"
    PORT = int(os.environ.get('PORT', 8001))  # Use PORT from environment for cloud


@dataclass
class AIConfig:
    """AI Signal Generation Configuration (NVIDIA NEM + Kimi K2.5)"""
    
    # NVIDIA NEM API Settings
    NVIDIA_API_KEY: str = os.environ.get('NVIDIA_API_KEY', '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')
    NVIDIA_API_URL: str = "https://integrate.api.nvidia.com/v1/chat/completions"
    MODEL_NAME: str = "moonshotai/kimi-k2.5"
    
    # Groq API Settings (fallback - faster)
    GROQ_API_KEY: str = os.environ.get('GROQ_API_KEY', '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')
    
    # AI Feature Toggle
    AI_ENABLED: bool = True
    
    # Request Settings
    MAX_TOKENS: int = 512
    TEMPERATURE: float = 0.3
    TIMEOUT_SECONDS: int = 30
    
    # RL Settings
    RL_ENABLED: bool = True
    RL_REWARD_LOOKBACK_MINUTES: int = 30


# Helper functions
def get_index_config(index_name: str) -> IndexConfig:
    """Get configuration for an index"""
    return INDICES.get(index_name.upper())


def get_all_indices() -> List[str]:
    """Get list of all available indices"""
    return list(INDICES.keys())


def get_active_indices() -> List[str]:
    """Get list of currently active indices"""
    return ACTIVE_INDICES


def get_iv_config() -> IVConfig:
    """Get IV momentum configuration"""
    return IVConfig()


def get_ai_config() -> AIConfig:
    """Get AI signal configuration"""
    return AIConfig()