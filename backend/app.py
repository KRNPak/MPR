#!/usr/bin/env python3
"""
Karandaaz Pakistan - Budget vs Actual Dashboard Backend
Flask API server for data processing and aggregation
"""

import os
from flask import Flask, jsonify, request
from flask_cors import CORS
from dotenv import load_dotenv
from data_loader import DataLoader
from calculations import BudgetCalculations
import logging

# Load environment variables
load_dotenv()

# Initialize Flask app
app = Flask(__name__)
CORS(app)

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# Initialize data loader and calculations
data_loader = None
calculations = None


def initialize_data():
    """Initialize data on app startup"""
    global data_loader, calculations
    try:
        logger.info("Initializing data loader...")
        data_loader = DataLoader(os.path.join(os.path.dirname(__file__), '..', 'Data'))
        data_loader.load_all_data()
        
        logger.info("Initializing calculations engine...")
        calculations = BudgetCalculations(data_loader)
        logger.info("Data initialization complete")
    except Exception as e:
        logger.error(f"Error initializing data: {str(e)}")
        raise


# ========================================================================
# API ENDPOINTS
# ========================================================================

@app.route('/api/health', methods=['GET'])
def health():
    """Health check endpoint"""
    return jsonify({'status': 'ok', 'message': 'Server is running'}), 200


@app.route('/api/dashboard/summary', methods=['GET'])
def dashboard_summary():
    """
    Get overall dashboard summary with KPIs
    Query params: granularity (Monthly|Quarterly|Yearly), view_mode (Period|QTD|YTD), period (Jul|Aug|...)
    """
    try:
        granularity = request.args.get('granularity', 'Monthly')
        view_mode = request.args.get('view_mode', 'QTD')
        period = request.args.get('period', 'Jul')
        
        summary = calculations.get_summary(
            granularity=granularity,
            view_mode=view_mode,
            period=period
        )
        return jsonify(summary), 200
    except Exception as e:
        logger.error(f"Error fetching dashboard summary: {str(e)}")
        return jsonify({'error': str(e)}), 500


@app.route('/api/dashboard/kpis', methods=['GET'])
def dashboard_kpis():
    """
    Get KPI metrics (Budget, Actual, Variance, Burn Rate)
    """
    try:
        granularity = request.args.get('granularity', 'Monthly')
        view_mode = request.args.get('view_mode', 'QTD')
        period = request.args.get('period', 'Jul')
        
        kpis = calculations.get_kpis(
            granularity=granularity,
            view_mode=view_mode,
            period=period
        )
        return jsonify(kpis), 200
    except Exception as e:
        logger.error(f"Error fetching KPIs: {str(e)}")
        return jsonify({'error': str(e)}), 500


@app.route('/api/departments', methods=['GET'])
def get_departments():
    """
    Get all departments with their metrics
    Query params: sort_by (Spend|Variance), granularity, view_mode, period
    """
    try:
        sort_by = request.args.get('sort_by', 'Spend')
        granularity = request.args.get('granularity', 'Monthly')
        view_mode = request.args.get('view_mode', 'QTD')
        period = request.args.get('period', 'Jul')
        
        departments = calculations.get_departments(
            sort_by=sort_by,
            granularity=granularity,
            view_mode=view_mode,
            period=period
        )
        return jsonify(departments), 200
    except Exception as e:
        logger.error(f"Error fetching departments: {str(e)}")
        return jsonify({'error': str(e)}), 500


@app.route('/api/departments/<dept_name>', methods=['GET'])
def get_department_details(dept_name):
    """
    Get detailed breakdown for a specific department (streams/workstreams)
    """
    try:
        granularity = request.args.get('granularity', 'Monthly')
        view_mode = request.args.get('view_mode', 'QTD')
        period = request.args.get('period', 'Jul')
        sort_by = request.args.get('sort_by', 'Spend')
        
        details = calculations.get_department_details(
            dept_name=dept_name,
            sort_by=sort_by,
            granularity=granularity,
            view_mode=view_mode,
            period=period
        )
        return jsonify(details), 200
    except Exception as e:
        logger.error(f"Error fetching department details: {str(e)}")
        return jsonify({'error': str(e)}), 500


@app.route('/api/streams/<stream_name>', methods=['GET'])
def get_stream_details(stream_name):
    """
    Get detailed account-level breakdown for a stream/workstream
    """
    try:
        granularity = request.args.get('granularity', 'Monthly')
        view_mode = request.args.get('view_mode', 'QTD')
        period = request.args.get('period', 'Jul')
        
        details = calculations.get_stream_details(
            stream_name=stream_name,
            granularity=granularity,
            view_mode=view_mode,
            period=period
        )
        return jsonify(details), 200
    except Exception as e:
        logger.error(f"Error fetching stream details: {str(e)}")
        return jsonify({'error': str(e)}), 500


@app.route('/api/periods', methods=['GET'])
def get_available_periods():
    """
    Get list of available fiscal periods
    """
    try:
        periods = calculations.get_available_periods()
        return jsonify({'periods': periods}), 200
    except Exception as e:
        logger.error(f"Error fetching periods: {str(e)}")
        return jsonify({'error': str(e)}), 500


@app.route('/api/export/csv', methods=['GET'])
def export_csv():
    """
    Export data as CSV
    Query params: dept_name (optional), stream_name (optional)
    """
    try:
        dept_name = request.args.get('dept_name')
        stream_name = request.args.get('stream_name')
        
        csv_data = calculations.export_as_csv(
            dept_name=dept_name,
            stream_name=stream_name
        )
        return csv_data, 200, {'Content-Disposition': 'attachment; filename=budget_export.csv'}
    except Exception as e:
        logger.error(f"Error exporting CSV: {str(e)}")
        return jsonify({'error': str(e)}), 500


@app.errorhandler(404)
def not_found(error):
    """Handle 404 errors"""
    return jsonify({'error': 'Not found'}), 404


@app.errorhandler(500)
def internal_error(error):
    """Handle 500 errors"""
    return jsonify({'error': 'Internal server error'}), 500


# ========================================================================
# APP INITIALIZATION
# ========================================================================

if __name__ == '__main__':
    # Initialize data on startup
    initialize_data()
    
    # Run development server
    debug_mode = os.getenv('FLASK_ENV') == 'development'
    app.run(
        host='0.0.0.0',
        port=int(os.getenv('FLASK_PORT', 5000)),
        debug=debug_mode
    )
