"""
INDEX OI SCANNER - Database Initialization
==========================================
Creates SQLite database with all required tables for index monitoring.

Tables:
- index_spot_history: Spot price timeseries per index
- strike_oi_live: Current strike-level OI (all indices)  
- strike_oi_timeseries: 3-min interval snapshots
- pcr_history: Put-Call Ratio tracking
- index_signals: Generated signals & alerts
- system_state: Server state for restarts
"""

import sqlite3
import os
from datetime import datetime

from config import Config

DB_PATH = Config.DB_PATH


def create_database():
    """Create the SQLite database with all tables"""
    
    # Backup existing database if exists
    if os.path.exists(DB_PATH):
        backup_name = f"index_scanner_backup_{datetime.now().strftime('%Y%m%d_%H%M%S')}.db"
        os.rename(DB_PATH, backup_name)
        print(f"📦 Existing database backed up to: {backup_name}")
    
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    
    # =========================================================================
    # INDEX SPOT HISTORY - Track spot price over time
    # =========================================================================
    cursor.execute('''
    CREATE TABLE IF NOT EXISTS index_spot_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        index_name TEXT NOT NULL,
        spot_price REAL NOT NULL,
        timestamp TIMESTAMP NOT NULL,
        date TEXT NOT NULL,
        interval_label TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
    ''')
    cursor.execute('CREATE INDEX IF NOT EXISTS idx_spot_index_date ON index_spot_history(index_name, date)')
    cursor.execute('CREATE INDEX IF NOT EXISTS idx_spot_timestamp ON index_spot_history(timestamp)')
    print("✅ Created table: index_spot_history")
    
    # =========================================================================
    # STRIKE OI LIVE - Current snapshot per index/strike
    # =========================================================================
    cursor.execute('''
    CREATE TABLE IF NOT EXISTS strike_oi_live (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        index_name TEXT NOT NULL,
        date TEXT NOT NULL,
        strike REAL NOT NULL,
        timestamp TIMESTAMP NOT NULL,
        ce_oi INTEGER DEFAULT 0,
        pe_oi INTEGER DEFAULT 0,
        ce_oi_baseline INTEGER DEFAULT 0,
        pe_oi_baseline INTEGER DEFAULT 0,
        ce_oi_change_pct REAL DEFAULT 0,
        pe_oi_change_pct REAL DEFAULT 0,
        ce_oi_poll_change_pct REAL DEFAULT 0,
        pe_oi_poll_change_pct REAL DEFAULT 0,
        ce_volume INTEGER DEFAULT 0,
        pe_volume INTEGER DEFAULT 0,
        ce_ltp REAL DEFAULT 0,
        pe_ltp REAL DEFAULT 0,
        ce_iv REAL DEFAULT 0,
        pe_iv REAL DEFAULT 0,
        is_atm BOOLEAN DEFAULT FALSE,
        net_signal REAL DEFAULT 0,
        signal_type TEXT DEFAULT 'NEUTRAL',
        UNIQUE(index_name, date, strike)
    )
    ''')
    cursor.execute('CREATE INDEX IF NOT EXISTS idx_strike_live_index_date ON strike_oi_live(index_name, date)')
    cursor.execute('CREATE INDEX IF NOT EXISTS idx_strike_live_strike ON strike_oi_live(index_name, strike)')
    print("✅ Created table: strike_oi_live")
    
    # =========================================================================
    # STRIKE OI TIMESERIES - 3-min interval snapshots for charts
    # =========================================================================
    cursor.execute('''
    CREATE TABLE IF NOT EXISTS strike_oi_timeseries (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        index_name TEXT NOT NULL,
        timestamp TIMESTAMP NOT NULL,
        date TEXT NOT NULL,
        interval_label TEXT,
        weighted_net_score REAL DEFAULT 0,
        signal TEXT DEFAULT 'NEUTRAL',
        bullish_value REAL DEFAULT 0,
        bearish_value REAL DEFAULT 0,
        net_value REAL DEFAULT 0,
        ce_unwinding REAL DEFAULT 0,
        pe_buildup REAL DEFAULT 0,
        pe_unwinding REAL DEFAULT 0,
        ce_buildup REAL DEFAULT 0,
        total_ce_oi INTEGER DEFAULT 0,
        total_pe_oi INTEGER DEFAULT 0,
        pcr REAL DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
    ''')
    cursor.execute('CREATE INDEX IF NOT EXISTS idx_timeseries_index_date ON strike_oi_timeseries(index_name, date)')
    cursor.execute('CREATE INDEX IF NOT EXISTS idx_timeseries_timestamp ON strike_oi_timeseries(timestamp)')
    print("✅ Created table: strike_oi_timeseries")
    
    # =========================================================================
    # PCR HISTORY - Put-Call Ratio tracking
    # =========================================================================
    cursor.execute('''
    CREATE TABLE IF NOT EXISTS pcr_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        index_name TEXT NOT NULL,
        timestamp TIMESTAMP NOT NULL,
        date TEXT NOT NULL,
        interval_label TEXT,
        pcr_oi REAL DEFAULT 0,
        pcr_volume REAL DEFAULT 0,
        total_ce_oi INTEGER DEFAULT 0,
        total_pe_oi INTEGER DEFAULT 0,
        total_ce_volume INTEGER DEFAULT 0,
        total_pe_volume INTEGER DEFAULT 0,
        change_from_open REAL DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
    ''')
    cursor.execute('CREATE INDEX IF NOT EXISTS idx_pcr_index_date ON pcr_history(index_name, date)')
    print("✅ Created table: pcr_history")
    
    # =========================================================================
    # INDEX SIGNALS - Generated alerts/signals
    # =========================================================================
    cursor.execute('''
    CREATE TABLE IF NOT EXISTS index_signals (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        index_name TEXT NOT NULL,
        signal_type TEXT NOT NULL,
        direction TEXT NOT NULL,
        trigger_time TIMESTAMP NOT NULL,
        trigger_details TEXT,
        net_score REAL DEFAULT 0,
        pcr REAL DEFAULT 0,
        spot_price REAL DEFAULT 0,
        status TEXT DEFAULT 'ACTIVE',
        ended_at TIMESTAMP,
        date TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
    ''')
    cursor.execute('CREATE INDEX IF NOT EXISTS idx_signals_index_date ON index_signals(index_name, date)')
    cursor.execute('CREATE INDEX IF NOT EXISTS idx_signals_status ON index_signals(status)')
    print("✅ Created table: index_signals")
    
    # =========================================================================
    # INDEX BASELINES - 9:15 baselines for each index
    # =========================================================================
    cursor.execute('''
    CREATE TABLE IF NOT EXISTS index_baselines (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        index_name TEXT NOT NULL,
        date TEXT NOT NULL,
        baseline_time TIMESTAMP NOT NULL,
        spot_price REAL DEFAULT 0,
        total_ce_oi INTEGER DEFAULT 0,
        total_pe_oi INTEGER DEFAULT 0,
        pcr REAL DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(index_name, date)
    )
    ''')
    cursor.execute('CREATE INDEX IF NOT EXISTS idx_baselines_index_date ON index_baselines(index_name, date)')
    print("✅ Created table: index_baselines")
    
    # =========================================================================
    # SUPPORT RESISTANCE - Calculated S/R levels from OI
    # =========================================================================
    cursor.execute('''
    CREATE TABLE IF NOT EXISTS support_resistance (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        index_name TEXT NOT NULL,
        date TEXT NOT NULL,
        timestamp TIMESTAMP NOT NULL,
        level_type TEXT NOT NULL,
        strike REAL NOT NULL,
        oi_value INTEGER DEFAULT 0,
        strength TEXT DEFAULT 'NORMAL',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
    ''')
    cursor.execute('CREATE INDEX IF NOT EXISTS idx_sr_index_date ON support_resistance(index_name, date)')
    print("✅ Created table: support_resistance")
    
    # =========================================================================
    # SYSTEM STATE - Track server state for restarts
    # =========================================================================
    cursor.execute('''
    CREATE TABLE IF NOT EXISTS system_state (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        key TEXT UNIQUE NOT NULL,
        value TEXT,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
    ''')
    print("✅ Created table: system_state")
    
    # =========================================================================
    # MAX PAIN HISTORY - Track max pain calculations
    # =========================================================================
    cursor.execute('''
    CREATE TABLE IF NOT EXISTS max_pain_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        index_name TEXT NOT NULL,
        timestamp TIMESTAMP NOT NULL,
        date TEXT NOT NULL,
        interval_label TEXT,
        max_pain_strike REAL NOT NULL,
        spot_price REAL DEFAULT 0,
        distance_from_spot REAL DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
    ''')
    cursor.execute('CREATE INDEX IF NOT EXISTS idx_maxpain_index_date ON max_pain_history(index_name, date)')
    print("✅ Created table: max_pain_history")
    
    # =========================================================================
    # IV CANDLES - Per-minute IV data for each index
    # =========================================================================
    cursor.execute('''
    CREATE TABLE IF NOT EXISTS iv_candles (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        index_name TEXT NOT NULL,
        timestamp TIMESTAMP NOT NULL,
        time_label TEXT NOT NULL,
        date TEXT NOT NULL,
        
        -- IV Values (from Upstox Option Chain API)
        atm_ce_iv REAL DEFAULT 0,
        atm_pe_iv REAL DEFAULT 0,
        avg_iv REAL DEFAULT 0,
        
        -- IV Changes
        iv_change_pct REAL DEFAULT 0,
        
        -- Price Context
        spot_price REAL DEFAULT 0,
        price_change_pct REAL DEFAULT 0,
        
        -- Greeks Summary (optional)
        avg_vega REAL DEFAULT 0,
        avg_theta REAL DEFAULT 0,
        avg_gamma REAL DEFAULT 0,
        
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(index_name, timestamp)
    )
    ''')
    cursor.execute('CREATE INDEX IF NOT EXISTS idx_iv_candles_index_date ON iv_candles(index_name, date)')
    cursor.execute('CREATE INDEX IF NOT EXISTS idx_iv_candles_timestamp ON iv_candles(timestamp)')
    print("✅ Created table: iv_candles")
    
    # =========================================================================
    # IV PATTERNS - Detected consecutive IV rise/fall patterns
    # =========================================================================
    cursor.execute('''
    CREATE TABLE IF NOT EXISTS iv_patterns (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        index_name TEXT NOT NULL,
        pattern_type TEXT DEFAULT 'IV_SURGE',
        date TEXT NOT NULL,
        
        -- Pattern Timing
        pattern_start TEXT NOT NULL,
        pattern_end TEXT,
        pattern_duration INTEGER DEFAULT 0,
        
        -- IV Metrics
        iv_at_start REAL DEFAULT 0,
        iv_at_end REAL DEFAULT 0,
        iv_rise_total REAL DEFAULT 0,
        iv_strength TEXT DEFAULT 'WEAK',
        
        -- Price at Signal
        price_at_signal REAL DEFAULT 0,
        
        -- Momentum Tracking (stored as JSON)
        momentum_by_window TEXT,
        
        -- Results
        peak_momentum REAL DEFAULT 0,
        peak_momentum_at INTEGER DEFAULT 0,
        momentum_duration INTEGER DEFAULT 0,
        momentum_fade_at INTEGER DEFAULT 0,
        direction TEXT DEFAULT 'NEUTRAL',
        
        -- Status
        is_active BOOLEAN DEFAULT TRUE,
        finalized BOOLEAN DEFAULT FALSE,
        
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
    ''')
    cursor.execute('CREATE INDEX IF NOT EXISTS idx_iv_patterns_index_date ON iv_patterns(index_name, date)')
    cursor.execute('CREATE INDEX IF NOT EXISTS idx_iv_patterns_active ON iv_patterns(is_active)')
    print("✅ Created table: iv_patterns")
    
    conn.commit()
    conn.close()
    
    print("\n" + "=" * 60)
    print("🚀 Index Scanner Database initialized successfully!")
    print(f"📁 Database file: {os.path.abspath(DB_PATH)}")
    print("=" * 60)


