"""
INDEX OI SCANNER SERVER v1.0
============================
Standalone real-time index monitoring system for NIFTY, BANKNIFTY, SENSEX, FINNIFTY

Features:
- Multi-index support with independent processing
- Strike-level OI analysis (ATM ± 15 strikes)
- PCR (Put-Call Ratio) tracking
- Interval dominance (Bulls vs Bears)
- Support/Resistance detection from OI
- Max Pain calculation
- Real-time WebSocket updates

Author: Index OI Scanner System
"""

import asyncio
import json
import time
import requests
import gzip
import sqlite3
import os
from datetime import datetime, timedelta
from collections import defaultdict, deque
from typing import Dict, List, Optional, Set, Tuple, Any
from urllib.parse import quote
import logging
import threading

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse, FileResponse, JSONResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
import uvicorn
import pandas as pd
import statistics

from config import Config, INDICES, IndexConfig, IVConfig, get_index_config, get_active_indices, get_iv_config, get_ai_config, AIConfig

# AI Signal Generation (optional - graceful fallback if not available)
try:
    from ai_signal import AISignalGenerator, calculate_confluence_score
    AI_AVAILABLE = True
except ImportError:
    AI_AVAILABLE = False
    logger.warning("AI signal module not available - AI features disabled")

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


# =============================================================================
# DATABASE MANAGER
# =============================================================================

class DatabaseManager:
    """Handle all SQLite database operations"""
    
    def __init__(self, db_path: str = Config.DB_PATH):
        self.db_path = db_path
        self._local = threading.local()
        self._ensure_tables()
    
    def _ensure_tables(self):
        """Ensure all required tables exist"""
        # Import and run init_db if needed
        if not os.path.exists(self.db_path):
            from init_db import create_database
            create_database()
    
    def get_connection(self) -> sqlite3.Connection:
        """Get thread-local database connection"""
        if not hasattr(self._local, 'conn') or self._local.conn is None:
            self._local.conn = sqlite3.connect(self.db_path, check_same_thread=False)
            self._local.conn.row_factory = sqlite3.Row
        return self._local.conn
    
    def execute(self, query: str, params: tuple = ()) -> sqlite3.Cursor:
        """Execute a query"""
        conn = self.get_connection()
        cursor = conn.cursor()
        cursor.execute(query, params)
        conn.commit()
        return cursor
    
    def fetch_one(self, query: str, params: tuple = ()) -> Optional[Dict]:
        """Fetch one row as dict"""
        cursor = self.execute(query, params)
        row = cursor.fetchone()
        return dict(row) if row else None
    
    def fetch_all(self, query: str, params: tuple = ()) -> List[Dict]:
        """Fetch all rows as list of dicts"""
        cursor = self.execute(query, params)
        return [dict(row) for row in cursor.fetchall()]
    
    # -------------------------------------------------------------------------
    # STRIKE OI DATA
    # -------------------------------------------------------------------------
    
    def save_strike_oi_bulk(self, records: List[tuple]):
        """Bulk save strike OI data"""
        if not records:
            return 0
        
        conn = self.get_connection()
        cursor = conn.cursor()
        today = datetime.now().strftime('%Y-%m-%d')
        now = datetime.now().isoformat()
        
        try:
            cursor.executemany('''
                INSERT OR REPLACE INTO strike_oi_live 
                (index_name, date, strike, timestamp, ce_oi, pe_oi, 
                 ce_oi_baseline, pe_oi_baseline, ce_oi_change_pct, pe_oi_change_pct,
                 ce_oi_poll_change_pct, pe_oi_poll_change_pct, ce_ltp, pe_ltp,
                 is_atm, net_signal, signal_type)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ''', [(r[0], today, r[1], now, r[2], r[3], r[4], r[5], r[6], r[7], 
                   r[8], r[9], r[10], r[11], r[12], r[13], r[14]) for r in records])
            conn.commit()
            return len(records)
        except Exception as e:
            logger.error(f"Error in bulk save strike OI: {e}")
            return 0
    
    def get_strike_oi_data(self, index_name: str, date: str = None) -> List[Dict]:
        """Get strike OI data for an index"""
        if not date:
            date = datetime.now().strftime('%Y-%m-%d')
        
        return self.fetch_all('''
            SELECT * FROM strike_oi_live 
            WHERE index_name = ? AND date = ?
            ORDER BY strike DESC
        ''', (index_name, date))
    
    # -------------------------------------------------------------------------
    # TIMESERIES DATA
    # -------------------------------------------------------------------------
    
    def save_timeseries(self, index_name: str, weighted_score: float, signal: str,
                        bullish_value: float, bearish_value: float, net_value: float,
                        ce_unwinding: float, pe_buildup: float, pe_unwinding: float,
                        ce_buildup: float, total_ce_oi: int, total_pe_oi: int, pcr: float):
        """Save timeseries entry"""
        today = datetime.now().strftime('%Y-%m-%d')
        now = datetime.now()
        interval_label = now.strftime('%H:%M')
        
        self.execute('''
            INSERT INTO strike_oi_timeseries 
            (index_name, timestamp, date, interval_label, weighted_net_score, signal,
             bullish_value, bearish_value, net_value, ce_unwinding, pe_buildup,
             pe_unwinding, ce_buildup, total_ce_oi, total_pe_oi, pcr)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ''', (index_name, now.isoformat(), today, interval_label, weighted_score, signal,
              bullish_value, bearish_value, net_value, ce_unwinding, pe_buildup,
              pe_unwinding, ce_buildup, total_ce_oi, total_pe_oi, pcr))
    
    def save_timeseries_bulk(self, records: List[tuple]):
        """Bulk save timeseries data"""
        if not records:
            return 0
        
        conn = self.get_connection()
        cursor = conn.cursor()
        today = datetime.now().strftime('%Y-%m-%d')
        now = datetime.now()
        interval_label = now.strftime('%H:%M')
        
        try:
            cursor.executemany('''
                INSERT INTO strike_oi_timeseries 
                (index_name, timestamp, date, interval_label, weighted_net_score, signal,
                 bullish_value, bearish_value, net_value, ce_unwinding, pe_buildup,
                 pe_unwinding, ce_buildup, total_ce_oi, total_pe_oi, pcr)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ''', [(r[0], now.isoformat(), today, interval_label, r[1], r[2], r[3], r[4], 
                   r[5], r[6], r[7], r[8], r[9], r[10], r[11], r[12]) for r in records])
            conn.commit()
            return len(records)
        except Exception as e:
            logger.error(f"Error in bulk save timeseries: {e}")
            return 0
    
    def get_timeseries(self, index_name: str, date: str = None) -> List[Dict]:
        """Get timeseries for today"""
        if not date:
            date = datetime.now().strftime('%Y-%m-%d')
        
        return self.fetch_all('''
            SELECT * FROM strike_oi_timeseries 
            WHERE index_name = ? AND date = ?
            ORDER BY timestamp ASC
        ''', (index_name, date))
    
    # -------------------------------------------------------------------------
    # PCR DATA
    # -------------------------------------------------------------------------
    
    def save_pcr(self, index_name: str, pcr_oi: float, pcr_volume: float,
                 total_ce_oi: int, total_pe_oi: int, total_ce_vol: int, total_pe_vol: int):
        """Save PCR data"""
        today = datetime.now().strftime('%Y-%m-%d')
        now = datetime.now()
        interval_label = now.strftime('%H:%M')
        
        # Get baseline PCR for change calculation
        baseline = self.fetch_one('''
            SELECT pcr_oi FROM index_baselines WHERE index_name = ? AND date = ?
        ''', (index_name, today))
        
        change_from_open = 0
        if baseline and baseline.get('pcr_oi', 0) > 0:
            change_from_open = ((pcr_oi - baseline['pcr_oi']) / baseline['pcr_oi']) * 100
        
        self.execute('''
            INSERT INTO pcr_history 
            (index_name, timestamp, date, interval_label, pcr_oi, pcr_volume,
             total_ce_oi, total_pe_oi, total_ce_volume, total_pe_volume, change_from_open)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ''', (index_name, now.isoformat(), today, interval_label, pcr_oi, pcr_volume,
              total_ce_oi, total_pe_oi, total_ce_vol, total_pe_vol, change_from_open))
    
    def get_pcr_history(self, index_name: str, date: str = None) -> List[Dict]:
        """Get PCR history for today"""
        if not date:
            date = datetime.now().strftime('%Y-%m-%d')
        
        return self.fetch_all('''
            SELECT * FROM pcr_history 
            WHERE index_name = ? AND date = ?
            ORDER BY timestamp ASC
        ''', (index_name, date))
    
    # -------------------------------------------------------------------------
    # BASELINE DATA
    # -------------------------------------------------------------------------
    
    def save_baseline(self, index_name: str, spot_price: float, 
                      total_ce_oi: int, total_pe_oi: int, pcr: float):
        """Save 9:15 baseline"""
        today = datetime.now().strftime('%Y-%m-%d')
        now = datetime.now().isoformat()
        
        self.execute('''
            INSERT OR REPLACE INTO index_baselines 
            (index_name, date, baseline_time, spot_price, total_ce_oi, total_pe_oi, pcr)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        ''', (index_name, today, now, spot_price, total_ce_oi, total_pe_oi, pcr))
    
    def get_baseline(self, index_name: str, date: str = None) -> Optional[Dict]:
        """Get baseline for an index"""
        if not date:
            date = datetime.now().strftime('%Y-%m-%d')
        
        return self.fetch_one('''
            SELECT * FROM index_baselines WHERE index_name = ? AND date = ?
        ''', (index_name, date))
    
    # -------------------------------------------------------------------------
    # SUPPORT/RESISTANCE
    # -------------------------------------------------------------------------
    
    def save_support_resistance(self, index_name: str, levels: List[Dict]):
        """Save S/R levels"""
        today = datetime.now().strftime('%Y-%m-%d')
        now = datetime.now().isoformat()
        
        # Clear old levels
        self.execute('DELETE FROM support_resistance WHERE index_name = ? AND date = ?',
                    (index_name, today))
        
        for level in levels:
            self.execute('''
                INSERT INTO support_resistance 
                (index_name, date, timestamp, level_type, strike, oi_value, strength)
                VALUES (?, ?, ?, ?, ?, ?, ?)
            ''', (index_name, today, now, level['type'], level['strike'], 
                  level['oi'], level['strength']))
    
    def get_support_resistance(self, index_name: str, date: str = None) -> List[Dict]:
        """Get S/R levels"""
        if not date:
            date = datetime.now().strftime('%Y-%m-%d')
        
        return self.fetch_all('''
            SELECT * FROM support_resistance 
            WHERE index_name = ? AND date = ?
            ORDER BY strike DESC
        ''', (index_name, date))
    
    # -------------------------------------------------------------------------
    # MAX PAIN
    # -------------------------------------------------------------------------
    
    def save_max_pain(self, index_name: str, max_pain_strike: float, 
                      spot_price: float, distance: float):
        """Save max pain data"""
        today = datetime.now().strftime('%Y-%m-%d')
        now = datetime.now()
        interval_label = now.strftime('%H:%M')
        
        self.execute('''
            INSERT INTO max_pain_history 
            (index_name, timestamp, date, interval_label, max_pain_strike, 
             spot_price, distance_from_spot)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        ''', (index_name, now.isoformat(), today, interval_label, 
              max_pain_strike, spot_price, distance))
    
    def get_max_pain_history(self, index_name: str, date: str = None) -> List[Dict]:
        """Get max pain history"""
        if not date:
            date = datetime.now().strftime('%Y-%m-%d')
        
        return self.fetch_all('''
            SELECT * FROM max_pain_history 
            WHERE index_name = ? AND date = ?
            ORDER BY timestamp ASC
        ''', (index_name, date))


# =============================================================================
# STRIKE MONITOR
# =============================================================================

