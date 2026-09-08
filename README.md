# Karandaaz Pakistan - Monthly Budget vs Actual (MPR)

A comprehensive financial dashboard for tracking monthly budget vs actual spending across departments and streams.

## Project Structure

```
MPR/
├── backend/                 # Python Flask backend
│   ├── app.py              # Main Flask application
│   ├── data_loader.py      # CSV data loading and caching
│   ├── calculations.py     # Budget calculations and aggregations
│   ├── requirements.txt    # Python dependencies
│   ├── run.py             # Development runner
│   ├── .env.example       # Environment variables template
│   └── .gitignore
├── frontend/               # React/HTML frontend (to be refactored)
│   ├── templates/         # HTML templates
│   ├── static/
│   │   ├── css/          # Separated stylesheets
│   │   └── js/           # Separated JavaScript
│   └── index.html        # Current monolithic file (will be refactored)
├── Data/                  # CSV data files
│   ├── BvA-202627 - Budget (1).csv
│   ├── BvA-202627 - ActualDonor.csv
│   ├── Innovation.csv
│   ├── CIC.csv
│   ├── EOD.csv
│   └── BvA-202627 - CAPEX.csv
├── .gitignore
└── README.md
```

## Backend Setup

### Prerequisites
- Python 3.8+
- pip

### Installation

1. Navigate to backend directory:
   ```bash
   cd backend
   ```

2. Create virtual environment:
   ```bash
   python -m venv venv
   source venv/bin/activate  # On Windows: venv\Scripts\activate
   ```

3. Install dependencies:
   ```bash
   pip install -r requirements.txt
   ```

4. Create .env file:
   ```bash
   cp .env.example .env
   ```

5. Run development server:
   ```bash
   python run.py
   ```

Server will start at `http://localhost:5000`

## API Endpoints

### Health Check
- `GET /api/health` - Server health status

### Dashboard
- `GET /api/dashboard/summary` - Overall summary with KPIs
- `GET /api/dashboard/kpis` - KPI metrics (Budget, Actual, Variance, Burn Rate)

### Departments
- `GET /api/departments` - List all departments
- `GET /api/departments/<dept_name>` - Department details and streams

### Streams
- `GET /api/streams/<stream_name>` - Stream/workstream details

### Export
- `GET /api/export/csv` - Export data as CSV

### Configuration
- `GET /api/periods` - Available fiscal periods

## Query Parameters

Most endpoints support:
- `granularity`: 'Monthly', 'Quarterly', 'Yearly' (default: Monthly)
- `view_mode`: 'Period', 'QTD', 'YTD' (default: QTD)
- `period`: Fiscal month name (Jul-Jun) (default: Jul)
- `sort_by`: 'Spend', 'Variance' (default: Spend)

## Features

✅ Backend API structure with Flask
✅ CSV data loading and caching
✅ Modular calculations engine
✅ CORS support for frontend integration
✅ Error handling and logging

🚧 Data aggregation implementation (TODO)
🚧 Frontend refactoring with separated components (TODO)
🚧 Database integration (TODO)
🚧 Authentication/Authorization (TODO)

## Development

### Running Tests (TODO)
```bash
pytest
```

### Code Style
Follow PEP 8 guidelines:
```bash
pylint backend/
black backend/
```

## Deployment

### Using Gunicorn
```bash
gunicorn app:app --workers 4 --bind 0.0.0.0:5000
```

### Docker (TODO)
```bash
docker build -t mpr-backend .
docker run -p 5000:5000 mpr-backend
```

## Environment Variables

See `.env.example` for configuration options.

## License

Internal Use Only - Karandaaz Pakistan
