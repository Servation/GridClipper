@echo off
echo =========================================
echo   Starting GridClipper Application
echo =========================================
echo.

echo Installing/Verifying Python dependencies...
pip install -r requirements.txt

echo Launching backend and frontend together...
echo (You can simply close this single window to shut down the entire app!)
echo.

:: Wait 4 seconds in the background and then open the browser
start cmd /c "timeout /t 4 /nobreak >nul && start http://localhost:5173"

:: Use concurrently to run both processes in this same terminal window
npx --yes concurrently -c "cyan,magenta" -n "BACKEND,FRONTEND" "cd backend && python main.py" "cd frontend && npm run dev"
