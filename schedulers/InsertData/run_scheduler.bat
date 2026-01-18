@echo off
echo ==========================================
echo InsertData Scheduler Service
echo ==========================================

REM Change to the script directory
cd /d "%~dp0"

REM Check if virtual environment exists
if not exist "venv" (
    echo Creating virtual environment...
    python -m venv venv
)

REM Activate virtual environment
call venv\Scripts\activate.bat

REM Install dependencies
echo Installing dependencies...
pip install -r requirements.txt

REM Run the scheduler
echo Starting InsertData Scheduler Service...
python scheduler_service.py

pause
