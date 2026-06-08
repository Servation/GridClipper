import sys
import os
import threading
import uvicorn
import webview
from fastapi.staticfiles import StaticFiles

# Add backend to path so we can import the FastAPI app
sys.path.append(os.path.join(os.path.dirname(__file__), 'backend'))
from main import app

def get_resource_path(relative_path):
    # PyInstaller creates a temp folder and stores path in _MEIPASS
    if hasattr(sys, '_MEIPASS'):
        return os.path.join(sys._MEIPASS, relative_path)
    return os.path.join(os.path.abspath("."), relative_path)

# Mount the React frontend
frontend_path = get_resource_path(os.path.join("frontend", "dist"))

if os.path.exists(frontend_path):
    app.mount("/", StaticFiles(directory=frontend_path, html=True), name="frontend")
else:
    print(f"Warning: Frontend dist folder not found at {frontend_path}")

def start_server():
    uvicorn.run(app, host="127.0.0.1", port=8000, log_level="error")

if __name__ == '__main__':
    # Start the FastAPI server in a background thread
    t = threading.Thread(target=start_server, daemon=True)
    t.start()
    
    # Wait a tiny bit for server to spin up
    import time
    time.sleep(1)
    
    # Create and start the PyWebView window
    webview.create_window(
        title='GridClipper',
        url='http://127.0.0.1:8000',
        width=1200,
        height=800,
        text_select=False
    )
    webview.start()