def reset_daily_data(date_str: str = None):
    """
    Reset daily data at market open (9:15 AM).
    Clears today's live data, keeps historical.
    """
    if date_str is None:
        date_str = datetime.now().strftime('%Y-%m-%d')
    
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    
    # Clear today's live strike data
    cursor.execute('DELETE FROM strike_oi_live WHERE date = ?', (date_str,))
    
    # Clear today's timeseries (start fresh)
    cursor.execute('DELETE FROM strike_oi_timeseries WHERE date = ?', (date_str,))
    
    # Clear today's PCR history
    cursor.execute('DELETE FROM pcr_history WHERE date = ?', (date_str,))
    
    # Clear today's baselines (will be set fresh at 9:15)
    cursor.execute('DELETE FROM index_baselines WHERE date = ?', (date_str,))
    
    # Clear today's S/R
    cursor.execute('DELETE FROM support_resistance WHERE date = ?', (date_str,))
    
    # Clear today's max pain
    cursor.execute('DELETE FROM max_pain_history WHERE date = ?', (date_str,))
    
    # Clear today's IV candles
    cursor.execute('DELETE FROM iv_candles WHERE date = ?', (date_str,))
    
    # Clear today's IV patterns (mark as inactive)
    cursor.execute('UPDATE iv_patterns SET is_active = FALSE WHERE date < ?', (date_str,))
    
    # Mark yesterday's signals as ended
    cursor.execute('''
        UPDATE index_signals 
        SET status = 'ENDED', ended_at = CURRENT_TIMESTAMP 
        WHERE date < ? AND status = 'ACTIVE'
    ''', (date_str,))
    
    conn.commit()
    conn.close()
    
    print(f"🔄 Daily data reset for {date_str}")


def get_db_stats():
    """Get statistics about the database"""
    if not os.path.exists(DB_PATH):
        return {'error': 'Database not found'}
    
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    
    stats = {}
    
    tables = [
        'index_spot_history', 'strike_oi_live', 'strike_oi_timeseries',
        'pcr_history', 'index_signals', 'index_baselines', 
        'support_resistance', 'max_pain_history', 'system_state',
        'iv_candles', 'iv_patterns'
    ]
    
    for table in tables:
        try:
            cursor.execute(f'SELECT COUNT(*) FROM {table}')
            stats[table] = cursor.fetchone()[0]
        except:
            stats[table] = 0
    
    conn.close()
    
    return stats


if __name__ == "__main__":
    import sys
    
    if len(sys.argv) > 1:
        if sys.argv[1] == "reset":
            reset_daily_data()
        elif sys.argv[1] == "stats":
            stats = get_db_stats()
            print("\n📊 Database Statistics:")
            for table, count in stats.items():
                print(f"  {table}: {count} rows")
        else:
            print("Usage: python init_db.py [reset|stats]")
    else:
        create_database()
