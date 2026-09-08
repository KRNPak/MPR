#!/usr/bin/env python3
"""
Calculations Module
Handles all budget calculations, aggregations, and KPI computations
"""

import pandas as pd
import numpy as np
import logging
from typing import Dict, List, Optional, Any
from datetime import datetime
from data_loader import DataLoader

logger = logging.getLogger(__name__)


class BudgetCalculations:
    """Perform budget calculations and aggregations"""
    
    FISCAL_MONTHS = ['Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun']
    QUARTER_MAP = {
        'Jul': 'Q1', 'Aug': 'Q1', 'Sep': 'Q1',
        'Oct': 'Q2', 'Nov': 'Q2', 'Dec': 'Q2',
        'Jan': 'Q3', 'Feb': 'Q3', 'Mar': 'Q3',
        'Apr': 'Q4', 'May': 'Q4', 'Jun': 'Q4'
    }
    
    DEPT_SORT_ORDER = {
        'DFS': 0,
        'CIC': 1,
        'II': 2,
        'DI': 3,
        'RMC': 4,
        'STAFF AND ADMIN': 5,
        'CAPEX': 6
    }
    
    def __init__(self, data_loader: DataLoader):
        """Initialize calculations engine with loaded data"""
        self.data_loader = data_loader
        self.budget_df = data_loader.get_budget_data()
        self.actual_df = data_loader.get_actual_data()
    
    def get_available_periods(self) -> List[str]:
        """Get list of available fiscal periods"""
        return self.FISCAL_MONTHS.copy()
    
    def get_summary(self, granularity: str = 'Monthly', view_mode: str = 'QTD', 
                   period: str = 'Jul') -> Dict[str, Any]:
        """
        Get overall summary data
        
        Args:
            granularity: 'Monthly', 'Quarterly', 'Yearly'
            view_mode: 'Period', 'QTD', 'YTD'
            period: Fiscal month name
        
        Returns:
            Dictionary with summary metrics and departmental breakdown
        """
        try:
            logger.info(f"Calculating summary: {granularity}, {view_mode}, {period}")
            
            # TODO: Implement summary calculation logic
            summary = {
                'granularity': granularity,
                'view_mode': view_mode,
                'period': period,
                'total_budget': 0,
                'total_actual': 0,
                'total_variance': 0,
                'burn_rate': 0,
                'departments': []
            }
            
            return summary
        except Exception as e:
            logger.error(f"Error calculating summary: {str(e)}")
            raise
    
    def get_kpis(self, granularity: str = 'Monthly', view_mode: str = 'QTD',
                 period: str = 'Jul') -> Dict[str, Any]:
        """
        Get KPI metrics
        
        Returns:
            Dictionary with KPI values
        """
        try:
            logger.info(f"Calculating KPIs: {granularity}, {view_mode}, {period}")
            
            kpis = {
                'fy_total_budget': 0,
                'fy_total_actual': 0,
                'fy_variance': 0,
                'fy_burn_rate': 0,
                'period_budget': 0,
                'period_actual': 0
            }
            
            return kpis
        except Exception as e:
            logger.error(f"Error calculating KPIs: {str(e)}")
            raise
    
    def get_departments(self, sort_by: str = 'Spend', granularity: str = 'Monthly',
                       view_mode: str = 'QTD', period: str = 'Jul') -> List[Dict[str, Any]]:
        """
        Get all departments with their metrics
        
        Args:
            sort_by: 'Spend' or 'Variance'
            granularity: Time granularity
            view_mode: 'Period', 'QTD', 'YTD'
            period: Current fiscal month
        
        Returns:
            List of department dictionaries sorted by specified criteria
        """
        try:
            logger.info(f"Fetching departments, sorted by {sort_by}")
            
            departments = []
            # TODO: Implement department aggregation
            
            return departments
        except Exception as e:
            logger.error(f"Error fetching departments: {str(e)}")
            raise
    
    def get_department_details(self, dept_name: str, sort_by: str = 'Spend',
                              granularity: str = 'Monthly', view_mode: str = 'QTD',
                              period: str = 'Jul') -> Dict[str, Any]:
        """
        Get detailed breakdown for a specific department
        
        Returns:
            Dictionary with department metrics and streams
        """
        try:
            logger.info(f"Fetching details for department: {dept_name}")
            
            details = {
                'department': dept_name,
                'budget': 0,
                'actual': 0,
                'variance': 0,
                'streams': []
            }
            
            return details
        except Exception as e:
            logger.error(f"Error fetching department details: {str(e)}")
            raise
    
    def get_stream_details(self, stream_name: str, granularity: str = 'Monthly',
                          view_mode: str = 'QTD', period: str = 'Jul') -> Dict[str, Any]:
        """
        Get account-level breakdown for a stream
        
        Returns:
            Dictionary with stream metrics and accounts
        """
        try:
            logger.info(f"Fetching details for stream: {stream_name}")
            
            details = {
                'stream': stream_name,
                'budget': 0,
                'actual': 0,
                'variance': 0,
                'accounts': []
            }
            
            return details
        except Exception as e:
            logger.error(f"Error fetching stream details: {str(e)}")
            raise
    
    def export_as_csv(self, dept_name: Optional[str] = None,
                     stream_name: Optional[str] = None) -> str:
        """
        Export data as CSV
        
        Args:
            dept_name: Optional department filter
            stream_name: Optional stream filter
        
        Returns:
            CSV string
        """
        try:
            logger.info(f"Exporting data: dept={dept_name}, stream={stream_name}")
            
            # TODO: Implement CSV export logic
            csv_str = "Department,Budget,Actual,Variance\n"
            
            return csv_str
        except Exception as e:
            logger.error(f"Error exporting CSV: {str(e)}")
            raise
    
    def _safe_numeric(self, val: Any) -> float:
        """Safely convert value to numeric"""
        if val is None or pd.isna(val):
            return 0.0
        try:
            # Handle negative values in parentheses
            if isinstance(val, str):
                if '(' in val and ')' in val:
                    return -float(val.replace('(', '').replace(')', ''))
                return float(val.replace(',', ''))
            return float(val)
        except (ValueError, TypeError):
            return 0.0
