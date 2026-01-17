@echo off
echo Starting Export Scheduler Service...
cd /d "%~dp0"
python scheduler_service.py
pause
