#!/usr/bin/env python3
"""
Development runner script
Usage: python run.py
"""

import sys
import os

# Add backend directory to path
sys.path.insert(0, os.path.dirname(__file__))

from app import app, initialize_data

if __name__ == '__main__':
    try:
        print("Initializing application...")
        initialize_data()
        print("Starting Flask development server...")
        app.run(debug=True, host='0.0.0.0', port=5000)
    except Exception as e:
        print(f"Error starting app: {e}")
        sys.exit(1)
