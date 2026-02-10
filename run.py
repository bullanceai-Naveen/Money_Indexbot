#!/usr/bin/env python3
"""
Index OI Scanner - Run Script
==============================
Convenience script to start the server with proper configuration.

Usage:
    python run.py                    # Start with default settings
    python run.py --port 8002        # Custom port
    python run.py --init             # Initialize database first
    python run.py --debug            # Enable debug logging
"""

import os
import sys
import argparse


def main():
    parser = argparse.ArgumentParser(description='Index OI Scanner Server')
    parser.add_argument('--port', type=int, default=8001, help='Server port (default: 8001)')
    parser.add_argument('--host', default='0.0.0.0', help='Server host (default: 0.0.0.0)')
    parser.add_argument('--init', action='store_true', help='Initialize database before starting')
    parser.add_argument('--debug', action='store_true', help='Enable debug logging')
    parser.add_argument('--token', help='Upstox access token (or set UPSTOX_ACCESS_TOKENS env var)')
    
    args = parser.parse_args()
    
    # Check for access token
    token = args.token or os.environ.get('UPSTOX_ACCESS_TOKENS')
    if not token:
        print("❌ ERROR: No access token provided!")
        print()
        print("Set token via:")
        print("  1. Environment variable: export UPSTOX_ACCESS_TOKENS='your_token'")
        print("  2. Command line: python run.py --token 'your_token'")
        print()
        sys.exit(1)
    
    # Set token in environment if provided via CLI
    if args.token:
        os.environ['UPSTOX_ACCESS_TOKENS'] = args.token
    
    # Initialize database if requested
    if args.init:
        print("📦 Initializing database...")
        from init_db import create_database
        create_database()
        print()
    
    # Configure logging
    import logging
    log_level = logging.DEBUG if args.debug else logging.INFO
    logging.basicConfig(
        level=log_level,
        format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
    )
    
    # Print startup info
    print("=" * 60)
    print("  INDEX OI SCANNER v1.0")
    print("=" * 60)
    print(f"  Host: {args.host}")
    print(f"  Port: {args.port}")
    print(f"  URL:  http://localhost:{args.port}")
    print(f"  Debug: {'Yes' if args.debug else 'No'}")
    print("=" * 60)
    print()
    
    # Start server
    import uvicorn
    uvicorn.run(
        "server:app",
        host=args.host,
        port=args.port,
        reload=args.debug,
        log_level="debug" if args.debug else "info"
    )


if __name__ == "__main__":
    main()