class IndexStrikeMonitor:
    """
    Strike-Level OI Monitor for indices
    
    Tracks all strikes within ATM ± N range for each index.
    Maintains baseline from 9:15 for consistent change calculations.
    Also tracks IV (Implied Volatility) for momentum sustainability analysis.
    """
    
    def __init__(self, db: DatabaseManager):
        self.db = db
        self.index_data = {}  # {index: {spot, atm, strikes_data, ...}}
        
        # IV Tracking
        self.iv_config = get_iv_config()
        self.iv_data = {}  # {index_name: {candles, patterns, ...}}
        
        logger.info("IndexStrikeMonitor initialized with IV tracking")
    
    def initialize_index(self, index_name: str, config: IndexConfig):
        """Initialize tracking for an index"""
        if index_name not in self.index_data:
            self.index_data[index_name] = {
                'config': config,
                'spot': 0,
                'atm': 0,
                'strikes_data': {},
                'baseline_strikes': {},
                'last_interval_snapshot': {},
                'timeseries': [],
                'dominance_timeseries': [],
                'last_timeseries_update': None,
                'poll_count': 0,
                'baseline_set_time': None,
                'total_ce_oi': 0,
                'total_pe_oi': 0
            }
        
        # Initialize IV tracking for this index
        if index_name not in self.iv_data:
            self.iv_data[index_name] = {
                'candles': [],                    # IV candle history
                'patterns': [],                   # Detected patterns
                'active_pattern': None,           # Currently forming pattern
                'consecutive_rises': 0,           # Consecutive IV rise count
                'current_iv': None,               # Current aggregate IV
                'last_iv': None,                  # Previous IV for change calc
                'iv_trend': 'STABLE',             # RISING, FALLING, STABLE
                'last_price': None                # For price change calc
            }
    
    def update_spot(self, index_name: str, spot_price: float):
        """Update spot price and calculate ATM"""
        if index_name not in self.index_data:
            return
        
        data = self.index_data[index_name]
        config = data['config']
        
        data['spot'] = spot_price
        data['atm'] = round(spot_price / config.strike_interval) * config.strike_interval
    
    def get_monitored_strikes(self, index_name: str) -> List[int]:
        """Get list of strikes to monitor (ATM ± N)"""
        if index_name not in self.index_data:
            return []
        
        data = self.index_data[index_name]
        atm = data['atm']
        config = data['config']
        
        if atm == 0:
            return []
        
        strikes = []
        for i in range(-config.strikes_range, config.strikes_range + 1):
            strikes.append(int(atm + (i * config.strike_interval)))
        return sorted(strikes, reverse=True)
    
    def get_oi_dominance_strikes(self, index_name: str) -> List[int]:
        """Get ATM ± 5 strikes for OI dominance calculation (dynamically moves with ATM)"""
        if index_name not in self.index_data:
            return []
        
        data = self.index_data[index_name]
        atm = data['atm']
        config = data['config']
        
        if atm == 0:
            return []
        
        # Use Config.OI_DOMINANCE_STRIKES_RANGE (±5 strikes) instead of config.strikes_range
        strikes = []
        for i in range(-Config.OI_DOMINANCE_STRIKES_RANGE, Config.OI_DOMINANCE_STRIKES_RANGE + 1):
            strikes.append(int(atm + (i * config.strike_interval)))
        return sorted(strikes, reverse=True)
    
    def update_strike_data(self, index_name: str, strike: int, ce_oi: int, pe_oi: int,
                           ce_ltp: float = 0, pe_ltp: float = 0):
        """Update OI data for a strike"""
        if index_name not in self.index_data:
            return
        
        if ce_oi == 0 and pe_oi == 0:
            return
        
        data = self.index_data[index_name]
        strikes_data = data['strikes_data']
        baseline_strikes = data['baseline_strikes']
        
        # Set baseline if not already set (first poll at 9:15)
        if strike not in baseline_strikes:
            baseline_strikes[strike] = {
                'ce_oi': ce_oi,
                'pe_oi': pe_oi,
                'timestamp': datetime.now().isoformat()
            }
            if data['baseline_set_time'] is None:
                data['baseline_set_time'] = datetime.now()
        
        # Get baseline values
        baseline = baseline_strikes.get(strike, {'ce_oi': ce_oi, 'pe_oi': pe_oi})
        baseline_ce = baseline['ce_oi']
        baseline_pe = baseline['pe_oi']
        
        # Calculate % change from BASELINE (9:15)
        ce_change = ((ce_oi - baseline_ce) / baseline_ce * 100) if baseline_ce > 0 else 0
        pe_change = ((pe_oi - baseline_pe) / baseline_pe * 100) if baseline_pe > 0 else 0
        
        # Calculate % change from PREVIOUS POLL
        prev_data = strikes_data.get(strike, {})
        prev_ce = prev_data.get('ce_oi', ce_oi)
        prev_pe = prev_data.get('pe_oi', pe_oi)
        
        ce_poll = ((ce_oi - prev_ce) / prev_ce * 100) if prev_ce > 0 else 0
        pe_poll = ((pe_oi - prev_pe) / prev_pe * 100) if prev_pe > 0 else 0
        
        strikes_data[strike] = {
            'ce_oi': ce_oi,
            'pe_oi': pe_oi,
            'ce_ltp': ce_ltp,
            'pe_ltp': pe_ltp,
            'ce_oi_baseline': baseline_ce,
            'pe_oi_baseline': baseline_pe,
            'ce_oi_prev': prev_ce,
            'pe_oi_prev': prev_pe,
            'ce_oi_change_pct': round(ce_change, 2),
            'pe_oi_change_pct': round(pe_change, 2),
            'ce_oi_poll_change_pct': round(ce_poll, 2),
            'pe_oi_poll_change_pct': round(pe_poll, 2)
        }
    
    def calculate_pcr(self, index_name: str) -> float:
        """Calculate Put-Call Ratio"""
        if index_name not in self.index_data:
            return 0
        
        data = self.index_data[index_name]
        strikes_data = data['strikes_data']
        
        total_ce = sum(sd.get('ce_oi', 0) for sd in strikes_data.values())
        total_pe = sum(sd.get('pe_oi', 0) for sd in strikes_data.values())
        
        data['total_ce_oi'] = total_ce
        data['total_pe_oi'] = total_pe
        
        return round(total_pe / total_ce, 3) if total_ce > 0 else 0
    
    def calculate_max_pain(self, index_name: str) -> Dict:
        """Calculate max pain strike"""
        if index_name not in self.index_data:
            return {'strike': 0, 'distance': 0}
        
        data = self.index_data[index_name]
        strikes_data = data['strikes_data']
        spot = data['spot']
        
        if not strikes_data or spot == 0:
            return {'strike': 0, 'distance': 0}
        
        # Calculate total pain at each strike
        pain_values = {}
        all_strikes = sorted(strikes_data.keys())
        
        for test_strike in all_strikes:
            total_pain = 0
            for strike, sd in strikes_data.items():
                ce_oi = sd.get('ce_oi', 0)
                pe_oi = sd.get('pe_oi', 0)
                
                # CE pain (loss for CE writers if price > strike)
                if test_strike > strike:
                    total_pain += ce_oi * (test_strike - strike)
                
                # PE pain (loss for PE writers if price < strike)
                if test_strike < strike:
                    total_pain += pe_oi * (strike - test_strike)
            
            pain_values[test_strike] = total_pain
        
        # Max pain is where total pain is minimum
        max_pain_strike = min(pain_values, key=pain_values.get)
        distance = ((max_pain_strike - spot) / spot) * 100
        
        return {
            'strike': max_pain_strike,
            'distance': round(distance, 2)
        }
    
    def calculate_support_resistance(self, index_name: str) -> Dict:
        """Calculate support/resistance levels from OI"""
        if index_name not in self.index_data:
            return {'support': [], 'resistance': []}
        
        data = self.index_data[index_name]
        strikes_data = data['strikes_data']
        atm = data['atm']
        
        if not strikes_data or atm == 0:
            return {'support': [], 'resistance': []}
        
        support_levels = []
        resistance_levels = []
        
        # Find top PE OI (Support) and CE OI (Resistance)
        pe_oi_list = [(s, sd.get('pe_oi', 0)) for s, sd in strikes_data.items() if s <= atm]
        ce_oi_list = [(s, sd.get('ce_oi', 0)) for s, sd in strikes_data.items() if s >= atm]
        
        # Sort by OI descending
        pe_oi_list.sort(key=lambda x: x[1], reverse=True)
        ce_oi_list.sort(key=lambda x: x[1], reverse=True)
        
        # Top 3 support levels (highest PE OI below ATM)
        for strike, oi in pe_oi_list[:3]:
            strength = 'STRONG' if oi > pe_oi_list[0][1] * 0.8 else 'NORMAL'
            support_levels.append({
                'type': 'SUPPORT',
                'strike': strike,
                'oi': oi,
                'strength': strength
            })
        
        # Top 3 resistance levels (highest CE OI above ATM)
        for strike, oi in ce_oi_list[:3]:
            strength = 'STRONG' if oi > ce_oi_list[0][1] * 0.8 else 'NORMAL'
            resistance_levels.append({
                'type': 'RESISTANCE',
                'strike': strike,
                'oi': oi,
                'strength': strength
            })
        
        return {
            'support': support_levels,
            'resistance': resistance_levels
        }
    
    def calculate_interval_dominance(self, index_name: str) -> Dict:
        """Calculate interval dominance (bulls vs bears)"""
        if index_name not in self.index_data:
            return {'bullish_value': 0, 'bearish_value': 0, 'net_value': 0}
        
        data = self.index_data[index_name]
        last_snapshot = data.get('last_interval_snapshot', {})
        strikes_data = data.get('strikes_data', {})
        
        bullish_value = 0.0
        bearish_value = 0.0
        ce_unwinding = 0.0
        pe_buildup = 0.0
        pe_unwinding = 0.0
        ce_buildup = 0.0
        
        if not last_snapshot:
            return {
                'bullish_value': 0, 'bearish_value': 0, 'net_value': 0,
                'ce_unwinding': 0, 'pe_buildup': 0, 'pe_unwinding': 0, 'ce_buildup': 0
            }
        
        # Use monitored strikes for dominance calculation
        for strike in self.get_monitored_strikes(index_name):
            if strike not in strikes_data or strike not in last_snapshot:
                continue
            
            current = strikes_data[strike]
            prev = last_snapshot[strike]
            
            ce_oi_now = current.get('ce_oi', 0)
            pe_oi_now = current.get('pe_oi', 0)
            ce_oi_prev = prev.get('ce_oi', 0)
            pe_oi_prev = prev.get('pe_oi', 0)
            
            ce_change = ((ce_oi_now - ce_oi_prev) / ce_oi_prev * 100) if ce_oi_prev > 0 else 0
            pe_change = ((pe_oi_now - pe_oi_prev) / pe_oi_prev * 100) if pe_oi_prev > 0 else 0
            
            # BULLISH: CE unwinding or PE buildup
            if ce_change < 0:
                contribution = abs(ce_change) * ce_oi_now / 1000000
                bullish_value += contribution
                ce_unwinding += contribution
            
            if pe_change > 0:
                contribution = pe_change * pe_oi_now / 1000000
                bullish_value += contribution
                pe_buildup += contribution
            
            # BEARISH: PE unwinding or CE buildup
            if pe_change < 0:
                contribution = abs(pe_change) * pe_oi_now / 1000000
                bearish_value += contribution
                pe_unwinding += contribution
            
            if ce_change > 0:
                contribution = ce_change * ce_oi_now / 1000000
                bearish_value += contribution
                ce_buildup += contribution
        
        return {
            'bullish_value': round(bullish_value, 2),
            'bearish_value': round(bearish_value, 2),
            'net_value': round(bullish_value - bearish_value, 2),
            'ce_unwinding': round(ce_unwinding, 2),
            'pe_buildup': round(pe_buildup, 2),
            'pe_unwinding': round(pe_unwinding, 2),
            'ce_buildup': round(ce_buildup, 2)
        }
    
    def calculate_atm_oi_dominance(self, index_name: str) -> Dict:
        """
        Calculate OI dominance using only ATM ± 5 strikes for Price Action chart
        
        This provides a focused view of immediate market sentiment by only 
        considering strikes close to the current ATM level.
        """
        if index_name not in self.index_data:
            return {'bullish_value': 0, 'bearish_value': 0, 'net_value': 0}
        
        data = self.index_data[index_name]
        last_snapshot = data.get('last_interval_snapshot', {})
        strikes_data = data.get('strikes_data', {})
        
        bullish_value = 0.0
        bearish_value = 0.0
        
        if not last_snapshot:
            return {'bullish_value': 0, 'bearish_value': 0, 'net_value': 0}
        
        # Use ONLY ATM ± 5 strikes (not all monitored strikes)
        for strike in self.get_oi_dominance_strikes(index_name):
            if strike not in strikes_data or strike not in last_snapshot:
                continue
            
            current = strikes_data[strike]
            prev = last_snapshot[strike]
            
            ce_oi_now = current.get('ce_oi', 0)
            pe_oi_now = current.get('pe_oi', 0)
            ce_oi_prev = prev.get('ce_oi', 0)
            pe_oi_prev = prev.get('pe_oi', 0)
            
            ce_change = ((ce_oi_now - ce_oi_prev) / ce_oi_prev * 100) if ce_oi_prev > 0 else 0
            pe_change = ((pe_oi_now - pe_oi_prev) / pe_oi_prev * 100) if pe_oi_prev > 0 else 0
            
            # BULLISH: CE unwinding or PE buildup
            if ce_change < 0:
                bullish_value += abs(ce_change) * ce_oi_now / 1000000
            if pe_change > 0:
                bullish_value += pe_change * pe_oi_now / 1000000
            
            # BEARISH: PE unwinding or CE buildup
            if pe_change < 0:
                bearish_value += abs(pe_change) * pe_oi_now / 1000000
            if ce_change > 0:
                bearish_value += ce_change * ce_oi_now / 1000000
        
        return {
            'bullish_value': round(bullish_value, 2),
            'bearish_value': round(bearish_value, 2),
            'net_value': round(bullish_value - bearish_value, 2)
        }
    
    def get_crossover_strikes(self, index_name: str) -> List[int]:
        """Get ATM ± 3 strikes for crossover analysis"""
        if index_name not in self.index_data:
            return []
        
        data = self.index_data[index_name]
        atm = data['atm']
        config = data['config']
        
        if atm == 0:
            return []
        
        strikes = []
        for i in range(-Config.CROSSOVER_STRIKES_RANGE, Config.CROSSOVER_STRIKES_RANGE + 1):
            strikes.append(int(atm + (i * config.strike_interval)))
        return sorted(strikes, reverse=True)
    
    def calculate_atm_strike_crossover(self, index_name: str) -> Dict:
        """
        Analyze ATM ± 3 strikes to detect CE vs PE OI crossovers.
        
        For each strike near ATM:
        - Compare current CE OI vs PE OI
        - Detect if CE has overtaken PE (bearish) or PE has overtaken CE (bullish)
        - Track crossover transitions from 9:15 baseline
        
        Returns:
            Dict with strike_analysis, summary, direction_signal, crossover_score
        """
        if index_name not in self.index_data:
            return {
                'strike_analysis': [],
                'summary': {'call_dominant_strikes': 0, 'put_dominant_strikes': 0, 'balanced_strikes': 0, 'total_analyzed': 0},
                'direction_signal': 'NEUTRAL',
                'crossover_score': 0,
                'confidence': 5,
                'reasoning': ['No data available']
            }
        
        data = self.index_data[index_name]
        strikes_data = data['strikes_data']
        baseline_strikes = data['baseline_strikes']
        atm = data['atm']
        config = data['config']
        threshold_pct = Config.CROSSOVER_DOMINANCE_THRESHOLD  # 10%
        
        strike_analysis = []
        call_dominant = 0
        put_dominant = 0
        balanced = 0
        crossovers_from_baseline = 0
        
        reasoning = []
        
        # Analyze each strike in ATM ± 3 range
        for strike in self.get_crossover_strikes(index_name):
            if strike not in strikes_data:
                continue
            
            sd = strikes_data[strike]
            baseline = baseline_strikes.get(strike, {})
            
            ce_oi = sd.get('ce_oi', 0)
            pe_oi = sd.get('pe_oi', 0)
            
            # Calculate distance from ATM
            distance_from_atm = int((strike - atm) / config.strike_interval)
            
            # Calculate dominance percentage
            total_oi = ce_oi + pe_oi
            if total_oi == 0:
                continue
            
            ce_pct = (ce_oi / total_oi) * 100
            pe_pct = (pe_oi / total_oi) * 100
            diff_pct = ce_pct - pe_pct  # Positive = CE dominant, Negative = PE dominant
            
            # Determine current dominance
            if diff_pct >= threshold_pct:
                dominant = 'CALLS'
                dominance_pct = diff_pct
                call_dominant += 1
            elif diff_pct <= -threshold_pct:
                dominant = 'PUTS'
                dominance_pct = abs(diff_pct)
                put_dominant += 1
            else:
                dominant = 'BALANCED'
                dominance_pct = abs(diff_pct)
                balanced += 1
            
            # Check baseline dominance (from 9:15)
            baseline_ce = baseline.get('ce_oi', ce_oi)
            baseline_pe = baseline.get('pe_oi', pe_oi)
            baseline_total = baseline_ce + baseline_pe
            
            if baseline_total > 0:
                baseline_diff = ((baseline_ce / baseline_total) - (baseline_pe / baseline_total)) * 100
                if baseline_diff >= threshold_pct:
                    prev_dominant = 'CALLS'
                elif baseline_diff <= -threshold_pct:
                    prev_dominant = 'PUTS'
                else:
                    prev_dominant = 'BALANCED'
            else:
                prev_dominant = 'BALANCED'
            
            # Detect crossover from baseline
            crossover_occurred = (prev_dominant != dominant and prev_dominant != 'BALANCED' and dominant != 'BALANCED')
            if crossover_occurred:
                crossovers_from_baseline += 1
            
            strike_analysis.append({
                'strike': strike,
                'is_atm': strike == atm,
                'distance_from_atm': distance_from_atm,
                'ce_oi': ce_oi,
                'pe_oi': pe_oi,
                'ce_pct': round(ce_pct, 1),
                'pe_pct': round(pe_pct, 1),
                'dominant': dominant,
                'dominance_pct': round(dominance_pct, 1),
                'crossover_occurred': crossover_occurred,
                'prev_dominant': prev_dominant
            })
        
        # Calculate crossover score (-10 to +10)
        # Positive = Bullish (PE dominant), Negative = Bearish (CE dominant)
        total_analyzed = call_dominant + put_dominant + balanced
        if total_analyzed > 0:
            # Score based on proportion of put vs call dominant strikes
            crossover_score = ((put_dominant - call_dominant) / total_analyzed) * 10
        else:
            crossover_score = 0
        
        # Determine direction
        if crossover_score >= 2:
            direction = 'BULLISH'
        elif crossover_score <= -2:
            direction = 'BEARISH'
        else:
            direction = 'NEUTRAL'
        
        # Calculate confidence (higher if more strikes agree)
        max_side = max(call_dominant, put_dominant)
        if total_analyzed > 0:
            agreement_ratio = max_side / total_analyzed
            confidence = int(5 + (agreement_ratio * 5))  # 5-10 scale
        else:
            confidence = 5
        
        # Build reasoning
        if call_dominant > put_dominant:
            reasoning.append(f"{call_dominant} of {total_analyzed} near-ATM strikes show CE OI > PE OI (Bearish)")
        elif put_dominant > call_dominant:
            reasoning.append(f"{put_dominant} of {total_analyzed} near-ATM strikes show PE OI > CE OI (Bullish)")
        else:
            reasoning.append(f"Near-ATM strikes are evenly split between CE and PE dominance")
        
        # ATM strike info
        atm_info = next((s for s in strike_analysis if s['is_atm']), None)
        if atm_info:
            reasoning.append(f"ATM strike ({atm}) has {atm_info['dominant']} dominance ({atm_info['dominance_pct']:.1f}%)")
        
        if crossovers_from_baseline > 0:
            reasoning.append(f"{crossovers_from_baseline} strikes changed dominance since 9:15 baseline")
        
        return {
            'strike_analysis': strike_analysis,
            'summary': {
                'call_dominant_strikes': call_dominant,
                'put_dominant_strikes': put_dominant,
                'balanced_strikes': balanced,
                'total_analyzed': total_analyzed,
                'crossovers_from_baseline': crossovers_from_baseline
            },
            'direction_signal': direction,
            'crossover_score': round(crossover_score, 2),
            'confidence': confidence,
            'reasoning': reasoning
        }
    
    def calculate_weighted_score(self, index_name: str) -> Dict:
        """Calculate OI-weighted net score"""
        if index_name not in self.index_data:
            return {'score': 0, 'signal': 'NEUTRAL'}
        
        data = self.index_data[index_name]
        strikes_data = data['strikes_data']
        
        pe_weighted_sum = 0
        ce_weighted_sum = 0
        total_oi = 0
        
        # Use monitored strikes for signal generation
        for strike in self.get_monitored_strikes(index_name):
            if strike not in strikes_data:
                continue
            
            sd = strikes_data[strike]
            ce_oi = sd.get('ce_oi', 0)
            pe_oi = sd.get('pe_oi', 0)
            ce_change = sd.get('ce_oi_change_pct', 0)
            pe_change = sd.get('pe_oi_change_pct', 0)
            
            ce_weighted_sum += ce_change * ce_oi
            pe_weighted_sum += pe_change * pe_oi
            total_oi += ce_oi + pe_oi
        
        if total_oi == 0:
            return {'score': 0, 'signal': 'NEUTRAL'}
        
        score = (pe_weighted_sum - ce_weighted_sum) / total_oi
        
        if score > Config.BULLISH_NET_THRESHOLD:
            signal = 'BULLISH'
        elif score < Config.BEARISH_NET_THRESHOLD:
            signal = 'BEARISH'
        else:
            signal = 'NEUTRAL'
        
        return {'score': round(score, 2), 'signal': signal}
    
    def save_interval_snapshot(self, index_name: str):
        """Save current OI as snapshot for next interval"""
        if index_name not in self.index_data:
            return
        
        data = self.index_data[index_name]
        data['last_interval_snapshot'] = {}
        
        # Save only monitored strikes for consistent dominance calculation
        for strike in self.get_monitored_strikes(index_name):
            if strike in data['strikes_data']:
                sd = data['strikes_data'][strike]
                data['last_interval_snapshot'][strike] = {
                    'ce_oi': sd.get('ce_oi', 0),
                    'pe_oi': sd.get('pe_oi', 0)
                }
    
    def _align_to_slot(self, dt: datetime, interval_minutes: int = 3) -> str:
        """
        Align a datetime to the nearest 3-minute slot boundary (rounded down).
        
        This ensures time_label matches the fixed chart slots for proper lookup.
        E.g., 09:16 -> '09:15', 09:19 -> '09:18', 10:47 -> '10:45'
        """
        minutes = dt.hour * 60 + dt.minute
        aligned_minutes = (minutes // interval_minutes) * interval_minutes
        aligned_hour = aligned_minutes // 60
        aligned_minute = aligned_minutes % 60
        return f"{aligned_hour:02d}:{aligned_minute:02d}"
    
    def update_timeseries(self, index_name: str):
        """Update timeseries (every 3 minutes)"""
        if index_name not in self.index_data:
            return
        
        data = self.index_data[index_name]
        current_time = datetime.now()
        
        # Align time_label to 3-minute slot boundary for chart synchronization
        aligned_time_label = self._align_to_slot(current_time, 3)
        
        # Check if 3 minutes have passed
        if data['last_timeseries_update']:
            elapsed = (current_time - data['last_timeseries_update']).total_seconds()
            if elapsed < 180:  # 3 minutes
                return
        
        # If no previous snapshot, save current as baseline
        if not data.get('last_interval_snapshot'):
            self.save_interval_snapshot(index_name)
            data['last_timeseries_update'] = current_time
            logger.debug(f"📊 {index_name}: Initial interval snapshot saved")
            return
        
        # Calculate dominance (full range - for Interval Dominance chart)
        dominance = self.calculate_interval_dominance(index_name)
        
        # Calculate ATM-based dominance (±5 strikes - for Price Action chart)
        atm_dominance = self.calculate_atm_oi_dominance(index_name)
        
        # Calculate weighted score
        weighted = self.calculate_weighted_score(index_name)
        
        # Calculate PCR
        pcr = self.calculate_pcr(index_name)
        
        # Add to timeseries with aligned time_label for chart slot matching
        entry = {
            'timestamp': current_time.isoformat(),
            'time_label': aligned_time_label,
            'weighted_net_score': weighted['score'],
            'signal': weighted['signal'],
            'pcr': pcr,
            # ATM-based dominance for Price Action chart (±5 strikes)
            'atm_bullish': atm_dominance['bullish_value'],
            'atm_bearish': atm_dominance['bearish_value'],
            'atm_net': atm_dominance['net_value'],
            **dominance  # Keep full-range dominance for Interval Dominance chart
        }
        
        # Check if an entry for this slot already exists - update it instead of duplicating
        existing_ts_idx = next((i for i, ts in enumerate(data['timeseries']) if ts.get('time_label') == aligned_time_label), None)
        if existing_ts_idx is not None:
            data['timeseries'][existing_ts_idx] = entry
        else:
            data['timeseries'].append(entry)
        
        existing_dom_idx = next((i for i, dom in enumerate(data['dominance_timeseries']) if dom.get('time_label') == aligned_time_label), None)
        if existing_dom_idx is not None:
            data['dominance_timeseries'][existing_dom_idx] = entry
        else:
            data['dominance_timeseries'].append(entry)
        
        # Save snapshot for next interval
        self.save_interval_snapshot(index_name)
        
        data['last_timeseries_update'] = current_time
        
        # Save to DB
        self.db.save_timeseries(
            index_name, weighted['score'], weighted['signal'],
            dominance['bullish_value'], dominance['bearish_value'], dominance['net_value'],
            dominance['ce_unwinding'], dominance['pe_buildup'],
            dominance['pe_unwinding'], dominance['ce_buildup'],
            data['total_ce_oi'], data['total_pe_oi'], pcr
        )
    
    def analyze_index(self, index_name: str) -> Dict:
        """Analyze all strikes and return data for UI"""
        if index_name not in self.index_data:
            return {'bar_graph_data': [], 'summary': {}}
        
        data = self.index_data[index_name]
        data['poll_count'] += 1
        
        bullish_count = 0
        bearish_count = 0
        bar_graph_data = []
        
        # Get monitored strikes
        monitored_strikes = self.get_monitored_strikes(index_name)
        
        for strike in monitored_strikes:
            if strike not in data['strikes_data']:
                continue
            
            sd = data['strikes_data'][strike]
            ce_change = sd['ce_oi_change_pct']
            pe_change = sd['pe_oi_change_pct']
            net_signal = pe_change - ce_change
            
            if net_signal > 0:
                signal_type = 'BULLISH'
                bullish_count += 1
            elif net_signal < 0:
                signal_type = 'BEARISH'
                bearish_count += 1
            else:
                signal_type = 'NEUTRAL'
            
            bar_graph_data.append({
                'strike': strike,
                'is_atm': strike == data['atm'],
                'ce_oi': sd['ce_oi'],
                'pe_oi': sd['pe_oi'],
                'ce_ltp': sd.get('ce_ltp', 0),
                'pe_ltp': sd.get('pe_ltp', 0),
                'ce_oi_baseline': sd.get('ce_oi_baseline', sd['ce_oi']),
                'pe_oi_baseline': sd.get('pe_oi_baseline', sd['pe_oi']),
                'ce_oi_change_pct': ce_change,
                'pe_oi_change_pct': pe_change,
                'ce_oi_poll_change_pct': sd.get('ce_oi_poll_change_pct', 0),
                'pe_oi_poll_change_pct': sd.get('pe_oi_poll_change_pct', 0),
                'net_signal': round(net_signal, 2),
                'signal_type': signal_type
            })
        
        # Sort by strike (highest first)
        bar_graph_data.sort(key=lambda x: x['strike'], reverse=True)
        
        # Update timeseries
        self.update_timeseries(index_name)
        
        # Calculate additional metrics
        pcr = self.calculate_pcr(index_name)
        max_pain = self.calculate_max_pain(index_name)
        sr_levels = self.calculate_support_resistance(index_name)
        weighted = self.calculate_weighted_score(index_name)
        
        # Determine overall trend
        if bullish_count > bearish_count:
            overall_trend = 'BULLISH'
        elif bearish_count > bullish_count:
            overall_trend = 'BEARISH'
        else:
            overall_trend = 'NEUTRAL'
        
        # Get IV analysis
        iv_analysis = self.get_iv_analysis(index_name)
        
        return {
            'index': index_name,
            'spot': data['spot'],
            'atm': data['atm'],
            'strike_interval': data['config'].strike_interval,
            'poll_count': data['poll_count'],
            'overall_trend': overall_trend,
            'pcr': pcr,
            'max_pain': max_pain,
            'support_resistance': sr_levels,
            'summary': {
                'bullish': bullish_count,
                'bearish': bearish_count,
                'neutral': len(bar_graph_data) - bullish_count - bearish_count
            },
            'bar_graph_data': bar_graph_data,
            'timeseries': data['timeseries'],
            'dominance_timeseries': data['dominance_timeseries'],
            'current_weighted_score': weighted,
            'total_ce_oi': data['total_ce_oi'],
            'total_pe_oi': data['total_pe_oi'],
            'iv_data': iv_analysis,
            'timestamp': datetime.now().isoformat()
        }
    
    # =========================================================================
    # IV TRACKING METHODS
    # =========================================================================
    
    def update_iv_data(self, index_name: str, iv_info: Dict):
        """
        Update IV data for an index (called from poll cycle)
        
        Args:
            index_name: Index identifier (NIFTY, BANKNIFTY, etc.)
            iv_info: Dict with avg_iv, atm_ce_iv, atm_pe_iv, spot_price
        """
        if index_name not in self.iv_data:
            return
        
        data = self.iv_data[index_name]
        current_time = datetime.now()
        
        avg_iv = iv_info.get('avg_iv', 0)
        if avg_iv <= 0:
            return
        
        # Calculate IV change from previous candle
        iv_change = 0
        if data['last_iv'] and data['last_iv'] > 0:
            iv_change = ((avg_iv - data['last_iv']) / data['last_iv']) * 100
        
        # Calculate price change
        spot_price = iv_info.get('spot_price', 0)
        price_change = 0
        if data['last_price'] and data['last_price'] > 0 and spot_price > 0:
            price_change = ((spot_price - data['last_price']) / data['last_price']) * 100
        
        # Create candle
        candle = {
            'timestamp': current_time.isoformat(),
            'time_label': current_time.strftime('%H:%M'),
            'avg_iv': round(avg_iv, 2),
            'atm_ce_iv': round(iv_info.get('atm_ce_iv', 0), 2),
            'atm_pe_iv': round(iv_info.get('atm_pe_iv', 0), 2),
            'iv_change_pct': round(iv_change, 3),
            'spot_price': round(spot_price, 2),
            'price_change_pct': round(price_change, 3)
        }
        
        data['candles'].append(candle)
        
        # Keep candle history bounded
        if len(data['candles']) > self.iv_config.IV_CANDLE_RETENTION:
            data['candles'] = data['candles'][-self.iv_config.IV_CANDLE_RETENTION:]
        
        # Update state
        data['current_iv'] = avg_iv
        data['last_iv'] = avg_iv
        data['last_price'] = spot_price
        
        # Determine IV trend
        if iv_change > 0.3:
            data['iv_trend'] = 'RISING'
        elif iv_change < -0.3:
            data['iv_trend'] = 'FALLING'
        else:
            data['iv_trend'] = 'STABLE'
        
        # Detect patterns
        self._detect_iv_pattern(index_name, candle)
        
        # Track momentum on active patterns
        self._track_pattern_momentum(index_name)
        
        logger.debug(f"📊 {index_name} IV: {avg_iv:.1f} ({iv_change:+.2f}%) Trend: {data['iv_trend']}")
    
    def _detect_iv_pattern(self, index_name: str, candle: Dict):
        """
        Detect consecutive IV rise patterns
        
        Pattern is detected when:
        - IV rises by >= IV_RISE_THRESHOLD for >= MIN_CONSECUTIVE_RISES candles
        """
        if index_name not in self.iv_data:
            return
        
        data = self.iv_data[index_name]
        iv_change = candle['iv_change_pct']
        
        if iv_change >= self.iv_config.IV_RISE_THRESHOLD:
            data['consecutive_rises'] += 1
            
            # Check if we've hit the minimum for a pattern
            if data['consecutive_rises'] >= self.iv_config.MIN_CONSECUTIVE_RISES:
                if data['active_pattern'] is None:
                    # Start new pattern
                    pattern_start_idx = max(0, len(data['candles']) - data['consecutive_rises'])
                    start_candle = data['candles'][pattern_start_idx] if pattern_start_idx < len(data['candles']) else candle
                    
                    data['active_pattern'] = {
                        'index_name': index_name,
                        'pattern_start': start_candle['time_label'],
                        'pattern_duration': data['consecutive_rises'],
                        'iv_at_start': start_candle['avg_iv'],
                        'iv_rise_total': sum(c['iv_change_pct'] for c in data['candles'][pattern_start_idx:]),
                        'price_at_signal': candle['spot_price'],
                        'momentum_by_window': {},
                        'peak_momentum': 0,
                        'peak_momentum_at': 0,
                        'momentum_duration': 0,
                        'direction': 'NEUTRAL',
                        'candles_since_signal': 0
                    }
                    logger.info(f"âš¡ {index_name}: IV SURGE pattern started at {start_candle['time_label']}")
                else:
                    # Extend existing pattern
                    data['active_pattern']['pattern_duration'] = data['consecutive_rises']
                    data['active_pattern']['iv_rise_total'] += iv_change
        else:
            # IV not rising - end pattern if active
            if data['active_pattern']:
                pattern = data['active_pattern']
                
                # Classify strength
                if pattern['pattern_duration'] > 0:
                    avg_rise = pattern['iv_rise_total'] / pattern['pattern_duration']
                    if avg_rise > self.iv_config.MODERATE_IV_RISE:
                        pattern['iv_strength'] = 'STRONG'
                    elif avg_rise > self.iv_config.WEAK_IV_RISE:
                        pattern['iv_strength'] = 'MODERATE'
                    else:
                        pattern['iv_strength'] = 'WEAK'
                
                pattern['iv_at_end'] = candle['avg_iv']
                pattern['pattern_end'] = candle['time_label']
                
                # Save to pattern history
                data['patterns'].append(pattern)
                
                # Keep pattern history bounded
                if len(data['patterns']) > self.iv_config.PATTERN_HISTORY_COUNT:
                    data['patterns'] = data['patterns'][-self.iv_config.PATTERN_HISTORY_COUNT:]
                
                logger.info(f"📉 {index_name}: IV pattern ended. Duration: {pattern['pattern_duration']}min, Rise: {pattern['iv_rise_total']:.2f}%")
                data['active_pattern'] = None
            
            data['consecutive_rises'] = 0
    
    def _track_pattern_momentum(self, index_name: str):
        """
        Track momentum for recent patterns
        
        For each pattern, track price movement after signal
        to determine momentum sustainability
        """
        if index_name not in self.iv_data:
            return
        
        data = self.iv_data[index_name]
        if not data['candles']:
            return
        
        current_price = data['candles'][-1]['spot_price']
        
        # Track active pattern
        if data['active_pattern'] and current_price > 0:
            pattern = data['active_pattern']
            pattern['candles_since_signal'] += 1
            
            signal_price = pattern['price_at_signal']
            if signal_price > 0:
                momentum = ((current_price - signal_price) / signal_price) * 100
                
                # Update peak momentum
                if abs(momentum) > abs(pattern['peak_momentum']):
                    pattern['peak_momentum'] = round(momentum, 3)
                    pattern['peak_momentum_at'] = pattern['candles_since_signal']
                    pattern['direction'] = 'BULLISH' if momentum > 0 else 'BEARISH'
        
        # Track recent completed patterns
        for pattern in data['patterns'][-5:]:
            if pattern.get('finalized'):
                continue
            
            signal_price = pattern.get('price_at_signal', 0)
            if signal_price > 0 and current_price > 0:
                momentum = ((current_price - signal_price) / signal_price) * 100
                
                if abs(momentum) > abs(pattern.get('peak_momentum', 0)):
                    pattern['peak_momentum'] = round(momentum, 3)
                    pattern['direction'] = 'BULLISH' if momentum > 0 else 'BEARISH'
    
    def get_iv_analysis(self, index_name: str) -> Dict:
        """
        Get IV analysis for an index - used in analyze_index()
        
        Returns:
            current_iv: Current aggregate IV
            iv_trend: RISING, FALLING, STABLE
            iv_change: Change from previous candle
            active_pattern: Currently forming pattern (if any)
            recent_patterns: Last 5 completed patterns
            iv_timeseries: Last 60 IV candles for chart
        """
        if index_name not in self.iv_data:
            return {
                'current_iv': None,
                'iv_trend': 'STABLE',
                'iv_change': 0,
                'active_pattern': None,
                'recent_patterns': [],
                'iv_timeseries': []
            }
        
        data = self.iv_data[index_name]
        
        return {
            'current_iv': data.get('current_iv'),
            'iv_trend': data.get('iv_trend', 'STABLE'),
            'iv_change': data['candles'][-1]['iv_change_pct'] if data['candles'] else 0,
            'active_pattern': data.get('active_pattern'),
            'recent_patterns': data['patterns'][-5:] if data['patterns'] else [],
            'iv_timeseries': data['candles'][-60:]  # Last hour of data
        }


# =============================================================================
# INDEX SCANNER SERVER
# =============================================================================

class IndexScannerServer:
    """
    Main server class for Index OI Scanner
    
    Handles:
    - Instrument loading for all indices
    - Real-time polling
    - Data processing
    - WebSocket connections
    - IV momentum tracking
    """
    
    def __init__(self, access_tokens: List[str]):
        self.access_tokens = access_tokens
        self.current_token_idx = 0
        
        # Rate limiting
        self.api_calls = 0
        self.last_api_reset = time.time()
        
        # Database
        self.db = DatabaseManager()
        
        # Strike monitor (includes IV tracking)
        self.strike_monitor = IndexStrikeMonitor(self.db)
        
        # Instrument storage
        self.index_options = {}      # {index: {strike: {CE: key, PE: key}}}
        self.index_spot_keys = {}    # {index: spot_key}
        self.fo_instruments = {}     # {key: info}
        self.symbol_to_key = {}
        self.key_to_symbol = {}
        
        # Active indices
        self.active_indices = get_active_indices()
        
        # Rolling snapshots for OI tracking
        self.rolling_snapshots = defaultdict(lambda: deque(maxlen=10))
        
        # WebSocket clients
        self.websocket_clients: List[WebSocket] = []
        
        # Polling state
        self.poll_count = 0
        self.last_snapshot_time = None
        self.is_running = False
        
        # IV Fetching State
        self.last_iv_fetch_time = None
        self.iv_expiry_dates = {}  # {index: expiry_date_str}
        
        # Stats
        self.stats = {
            'poll_count': 0,
            'last_poll_time': None,
            'active_indices': [],
            'total_strikes': 0
        }
        
        # Candlestick data storage (3-minute OHLC)
        self.candle_data = {}  # {index_name: [{timestamp, open, high, low, close}, ...]}
        self.last_candle_fetch_time = {}  # {index_name: datetime}
        
        logger.info("IndexScannerServer initialized with IV tracking")
        logger.info(f"  Active indices: {self.active_indices}")
    
    def get_headers(self) -> Dict:
        """Get headers with current access token"""
        token = self.access_tokens[self.current_token_idx]
        return {
            'Authorization': f'Bearer {token}',
            'Accept': 'application/json'
        }
    
    def rotate_token(self):
        """Rotate to next token"""
        self.current_token_idx = (self.current_token_idx + 1) % len(self.access_tokens)
    
    def check_rate_limit(self):
        """Check and handle rate limiting"""
        current_time = time.time()
        
        if current_time - self.last_api_reset >= 60:
            self.api_calls = 0
            self.last_api_reset = current_time
        
        if self.api_calls >= Config.MAX_API_CALLS_PER_MINUTE:
            sleep_time = 60 - (current_time - self.last_api_reset)
            if sleep_time > 0:
                logger.warning(f"âš ️ Rate limit approaching, sleeping {sleep_time:.1f}s")
                time.sleep(sleep_time)
                self.api_calls = 0
                self.last_api_reset = time.time()
    
    def record_api_call(self):
        """Record an API call"""
        self.api_calls += 1
    
    def fetch_quotes(self, instrument_keys: List[str]) -> Dict:
        """Fetch market quotes"""
        try:
            if not instrument_keys:
                return {}
            
            all_quotes = {}
            
            for i in range(0, len(instrument_keys), Config.API_BATCH_SIZE):
                self.check_rate_limit()
                
                batch = instrument_keys[i:i + Config.API_BATCH_SIZE]
                
                url = f"{Config.API_BASE_URL}/v2/market-quote/quotes"
                params = {'instrument_key': ','.join(batch)}
                
                response = requests.get(url, headers=self.get_headers(), params=params, timeout=15)
                self.record_api_call()
                
                if response.status_code == 200:
                    data = response.json()
                    if data.get('status') == 'success':
                        all_quotes.update(data.get('data', {}))
                
                elif response.status_code == 429:
                    logger.warning("âš ️ Rate limit 429 hit - waiting 60s")
                    time.sleep(60)
                    self.api_calls = 0
                    self.last_api_reset = time.time()
                    self.rotate_token()
                
                if i + Config.API_BATCH_SIZE < len(instrument_keys):
                    time.sleep(Config.API_BATCH_DELAY)
            
            return all_quotes
        except Exception as e:
            logger.error(f"Error fetching quotes: {e}")
            return {}
    
    async def load_instruments(self):
        """Load all index options instruments"""
        try:
            logger.info("📡 Loading index instruments...")
            
            url = "https://assets.upstox.com/market-quote/instruments/exchange/complete.json.gz"
            response = requests.get(url, timeout=60)
            response.raise_for_status()
            
            decompressed = gzip.decompress(response.content)
            instruments = json.loads(decompressed.decode('utf-8'))
            df = pd.DataFrame(instruments)
            
            # Filter F&O options - include NSE, BSE, and MCX
            fo_options = df[
                (df['segment'].isin(['NSE_FO', 'BSE_FO', 'MCX_FO'])) &
                (df['instrument_type'].isin(['CE', 'PE']))
            ].copy()
            
            # Process expiries
            fo_options['expiry_dt'] = pd.to_datetime(fo_options['expiry'] / 1000, unit='s')
            current_date = datetime.now()
            
            total_strikes = 0
            
            # Process each active index
            for index_name in self.active_indices:
                config = get_index_config(index_name)
                if not config:
                    continue
                
                # Store spot key
                self.index_spot_keys[index_name] = config.spot_key
                
                # Initialize strike monitor
                self.strike_monitor.initialize_index(index_name, config)
                
                # Determine correct segment based on exchange
                if config.exchange == 'MCX':
                    segment = 'MCX_FO'
                elif config.exchange == 'BSE':
                    segment = 'BSE_FO'
                else:
                    segment = 'NSE_FO'
                
                # Filter options for this index with correct segment
                index_opts = fo_options[
                    (fo_options['underlying_symbol'] == config.option_symbol) &
                    (fo_options['segment'] == segment)
                ]
                
                if index_opts.empty:
                    logger.warning(f"âš ️ No options found for {index_name} in segment {segment}")
                    continue
                
                # Get nearest expiry
                future_expiries = index_opts[index_opts['expiry_dt'] >= current_date]
                if future_expiries.empty:
                    continue
                
                nearest_expiry = future_expiries['expiry_dt'].min()
                index_opts = index_opts[index_opts['expiry_dt'] == nearest_expiry]
                
                # Store options by strike
                self.index_options[index_name] = {}
                
                for _, row in index_opts.iterrows():
                    key = row['instrument_key']
                    strike = row['strike_price']
                    opt_type = row['instrument_type']
                    trading_symbol = row.get('trading_symbol', '')
                    
                    self.fo_instruments[key] = {
                        'index': index_name,
                        'strike': strike,
                        'type': opt_type,
                        'expiry': nearest_expiry.strftime('%Y-%m-%d'),
                        'trading_symbol': trading_symbol
                    }
                    
                    if strike not in self.index_options[index_name]:
                        self.index_options[index_name][strike] = {}
                    self.index_options[index_name][strike][opt_type] = key
                    
                    # Build key mappings
                    self._build_key_mapping(key, trading_symbol)
                
                strikes_count = len(self.index_options[index_name])
                total_strikes += strikes_count
                
                # Store expiry for IV fetching
                self.iv_expiry_dates[index_name] = nearest_expiry.strftime('%Y-%m-%d')
                
                logger.info(f"✅ {index_name}: Loaded {strikes_count} strikes (expiry: {nearest_expiry.strftime('%d-%b')})")
            
            self.stats['total_strikes'] = total_strikes
            self.stats['active_indices'] = self.active_indices
            
            logger.info(f"✅ Loaded {len(self.fo_instruments)} option instruments")
            logger.info(f"✅ Total strikes across all indices: {total_strikes}")
            
        except Exception as e:
            logger.error(f"Error loading instruments: {e}")
            import traceback
            logger.error(traceback.format_exc())
            raise
    
    def _build_key_mapping(self, instrument_key: str, trading_symbol: str):
        """Build response key mapping"""
        if not trading_symbol:
            return
        
        segment = instrument_key.split('|')[0] if '|' in instrument_key else 'NSE_FO'
        
        parts = trading_symbol.split()
        if len(parts) >= 6:
            stock_name = parts[0]
            strike_val = parts[1]
            opt_type = parts[2]
            month_val = parts[4]
            year_val = parts[5]
            
            api_symbol = f"{stock_name}{year_val}{month_val}{strike_val}{opt_type}"
            api_response_key = f"{segment}:{api_symbol}"
            self.symbol_to_key[api_response_key] = instrument_key
            self.key_to_symbol[instrument_key] = api_response_key
        
        response_key = f"{segment}:{trading_symbol}"
        self.symbol_to_key[response_key] = instrument_key
    
    def fetch_index_spot(self, index_name: str) -> float:
        """
        Fetch spot price for an index
        
        For NSE/BSE indices: Uses index spot price
        For MCX commodities: Uses nearest futures LTP as proxy
        """
        if index_name not in self.index_spot_keys:
            return 0
        
        config = get_index_config(index_name)
        spot_key = self.index_spot_keys[index_name]
        
        try:
            # For MCX commodities, use nearest futures as spot proxy
            if config and config.exchange == 'MCX':
                return self._fetch_commodity_spot_proxy(index_name)
            
            # For equity indices, use index spot
            quotes = self.fetch_quotes([spot_key])
            
            for response_key, quote in quotes.items():
                if index_name.lower() in response_key.lower():
                    return float(quote.get('last_price', 0))
            
            # Try by key directly
            for key, quote in quotes.items():
                return float(quote.get('last_price', 0))
            
            return 0
        except Exception as e:
            logger.error(f"Error fetching {index_name} spot: {e}")
            return 0
    
    def _fetch_commodity_spot_proxy(self, index_name: str) -> float:
        """
        For MCX commodities, use the nearest futures contract LTP as spot proxy
        """
        try:
            # Get any option for this commodity to find its expiry
            if index_name not in self.index_options or not self.index_options[index_name]:
                return 0
            
            # Get the first strike to find a valid option key
            first_strike = list(self.index_options[index_name].keys())[0]
            option_types = self.index_options[index_name][first_strike]
            
            if 'CE' in option_types:
                some_option_key = option_types['CE']
            elif 'PE' in option_types:
                some_option_key = option_types['PE']
            else:
                return 0
            
            # Get option quote to derive underlying price
            quotes = self.fetch_quotes([some_option_key])
            
            for key, quote in quotes.items():
                # Use underlying price from the option quote if available
                underlying = quote.get('underlying_price', 0)
                if underlying and underlying > 0:
                    return float(underlying)
                
                # Otherwise estimate from ATM options
                ltp = quote.get('last_price', 0)
                oi = quote.get('oi', 0)
                
                # Return ATM strike as approximate spot
                instrument_info = self.fo_instruments.get(some_option_key, {})
                strike = instrument_info.get('strike', 0)
                if strike > 0:
                    return float(strike)
            
            return 0
        except Exception as e:
            logger.debug(f"Error fetching commodity spot proxy for {index_name}: {e}")
            return 0
    
    def process_index_strikes(self, index_name: str):
        """Process strike-level OI for an index"""
        if index_name not in self.index_options:
            return None
        
        try:
            # Collect all option keys
            all_keys = []
            strike_key_map = {}
            
            for strike, types in self.index_options[index_name].items():
                strike_key_map[strike] = {}
                for opt_type, key in types.items():
                    all_keys.append(key)
                    strike_key_map[strike][opt_type] = key
            
            if not all_keys:
                return None
            
            # Fetch quotes
            quotes = self.fetch_quotes(all_keys)
            
            # Process each strike
            for strike, types in strike_key_map.items():
                ce_oi = 0
                pe_oi = 0
                ce_ltp = 0
                pe_ltp = 0
                
                for opt_type, key in types.items():
                    response_key = self.key_to_symbol.get(key, key)
                    quote = quotes.get(response_key) or quotes.get(key)
                    
                    if not quote:
                        # Try alternative lookup
                        for qkey, qval in quotes.items():
                            if str(int(strike)) in qkey and opt_type in qkey:
                                quote = qval
                                break
                    
                    if quote:
                        oi = int(quote.get('oi', 0))
                        ltp = float(quote.get('last_price', 0))
                        
                        if opt_type == 'CE':
                            ce_oi = oi
                            ce_ltp = ltp
                        else:
                            pe_oi = oi
                            pe_ltp = ltp
                        
                        # Store in rolling snapshots
                        snapshot = {
                            'timestamp': int(time.time() * 1000),
                            'oi': oi,
                            'ltp': ltp
                        }
                        self.rolling_snapshots[key].append(snapshot)
                
                self.strike_monitor.update_strike_data(index_name, strike, ce_oi, pe_oi, ce_ltp, pe_ltp)
            
            # Analyze and return results
            return self.strike_monitor.analyze_index(index_name)
            
        except Exception as e:
            logger.error(f"Error processing strikes for {index_name}: {e}")
            return None
    
    def fetch_option_chain_iv(self, index_name: str) -> Dict:
        """
        Fetch IV from Upstox Option Chain API
        
        Uses the /v2/option/chain endpoint which returns option_greeks.iv
        for each strike. We aggregate IV from ATM ± 3 strikes.
        
        Returns:
            Dict with avg_iv, atm_ce_iv, atm_pe_iv, spot_price
        """
        try:
            config = get_index_config(index_name)
            if not config:
                return {}
            
            expiry_date = self.iv_expiry_dates.get(index_name)
            if not expiry_date:
                return {}
            
            self.check_rate_limit()
            
            url = f"{Config.API_BASE_URL}/v2/option/chain"
            params = {
                'instrument_key': config.spot_key,
                'expiry_date': expiry_date
            }
            
            response = requests.get(url, headers=self.get_headers(), params=params, timeout=15)
            self.record_api_call()
            
            if response.status_code == 200:
                data = response.json()
                if data.get('status') == 'success':
                    return self._extract_iv_from_chain(data.get('data', []), index_name)
            elif response.status_code == 429:
                logger.warning(f"âš ️ Rate limit 429 on IV fetch for {index_name}")
                self.rotate_token()
            else:
                logger.debug(f"IV fetch failed for {index_name}: {response.status_code}")
            
            return {}
        except Exception as e:
            logger.error(f"Error fetching IV for {index_name}: {e}")
            return {}
    
    def _extract_iv_from_chain(self, chain_data: List, index_name: str) -> Dict:
        """
        Extract aggregate IV from option chain data
        
        Calculates average IV from ATM ± 3 strikes
        """
        if not chain_data:
            return {}
        
        atm = self.strike_monitor.index_data.get(index_name, {}).get('atm', 0)
        config = get_index_config(index_name)
        
        if not atm or not config:
            return {}
        
        iv_range = config.strike_interval * 3  # ATM ± 3 strikes
        iv_values = []
        atm_ce_iv = 0
        atm_pe_iv = 0
        spot_price = self.strike_monitor.index_data.get(index_name, {}).get('spot', 0)
        
        for item in chain_data:
            strike = item.get('strike_price', 0)
            
            # Focus on strikes near ATM
            if abs(strike - atm) <= iv_range:
                # Extract call IV
                call_data = item.get('call_options', {})
                ce_greeks = call_data.get('option_greeks', {})
                ce_iv = ce_greeks.get('iv', 0)
                
                # Extract put IV
                put_data = item.get('put_options', {})
                pe_greeks = put_data.get('option_greeks', {})
                pe_iv = pe_greeks.get('iv', 0)
                
                if ce_iv and ce_iv > 0:
                    iv_values.append(ce_iv * 100)  # Convert to percentage
                if pe_iv and pe_iv > 0:
                    iv_values.append(pe_iv * 100)
                
                # Store ATM IV specifically
                if int(strike) == int(atm):
                    atm_ce_iv = ce_iv * 100 if ce_iv else 0
                    atm_pe_iv = pe_iv * 100 if pe_iv else 0
        
        if not iv_values:
            return {}
        
        avg_iv = statistics.mean(iv_values)
        
        return {
            'avg_iv': round(avg_iv, 2),
            'atm_ce_iv': round(atm_ce_iv, 2),
            'atm_pe_iv': round(atm_pe_iv, 2),
            'spot_price': spot_price
        }
    
    def fetch_intraday_candles(self, index_name: str) -> List[Dict]:
        """
        Fetch 3-minute intraday candlestick data from Upstox V3 API
        
        Endpoint: /v3/historical-candle/intraday/{instrument_key}/minutes/3
        
        Returns: List of candles with OHLC + timestamp
        """
        try:
            config = get_index_config(index_name)
            if not config:
                return []
            
            # Skip candle fetching for MCX commodities - their spot_key format
            # (MCX_FO|CRUDEOIL) isn't a valid instrument key for historical API
            if config.exchange == 'MCX':
                return self.candle_data.get(index_name, [])
            
            # Check cache - only fetch every 3 minutes
            now = datetime.now()
            last_fetch = self.last_candle_fetch_time.get(index_name)
            if last_fetch and (now - last_fetch).total_seconds() < 180:  # 3 minutes
                return self.candle_data.get(index_name, [])
            
            self.check_rate_limit()
            
            # URL encode the instrument key
            instrument_key = quote(config.spot_key, safe='')
            
            url = f"{Config.API_BASE_URL}/v3/historical-candle/intraday/{instrument_key}/minutes/3"
            
            response = requests.get(url, headers=self.get_headers(), timeout=15)
            self.record_api_call()
            
            if response.status_code == 200:
                data = response.json()
                if data.get('status') == 'success':
                    candles_raw = data.get('data', {}).get('candles', [])
                    
                    # Parse candles - format: [timestamp, open, high, low, close, volume, oi]
                    candles = []
                    for candle in candles_raw:
                        if len(candle) >= 5:
                            try:
                                timestamp_str = candle[0]
                                # Parse ISO format timestamp
                                ts = datetime.fromisoformat(timestamp_str.replace('Z', '+00:00'))
                                
                                candles.append({
                                    'timestamp': timestamp_str,
                                    'time_label': ts.strftime('%H:%M'),
                                    'open': float(candle[1]),
                                    'high': float(candle[2]),
                                    'low': float(candle[3]),
                                    'close': float(candle[4]),
                                    'volume': int(candle[5]) if len(candle) > 5 else 0
                                })
                            except (ValueError, IndexError) as e:
                                logger.debug(f"Error parsing candle: {e}")
                                continue
                    
                    # Sort by timestamp (oldest first)
                    candles.sort(key=lambda x: x['timestamp'])
                    
                    # Cache the candles
                    self.candle_data[index_name] = candles
                    self.last_candle_fetch_time[index_name] = now
                    
                    logger.debug(f"📈 {index_name}: Fetched {len(candles)} candles")
                    return candles
            elif response.status_code == 429:
                logger.warning("⚠️ Rate limit hit on candle fetch")
                time.sleep(5)
            else:
                logger.warning(f"Candle fetch failed for {index_name}: {response.status_code}")
            
            return self.candle_data.get(index_name, [])
            
        except Exception as e:
            logger.error(f"Error fetching candles for {index_name}: {e}")
            return self.candle_data.get(index_name, [])
    
    def generate_market_time_slots(self, index_name: str = None) -> List[str]:
        """
        Generate all 3-minute time slots for fixed X-axis chart display
        
        For MCX commodities (CRUDEOIL, NATURALGAS): 9:00 AM to 11:30 PM (290 slots)
        For equity indices (NIFTY, BANKNIFTY, etc.): 9:15 AM to 3:30 PM (126 slots)
        """
        slots = []
        interval = timedelta(minutes=3)
        
        # Check if this is an MCX commodity
        config = get_index_config(index_name) if index_name else None
        is_mcx = config and config.exchange == 'MCX'
        
        if is_mcx:
            # MCX trading hours: 9:00 AM to 11:30 PM
            start = datetime.strptime("09:00", "%H:%M")
            end = datetime.strptime("23:30", "%H:%M")
        else:
            # Equity indices: 9:15 AM to 3:30 PM
            start = datetime.strptime("09:15", "%H:%M")
            end = datetime.strptime("15:30", "%H:%M")
        
        current = start
        while current <= end:
            slots.append(current.strftime("%H:%M"))
            current += interval
        
        return slots
    
    def get_aligned_chart_data(self, index_name: str) -> Dict:
        """
        Get candlestick data aligned with OI sentiment and interval dominance
        
        Returns aligned data for synchronized charting with:
        - slots: All fixed 3-minute time slots (varies by exchange)
        - candles: OHLC candlestick data aligned to fixed slots
        - oi_sentiment: Aligned cumulative score timeseries
        - interval_dominance: Aligned dominance values
        """
        try:
            # Generate fixed time slots for X-axis (exchange-specific)
            all_slots = self.generate_market_time_slots(index_name)
            
            # Fetch candles
            candles = self.fetch_intraday_candles(index_name)
            
            # Get OI timeseries from strike monitor
            if index_name not in self.strike_monitor.index_data:
                return {
                    'slots': all_slots,
                    'candles': [],
                    'oi_sentiment': [],
                    'interval_dominance': [],
                    'spot': 0,
                    'atm': 0
                }
            
            data = self.strike_monitor.index_data[index_name]
            timeseries = data.get('timeseries', [])
            dominance = data.get('dominance_timeseries', [])
            
            # Build lookup maps for O(1) access
            candle_map = {c['time_label']: c for c in candles}
            timeseries_map = {ts.get('time_label', ''): ts for ts in timeseries}
            dominance_map = {dom.get('time_label', ''): dom for dom in dominance}
            
            # Build aligned data for each fixed time slot
            aligned_candles = []
            last_oi_entry = None
            last_dom_entry = None
            
            for slot in all_slots:
                candle = candle_map.get(slot)
                
                # Update last known OI/dominance entries for carry-forward
                if slot in timeseries_map:
                    last_oi_entry = timeseries_map[slot]
                if slot in dominance_map:
                    last_dom_entry = dominance_map[slot]
                
                if candle:
                    # We have candle data for this slot
                    aligned_candles.append({
                        **candle,
                        'oi_score': last_oi_entry.get('weighted_net_score', 0) if last_oi_entry else 0,
                        'oi_signal': last_oi_entry.get('signal', 'NEUTRAL') if last_oi_entry else 'NEUTRAL',
                        # Use ATM-based dominance (±5 strikes) for Price Action chart
                        'bullish_value': last_dom_entry.get('atm_bullish', 0) if last_dom_entry else 0,
                        'bearish_value': last_dom_entry.get('atm_bearish', 0) if last_dom_entry else 0,
                        'net_dominance': last_dom_entry.get('atm_net', 0) if last_dom_entry else 0
                    })
                else:
                    # No candle data for this slot - add placeholder with null values
                    aligned_candles.append({
                        'time_label': slot,
                        'timestamp': None,
                        'open': None,
                        'high': None,
                        'low': None,
                        'close': None,
                        'volume': None,
                        'oi_score': last_oi_entry.get('weighted_net_score', 0) if last_oi_entry else 0,
                        'oi_signal': last_oi_entry.get('signal', 'NEUTRAL') if last_oi_entry else 'NEUTRAL',
                        # Use ATM-based dominance (±5 strikes) for Price Action chart
                        'bullish_value': last_dom_entry.get('atm_bullish', 0) if last_dom_entry else 0,
                        'bearish_value': last_dom_entry.get('atm_bearish', 0) if last_dom_entry else 0,
                        'net_dominance': last_dom_entry.get('atm_net', 0) if last_dom_entry else 0
                    })
            
            # Prepare OI sentiment series for chart (also aligned to slots)
            oi_sentiment = []
            last_score = 0
            last_signal = 'NEUTRAL'
            for slot in all_slots:
                if slot in timeseries_map:
                    ts = timeseries_map[slot]
                    last_score = ts.get('weighted_net_score', 0)
                    last_signal = ts.get('signal', 'NEUTRAL')
                oi_sentiment.append({
                    'time_label': slot,
                    'score': last_score,
                    'signal': last_signal
                })
            
            # Prepare interval dominance series for chart (also aligned to slots)
            interval_dominance = []
            last_bullish = 0
            last_bearish = 0
            last_net = 0
            for slot in all_slots:
                if slot in dominance_map:
                    dom = dominance_map[slot]
                    last_bullish = dom.get('bullish_value', 0)
                    last_bearish = dom.get('bearish_value', 0)
                    last_net = dom.get('net_value', 0)
                interval_dominance.append({
                    'time_label': slot,
                    'bullish': last_bullish,
                    'bearish': last_bearish,
                    'net': last_net
                })
            
            # Calculate LIVE ATM-based dominance and score for the most recent candles
            # This ensures charts show data even before the 3-minute timeseries kicks in
            live_atm_dominance = self.strike_monitor.calculate_atm_oi_dominance(index_name)
            live_score = self.strike_monitor.calculate_weighted_score(index_name)
            
            # Apply live values to candles that don't have any dominance data
            for candle in aligned_candles:
                if candle.get('open') is not None:  # Valid candle
                    # If bullish/bearish values are still 0, use live values
                    if candle.get('bullish_value', 0) == 0 and candle.get('bearish_value', 0) == 0:
                        candle['bullish_value'] = live_atm_dominance['bullish_value']
                        candle['bearish_value'] = live_atm_dominance['bearish_value']
                        candle['net_dominance'] = live_atm_dominance['net_value']
                    # If oi_score is 0, use live score
                    if candle.get('oi_score', 0) == 0:
                        candle['oi_score'] = live_score['score']
                        candle['oi_signal'] = live_score['signal']
            
            return {
                'slots': all_slots,
                'candles': aligned_candles,
                'oi_sentiment': oi_sentiment,
                'interval_dominance': interval_dominance,
                'spot': data.get('spot', 0),
                'atm': data.get('atm', 0),
                'live_dominance': live_atm_dominance,
                'live_score': live_score
            }
            
        except Exception as e:
            logger.error(f"Error getting aligned chart data for {index_name}: {e}")
            return {'slots': [], 'candles': [], 'oi_sentiment': [], 'interval_dominance': []}
    
    async def poll_cycle(self):
        """Single polling cycle"""
        self.poll_count += 1
        cycle_start = time.time()
        current_time = time.time()
        
        results = {}
        
        # Check if we should fetch IV (every 60 seconds)
        should_fetch_iv = Config.IV_POLLING_ENABLED and (
            self.last_iv_fetch_time is None or 
            current_time - self.last_iv_fetch_time >= Config.IV_FETCH_INTERVAL
        )
        
        for index_name in self.active_indices:
            try:
                # Fetch spot price
                spot = self.fetch_index_spot(index_name)
                if spot > 0:
                    self.strike_monitor.update_spot(index_name, spot)
                
                # Process strikes
                analysis = self.process_index_strikes(index_name)
                
                # Fetch and update IV data (every 60 seconds) - Skip MCX commodities
                config = get_index_config(index_name)
                is_mcx = config and config.exchange == 'MCX'
                
                if should_fetch_iv and not is_mcx:
                    iv_info = self.fetch_option_chain_iv(index_name)
                    if iv_info and iv_info.get('avg_iv', 0) > 0:
                        self.strike_monitor.update_iv_data(index_name, iv_info)
                
                if analysis:
                    results[index_name] = analysis
                    
                    # Save to DB (bulk)
                    self._save_strike_data_bulk(index_name, analysis)
                
            except Exception as e:
                logger.error(f"Error processing {index_name}: {e}")
        
        # Update IV fetch time
        if should_fetch_iv:
            self.last_iv_fetch_time = current_time
            if self.poll_count <= 3:
                logger.info("📊 IV data fetched for all indices")
        
        # Update stats
        cycle_time = time.time() - cycle_start
        self.stats['poll_count'] = self.poll_count
        self.stats['last_poll_time'] = datetime.now().isoformat()
        self.stats['cycle_time'] = round(cycle_time, 2)
        
        # Broadcast to WebSocket clients
        await self.broadcast_update(results)
        
        if self.poll_count <= 3 or self.poll_count % 10 == 0:
            logger.info(f"📊 Poll #{self.poll_count} completed in {cycle_time:.2f}s - {len(results)} indices updated")
        
        return results
    
    def _save_strike_data_bulk(self, index_name: str, analysis: Dict):
        """Save strike data to database"""
        records = []
        
        for bar in analysis.get('bar_graph_data', []):
            records.append((
                index_name,
                bar['strike'],
                bar['ce_oi'],
                bar['pe_oi'],
                bar.get('ce_oi_baseline', bar['ce_oi']),
                bar.get('pe_oi_baseline', bar['pe_oi']),
                bar['ce_oi_change_pct'],
                bar['pe_oi_change_pct'],
                bar.get('ce_oi_poll_change_pct', 0),
                bar.get('pe_oi_poll_change_pct', 0),
                bar.get('ce_ltp', 0),
                bar.get('pe_ltp', 0),
                bar['is_atm'],
                bar['net_signal'],
                bar['signal_type']
            ))
        
        if records:
            self.db.save_strike_oi_bulk(records)
    
    async def start_polling(self):
        """Start the polling loop"""
        self.is_running = True
        logger.info(f"🚀 Starting polling loop (interval: {Config.POLLING_INTERVAL}s)")
        
        while self.is_running:
            try:
                await self.poll_cycle()
                await asyncio.sleep(Config.POLLING_INTERVAL)
            except Exception as e:
                logger.error(f"Polling error: {e}")
                await asyncio.sleep(5)
    
    def stop_polling(self):
        """Stop the polling loop"""
        self.is_running = False
        logger.info("⏹️ Polling stopped")
    
    async def connect_websocket(self, websocket: WebSocket):
        """Connect a WebSocket client"""
        await websocket.accept()
        self.websocket_clients.append(websocket)
        logger.info(f"🔌 WebSocket connected. Total: {len(self.websocket_clients)}")
    
    def disconnect_websocket(self, websocket: WebSocket):
        """Disconnect a WebSocket client"""
        if websocket in self.websocket_clients:
            self.websocket_clients.remove(websocket)
            logger.info(f"🔌 WebSocket disconnected. Total: {len(self.websocket_clients)}")
    
    async def broadcast_update(self, data: Dict):
        """Broadcast update to all WebSocket clients"""
        if not self.websocket_clients:
            return
        
        message = json.dumps({
            'type': 'update',
            'data': data,
            'timestamp': datetime.now().isoformat()
        })
        
        disconnected = []
        for client in self.websocket_clients:
            try:
                await client.send_text(message)
            except:
                disconnected.append(client)
        
        for client in disconnected:
            self.disconnect_websocket(client)


# =============================================================================
# FASTAPI APPLICATION
# =============================================================================

app = FastAPI(
    title="Index OI Scanner",
    description="Real-time Options OI monitoring for NIFTY, BANKNIFTY, SENSEX",
    version="1.0.0"
)

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Global scanner instance
scanner_server: Optional[IndexScannerServer] = None


@app.on_event("startup")
async def startup():
    """Initialize server on startup"""
    global scanner_server
    
    # Get access tokens from config or environment
    # Config.ACCESS_TOKENS_ENV contains the actual token(s), not an env var name
    tokens_str = Config.ACCESS_TOKENS_ENV or os.environ.get('UPSTOX_ACCESS_TOKENS', '')
    if not tokens_str:
        logger.error("❌ No access tokens found. Set token in config.py or UPSTOX_ACCESS_TOKENS environment variable.")
        return
    
    tokens = [t.strip() for t in tokens_str.split(',') if t.strip()]
    
    scanner_server = IndexScannerServer(tokens)
    await scanner_server.load_instruments()
    
    # Start polling in background
    asyncio.create_task(scanner_server.start_polling())
    
    logger.info("🚀 Index OI Scanner Server started!")


@app.on_event("shutdown")
async def shutdown():
    """Cleanup on shutdown"""
    global scanner_server
    if scanner_server:
        scanner_server.stop_polling()


# Static files
app.mount("/static", StaticFiles(directory="static"), name="static")


@app.get("/", response_class=HTMLResponse)
async def root():
    """Serve main page"""
    return FileResponse("static/index.html")


@app.get("/ai-analysis", response_class=HTMLResponse)
async def ai_analysis_page():
    """Serve AI Analysis page"""
    return FileResponse("static/ai-analysis.html")


# -----------------------------------------------------------------------------
# API ENDPOINTS
# -----------------------------------------------------------------------------

@app.get("/api/dashboard")
async def get_dashboard():
    """Get dashboard summary for all indices"""
    if not scanner_server:
        return {'error': 'Server not ready'}
    
    summary = {}
    
    for index_name in scanner_server.active_indices:
        if index_name in scanner_server.strike_monitor.index_data:
            data = scanner_server.strike_monitor.index_data[index_name]
            weighted = scanner_server.strike_monitor.calculate_weighted_score(index_name)
            pcr = scanner_server.strike_monitor.calculate_pcr(index_name)
            
            summary[index_name] = {
                'spot': data['spot'],
                'atm': data['atm'],
                'trend': weighted['signal'],
                'score': weighted['score'],
                'pcr': pcr,
                'poll_count': data['poll_count']
            }
    
    return {
        'indices': summary,
        'active': scanner_server.active_indices,
        'timestamp': datetime.now().isoformat()
    }


@app.get("/api/{index_name}/strikes/live")
async def get_index_strikes(index_name: str):
    """Get strike-level data for an index"""
    if not scanner_server:
        return {'error': 'Server not ready'}
    
    index_name = index_name.upper()
    
    if index_name not in scanner_server.active_indices:
        return {'error': f'Index {index_name} not active'}
    
    # Get from strike monitor
    analysis = scanner_server.strike_monitor.analyze_index(index_name)
    
    return analysis


@app.get("/api/{index_name}/timeseries")
async def get_index_timeseries(index_name: str):
    """Get timeseries data for an index"""
    if not scanner_server:
        return {'error': 'Server not ready'}
    
    index_name = index_name.upper()
    
    # Get from database
    timeseries = scanner_server.db.get_timeseries(index_name)
    
    return {
        'index': index_name,
        'timeseries': timeseries,
        'count': len(timeseries),
        'timestamp': datetime.now().isoformat()
    }


@app.get("/api/{index_name}/pcr")
async def get_index_pcr(index_name: str):
    """Get PCR data for an index"""
    if not scanner_server:
        return {'error': 'Server not ready'}
    
    index_name = index_name.upper()
    
    # Current PCR
    current_pcr = scanner_server.strike_monitor.calculate_pcr(index_name)
    
    # Historical PCR
    pcr_history = scanner_server.db.get_pcr_history(index_name)
    
    return {
        'index': index_name,
        'current_pcr': current_pcr,
        'history': pcr_history,
        'timestamp': datetime.now().isoformat()
    }


@app.get("/api/{index_name}/support-resistance")
async def get_index_sr(index_name: str):
    """Get support/resistance levels for an index"""
    if not scanner_server:
        return {'error': 'Server not ready'}
    
    index_name = index_name.upper()
    
    sr_levels = scanner_server.strike_monitor.calculate_support_resistance(index_name)
    
    return {
        'index': index_name,
        **sr_levels,
        'timestamp': datetime.now().isoformat()
    }


@app.get("/api/{index_name}/max-pain")
async def get_index_max_pain(index_name: str):
    """Get max pain data for an index"""
    if not scanner_server:
        return {'error': 'Server not ready'}
    
    index_name = index_name.upper()
    
    max_pain = scanner_server.strike_monitor.calculate_max_pain(index_name)
    max_pain_history = scanner_server.db.get_max_pain_history(index_name)
    
    data = scanner_server.strike_monitor.index_data.get(index_name, {})
    
    return {
        'index': index_name,
        'current': {
            'strike': max_pain['strike'],
            'spot': data.get('spot', 0),
            'distance': max_pain['distance']
        },
        'history': max_pain_history,
        'timestamp': datetime.now().isoformat()
    }


@app.get("/api/stats")
async def get_stats():
    """Get server statistics"""
    if not scanner_server:
        return {'error': 'Server not ready'}
    
    return scanner_server.stats


@app.get("/api/config")
async def get_config():
    """Get index configurations"""
    return {
        'indices': {name: {
            'display_name': cfg.display_name,
            'strike_interval': cfg.strike_interval,
            'strikes_range': cfg.strikes_range,
            'lot_size': cfg.lot_size
        } for name, cfg in INDICES.items()},
        'active': get_active_indices(),
        'polling_interval': Config.POLLING_INTERVAL,
        'iv_polling_enabled': Config.IV_POLLING_ENABLED,
        'iv_fetch_interval': Config.IV_FETCH_INTERVAL
    }


# -----------------------------------------------------------------------------
# CANDLESTICK CHART API ENDPOINT
# -----------------------------------------------------------------------------

@app.get("/api/{index_name}/candles")
async def get_index_candles(index_name: str):
    """Get candlestick data with aligned OI sentiment & interval dominance"""
    if not scanner_server:
        return {'error': 'Server not ready'}
    
    index_name = index_name.upper()
    
    if index_name not in scanner_server.active_indices:
        return {'error': f'Index {index_name} not active'}
    
    # Get aligned chart data
    chart_data = scanner_server.get_aligned_chart_data(index_name)
    
    return {
        'index': index_name,
        **chart_data,
        'timestamp': datetime.now().isoformat()
    }


# -----------------------------------------------------------------------------
# IV MOMENTUM API ENDPOINTS
# -----------------------------------------------------------------------------

@app.get("/api/{index_name}/iv")
async def get_index_iv(index_name: str):
    """Get IV data for a specific index"""
    if not scanner_server:
        return {'error': 'Server not ready'}
    
    index_name = index_name.upper()
    
    iv_data = scanner_server.strike_monitor.get_iv_analysis(index_name)
    
    return {
        'index': index_name,
        'iv_data': iv_data,
        'timestamp': datetime.now().isoformat()
    }


@app.get("/api/iv-summary")
async def get_iv_summary():
    """Get IV summary across all indices"""
    if not scanner_server:
        return {'error': 'Server not ready'}
    
    summary = {}
    for index_name in scanner_server.active_indices:
        iv_data = scanner_server.strike_monitor.get_iv_analysis(index_name)
        summary[index_name] = {
            'current_iv': iv_data.get('current_iv'),
            'iv_trend': iv_data.get('iv_trend', 'STABLE'),
            'iv_change': iv_data.get('iv_change', 0),
            'has_active_pattern': iv_data.get('active_pattern') is not None,
            'pattern_count': len(iv_data.get('recent_patterns', []))
        }
    
    return {
        'summary': summary,
        'timestamp': datetime.now().isoformat()
    }


@app.get("/api/iv-patterns")
async def get_all_iv_patterns():
    """Get recent IV patterns across all indices"""
    if not scanner_server:
        return {'error': 'Server not ready'}
    
    all_patterns = []
    for index_name in scanner_server.active_indices:
        iv_data = scanner_server.strike_monitor.get_iv_analysis(index_name)
        
        # Add active pattern if exists
        if iv_data.get('active_pattern'):
            pattern = iv_data['active_pattern'].copy()
            pattern['is_active'] = True
            all_patterns.append(pattern)
        
        # Add recent completed patterns
        for pattern in iv_data.get('recent_patterns', []):
            pattern_copy = pattern.copy()
            pattern_copy['is_active'] = False
            all_patterns.append(pattern_copy)
    
    # Sort by pattern start time (most recent first)
    all_patterns.sort(key=lambda p: p.get('pattern_start', ''), reverse=True)
    
    return {
        'patterns': all_patterns[:20],  # Last 20 patterns
        'timestamp': datetime.now().isoformat()
    }


# -----------------------------------------------------------------------------
# AI SIGNAL API ENDPOINTS
# -----------------------------------------------------------------------------

@app.get("/api/{index_name}/ai-signal")
async def get_ai_signal(index_name: str):
    """Get AI-generated trading suggestion for an index"""
    if not scanner_server:
        return {'error': 'Server not ready'}
    
    if not AI_AVAILABLE:
        return {'error': 'AI module not available'}
    
    index_name = index_name.upper()
    
    if index_name not in scanner_server.active_indices:
        return {'error': f'Index {index_name} not active'}
    
    try:
        ai_config = get_ai_config()
        
        if not ai_config.AI_ENABLED:
            return {'error': 'AI features disabled'}
        
        # Get current index analysis
        analysis = scanner_server.strike_monitor.analyze_index(index_name)
        
        # Create AI generator and get suggestion
        generator = AISignalGenerator(api_key=ai_config.NVIDIA_API_KEY, config=ai_config)
        market_data = generator.aggregate_market_data(analysis)
        suggestion = generator.generate_suggestion(market_data)
        
        return {
            'index': index_name,
            'ai_signal': suggestion,
            'market_data': market_data,
            'timestamp': datetime.now().isoformat()
        }
        
    except Exception as e:
        logger.error(f"AI signal generation failed for {index_name}: {e}")
        return {
            'index': index_name,
            'error': str(e),
            'timestamp': datetime.now().isoformat()
        }


@app.get("/api/{index_name}/confluence")
async def get_confluence_score(index_name: str):
    """Get confluence score (alignment of OI, PCR, MaxPain, IV) + Strike Crossover Analysis"""
    if not scanner_server:
        return {'error': 'Server not ready'}
    
    if not AI_AVAILABLE:
        return {'error': 'AI module not available'}
    
    index_name = index_name.upper()
    
    if index_name not in scanner_server.active_indices:
        return {'error': f'Index {index_name} not active'}
    
    try:
        # Get current index analysis
        analysis = scanner_server.strike_monitor.analyze_index(index_name)
        
        # Create AI generator to aggregate data
        generator = AISignalGenerator(api_key="")
        market_data = generator.aggregate_market_data(analysis)
        
        # Calculate confluence
        confluence = calculate_confluence_score(market_data)
        
        # Get strike crossover analysis (ATM ± 3 strikes)
        crossover_analysis = scanner_server.strike_monitor.calculate_atm_strike_crossover(index_name)
        
        return {
            'index': index_name,
            'confluence': confluence,
            'market_data': market_data,
            'crossover_analysis': crossover_analysis,
            'timestamp': datetime.now().isoformat()
        }
        
    except Exception as e:
        logger.error(f"Confluence calculation failed for {index_name}: {e}")
        return {
            'index': index_name,
            'error': str(e),
            'timestamp': datetime.now().isoformat()
        }


@app.get("/api/{index_name}/strike-crossover")
async def get_strike_crossover(index_name: str):
    """Get ATM Strike Crossover Analysis - CE vs PE OI comparison at near-ATM strikes"""
    if not scanner_server:
        return {'error': 'Server not ready'}
    
    index_name = index_name.upper()
    
    if index_name not in scanner_server.active_indices:
        return {'error': f'Index {index_name} not active'}
    
    try:
        # Get strike crossover analysis
        crossover_analysis = scanner_server.strike_monitor.calculate_atm_strike_crossover(index_name)
        
        # Get ATM info from strike monitor
        index_data = scanner_server.strike_monitor.index_data.get(index_name, {})
        
        return {
            'index': index_name,
            'atm': index_data.get('atm', 0),
            'spot': index_data.get('spot', 0),
            'crossover_analysis': crossover_analysis,
            'timestamp': datetime.now().isoformat()
        }
        
    except Exception as e:
        logger.error(f"Strike crossover analysis failed for {index_name}: {e}")
        return {
            'index': index_name,
            'error': str(e),
            'timestamp': datetime.now().isoformat()
        }


@app.get("/api/ai-summary")
async def get_ai_summary():
    """Get AI status and summary across all indices"""
    if not scanner_server:
        return {'error': 'Server not ready'}
    
    ai_config = get_ai_config()
    
    return {
        'ai_available': AI_AVAILABLE,
        'ai_enabled': ai_config.AI_ENABLED,
        'model': ai_config.MODEL_NAME,
        'rl_enabled': ai_config.RL_ENABLED,
        'rl_lookback_minutes': ai_config.RL_REWARD_LOOKBACK_MINUTES,
        'active_indices': scanner_server.active_indices,
        'timestamp': datetime.now().isoformat()
    }


# -----------------------------------------------------------------------------
# WEBSOCKET
# -----------------------------------------------------------------------------

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    """WebSocket endpoint for real-time updates"""
    if not scanner_server:
        await websocket.close(code=1011, reason="Server not ready")
        return
    
    try:
        await scanner_server.connect_websocket(websocket)
        
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        scanner_server.disconnect_websocket(websocket)
    except Exception as e:
        logger.error(f"WebSocket error: {e}")
        scanner_server.disconnect_websocket(websocket)


# =============================================================================
# MAIN
# =============================================================================

if __name__ == "__main__":
    uvicorn.run(app, host=Config.HOST, port=Config.PORT)
