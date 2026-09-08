#!/usr/bin/env python3
"""
Data Loader Module
Handles loading and caching of CSV files
"""

import os
import pandas as pd
import logging
from typing import Dict, List, Optional

logger = logging.getLogger(__name__)


class DataLoader:
    """Load and cache budget and actual data from CSV files"""
    
    CSV_FILES = {
        'budget': 'BvA-202627 - Budget (1).csv',
        'actual_donor': 'BvA-202627 - ActualDonor.csv',
        'innovation': 'Innovation.csv',
        'cic': 'CIC.csv',
        'eod': 'EOD.csv',
        'capex': 'BvA-202627 - CAPEX.csv'
    }
    
    def __init__(self, data_dir: str):
        """Initialize data loader with data directory path"""
        self.data_dir = data_dir
        self.data = {}
        self.raw_data = {}
    
    def load_all_data(self) -> None:
        """Load all required CSV files"""
        logger.info(f"Loading data from {self.data_dir}")
        
        for key, filename in self.CSV_FILES.items():
            filepath = os.path.join(self.data_dir, filename)
            try:
                if os.path.exists(filepath):
                    df = pd.read_csv(filepath)
                    self.raw_data[key] = df
                    logger.info(f"Loaded {key}: {len(df)} rows")
                else:
                    logger.warning(f"File not found: {filepath}")
            except Exception as e:
                logger.error(f"Error loading {key} from {filepath}: {str(e)}")
    
    def get_raw_data(self, key: str) -> Optional[pd.DataFrame]:
        """Get raw data for a specific file"""
        return self.raw_data.get(key)
    
    def get_budget_data(self) -> Optional[pd.DataFrame]:
        """Get budget data"""
        return self.raw_data.get('budget')
    
    def get_actual_data(self) -> Optional[pd.DataFrame]:
        """Get actual spend data"""
        return self.raw_data.get('actual_donor')
    
    def get_all_data(self) -> Dict[str, pd.DataFrame]:
        """Get all loaded data"""
        return self.raw_data.copy()
    
    def refresh_data(self) -> None:
        """Reload all data from files"""
        self.raw_data.clear()
        self.data.clear()
        self.load_all_data()
        logger.info("Data refreshed")
